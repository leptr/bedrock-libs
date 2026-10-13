// Developed by: Petar Mijailovic (leptr)
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

import {
  EntityDamageCause,
  TicksPerSecond,
  system,
  world,
} from "@minecraft/server";
import {
  BVector2,
  BVector3,
  FULL_CIRCLE,
  HALF_CIRCLE,
  RIGHT_ANGLE,
} from "../better_vectors/better_vectors.js";
import {
  AngleOffset,
  DirectionalOffset,
  getEntitySettingsConfig,
  getAttackReferenceYaw,
  getTargetVector,
  rotationRelativeOffset,
  usesLegacyRotation,
} from "../toolkit/toolkit.js";
import { secondsToTicks } from "../utils/utils.js";
import { SETTINGS } from "../game_settings.js";
import { logger, logIgnoredError } from "../utils/logger.js";
import { CAMERA_SHAKE_DEFAULTS } from "../toolkit/effect_defaults.js";
import { ATTACK_DIRECTIONS, DAMAGE_PATTERNS } from "./constants.js";
import { applyTimedHitEffect } from "../toolkit/timed_effect.js";
import { applyCustomEffect } from "../toolkit/custom_effect.js";
/** @import { Entity } from "@minecraft/server" */
/** @import { CameraShake, EntityEffect, ParticleEffect, SoundEffect } from "../toolkit/toolkit.js" */

const ATTACK_DEFAULTS = SETTINGS.attack_system.defaults;
const UNIT_INTERVAL_MIN = 0;
const UNIT_INTERVAL_MAX = 1;
const RETURN_CURVE_MIDPOINT = 0.5;
const LINE_ATTACK_RADIUS_CAP = 5;
const LINE_ATTACK_SAMPLE_STEP = 0.25;
const LINE_ATTACK_FIRST_RING_RAYS = 4;
const LINE_ATTACK_OUTER_RING_RAYS = 8;
// Above this |y| a line attack's direction is too close to vertical to cross
// with world up.
const LINE_ATTACK_NEAR_VERTICAL_Y = 0.99;
// Cubic Hermite basis: the start value is weighted by 2t^3 - 3t^2 + 1 and the
// end value by -2t^3 + 3t^2.
const HERMITE_CUBIC_COEFF = 2;
const HERMITE_SQUARE_COEFF = 3;
const COLLIDER_PUSH_STRENGTH = 0.4;
const DEFAULT_PROJECTILE_SPAWN_EVENT = "minecraft:entity_spawned";
const DEFAULT_PROJECTILE_ID = "minecraft:arrow";
const activeAttackRotationLocks = new Map();
const activeAttackMovementDisables = new Map();
const activeEntityRotationRequestVersions = new Map();

function getActiveAttackControlTokens(
  map,
  entityId,
  shouldCreateIfMissing = false,
) {
  if (typeof entityId !== "string" || entityId.length === 0) {
    return undefined;
  }

  let tokens = map.get(entityId);
  if (!tokens && shouldCreateIfMissing) {
    tokens = new Set();
    map.set(entityId, tokens);
  }

  return tokens;
}

function addAttackControlToken(map, entity, runtimeToken, onFirstAcquire) {
  if (!entity?.isValid) {
    return;
  }

  if (runtimeToken === undefined) {
    onFirstAcquire(entity);
    return;
  }

  const tokens = getActiveAttackControlTokens(map, entity.id, true);
  if (!tokens || tokens.has(runtimeToken)) {
    return;
  }

  const shouldApplyControl = tokens.size === 0;
  tokens.add(runtimeToken);

  if (shouldApplyControl) {
    onFirstAcquire(entity);
  }
}

function removeAttackControlToken(map, entity, runtimeToken, onLastRelease) {
  if (!entity?.isValid) {
    return;
  }

  if (runtimeToken === undefined) {
    onLastRelease(entity);
    return;
  }

  const tokens = getActiveAttackControlTokens(map, entity.id);
  if (!tokens?.delete(runtimeToken)) {
    return;
  }

  if (tokens.size === 0) {
    map.delete(entity.id);
    onLastRelease(entity);
  }
}

function applyAttackRotationLock(entity, runtimeToken) {
  addAttackControlToken(
    activeAttackRotationLocks,
    entity,
    runtimeToken,
    target => lockEntityRotation(target),
  );
}

function releaseAttackRotationLock(entity, runtimeToken) {
  removeAttackControlToken(
    activeAttackRotationLocks,
    entity,
    runtimeToken,
    target => unlockEntityRotation(target),
  );
}

function applyAttackMovementDisable(entity, runtimeToken) {
  addAttackControlToken(
    activeAttackMovementDisables,
    entity,
    runtimeToken,
    target => target.triggerEvent(SETTINGS.entities.global_events.movement_off),
  );
}

function releaseAttackMovementDisable(entity, runtimeToken) {
  removeAttackControlToken(
    activeAttackMovementDisables,
    entity,
    runtimeToken,
    target => target.triggerEvent(SETTINGS.entities.global_events.movement_on),
  );
}

function getTimedAttackStateChanges(value) {
  if (Array.isArray(value)) {
    return value.filter(
      entry => typeof entry === "number" && Number.isFinite(entry) && entry > 0,
    );
  }

  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? [value]
    : [];
}

function hasTimedAttackStateChange(value) {
  return getTimedAttackStateChanges(value).length > 0;
}

/**
 * Whether a projectile should aim at the midpoint of the target's body rather
 * than its feet. Defaults on.
 * @param {Object} config - An attack's attackOptions.
 * @returns {boolean}
 */
export function shouldTargetProjectileCenter(config) {
  return config?.projectileTargetCenter ?? true;
}

function createZeroDirectionalOffset(
  shouldIgnoreVertical = false,
  shouldUseViewDirection = false,
) {
  return new DirectionalOffset(
    UNIT_INTERVAL_MIN,
    UNIT_INTERVAL_MIN,
    UNIT_INTERVAL_MIN,
    shouldIgnoreVertical,
    shouldUseViewDirection,
  );
}

function createZeroAngleOffset() {
  return new AngleOffset(UNIT_INTERVAL_MIN, UNIT_INTERVAL_MIN);
}

function clampUnitInterval(value) {
  return Math.max(UNIT_INTERVAL_MIN, Math.min(UNIT_INTERVAL_MAX, value));
}

function scheduleAttackStateChange(entity, delayTicks, callback) {
  for (const scheduledTick of getTimedAttackStateChanges(delayTicks)) {
    system.runTimeout(() => {
      if (!entity?.isValid) {
        return;
      }

      callback(entity);
    }, scheduledTick);
  }
}

export function setupAttackStateControls(entity, attackOptions, runtimeToken) {
  if (!entity?.isValid || !attackOptions) {
    return;
  }

  if (attackOptions.lockRotation) {
    applyAttackRotationLock(entity, runtimeToken);
  }

  if (attackOptions.disableMovement) {
    applyAttackMovementDisable(entity, runtimeToken);
  }

  scheduleAttackStateChange(
    entity,
    attackOptions.lockRotationAfterTime,
    target => applyAttackRotationLock(target, runtimeToken),
  );
  scheduleAttackStateChange(
    entity,
    attackOptions.disableMovementAfterTime,
    target => applyAttackMovementDisable(target, runtimeToken),
  );
  scheduleAttackStateChange(
    entity,
    attackOptions.unlockRotationAfterTime,
    target => releaseAttackRotationLock(target, runtimeToken),
  );
  scheduleAttackStateChange(
    entity,
    attackOptions.enableMovementAfterTime,
    target => releaseAttackMovementDisable(target, runtimeToken),
  );
}

export function cleanupAttackStateControls(
  entity,
  attackOptions,
  runtimeToken,
) {
  if (!entity?.isValid || !attackOptions) {
    return;
  }

  if (
    attackOptions.lockRotation ||
    hasTimedAttackStateChange(attackOptions.lockRotationAfterTime)
  ) {
    releaseAttackRotationLock(entity, runtimeToken);
  }

  if (
    attackOptions.disableMovement ||
    hasTimedAttackStateChange(attackOptions.disableMovementAfterTime)
  ) {
    releaseAttackMovementDisable(entity, runtimeToken);
  }
}

/**
 * Attack execution helpers: targeting, rotation and movement control,
 * projectiles, effects and knockback. Attacks themselves are created with
 * `AttackFactory.createAttack()`.
 *
 * Attack types:
 * - 'single': One damage instance after delay
 * - 'multi': Multiple sequential damage instances
 * - 'continuous': Repeated ticking damage over duration
 * - 'ranged': Spawns projectile entities
 * - 'multi_ranged': Spawns multiple projectiles
 * See `ATTACK_TYPES` in constants.js.
 *
 * Attack patterns:
 * - 'cone': Cone-shaped area in front of attacker
 * - 'area': Circular area around attacker or target point
 * - 'ring': Ring/donut shape with inner and outer radius
 * - 'arc': Filled arc sector that can grow clockwise or counter-clockwise over time
 * - 'line': Line/beam from attacker in facing direction
 * - 'spawn_entity': Spawns entities relative to the attacker or target location
 * Spawn-entity layouts can use ATTACK_SHAPES such as GRID, CIRCLE, TRIANGLE, PENTAGON, HEXAGON, OCTAGON, LINES, SQUARE, DIAMOND, and STAR.
 * See `DAMAGE_PATTERNS` in constants.js.
 *
 * Usage:
 *   const attack = AttackFactory.createAttack({
 *     type: 'single',        // Attack type
 *     pattern: 'cone',       // Attack pattern
 *     damage: 10,
 *     range: 5,
 *     angle: 45
 *   });
 *   attack.performAttack({ entity: myEntity });
 * Runtime overrides can be provided as a second argument:
 *   const attack = AttackFactory.createAttack(SETTINGS.entities.foo.attacks.bar, {
 *     range: 8,
 *     spawnConfig: { count: 6, shape: ATTACK_SHAPES.HEXAGON }
 *   });
 */

/** Entity types ignored by default knockback handling and target selection. */
export const KNOCKBACK_EXCLUDED_ENTITIES = [
  "minecraft:item",
  "minecraft:arrow",
  "minecraft:thrown_trident",
  "minecraft:xp_bottle",
  "minecraft:snowball",
  "minecraft:ender_pearl",
  "minecraft:eye_of_ender_signal",
  "minecraft:egg",
  "minecraft:fishing_hook",
];

const TARGET_REQUEST_TIMEOUT_TICKS = Math.max(
  2,
  Math.round(TicksPerSecond * 0.1),
);
const inFlightTargetRequests = new Map();
const targetRequestState = { queue: Promise.resolve() };

/**
 * @typedef {number | [number, number]} DamageValue
 */

function resolveVerticalRange(value, fallback) {
  const resolved = Number(value ?? fallback);
  return Number.isFinite(resolved)
    ? Math.max(UNIT_INTERVAL_MIN, resolved)
    : UNIT_INTERVAL_MIN;
}

function getSearchMaxDistance(range, verticalRange) {
  const resolvedRange = Number(range);
  const resolvedVertical = Number(verticalRange);
  if (!Number.isFinite(resolvedRange) || !Number.isFinite(resolvedVertical)) {
    return UNIT_INTERVAL_MIN;
  }
  return new BVector2(resolvedRange, resolvedVertical).magnitude();
}

function calculateEntityYawFromHorizontalDelta(
  deltaX,
  deltaZ,
  fallbackYaw = 0,
) {
  if (!Number.isFinite(deltaX) || !Number.isFinite(deltaZ)) {
    return fallbackYaw;
  }

  if (Math.abs(deltaX) < 0.0001 && Math.abs(deltaZ) < 0.0001) {
    return fallbackYaw;
  }

  return (-Math.atan2(deltaX, deltaZ) * HALF_CIRCLE) / Math.PI;
}

function calculateEntityYawToTarget(entity, target, fallbackYaw = 0) {
  if (!entity?.isValid || !target?.isValid) {
    return fallbackYaw;
  }

  const deltaX = Number(target.location?.x) - Number(entity.location?.x);
  const deltaZ = Number(target.location?.z) - Number(entity.location?.z);

  return calculateEntityYawFromHorizontalDelta(deltaX, deltaZ, fallbackYaw);
}

function resolveDirectionalOffset(offset, fallback) {
  const base = offset ?? fallback ?? createZeroDirectionalOffset(true);

  const ground = base?.getGround?.() ?? base?.ground ?? UNIT_INTERVAL_MIN;
  const side = base?.getSide?.() ?? base?.side ?? UNIT_INTERVAL_MIN;
  const front = base?.getFront?.() ?? base?.front ?? UNIT_INTERVAL_MIN;

  return new DirectionalOffset(
    ground,
    side,
    front,
    base?.ignoreVertical ?? false,
    base?.useViewDirection ?? false,
    base?.useTargetDirection ?? false,
  );
}

function isWithinHorizontalVerticalRange(
  origin,
  target,
  range,
  verticalRange,
  verticalOriginY,
  cancelVerticalNegative,
) {
  const horizontalOrigin = new BVector2(origin.x, origin.z);
  const horizontalTarget = new BVector2(target.x, target.z);
  const horizontalDistance = horizontalTarget.distance(horizontalOrigin);
  if (horizontalDistance > range) {
    return false;
  }
  const dy = BVector3.subtract(
    BVector3.from(target),
    new BVector3(origin.x, verticalOriginY, origin.z),
  ).y;
  if (cancelVerticalNegative) {
    return dy >= 0 && dy <= verticalRange;
  }
  return Math.abs(dy) <= verticalRange;
}

function isProtectedPlayerTarget(target) {
  if (!target?.isValid || typeof target?.getGameMode !== "function") {
    return false;
  }

  const mode = target.getGameMode();
  return mode === "Creative" || mode === "Spectator";
}

function isSurvivalPlayerTarget(target) {
  if (!target?.isValid || typeof target?.getGameMode !== "function") {
    return false;
  }

  return target.getGameMode() === "Survival";
}

function easeOutCirc(progress) {
  const clamped = clampUnitInterval(progress);
  return Math.sqrt(
    UNIT_INTERVAL_MAX -
      (clamped - UNIT_INTERVAL_MAX) * (clamped - UNIT_INTERVAL_MAX),
  );
}

function easeInCirc(progress) {
  const clamped = clampUnitInterval(progress);
  return UNIT_INTERVAL_MAX - Math.sqrt(UNIT_INTERVAL_MAX - clamped * clamped);
}

function sampleHermiteCurve(
  progress,
  startValue,
  endValue,
  startSlope,
  endSlope,
) {
  const clamped = clampUnitInterval(progress);
  const t2 = clamped * clamped;
  const t3 = t2 * clamped;

  return (
    (HERMITE_CUBIC_COEFF * t3 - HERMITE_SQUARE_COEFF * t2 + 1) * startValue +
    (t3 - 2 * t2 + clamped) * startSlope +
    (-HERMITE_CUBIC_COEFF * t3 + HERMITE_SQUARE_COEFF * t2) * endValue +
    (t3 - t2) * endSlope
  );
}

function getReturningDistanceProgress(
  normalizedTime,
  useEasing,
  minimumSpeedScale,
) {
  const clamped = clampUnitInterval(normalizedTime);

  if (!useEasing) {
    return (
      (clamped <= RETURN_CURVE_MIDPOINT
        ? clamped
        : UNIT_INTERVAL_MAX - clamped) * 2
    );
  }

  const minimumScale = clampUnitInterval(minimumSpeedScale);
  const normalizedStartSlope = 2 / (UNIT_INTERVAL_MAX + minimumScale);
  const normalizedMidpointSlope = normalizedStartSlope * minimumScale;

  if (clamped <= RETURN_CURVE_MIDPOINT) {
    return sampleHermiteCurve(
      easeOutCirc(clamped / RETURN_CURVE_MIDPOINT),
      UNIT_INTERVAL_MIN,
      UNIT_INTERVAL_MAX,
      normalizedStartSlope,
      normalizedMidpointSlope,
    );
  }

  return sampleHermiteCurve(
    easeInCirc((clamped - RETURN_CURVE_MIDPOINT) / RETURN_CURVE_MIDPOINT),
    UNIT_INTERVAL_MAX,
    UNIT_INTERVAL_MIN,
    -normalizedMidpointSlope,
    -normalizedStartSlope,
  );
}

function buildDirectionFromYawAndOffsets(baseYaw, thetaOffset, phiOffset) {
  const desiredTheta = baseYaw + thetaOffset;
  const desiredPhi = -phiOffset;
  return BVector3.fromAngles(desiredTheta + RIGHT_ANGLE, desiredPhi);
}

function applyProjectileImpulse(projectile, direction) {
  if (!projectile?.isValid || shouldStopProjectile(projectile)) {
    return;
  }

  projectile?.clearVelocity();
  projectile?.applyImpulse(direction);
}

/**
 * Check whether a projectile should stop being driven by scripted motion.
 * @param {Entity} projectile - Projectile entity to inspect.
 * @returns {boolean}
 */
export function shouldStopProjectile(projectile) {
  const stoppedTag = SETTINGS.entities.global_tags.projectile_stopped;

  return Boolean(
    !projectile?.isValid ||
    (typeof stoppedTag === "string" &&
      stoppedTag.length > 0 &&
      projectile?.hasTag?.(stoppedTag)),
  );
}

/**
 * Mark a projectile as stopped and clear its velocity.
 * @param {Entity} projectile - Projectile entity to stop.
 * @returns {boolean} True when the projectile was updated.
 */
export function stopProjectile(projectile) {
  if (!projectile?.isValid) {
    return false;
  }

  const stoppedTag = SETTINGS.entities.global_tags.projectile_stopped;
  const stopHomingTag = SETTINGS.entities.global_tags.projectile_stop_homing;

  try {
    if (typeof stoppedTag === "string" && stoppedTag.length > 0) {
      projectile.addTag(stoppedTag);
    }
  } catch (error) {
    logIgnoredError("attack_system/entity_attack:stopProjectile", error);
  }

  try {
    if (typeof stopHomingTag === "string" && stopHomingTag.length > 0) {
      projectile.addTag(stopHomingTag);
    }
  } catch (error) {
    logIgnoredError("attack_system/entity_attack:stopProjectile", error);
  }

  projectile.clearVelocity();
  return true;
}

/**
 * Knockback configuration shared by attack helpers.
 */
export class KnockbackOptions {
  /**
   * Provides knockback options for entity attacks.
   *
   * Timing fields can also be set on the object. They are not constructor
   * parameters:
   * - `startTime` (Number): Optional first knockback application time in seconds relative to the hit. Defaults to immediate.
   * - `endTime` (Number): Optional last knockback application time in seconds relative to the hit.
   * - `interval` (Number): Optional interval, in seconds, between repeated knockback applications.
   *
   * @param {Number} [strength] - Knockback strength.
   * @param {Number} [range] - Knockback range.
   */
  constructor(strength, range) {
    this.strength = strength ?? 0;
    this.range = range ?? 0;
  }

  /**
   * Returns a JSON string of the object
   */
  stringify() {
    return JSON.stringify(this);
  }
}

/**
 * Attack options with their default values. `parseOptions` fills one of
 * these from a partial options object.
 */
export class AttackOptions {
  /**
   * Provides attack options for entity attacks.
   *
   * The AttackFactory also reads these fields from an attack config. They are
   * not constructor parameters:
   * - `spawnConfig` (Object): Authored helper for generating spawn_entity hit layouts. Supports `count`, `radius`, `directionalOffset`, `angleOffset`, `shape`, `angle`, `angleSpacing`, `spacing`, `rowSpacing`, `columnSpacing`, `lineSpacing`, `layerDelay`, and `spawnOnEdges`. `shape: ATTACK_SHAPES.CIRCLE` mirrors projectile shotsConfig behavior, while `shape: ATTACK_SHAPES.LINES` treats `count` as the number of radial lines and uses radius as line length. `layerDelay` adds extra delay per distinct radial layer from nearest to farthest.
   * - `projectToGround` (Boolean): When true, DAMAGE_PATTERNS.SPAWN_ENTITY projects each spawned entity straight down to the first solid block below the generated spawn point.
   * - `entity` (String): Identifier of the entity that will be spawned by DAMAGE_PATTERNS.SPAWN_ENTITY.
   * - `directionalOffset` (DirectionalOffset): Rotated offset used by DAMAGE_PATTERNS.SPAWN_ENTITY when placing spawned entities. For direct spawn_entity hits this is the required offset from the spawn origin; generated spawnConfig layouts can derive offsets procedurally.
   * - `spawnAtTargetLocation` (Boolean): When true, DAMAGE_PATTERNS.SPAWN_ENTITY uses the current target location as its origin before applying directionalOffset.
   *
   * @param {String} pattern - Attack pattern/shape. Supports DAMAGE_PATTERNS.CONE, DAMAGE_PATTERNS.AREA, DAMAGE_PATTERNS.RING, DAMAGE_PATTERNS.ARC, DAMAGE_PATTERNS.LINE, and DAMAGE_PATTERNS.SPAWN_ENTITY. Defaults to DAMAGE_PATTERNS.CONE.
   * @param {Number} delay - Delay, in seconds, after which the damage will be dealt. Converted to ticks internally. Defaults to 0.
   * @param {DamageValue} damage - Amount of damage to be dealt. Can be a number or `[min, max]`. Defaults to 1.
   * @param {DirectionalOffset} damageOffset - Offset options for the damage origin, relative to the entity's location.
   * @param {AngleOffset} damageAngleOffset - Angle offset of the damage area, relative to the entity's rotation.
   * @param {Number} range - Attack range, in blocks. Defaults to 5.
   * @param {Number} verticalRange - Vertical radius, in blocks, from the entity's Y position used to include targets above and below. Defaults to 2 (effective vertical span of 4).
   * @param {Boolean} cancelVerticalNegative - When true, only targets at or above the entity's Y are checked (below Y is ignored). Defaults to false.
   * @param {Number} areaExpansionTime - Time, in seconds, for ring and arc attacks to expand from radius 0 to `range`. Converted to ticks internally. Defaults to 1.
   * @param {Number} arcGrowthTime - Legacy alias for arc sweep growth time. Arc attacks use damageDuration for sweep growth when it is set.
   * @param {String} arcDirection - Growth direction for arc attacks. Supported values are `clockwise` and `counter_clockwise`. Defaults to `clockwise`.
   * @param {Number} ringThickness - Ring thickness, in blocks, for ring attacks. Defaults to 1.
   * @param {Number} startAngle - Starting angular offset, in degrees, for arc attacks relative to the entity's facing and damageAngleOffset. Defaults to 0.
   * @param {Number} lineRadius - Radius, in blocks, for line attacks. Rays are cast from the center with radial rings every 0.25 blocks until this radius (clamped to 5). Warning: large values can be expensive and impact performance.
   * @param {Number} angle - Range of the cone attack, in degrees, inside which the damage will be dealt. For arc attacks, this is the final sweep angle. Defaults to 30 degrees.
   * @param {Number} duration - Duration of the attack, in seconds (should match up with the animation length). Converted to ticks internally. Defaults to 0.
   * @param {Number} damageDuration - Duration, in seconds, that damage will continuously be dealt. Converted to ticks internally. Defaults to 0.
   * @param {Number} interval - Interval, in ticks, between continuous damage or shots. Defaults to 0.
   * @param {Boolean} hasSpecialEffects - Whether the attack has any special effects on hit. Defaults to false.
   * @param {Boolean} lockRotation - Whether the entity's rotation should be locked when performing the attack. Defaults to false.
   * @param {Boolean} disableMovement - Whether the entity's movement should be disabled during the attack. Defaults to false.
   * @param {Number} disableMovementAfterTime - Delay in seconds before movement is disabled. Defaults to 0.
   * @param {Number} lockRotationAfterTime - Delay in seconds before rotation is locked. Defaults to 0.
   * @param {Number} enableMovementAfterTime - Delay in seconds before movement is enabled. Defaults to 0.
   * @param {Number} unlockRotationAfterTime - Delay in seconds before rotation is unlocked. Defaults to 0.
   * @param {String} startEvent - Entity event that will be called at the start of the attack. Defaults to SETTINGS.entities.global_events.attack_start.
   * @param {String} endEvent - Entity event that will be called at the end of the attack. Defaults to SETTINGS.entities.global_events.attack_end.
   * @param {KnockbackOptions} knockbackOptions - Knockback options for the attack
   * @param {EntityDamageCause} damageCause - Damage cause for the attack.
   * @param {Boolean} dontAssignDamagingEntity - If true, the damageCause for the attack will not be set.
   * @param {EntityEffect[]} hitEffects - Entity effects that are dealt to the target on hit.
   * @param {SoundEffect[]} soundEffects - Sound effects that are played when the hit is dealt.
   * @param {ParticleEffect[]} particleEffects - Particle effects that are summoned when the hit is dealt.
   * @param {CameraShake} cameraShakeEffect - Camera shake effect that is applied when the hit is dealt.
   * @param {Array} hits - Array of MultiHitAttack objects that will be performed during the attack.
   * @param {Array} shots - Array of MultiRangedAttack objects that will be performed during the attack.
   * @param {String} projectile - Identifier of the projectile that will be shot. Defaults to "minecraft:arrow".
   * @param {String} projectileSpawnEvent - The spawn event of the projectile. Defaults to "minecraft:entity_spawned".
   * @param {DirectionalOffset} projectileOffset - Offset options for the projectile, relative to the entity's location.
   * @param {AngleOffset} projectileAngleOffset - Angle offset of the projectile, relative to the entity's rotation.
   * @param {BVector3} projectileDirection - Custom direction at which the projectile will be shot. If excluded, the projectile will follow entity's line of sight.
   * @param {Number} projectileStrength - Strength at which the projectile will be shot. Defaults to 1.
   * @param {Boolean} projectileTargetCenter - Whether projectile targeting should aim at the target midpoint instead of raw location. Defaults to true.
   * @param {Number} projectileTargetYOffset - A constant offset applied to the target's Y position before computing the shooting direction. Defaults to 0.
   * @param {Number} projectileYDirectionDistributionScaling - A correction applied to the Y direction before normalization which scales with the horizontal distance to the target. Defaults to 0.
   * @param {Number} projectileBaseInaccuracy - The projectile inaccuracy applied when shooting without any reductions. Defaults to 0.
   * @param {Number} projectileInaccuracyChangePerDifficulty - A correction applied to the inaccuracy which scales with the difficulty level. Defaults to 0.
   * @param {Boolean} ignoreEntityRotation - Whether the projectiles should ignore the entity's rotation and use world rotation instead. Defaults to false.
   * @param {Number} startDelay - Delay, in seconds, after which a continuous ranged attack will start shooting projectiles. Converted to ticks internally. Defaults to 0.
   * @param {Number} endDelay - Delay, in seconds, after which a continuous ranged attack will stop, after the duration of the attack. Converted to ticks internally. Defaults to 0.
   * @param {String} shootSound - ID of the sound that will be played when the projectile is show.
   * @param {Number} isContinuous - Whether the projectile will continuously be propelled or not. Defaults to false.
   * @param {Number} isHoming - Whether the projectile should follow the entity's target or not. Defaults to false.
   * @param {Boolean} homeToTargetLocation - When true and `isHoming` is enabled, the projectile homes to a snapshot of the target's location taken at shot time. Defaults to false.
   * @param {Number} delayedHoming - Delay, in seconds, before homing starts. During this delay the projectile is continuously propelled in its initial direction. Converted to ticks internally. Defaults to 0.
   * @param {Boolean} isReturning - Whether the projectile should follow a closed return path back to its origin. Defaults to false.
   * @param {Number} flightTime - Total time, in seconds, for a returning projectile to travel out and back. Converted to ticks internally. When provided, the projectile reaches `range` at exactly half of this time. When omitted or 0, returning travel time is derived from the curve length using `range` and `projectileStrength`. Defaults to 0.
   * @param {Boolean} shouldArc - Whether a returning projectile should travel on a curved path shaped by its angle offset instead of a straight out-and-back line. Defaults to false.
   * @param {Boolean} useEasing - Whether a returning projectile should ease into the turnaround and accelerate back out of it. When false, it traverses the return curve at constant speed. Defaults to true.
   * @param {Number} minimumReturnSpeedScale - Minimum speed floor for returning projectiles, expressed as a fraction of `projectileStrength`. Must be between 0 and 1. Defaults to 0.5.
   * @param {Boolean} despawnOnReturn - Whether a returning projectile should despawn once it gets back to, or past, its origin point. Defaults to true.
   * @param {Number} offsetIgnoreVerticalRotation - Whether the entity's Y rotation should be ignored when adding the projectile offset. Defaults to false.
   * @param {Number} cancelVerticalMovement - Whether the projectile's vertical movement should be nullified or not. Defaults to false.
   * @param {Number} shooterMatchProjectileRotation - Whether the entity rotation should change to match the projectile's direction or not. Defaults to false.
   */
  constructor(
    pattern,
    delay,
    damage,
    range,
    verticalRange,
    cancelVerticalNegative,
    areaExpansionTime,
    ringThickness,
    lineRadius,
    angle,
    damageOffset,
    damageAngleOffset,
    duration,
    damageDuration,
    interval,
    hasSpecialEffects,
    lockRotation,
    disableMovement,
    disableMovementAfterTime,
    lockRotationAfterTime,
    enableMovementAfterTime,
    unlockRotationAfterTime,
    startEvent,
    endEvent,
    knockbackOptions,
    damageCause,
    dontAssignDamagingEntity,
    hitEffects,
    soundEffects,
    particleEffects,
    cameraShakeEffect,
    hits,
    shots,
    projectile,
    projectileSpawnEvent,
    projectileOffset,
    projectileAngleOffset,
    projectileDirection,
    projectileStrength,
    projectileTargetCenter,
    projectileTargetYOffset,
    projectileYDirectionDistributionScaling,
    projectileBaseInaccuracy,
    projectileInaccuracyChangePerDifficulty,
    ignoreEntityRotation,
    startDelay,
    endDelay,
    shootSound,
    isContinuous,
    isHoming,
    homeToTargetLocation,
    delayedHoming,
    isReturning,
    flightTime,
    shouldArc,
    useEasing,
    minimumReturnSpeedScale,
    despawnOnReturn,
    offsetIgnoreVerticalRotation,
    cancelVerticalMovement,
    shooterMatchProjectileRotation,
    arcGrowthTime,
    arcDirection,
    startAngle,
  ) {
    this.pattern = pattern ?? DAMAGE_PATTERNS.CONE;
    this.delay = delay ?? UNIT_INTERVAL_MIN;
    this.damage = damage ?? ATTACK_DEFAULTS.damage;
    this.range = range ?? ATTACK_DEFAULTS.range;
    this.verticalRange = verticalRange ?? ATTACK_DEFAULTS.vertical_range;
    this.cancelVerticalNegative = cancelVerticalNegative ?? false;
    this.areaExpansionTime =
      areaExpansionTime ?? ATTACK_DEFAULTS.area_expansion_time;
    this.arcGrowthTime = arcGrowthTime ?? UNIT_INTERVAL_MIN;
    this.arcDirection = arcDirection ?? ATTACK_DIRECTIONS.CLOCKWISE;
    this.ringThickness = ringThickness ?? ATTACK_DEFAULTS.ring_thickness;
    this.startAngle = startAngle ?? UNIT_INTERVAL_MIN;
    this.lineRadius = lineRadius ?? UNIT_INTERVAL_MIN;
    this.angle = angle ?? ATTACK_DEFAULTS.angle;
    this.damageOffset = damageOffset ?? createZeroDirectionalOffset();
    this.damageAngleOffset = damageAngleOffset ?? createZeroAngleOffset();
    this.duration = duration ?? UNIT_INTERVAL_MIN;
    this.damageDuration = damageDuration ?? UNIT_INTERVAL_MIN;
    this.interval = interval ?? UNIT_INTERVAL_MIN;
    this.hasSpecialEffects = hasSpecialEffects ?? false;
    this.lockRotation = lockRotation ?? false;
    this.disableMovement = disableMovement ?? false;
    this.disableMovementAfterTime =
      disableMovementAfterTime ?? UNIT_INTERVAL_MIN;
    this.lockRotationAfterTime = lockRotationAfterTime ?? UNIT_INTERVAL_MIN;
    this.enableMovementAfterTime = enableMovementAfterTime ?? UNIT_INTERVAL_MIN;
    this.unlockRotationAfterTime = unlockRotationAfterTime ?? UNIT_INTERVAL_MIN;
    this.startEvent =
      startEvent ?? SETTINGS.entities.global_events.attack_start;
    this.endEvent = endEvent ?? SETTINGS.entities.global_events.attack_end;
    this.knockbackOptions = knockbackOptions ?? new KnockbackOptions();
    this.damageCause = damageCause ?? EntityDamageCause.entityAttack;
    this.dontAssignDamagingEntity = dontAssignDamagingEntity ?? false;
    this.hitEffects = hitEffects ?? [];
    this.soundEffects = soundEffects ?? [];
    this.particleEffects = particleEffects ?? [];
    this.cameraShakeEffect = cameraShakeEffect;
    this.hits = hits ?? [];
    this.shots = shots ?? [];
    this.projectile = projectile ?? DEFAULT_PROJECTILE_ID;
    this.projectileSpawnEvent =
      projectileSpawnEvent ?? DEFAULT_PROJECTILE_SPAWN_EVENT;
    this.projectileOffset = projectileOffset ?? createZeroDirectionalOffset();
    this.projectileAngleOffset =
      projectileAngleOffset ?? createZeroAngleOffset();
    this.projectileDirection = projectileDirection;
    this.projectileStrength =
      projectileStrength ?? ATTACK_DEFAULTS.projectile_strength;
    this.projectileTargetCenter = projectileTargetCenter ?? true;
    this.projectileTargetYOffset = projectileTargetYOffset ?? UNIT_INTERVAL_MIN;
    this.projectileYDirectionDistScaling =
      projectileYDirectionDistributionScaling ?? UNIT_INTERVAL_MIN;
    this.projectileBaseInaccuracy =
      projectileBaseInaccuracy ?? UNIT_INTERVAL_MIN;
    this.projectileInaccuracyChangePerDifficulty =
      projectileInaccuracyChangePerDifficulty ?? UNIT_INTERVAL_MIN;
    this.ignoreEntityRotation = ignoreEntityRotation ?? false;
    this.startDelay = startDelay ?? UNIT_INTERVAL_MIN;
    this.endDelay = endDelay ?? UNIT_INTERVAL_MIN;
    this.shootSound = shootSound;
    this.isContinuous = isContinuous ?? false;
    this.isHoming = isHoming ?? false;
    this.homeToTargetLocation = homeToTargetLocation ?? false;
    this.delayedHoming = delayedHoming ?? UNIT_INTERVAL_MIN;
    this.isReturning = isReturning ?? false;
    this.flightTime = flightTime ?? UNIT_INTERVAL_MIN;
    this.shouldArc = shouldArc ?? false;
    this.useEasing = useEasing ?? true;
    this.minimumReturnSpeedScale =
      minimumReturnSpeedScale ?? ATTACK_DEFAULTS.minimum_return_speed_scale;
    this.despawnOnReturn = despawnOnReturn ?? true;
    this.offsetIgnoreVerticalRotation = offsetIgnoreVerticalRotation ?? false;
    this.cancelVerticalMovement = cancelVerticalMovement ?? false;
    this.shooterMatchProjectileRotation =
      shooterMatchProjectileRotation ?? false;
  }

  /**
   * Returns a JSON string of the object
   */
  stringify() {
    return JSON.stringify(this);
  }
}

/**
 * Flexible callback context object passed through attack execution hooks.
 */
export class AttackContext {
  /**
   * Container object passed to all attack callbacks.
   * This is intentionally a flexible bag-of-data so callers can add their own fields.
   *
   * @param {Object} data
   */
  constructor(data) {
    Object.assign(this, data ?? {});
  }

  /**
   * Points this context at the attack being executed.
   *
   * @param {Object} attack
   * @returns {AttackContext & Record<string, any>} This context.
   */
  bindAttack(attack) {
    return Object.assign(this, {
      attack,
      attackOptions: attack?.attackOptions,
      hasSpecialEffects: attack?.attackOptions?.hasSpecialEffects ?? false,
    });
  }
}

/**
 * An AttackContext together with the fields callers put on it. The context is
 * an open bag of data, so any field name is allowed.
 * @typedef {AttackContext & Record<string, any>} AttackContextData
 */

/**
 * Normalizes arbitrary attack data into a shared AttackContext.
 * @param {Object} attack
 * @param {Object|AttackContext} attackData
 * @returns {AttackContextData}
 */
function normalizeAttackContext(attack, attackData) {
  const context =
    attackData instanceof AttackContext
      ? attackData
      : new AttackContext(attackData);
  return context.bindAttack(attack);
}

function resolveAngleOffset(offset, fallback) {
  const base = offset ?? fallback ?? createZeroAngleOffset();
  const theta = base?.getTheta?.() ?? base?.theta ?? UNIT_INTERVAL_MIN;
  const phi = base?.getPhi?.() ?? base?.phi ?? UNIT_INTERVAL_MIN;
  return new AngleOffset(theta, phi);
}

function normalizeAreaKnockbackOptions(options) {
  const resolvedOptions = {
    ...options,
    pattern: options?.pattern ?? DAMAGE_PATTERNS.AREA,
    damage: UNIT_INTERVAL_MIN,
    damageOffset: resolveDirectionalOffset(
      options?.damageOffset ?? options?.directionalOffset,
      createZeroDirectionalOffset(true),
    ),
    damageAngleOffset: resolveAngleOffset(
      options?.damageAngleOffset ?? options?.angleOffset,
      createZeroAngleOffset(),
    ),
  };

  const knockbackOptions = {
    ...options?.knockbackOptions,
  };

  if (options?.horizontalStrength !== undefined) {
    knockbackOptions.horizontalStrength = options.horizontalStrength;
  }

  if (options?.verticalStrength !== undefined) {
    knockbackOptions.verticalStrength = options.verticalStrength;
  }

  if (options?.strength !== undefined) {
    knockbackOptions.strength = options.strength;
  }

  if (options?.knockbackRange !== undefined) {
    knockbackOptions.range = options.knockbackRange;
  }

  resolvedOptions.knockbackOptions = knockbackOptions;

  return parseOptions(resolvedOptions);
}

function normalizeAreaKnockbackContext(entity, attack, attackData) {
  const context = normalizeAttackContext(attack, attackData ?? {});
  context.entity ??= entity;
  context.excludeFamilies ??= context.excludedFamilies ?? [];
  context.excludeTypes ??= context.excludedTypes ?? [];
  context.excludeTags ??= context.excludedTags ?? [];
  context.excludeNames ??= context.excludedNames ?? [];
  context.excludeEntities ??= context.excludedEntities ?? [];
  return context;
}

function getExcludedEntityIds(excludedEntities) {
  const excludedIds = new Set();

  const entities = excludedEntities ?? [];
  for (const excludedEntity of entities) {
    if (typeof excludedEntity === "string" && excludedEntity.length > 0) {
      excludedIds.add(excludedEntity);
      continue;
    }

    if (
      excludedEntity?.id !== undefined &&
      excludedEntity?.id !== null &&
      excludedEntity.id !== ""
    ) {
      excludedIds.add(excludedEntity.id);
    }
  }

  return excludedIds;
}

function filterAreaKnockbackTargets(targets, context) {
  const excludedEntityIds = getExcludedEntityIds(context.excludeEntities);

  return targets.filter(target => {
    const targetEntity = target?.entity ?? target;

    if (!targetEntity?.isValid || isProtectedPlayerTarget(targetEntity)) {
      return false;
    }

    if (excludedEntityIds.has(targetEntity.id)) {
      return false;
    }

    if (typeof context.validateTarget === "function") {
      try {
        if (!context.validateTarget(targetEntity, context)) {
          return false;
        }
      } catch {
        return false;
      }
    }

    return true;
  });
}

function updateAreaKnockbackLineDirection(context, target) {
  if (!context?.entity?.isValid || !target?.isValid) {
    return;
  }

  const source = BVector3.from(context.entity.getHeadLocation());
  const targetLocation = BVector3.from(target.location);
  const targetHeadLocation = BVector3.from(target.getHeadLocation());
  const midpoint = BVector3.lerp(targetLocation, targetHeadLocation, 0.5);

  context.direction = BVector3.subtract(midpoint, source);
  context.target = target;
}

function applyAreaKnockbackHit(attack, context) {
  const { entity, onHitTarget, onHit, perTick } = context;

  if (
    !entity?.isValid ||
    (!context.allowDeadSource &&
      entity.getProperty(SETTINGS.entities.global_properties.dead))
  ) {
    return false;
  }

  context.tick = (context.tick ?? 0) + 1;

  if (typeof perTick === "function") {
    perTick(context);
  }

  context._resolvedDamageOffset = resolveDirectionalOffset(
    attack.attackOptions.damageOffset,
    new DirectionalOffset(0, 0, 0, true),
  );

  handleSoundEffects(entity, attack.attackOptions.soundEffects);
  handleParticleEffects(entity, attack.attackOptions.particleEffects);
  handleCameraShakeEffect(entity, attack.attackOptions.cameraShakeEffect);

  const targets = filterAreaKnockbackTargets(
    getAttackTargets(entity, attack, context),
    context,
  );
  context.targets = targets;

  for (const target of targets) {
    const targetEntity = target?.entity ?? target;

    if (!targetEntity?.isValid) {
      continue;
    }

    handleKnockback(entity, targetEntity, attack.attackOptions);

    if (typeof onHitTarget === "function") {
      context.target = targetEntity;
      onHitTarget(context);
    }
  }

  if (typeof onHit === "function") {
    context.target = null;
    onHit(context);
  }

  return true;
}

/**
 * Applies knockback to entities selected by the shared attack target selectors.
 * Accepts attack-style area options and performAttack-style exclusion data.
 *
 * @param {Entity} entity - Entity applying the knockback.
 * @param {Object} options - Knockback selector and force options.
 * @param {Object} [options.pattern] - Target pattern. Supports area, arc, line, and any pattern supported by getAttackTargets.
 * @param {Number} [options.range] - Horizontal target range.
 * @param {Number} [options.delay] - Delay in seconds before the first knockback application.
 * @param {Number} [options.duration] - Duration in seconds. When omitted, knockback is applied once immediately.
 * @param {Number} [options.verticalRange] - Vertical target range.
 * @param {DirectionalOffset|Object} [options.directionalOffset] - Alias for damageOffset.
 * @param {AngleOffset|Object} [options.angleOffset] - Alias for damageAngleOffset.
 * @param {Number} [options.horizontalStrength] - Horizontal knockback strength.
 * @param {Number} [options.verticalStrength] - Vertical knockback strength.
 * @param {SoundEffect[]} [options.soundEffects] - Sound effects emitted each time knockback is applied.
 * @param {ParticleEffect[]} [options.particleEffects] - Particle effects emitted each time knockback is applied.
 * @param {CameraShake} [options.cameraShakeEffect] - Camera shake emitted each time knockback is applied.
 * @param {Object} [attackData] - performAttack-style execution data, including excludeNames/excludeTags/excludeFamilies/excludeTypes and excluded* aliases.
 * @param {boolean} [attackData.allowDeadSource] - When true, the source entity may keep applying knockback after its custom dead property is set.
 * @returns {Promise<AttackContext>} The scheduled knockback context.
 */
export async function applyAreaKnockback(entity, options, attackData = {}) {
  const attack = {
    attackOptions: normalizeAreaKnockbackOptions(options ?? {}),
  };
  const context = normalizeAreaKnockbackContext(entity, attack, attackData);

  if (
    !context.entity?.isValid ||
    (!context.allowDeadSource &&
      context.entity.getProperty(SETTINGS.entities.global_properties.dead))
  ) {
    return context;
  }

  const isLineAttack = attack.attackOptions.pattern === DAMAGE_PATTERNS.LINE;
  const shouldDriveDirectionFromTarget =
    isLineAttack && context.direction === undefined;
  const cachedTarget = shouldDriveDirectionFromTarget
    ? await getTarget(context.entity)
    : undefined;

  const finalize = () => {
    if (typeof context.callback === "function") {
      context.callback(context);
    }
  };

  const runHit = () => {
    if (shouldDriveDirectionFromTarget && cachedTarget?.isValid) {
      updateAreaKnockbackLineDirection(context, cachedTarget);
    }

    return applyAreaKnockbackHit(attack, context);
  };

  const durationTicks = Number(attack.attackOptions.duration ?? 0);
  const delayTicks = Number(attack.attackOptions.delay ?? 0);
  const hasDuration = Number.isFinite(durationTicks) && durationTicks > 0;
  const hasDelay = Number.isFinite(delayTicks) && delayTicks > 0;

  const finishSingleHit = () => {
    finalize();
    return context;
  };

  const startDurationLoop = () => {
    if (!runHit()) {
      return context;
    }

    if (durationTicks <= 1) {
      finalize();
      return context;
    }

    let elapsedTicks = 1;
    const interval = system.runInterval(() => {
      if (
        !context.entity?.isValid ||
        (!context.allowDeadSource &&
          context.entity.getProperty(SETTINGS.entities.global_properties.dead))
      ) {
        system.clearRun(interval);
        context._areaKnockbackInterval = null;
        return;
      }

      elapsedTicks += 1;
      runHit();

      if (elapsedTicks >= durationTicks) {
        system.clearRun(interval);
        context._areaKnockbackInterval = null;
        finalize();
      }
    }, 1);

    context._areaKnockbackInterval = interval;
    return context;
  };

  const beginExecution = () => {
    if (!hasDuration) {
      runHit();
      return finishSingleHit();
    }

    return startDurationLoop();
  };

  if (hasDelay) {
    system.runTimeout(() => {
      if (
        !context.entity?.isValid ||
        (!context.allowDeadSource &&
          context.entity.getProperty(SETTINGS.entities.global_properties.dead))
      ) {
        return;
      }

      beginExecution();
    }, delayTicks);
    return context;
  }

  return beginExecution();
}

/**
 * Creates a fresh OptionsConstructor instance with defaults, then applies user-provided overrides.
 * Optionally normalizes nested option objects (e.g., knockbackOptions) into their class instances.
 *
 * @template T
 * @param {T|Object} options
 * @param {new (...args: any[]) => T} [OptionsConstructor]
 * @param {Record<string, new (...args: any[]) => any> | null} [nestedOptionConstructors]
 * @returns {T}
 */
export function parseOptions(
  options,
  OptionsConstructor,
  nestedOptionConstructors,
) {
  const resolvedOptions = options === undefined ? {} : options;
  const ResolvedOptionsConstructor =
    OptionsConstructor === undefined
      ? /** @type {new (...args: any[]) => any} */ (AttackOptions)
      : OptionsConstructor;
  const resolvedNestedOptionConstructors =
    nestedOptionConstructors === undefined
      ? { knockbackOptions: KnockbackOptions }
      : nestedOptionConstructors;

  const mergedOptions = new ResolvedOptionsConstructor();

  // Covers plain objects and instances of the options class alike.
  if (resolvedOptions !== null && typeof resolvedOptions === "object") {
    Object.assign(mergedOptions, resolvedOptions);
  }

  if (
    resolvedNestedOptionConstructors !== null &&
    typeof resolvedNestedOptionConstructors === "object"
  ) {
    for (const [key, NestedConstructor] of Object.entries(
      resolvedNestedOptionConstructors,
    )) {
      const nestedValue = mergedOptions[key];

      if (
        nestedValue === undefined ||
        nestedValue === null ||
        nestedValue instanceof NestedConstructor ||
        typeof nestedValue !== "object"
      ) {
        continue;
      }

      const mergedNestedValue = new NestedConstructor();
      Object.assign(mergedNestedValue, nestedValue);
      mergedOptions[key] = mergedNestedValue;
    }
  }

  if (mergedOptions !== null && typeof mergedOptions === "object") {
    const normalizeSecondsField = key => {
      const value = mergedOptions[key];
      if (Array.isArray(value)) {
        mergedOptions[key] = value
          .filter(
            entry =>
              typeof entry === "number" && Number.isFinite(entry) && entry > 0,
          )
          .map(entry => Math.max(0, Math.round(entry * TicksPerSecond)));
        return;
      }

      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
        mergedOptions[key] = 0;
        return;
      }
      mergedOptions[key] = Math.max(0, Math.round(value * TicksPerSecond));
    };

    for (const key of [
      "delay",
      "duration",
      "damageDuration",
      "startDelay",
      "endDelay",
      "areaExpansionTime",
      "arcGrowthTime",
      "delayedHoming",
      "flightTime",
      "disableMovementAfterTime",
      "lockRotationAfterTime",
      "enableMovementAfterTime",
      "unlockRotationAfterTime",
    ]) {
      if (Object.hasOwn(mergedOptions, key)) {
        normalizeSecondsField(key);
      }
    }
  }

  return mergedOptions;
}

/**
 * Gets targets of the attack using the corresponding target selection method.
 * @param {Entity} entity - The entity performing the attack.
 * @param {Object} attack - The attack object containing the attack data.
 * @param {Object} attackData - The attack data object.
 */
function getAttackTargets(entity, attack, attackData) {
  let targets = [];

  switch (attack.attackOptions.pattern) {
    case DAMAGE_PATTERNS.CONE: {
      targets = handleConeAttack(entity, attack, attackData);
      break;
    }
    case DAMAGE_PATTERNS.AREA: {
      targets = handleAreaAttack(entity, attack, attackData);
      break;
    }
    case DAMAGE_PATTERNS.RING: {
      targets = handleRingAttack(entity, attack, attackData);
      break;
    }
    case DAMAGE_PATTERNS.ARC: {
      targets = handleArcAttack(entity, attack, attackData);
      break;
    }
    case DAMAGE_PATTERNS.LINE: {
      targets = handleLineAttack(entity, attack, attackData);
      break;
    }
    default: {
      break;
    }
  }

  targets = targets.filter(t => t?.isValid && !isProtectedPlayerTarget(t));
  return targets;
}

/**
 * Gets targets of the attack using the corresponding target selection method.
 * @param {Entity} entity - The entity performing the attack.
 * @param {Object} attack - The attack object containing the attack data.
 * @param {Object} attackData - The attack data object.
 */
function handleConeAttack(entity, attack, attackData) {
  if (!isValid(entity)) {
    return [];
  }

  const targets = [];
  const excludedNames = [];
  const excludedTags = [];
  const excludedFamilies = [];
  const excludedTypes = [];

  if (attackData.excludeNames !== undefined) {
    excludedNames.push(...attackData.excludeNames);
  }
  if (attackData.excludeTags !== undefined) {
    excludedTags.push(...attackData.excludeTags);
  }
  if (attackData.excludeFamilies !== undefined) {
    excludedFamilies.push(...attackData.excludeFamilies);
  }
  if (attackData.excludeTypes !== undefined) {
    excludedTypes.push(...attackData.excludeTypes);
  }

  const tameable = entity?.getComponent(
    SETTINGS.entities.components.tameable.id,
  );
  if (tameable?.isTamed) {
    const name = tameable.tamedToPlayer?.name;
    if (name !== undefined && name !== null) {
      excludedNames.push(name);
    }
  }

  const loc =
    attackData.location === undefined
      ? rotationRelativeOffset(
          entity,
          attackData?._resolvedDamageOffset ??
            attack?.attackOptions?.damageOffset ??
            createZeroDirectionalOffset(true),
        )
      : attackData.location;

  const entities =
    entity?.dimension.getEntities({
      location: loc,
      excludeNames: excludedNames,
      excludeTags: excludedTags,
      excludeFamilies: ["inanimate", ...excludedFamilies],
      excludeTypes: [
        entity?.typeId,
        ...KNOCKBACK_EXCLUDED_ENTITIES,
        ...excludedTypes,
      ],
      maxDistance: getSearchMaxDistance(
        attack.attackOptions.range,
        resolveVerticalRange(attack?.attackOptions?.verticalRange, 2),
      ),
    }) ?? [];

  for (const t of entities) {
    if (!t?.isValid) {
      continue;
    }
    const angleOffset =
      attack?.attackOptions?.damageAngleOffset?.getTheta?.() ?? 0;
    const entityRotation = getAttackReferenceYaw(entity) + angleOffset;
    const targetVector = getTargetVector(entity, t);
    const targetAngle = targetVector.angles().theta;

    const diff = Math.abs(entityRotation - targetAngle) % FULL_CIRCLE;
    const angleDifference = diff > HALF_CIRCLE ? FULL_CIRCLE - diff : diff;
    if (angleDifference <= attack.attackOptions.angle) {
      const verticalRange = resolveVerticalRange(
        attack?.attackOptions?.verticalRange,
        2,
      );
      if (
        isWithinHorizontalVerticalRange(
          loc,
          t.location,
          attack.attackOptions.range,
          verticalRange,
          entity.location.y,
          attack?.attackOptions?.cancelVerticalNegative ?? false,
        )
      ) {
        targets.push(t);
      }
    }
  }

  return targets;
}

/**
 * Gets targets of the attack using the corresponding target selection method.
 * @param {Entity} entity - The entity performing the attack.
 * @param {Object} attack - The attack object containing the attack data.
 */
function handleAreaAttack(entity, attack, attackData) {
  if (!isValid(entity)) {
    return [];
  }

  const excludedNames = [];
  const excludedTags = [];
  const excludedFamilies = [];
  const excludedTypes = [];

  if (attackData.excludeNames !== undefined) {
    excludedNames.push(...attackData.excludeNames);
  }
  if (attackData.excludeTags !== undefined) {
    excludedTags.push(...attackData.excludeTags);
  }
  if (attackData.excludeFamilies !== undefined) {
    excludedFamilies.push(...attackData.excludeFamilies);
  }
  if (attackData.excludeTypes !== undefined) {
    excludedTypes.push(...attackData.excludeTypes);
  }

  const tameable = entity?.getComponent(
    SETTINGS.entities.components.tameable.id,
  );
  if (tameable?.isTamed) {
    const name = tameable.tamedToPlayer?.name;
    if (name !== undefined && name !== null) {
      excludedNames.push(name);
    }
  }

  const loc =
    attackData.location === undefined
      ? rotationRelativeOffset(
          entity,
          attackData?._resolvedDamageOffset ??
            attack?.attackOptions?.damageOffset ??
            new DirectionalOffset(0, 0, 0, true),
        )
      : attackData.location;

  const targets =
    entity?.dimension.getEntities({
      location: loc,
      excludeNames: excludedNames,
      excludeTags: excludedTags,
      excludeFamilies: ["inanimate", ...excludedFamilies],
      excludeTypes: [
        entity?.typeId,
        ...KNOCKBACK_EXCLUDED_ENTITIES,
        ...excludedTypes,
      ],
      maxDistance: getSearchMaxDistance(
        attack.attackOptions.range,
        resolveVerticalRange(attack?.attackOptions?.verticalRange, 2),
      ),
    }) ?? [];

  const verticalRange = resolveVerticalRange(
    attack?.attackOptions?.verticalRange,
    2,
  );
  return targets.filter(
    t =>
      t?.location &&
      isWithinHorizontalVerticalRange(
        loc,
        t.location,
        attack.attackOptions.range,
        verticalRange,
        entity.location.y,
        attack?.attackOptions?.cancelVerticalNegative ?? false,
      ),
  );
}

/**
 * True when the ring attack misses this target: outside the ring's band, its
 * vertical range, or its angle.
 */
function isOutsideAttackRing(target, entity, attack, ring) {
  const horizontalDistance = BVector2.subtract(
    new BVector2(target.location.x, target.location.z),
    new BVector2(ring.origin.x, ring.origin.z),
  ).magnitude();
  if (
    horizontalDistance < ring.minRadius ||
    horizontalDistance > ring.maxRadius
  ) {
    return true;
  }

  if (
    !isWithinHorizontalVerticalRange(
      ring.origin,
      target.location,
      ring.maxRange,
      ring.verticalRange,
      entity.location.y,
      attack?.attackOptions?.cancelVerticalNegative ?? false,
    )
  ) {
    return true;
  }

  if (!ring.isUseAngle) {
    return false;
  }

  const targetVector = getTargetVector(entity, target);
  const targetAngle = targetVector.angles().theta;
  const diff = Math.abs(ring.entityRotation - targetAngle) % FULL_CIRCLE;
  const angleDifference = diff > HALF_CIRCLE ? FULL_CIRCLE - diff : diff;
  return angleDifference > ring.angle;
}

/**
 * Gets targets of the attack using the corresponding target selection method.
 * @param {Entity} entity - The entity performing the attack.
 * @param {Object} attack - The attack object containing the attack data.
 * @param {Object} attackData - The attack data object.
 */
function handleRingAttack(entity, attack, attackData) {
  if (!isValid(entity)) {
    return [];
  }

  const excludedNames = [];
  const excludedTags = [];
  const excludedFamilies = [];
  const excludedTypes = [];

  if (attackData.excludeNames !== undefined) {
    excludedNames.push(...attackData.excludeNames);
  }
  if (attackData.excludeTags !== undefined) {
    excludedTags.push(...attackData.excludeTags);
  }
  if (attackData.excludeFamilies !== undefined) {
    excludedFamilies.push(...attackData.excludeFamilies);
  }
  if (attackData.excludeTypes !== undefined) {
    excludedTypes.push(...attackData.excludeTypes);
  }

  const tameable = entity?.getComponent(
    SETTINGS.entities.components.tameable.id,
  );
  if (tameable?.isTamed) {
    const name = tameable.tamedToPlayer?.name;
    if (name !== undefined && name !== null) {
      excludedNames.push(name);
    }
  }

  const loc =
    attackData.location === undefined
      ? rotationRelativeOffset(
          entity,
          attackData?._resolvedDamageOffset ??
            attack?.attackOptions?.damageOffset ??
            new DirectionalOffset(0, 0, 0, true),
        )
      : attackData.location;

  const maxRange = Number(attack?.attackOptions?.range ?? 0);
  if (!Number.isFinite(maxRange) || maxRange <= 0) {
    return [];
  }

  let maxRadius = maxRange;
  const expansionTime = Number(
    attack?.attackOptions?.areaExpansionTime ??
      ATTACK_DEFAULTS.area_expansion_time,
  );
  const ringThickness = Number(
    attack?.attackOptions?.ringThickness ?? ATTACK_DEFAULTS.ring_thickness,
  );
  const thickness = Number.isFinite(ringThickness)
    ? Math.max(0, ringThickness)
    : 0;
  const tick =
    typeof attackData?.tick === "number" && Number.isFinite(attackData.tick)
      ? attackData.tick
      : undefined;
  let resolvedTick = tick;
  let isApplyExpansionTick = tick !== undefined;
  if (resolvedTick === undefined) {
    const ringTick =
      typeof attackData?._ringTick === "number" &&
      Number.isFinite(attackData._ringTick)
        ? attackData._ringTick + 1
        : 1;
    attackData._ringTick = ringTick;
    resolvedTick = ringTick;
    isApplyExpansionTick = ringTick > 1;
  }

  if (expansionTime > 0 && isApplyExpansionTick && resolvedTick !== undefined) {
    const intervalTicks = Math.max(
      1,
      Number(attack?.attackOptions?.interval ?? 1),
    );
    const expansionTicks = Math.max(1, Math.round(expansionTime));
    const elapsedTicks = Math.max(0, resolvedTick * intervalTicks);
    const progress = Math.min(1, elapsedTicks / expansionTicks);
    maxRadius = maxRange * progress;
  }

  if (maxRadius <= 0) {
    return [];
  }

  const minRadius =
    thickness > 0 ? Math.max(0, maxRadius - thickness) : maxRadius;

  const angleOffset =
    attack?.attackOptions?.damageAngleOffset?.getTheta?.() ?? 0;
  const entityRotation = getAttackReferenceYaw(entity) + angleOffset;
  const angle = Number(attack?.attackOptions?.angle ?? FULL_CIRCLE);
  const isUseAngle = Number.isFinite(angle) && angle < FULL_CIRCLE;
  const origin = BVector3.from(loc);

  const verticalRange = resolveVerticalRange(
    attack?.attackOptions?.verticalRange,
    ATTACK_DEFAULTS.vertical_range,
  );
  const entities =
    entity?.dimension.getEntities({
      location: loc,
      excludeNames: excludedNames,
      excludeTags: excludedTags,
      excludeFamilies: ["inanimate", ...excludedFamilies],
      excludeTypes: [
        entity?.typeId,
        ...KNOCKBACK_EXCLUDED_ENTITIES,
        ...excludedTypes,
      ],
      maxDistance: getSearchMaxDistance(maxRadius, verticalRange),
    }) ?? [];

  const ring = {
    origin,
    minRadius,
    maxRadius,
    maxRange,
    verticalRange,
    isUseAngle,
    angle,
    entityRotation,
  };
  return entities.filter(
    t => t?.isValid && !isOutsideAttackRing(t, entity, attack, ring),
  );
}

function normalizeAngle(angle) {
  return ((angle % FULL_CIRCLE) + FULL_CIRCLE) % FULL_CIRCLE;
}

function clockwiseAngleDistance(startAngle, endAngle) {
  return normalizeAngle(endAngle - startAngle);
}

function counterClockwiseAngleDistance(startAngle, endAngle) {
  return normalizeAngle(startAngle - endAngle);
}

function isTargetInArcSweep(entity, attack, target) {
  const configuredSweep = Number(attack?.attackOptions?.angle ?? FULL_CIRCLE);
  const minimumSweep = Number(attack?.attackOptions?.minSweep ?? 0);

  if (!Number.isFinite(configuredSweep)) {
    return true;
  }

  const startAngle = normalizeAngle(
    getAttackReferenceYaw(entity) +
      (attack?.attackOptions?.damageAngleOffset?.getTheta?.() ?? 0) +
      Number(attack?.attackOptions?.startAngle ?? 0),
  );
  const targetAngle = normalizeAngle(
    getTargetVector(entity, target).angles().theta,
  );
  const arcDirection =
    attack?.attackOptions?.arcDirection ?? ATTACK_DIRECTIONS.CLOCKWISE;
  const sweep =
    arcDirection === ATTACK_DIRECTIONS.COUNTER_CLOCKWISE
      ? counterClockwiseAngleDistance(startAngle, targetAngle)
      : clockwiseAngleDistance(startAngle, targetAngle);

  return isSweepWithinBand(sweep, minimumSweep, configuredSweep);
}

function isSweepWithinBand(sweep, minimumSweep, maximumSweep) {
  const lowerBound = Math.max(0, Number(minimumSweep) || 0);
  const upperBound = Math.max(lowerBound, Number(maximumSweep) || 0);
  const bandWidth = upperBound - lowerBound;

  if (bandWidth <= 0) {
    return false;
  }

  if (bandWidth >= FULL_CIRCLE) {
    return true;
  }

  const normalizedLowerBound = normalizeAngle(lowerBound);
  const normalizedSweep = normalizeAngle(sweep);
  const sweepFromLowerBound = normalizeAngle(
    normalizedSweep - normalizedLowerBound,
  );

  return sweepFromLowerBound > 0 && sweepFromLowerBound <= bandWidth;
}

function handleArcAttack(entity, attack, attackData) {
  const areaExpansionTime = Number(
    attack?.attackOptions?.areaExpansionTime ?? 0,
  );
  const arcGrowthTime = Number(
    attack?.attackOptions?.damageDuration ??
      attack?.attackOptions?.arcGrowthTime ??
      0,
  );
  let resolvedAttack = attack;

  if (areaExpansionTime > 0 || arcGrowthTime > 0) {
    const tick =
      typeof attackData?.tick === "number" && Number.isFinite(attackData.tick)
        ? attackData.tick
        : undefined;
    let resolvedTick = tick;

    if (resolvedTick === undefined) {
      const arcTick =
        typeof attackData?._arcTick === "number" &&
        Number.isFinite(attackData._arcTick)
          ? attackData._arcTick + 1
          : 1;
      attackData._arcTick = arcTick;
      resolvedTick = arcTick;
    }

    const intervalTicks = Math.max(
      1,
      Number(attack?.attackOptions?.interval ?? 1),
    );
    const previousElapsedTicks = Math.max(
      0,
      (resolvedTick - 1) * intervalTicks,
    );
    const elapsedTicks = Math.max(0, resolvedTick * intervalTicks);
    let currentRange = Number(attack?.attackOptions?.range ?? 0);

    if (areaExpansionTime > 0) {
      const expansionTicks = Math.max(1, Math.round(areaExpansionTime));
      const radiusProgress = Math.min(1, elapsedTicks / expansionTicks);
      currentRange *= radiusProgress;
    }

    const currentSweep =
      arcGrowthTime > 0
        ? Math.max(0, Number(attack?.attackOptions?.angle ?? 0)) *
          Math.min(1, elapsedTicks / Math.max(1, Math.round(arcGrowthTime)))
        : attack?.attackOptions?.angle;
    const previousSweep =
      arcGrowthTime > 0
        ? Math.max(0, Number(attack?.attackOptions?.angle ?? 0)) *
          Math.min(
            1,
            previousElapsedTicks / Math.max(1, Math.round(arcGrowthTime)),
          )
        : 0;

    resolvedAttack = {
      ...attack,
      attackOptions: {
        ...attack.attackOptions,
        range: currentRange,
        minSweep: previousSweep,
        angle: currentSweep,
      },
    };
  }

  const targets = handleAreaAttack(entity, resolvedAttack, attackData);
  return targets.filter(target =>
    isTargetInArcSweep(entity, resolvedAttack, target),
  );
}

/**
 * Gets targets of the attack using the corresponding target selection method.
 * @param {Entity} entity - The entity performing the attack.
 * @param {Object} attack - The attack object containing the attack data.
 * @param {Object} attackData - The attack data object.
 */
function handleLineAttack(entity, attack, attackData) {
  if (!isValid(entity)) {
    return [];
  }

  // NOTE: lineYaw/linePitch are world-space rotations computed from direction vectors.
  // They are also computed continuously via startLineAimTracking(...) when provided.

  const excludedNames = [];
  const excludedTags = [];
  const excludedFamilies = [];
  const excludedTypes = [];

  if (attackData.excludeNames !== undefined) {
    excludedNames.push(...attackData.excludeNames);
  }
  if (attackData.excludeTags !== undefined) {
    excludedTags.push(...attackData.excludeTags);
  }
  if (attackData.excludeFamilies !== undefined) {
    excludedFamilies.push(...attackData.excludeFamilies);
  }
  if (attackData.excludeTypes !== undefined) {
    excludedTypes.push(...attackData.excludeTypes);
  }

  const tameable = entity?.getComponent(
    SETTINGS.entities.components.tameable.id,
  );
  if (tameable?.isTamed) {
    const name = tameable.tamedToPlayer?.name;
    if (name !== undefined && name !== null) {
      excludedNames.push(name);
    }
  }

  const angleOffset = attack?.attackOptions?.damageAngleOffset;

  const baseDirection = attackData.direction ?? entity?.getViewDirection?.();
  if (baseDirection === undefined || baseDirection === null) {
    return [];
  }

  let directionVec = BVector3.from(baseDirection);

  const thetaOffset = angleOffset?.getTheta?.() ?? 0;
  const phiOffset = angleOffset?.getPhi?.() ?? 0;
  if (thetaOffset !== 0 || phiOffset !== 0) {
    const { yaw, pitch } = rotationFromDirection(directionVec);
    directionVec = directionFromRotation(yaw + thetaOffset, pitch + phiOffset);
  }

  if (!directionVec || directionVec.magnitude?.() === 0) {
    return [];
  }

  directionVec = directionVec.copy();
  directionVec.normalize();

  const { yaw: lineYaw, pitch: linePitch } =
    rotationFromDirection(directionVec);
  attackData.lineYaw = lineYaw;
  attackData.linePitch = linePitch;
  attackData.lineDirection = directionVec.copy();
  if (
    typeof attackData.onLineAim === "function" &&
    attackData._lineAimTrackingActive !== true
  ) {
    attackData.onLineAim(attackData);
  }

  const direction = directionVec.toVector3();

  const headLocation = BVector3.from(entity.getHeadLocation());

  let loc;
  if (attackData.location === undefined) {
    const offset =
      attackData?._resolvedDamageOffset ??
      attack?.attackOptions?.damageOffset ??
      createZeroDirectionalOffset(true, true);
    const offsetLoc = rotationRelativeOffset(
      entity,
      offset,
      undefined,
      true,
      directionVec,
    );
    const entityLoc = BVector3.from(entity.location);
    const offsetDelta = BVector3.subtract(offsetLoc, entityLoc);
    loc = headLocation.copy();
    loc.add(offsetDelta);
  } else {
    loc = attackData.location;
  }

  const lineRadius = Number(attack?.attackOptions?.lineRadius ?? 0);
  const radius = Number.isFinite(lineRadius)
    ? Math.min(LINE_ATTACK_RADIUS_CAP, Math.max(UNIT_INTERVAL_MIN, lineRadius))
    : UNIT_INTERVAL_MIN;
  const directionUnit = directionVec.copy();
  const verticalRange = resolveVerticalRange(
    attack?.attackOptions?.verticalRange,
    ATTACK_DEFAULTS.vertical_range,
  );
  const raycastOptions = {
    excludeNames: excludedNames,
    excludeTags: excludedTags,
    excludeFamilies: ["inanimate", ...excludedFamilies],
    excludeTypes: [
      entity?.typeId,
      ...KNOCKBACK_EXCLUDED_ENTITIES,
      ...excludedTypes,
    ],
    maxDistance: attack.attackOptions.range,
  };

  if (radius <= 0) {
    const targets =
      entity?.dimension.getEntitiesFromRay(
        loc?.toVector3?.() ?? loc,
        direction,
        raycastOptions,
      ) ?? [];
    // getEntitiesFromRay returns hit records, not entities.
    return targets
      .map(hit => /** @type {Entity} */ (hit?.entity ?? hit))
      .filter(
        t =>
          t?.isValid &&
          t.location &&
          isWithinHorizontalVerticalRange(
            loc,
            t.location,
            attack.attackOptions.range,
            verticalRange,
            entity.location.y,
            attack?.attackOptions?.cancelVerticalNegative ?? false,
          ),
      );
  }

  const worldUp =
    Math.abs(directionUnit.y) > LINE_ATTACK_NEAR_VERTICAL_Y
      ? new BVector3(1, 0, 0)
      : BVector3.up();
  const right = BVector3.crossProduct(directionUnit, worldUp);
  right.normalize();
  const up = BVector3.crossProduct(right, directionUnit);
  up.normalize();

  const baseLoc = BVector3.from(loc);
  const step = LINE_ATTACK_SAMPLE_STEP;
  const uniqueTargets = new Map();

  const centerHits =
    entity?.dimension.getEntitiesFromRay(
      loc?.toVector3?.() ?? loc,
      direction,
      raycastOptions,
    ) ?? [];
  for (const hit of centerHits) {
    const hitEntity = /** @type {Entity} */ (hit?.entity ?? hit);
    if (!hitEntity?.isValid) {
      continue;
    }
    if (!uniqueTargets.has(hitEntity)) {
      uniqueTargets.set(hitEntity, hitEntity);
    }
  }

  const ringCount = Math.floor(radius / step + 1e-6);
  for (let ringIndex = 1; ringIndex <= ringCount; ringIndex += 1) {
    const ringRadius = ringIndex * step;
    if (ringRadius > radius + 1e-6) {
      break;
    }

    const raysPerRing =
      ringIndex === 1
        ? LINE_ATTACK_FIRST_RING_RAYS
        : LINE_ATTACK_OUTER_RING_RAYS;
    for (let index = 0; index < raysPerRing; index += 1) {
      const angle = (Math.PI * 2 * index) / raysPerRing;
      const x = Math.cos(angle) * ringRadius;
      const y = Math.sin(angle) * ringRadius;

      const offset = right.copy();
      offset.multiply(x);
      const upOffset = up.copy();
      upOffset.multiply(y);
      offset.add(upOffset);

      const rayLoc = baseLoc.copy();
      rayLoc.add(offset);

      const rayOrigin = rayLoc.toVector3();
      const hits =
        entity?.dimension.getEntitiesFromRay(
          rayOrigin,
          direction,
          raycastOptions,
        ) ?? [];
      for (const hit of hits) {
        const hitEntity = /** @type {Entity} */ (hit?.entity ?? hit);
        if (!hitEntity?.isValid) {
          continue;
        }
        if (!uniqueTargets.has(hitEntity)) {
          uniqueTargets.set(hitEntity, hitEntity);
        }
      }
    }
  }

  return [...uniqueTargets.values()].filter(
    t =>
      t?.location &&
      isWithinHorizontalVerticalRange(
        loc,
        t.location,
        attack.attackOptions.range,
        verticalRange,
        entity.location.y,
        attack?.attackOptions?.cancelVerticalNegative ?? false,
      ),
  );
}

function directionFromRotation(yawDeg, pitchDeg) {
  return BVector3.fromAngles(yawDeg + RIGHT_ANGLE, -pitchDeg);
}

function rotationFromDirection(direction) {
  const vec = BVector3.from(direction);
  const mag = vec.magnitude();
  if (!Number.isFinite(mag) || mag === 0) {
    return { yaw: 0, pitch: 0 };
  }

  vec.divide(mag);

  const clampedY = Math.max(-1, Math.min(1, vec.y));
  const pitchRad = -Math.asin(clampedY);
  const yawRad = Math.atan2(-vec.x, vec.z);

  return {
    yaw: (yawRad * HALF_CIRCLE) / Math.PI,
    pitch: (pitchRad * HALF_CIRCLE) / Math.PI,
  };
}

/**
 * Locks the entity's rotation so it won't rotate during attacks.
 * @param {Entity} entity - The entity whose rotation will be locked.
 */
export function lockEntityRotation(entity) {
  if (entity?.isValid) {
    entity?.setProperty(
      SETTINGS.entities.global_properties.rotation_locked,
      true,
    );
  }
}

/**
 * Unlocks the entity's rotation.
 * @param {Entity} entity - The entity whose rotation will be unlocked.
 */
export function unlockEntityRotation(entity) {
  if (entity?.isValid) {
    entity?.setProperty(
      SETTINGS.entities.global_properties.rotation_locked,
      false,
    );
  }
}

export function enableEntityMovement(entity) {
  if (entity?.isValid) {
    entity.triggerEvent(SETTINGS.entities.global_events.movement_on);
  }
}

export function disableEntityMovement(entity) {
  if (entity?.isValid) {
    entity.triggerEvent(SETTINGS.entities.global_events.movement_off);
  }
}

export function handleEntityRotation(entity) {
  if (!entity?.isValid) {
    return;
  }

  // Resolved before any getProperty call: tickRegisteredEntities runs this for
  // every registered type, including ones registered only for interaction, and
  // those entities have none of the global properties read below.
  const entityConfig = getEntitySettingsConfig(entity.typeId);
  if (!entityConfig) {
    return;
  }

  if (entity.getProperty?.(SETTINGS.entities.global_properties.dead)) {
    if (typeof entity?.id === "string") {
      activeEntityRotationRequestVersions.delete(entity.id);
    }
    return;
  }

  if (entity.getProperty(SETTINGS.entities.global_properties.rotation_locked)) {
    return;
  }

  const entityId = typeof entity.id === "string" ? entity.id : undefined;

  if (usesLegacyRotation(entityConfig)) {
    if (entityId) {
      activeEntityRotationRequestVersions.delete(entityId);
    }
    return;
  }

  const liveYaw = Number(entity.getRotation?.()?.y);
  const storedYaw = Number(
    entity.getProperty?.(SETTINGS.entities.global_properties.rotation),
  );
  const viewDirection = entity.getViewDirection?.();
  const fallbackYaw = Number.isFinite(storedYaw)
    ? storedYaw
    : Number.isFinite(liveYaw)
      ? liveYaw
      : 0;
  const viewDirectionYaw = calculateEntityYawFromHorizontalDelta(
    Number(viewDirection?.x),
    Number(viewDirection?.z),
    fallbackYaw,
  );

  const applyModeledYaw = yaw => {
    if (!Number.isFinite(yaw)) {
      return;
    }

    try {
      entity.setProperty(SETTINGS.entities.global_properties.rotation, yaw);
    } catch (error) {
      logIgnoredError("attack_system/entity_attack:applyModeledYaw", error);
    }
  };

  const hasTarget =
    entity.getProperty(SETTINGS.entities.global_properties.has_target) === true;

  if (!hasTarget) {
    if (entityId) {
      activeEntityRotationRequestVersions.delete(entityId);
    }

    applyModeledYaw(viewDirectionYaw);
    return;
  }

  const targetRequest = getTarget(entity);
  if (!targetRequest) {
    return;
  }

  const requestVersion = entityId
    ? (activeEntityRotationRequestVersions.get(entityId) ?? 0) + 1
    : undefined;

  if (entityId) {
    activeEntityRotationRequestVersions.set(entityId, requestVersion);
  }

  // Turn towards the target once the request lands, unless a newer request for
  // the same entity has superseded this one. Falls back to the view direction
  // when the target is gone or the request failed.
  void (async () => {
    try {
      const target = await targetRequest;

      if (!entity?.isValid) {
        return;
      }

      if (
        entityId &&
        activeEntityRotationRequestVersions.get(entityId) !== requestVersion
      ) {
        return;
      }

      const isStillHasTarget =
        entity.getProperty(SETTINGS.entities.global_properties.has_target) ===
        true;

      if (!isStillHasTarget || !target?.isValid) {
        applyModeledYaw(viewDirectionYaw);
        return;
      }

      applyModeledYaw(calculateEntityYawToTarget(entity, target, fallbackYaw));
    } catch {
      if (
        entityId &&
        activeEntityRotationRequestVersions.get(entityId) !== requestVersion
      ) {
        return;
      }

      applyModeledYaw(viewDirectionYaw);
    }
  })();
}

export function initializeEntityRotationOnSpawn(entity) {
  if (!entity?.isValid) {
    return;
  }

  // Config first, for the same reason as handleEntityRotation.
  const entityConfig = getEntitySettingsConfig(entity.typeId);
  if (!entityConfig || usesLegacyRotation(entityConfig)) {
    return;
  }

  if (entity.getProperty?.(SETTINGS.entities.global_properties.dead)) {
    return;
  }

  const liveYaw = Number(entity.getRotation?.()?.y);
  if (!Number.isFinite(liveYaw)) {
    return;
  }

  try {
    entity.setProperty(SETTINGS.entities.global_properties.rotation, liveYaw);
  } catch (error) {
    logIgnoredError(
      "attack_system/entity_attack:initializeEntityRotationOnSpawn",
      error,
    );
  }
}

/**
 * Sets the entity's rotation.
 * @param {Entity} entity - The entity whose rotation will be set.
 */
export function setEntityRotation(entity, vector) {
  if (!entity?.isValid) {
    return;
  }

  if (typeof entity.setRotation === "function") {
    entity.setRotation({ x: 0, y: vector.angles().theta });
  }
}

/**
 * Propels a projectile in the given direction.
 * @param {Entity} projectile - The projectile entity that is being propelled.
 * @param {BVector3} direction - The attack object containing the attack data.
 * @param {Boolean} isContinuous - Whether the projectile will continuously be propelled or not. Defaults to false.
 */
export function propelProjectile(projectile, direction, isContinuous) {
  if (shouldStopProjectile(projectile)) {
    return;
  }

  projectile?.clearVelocity();
  projectile?.applyImpulse(direction);
  system.runTimeout(() => {
    if (isContinuous && !shouldStopProjectile(projectile)) {
      propelProjectile(projectile, direction, isContinuous);
    }
  }, 1);
}

/**
 * Propels a projectile continuously for a fixed duration.
 * @param {Entity} projectile - The projectile entity that is being propelled.
 * @param {BVector3} direction - The direction at which the projectile should be propelled.
 * @param {Number} ticks - Number of ticks to keep propelling the projectile.
 * @param {() => void} [onComplete] - Optional callback invoked once the full tick duration has elapsed.
 */
export function propelProjectileForTicks(
  projectile,
  direction,
  ticks,
  onComplete,
) {
  if (ticks <= 0) {
    if (typeof onComplete === "function") {
      onComplete();
    }
    return;
  }

  if (shouldStopProjectile(projectile)) {
    return;
  }

  applyProjectileImpulse(projectile, direction);
  system.runTimeout(() => {
    if (!shouldStopProjectile(projectile)) {
      propelProjectileForTicks(projectile, direction, ticks - 1, onComplete);
    }
  }, 1);
}

/**
 * Propels a projectile out and then back along a computed return curve.
 * @param {Entity} projectile - The projectile entity that is being propelled.
 * @param {{initialDirection:BVector3, sourceEntity?:Entity, target?:Entity, attackConfig?:Object, attackContext?:Object, baseYaw:Number, thetaOffset:Number, phiOffset:Number, initialStrength:Number, flightTime:Number, splitReturnPhases?:Boolean, outboundFlightTime?:Number, returnPauseTime?:Number, returnFlightTime?:Number, range:Number, shouldArc:Boolean, useEasing:Boolean, minimumReturnSpeedScale:Number, despawnOnReturn:Boolean, cancelVerticalMovement:Boolean, onShoot?:(context:Object)=>void, onOutboundEnd?:(context:Object)=>void, onPause?:(context:Object)=>void, onPauseEnd?:(context:Object)=>void, onProjectileReturn?:(context:Object)=>void, onReturnStart?:(context:Object)=>void, onReturnEnd?:(context:Object)=>void}} options
 */
export function propelReturningProjectile(projectile, options) {
  if (shouldStopProjectile(projectile)) {
    return;
  }

  const explicitFlightTime = Math.max(0, Math.floor(options?.flightTime ?? 0));
  const explicitOutboundFlightTime = Math.max(
    0,
    Math.floor(options?.outboundFlightTime ?? 0),
  );
  const explicitReturnFlightTime = Math.max(
    0,
    Math.floor(options?.returnFlightTime ?? 0),
  );
  const returnPauseTime = Math.max(
    0,
    Math.floor(options?.returnPauseTime ?? 0),
  );
  const isSplitReturnPhases = Boolean(options?.splitReturnPhases);
  const initialStrength = Number(options?.initialStrength ?? 0);
  const configuredRange = Number(options?.range ?? 0);
  const useEasing = options?.useEasing ?? true;
  const minimumReturnSpeedScale = Math.max(
    0,
    Math.min(
      1,
      Number(
        options?.minimumReturnSpeedScale ??
          ATTACK_DEFAULTS.minimum_return_speed_scale,
      ),
    ),
  );

  if (!Number.isFinite(initialStrength) || initialStrength <= 0) {
    applyProjectileImpulse(
      projectile,
      options?.initialDirection ?? BVector3.from(projectile.getViewDirection()),
    );
    return;
  }

  const baseDirection = BVector3.from(
    options?.initialDirection ?? projectile.getViewDirection(),
  );
  if (baseDirection.magnitude() === 0) {
    baseDirection.set(0, 0, 1);
  }
  baseDirection.normalize();

  const centerDirection = buildDirectionFromYawAndOffsets(
    options?.baseYaw ?? 0,
    0,
    0,
  );
  const sideDirection = buildDirectionFromYawAndOffsets(
    (options?.baseYaw ?? 0) + HALF_CIRCLE / 2,
    0,
    0,
  );
  const upDirection = BVector3.up();

  if (options?.cancelVerticalMovement) {
    centerDirection.y = 0;
    sideDirection.y = 0;
  }

  if (centerDirection.magnitude() === 0) {
    centerDirection.set(0, 0, 1);
  }
  if (sideDirection.magnitude() === 0) {
    sideDirection.set(1, 0, 0);
  }

  centerDirection.normalize();
  sideDirection.normalize();

  const shouldArc =
    Boolean(options?.shouldArc) &&
    ((options?.thetaOffset ?? 0) !== 0 || (options?.phiOffset ?? 0) !== 0);

  const forwardComponent = BVector3.dotProduct(baseDirection, centerDirection);
  const safeForwardComponent =
    Math.abs(forwardComponent) < 0.0001 ? 1 : forwardComponent;
  const sideScale =
    BVector3.dotProduct(baseDirection, sideDirection) / safeForwardComponent;
  const verticalScale = options?.cancelVerticalMovement
    ? 0
    : BVector3.dotProduct(baseDirection, upDirection) / safeForwardComponent;
  const hasRange = Number.isFinite(configuredRange) && configuredRange > 0;
  const configuredPhaseTicks =
    explicitOutboundFlightTime + explicitReturnFlightTime + returnPauseTime;
  const fallbackMaxDistance =
    initialStrength *
    Math.max(1, explicitFlightTime, configuredPhaseTicks) *
    0.25;
  const maxDistance = hasRange ? configuredRange : fallbackMaxDistance;

  if (!Number.isFinite(maxDistance) || maxDistance <= 0) {
    const fallbackDirection = baseDirection.copy();
    fallbackDirection.setMagnitude(initialStrength);
    applyProjectileImpulse(projectile, fallbackDirection);
    return;
  }

  const sideAmplitude = sideScale / 4;
  const verticalAmplitude = verticalScale / 4;

  const invokeHandler = (handlerName, payload = {}) => {
    const handler = options?.[handlerName];

    if (typeof handler !== "function") {
      return;
    }

    try {
      handler({
        ...options?.attackContext,
        attack: options?.attackContext?.attack,
        attackOptions:
          options?.attackContext?.attackOptions ?? options?.attackConfig,
        projectile,
        target: options?.target,
        sourceEntity: options?.sourceEntity,
        phaseHandler: handlerName,
        ...payload,
      });
    } catch (error) {
      logger.warn(`Returning projectile handler ${handlerName} failed`, error);
    }
  };

  const invokeProjectileReturnHandlers = payload => {
    invokeHandler("onProjectileReturn", payload);
    invokeHandler("onReturnStart", payload);
  };

  const addReturningTag = () => {
    if (
      projectile?.hasTag?.(SETTINGS.entities.global_tags.projectile_returning)
    ) {
      return;
    }

    try {
      projectile.addTag(SETTINGS.entities.global_tags.projectile_returning);
    } catch (error) {
      logIgnoredError("attack_system/entity_attack:addReturningTag", error);
    }
  };

  const getCurvePoint = normalizedTime => {
    const clampedTime = Math.max(0, Math.min(1, normalizedTime));
    const distanceProgress = getReturningDistanceProgress(
      clampedTime,
      useEasing,
      minimumReturnSpeedScale,
    );
    const forwardDistance = maxDistance * distanceProgress;

    if (!shouldArc) {
      const straightPoint = baseDirection.copy();
      straightPoint.multiply(forwardDistance);
      return straightPoint;
    }

    const bend = Math.sin(2 * Math.PI * clampedTime);
    const lateralOffset = maxDistance * sideAmplitude * bend;
    const verticalOffset = maxDistance * verticalAmplitude * bend;

    const point = centerDirection.copy();
    point.multiply(forwardDistance);

    const lateralPoint = sideDirection.copy();
    lateralPoint.multiply(lateralOffset);
    point.add(lateralPoint);

    if (!options?.cancelVerticalMovement) {
      const verticalPoint = upDirection.copy();
      verticalPoint.multiply(verticalOffset);
      point.add(verticalPoint);
    }

    return point;
  };

  const estimateCurveLength = (startTime = 0, endTime = 1, samples = 64) => {
    let totalLength = 0;
    let previousPoint = getCurvePoint(startTime);

    for (let sample = 1; sample <= samples; sample += 1) {
      const progress = startTime + ((endTime - startTime) * sample) / samples;
      const currentPoint = getCurvePoint(progress);
      totalLength += BVector3.subtract(currentPoint, previousPoint).magnitude();
      previousPoint = currentPoint;
    }

    return totalLength;
  };

  const derivedFlightTime = hasRange
    ? Math.max(2, Math.ceil(estimateCurveLength() / initialStrength))
    : 0;
  const derivedOutboundFlightTime = Math.max(
    1,
    Math.ceil(estimateCurveLength(0, 0.5, 32) / initialStrength),
  );
  const derivedReturnFlightTime = Math.max(
    1,
    Math.ceil(estimateCurveLength(0.5, 1, 32) / initialStrength),
  );

  const resolveSplitPhaseTimings = () => {
    const roundTripWithoutPause = Math.max(
      0,
      explicitFlightTime - returnPauseTime,
    );
    let outboundTicks = explicitOutboundFlightTime;
    let returnTicks = explicitReturnFlightTime;

    if (outboundTicks <= 0 && returnTicks <= 0) {
      if (roundTripWithoutPause > 0) {
        outboundTicks = Math.max(1, Math.ceil(roundTripWithoutPause / 2));
        returnTicks = Math.max(1, roundTripWithoutPause - outboundTicks);
      } else {
        outboundTicks = derivedOutboundFlightTime;
        returnTicks = derivedReturnFlightTime;
      }
    } else if (outboundTicks <= 0) {
      outboundTicks =
        roundTripWithoutPause > explicitReturnFlightTime
          ? Math.max(1, roundTripWithoutPause - explicitReturnFlightTime)
          : derivedOutboundFlightTime;
    } else if (returnTicks <= 0) {
      returnTicks =
        roundTripWithoutPause > explicitOutboundFlightTime
          ? Math.max(1, roundTripWithoutPause - explicitOutboundFlightTime)
          : derivedReturnFlightTime;
    } else {
      // do nothing
    }

    return {
      outboundTicks,
      returnTicks,
      pauseTicks: returnPauseTime,
    };
  };

  const totalTicks =
    explicitFlightTime > 0 ? explicitFlightTime : derivedFlightTime;

  if (!isSplitReturnPhases && totalTicks <= 0) {
    const fallbackDirection = baseDirection.copy();
    fallbackDirection.setMagnitude(initialStrength);
    applyProjectileImpulse(projectile, fallbackDirection);
    return;
  }

  const phaseCurvePoint = (phase, phaseProgress) => {
    const clampedProgress = Math.max(0, Math.min(1, phaseProgress));

    if (phase === "shoot") {
      return getCurvePoint(clampedProgress * 0.5);
    }

    return getCurvePoint(0.5 + clampedProgress * 0.5);
  };

  const finalizeReturn = payload => {
    invokeHandler("onReturnEnd", payload);

    if (options?.despawnOnReturn ?? true) {
      projectile?.remove();
    }
  };

  if (isSplitReturnPhases) {
    const splitTimings = resolveSplitPhaseTimings();

    if (splitTimings.outboundTicks <= 0 || splitTimings.returnTicks <= 0) {
      const fallbackDirection = baseDirection.copy();
      fallbackDirection.setMagnitude(initialStrength);
      applyProjectileImpulse(projectile, fallbackDirection);
      return;
    }

    const midpoint = getCurvePoint(0.5);

    const startReturnPhase = previousPoint => {
      if (shouldStopProjectile(projectile)) {
        return;
      }

      addReturningTag();
      invokeProjectileReturnHandlers({
        phase: "return",
        phaseTick: 0,
        phaseDuration: splitTimings.returnTicks,
        curvePoint: previousPoint.copy(),
      });

      if (shouldStopProjectile(projectile)) {
        return;
      }

      const stepReturn = (currentTick, lastPoint) => {
        if (shouldStopProjectile(projectile)) {
          return;
        }

        const isFinalTick = currentTick >= splitTimings.returnTicks;
        const progress = Math.max(
          0,
          Math.min(1, currentTick / splitTimings.returnTicks),
        );
        const targetPoint = phaseCurvePoint("return", progress);
        const direction = BVector3.subtract(targetPoint, lastPoint);

        if (options?.cancelVerticalMovement) {
          direction.y = 0;
        }

        applyProjectileImpulse(projectile, direction);

        if (isFinalTick) {
          finalizeReturn({
            phase: "return",
            phaseTick: currentTick,
            phaseDuration: splitTimings.returnTicks,
            curvePoint: targetPoint.copy(),
          });
          return;
        }

        system.runTimeout(() => {
          stepReturn(currentTick + 1, targetPoint);
        }, 1);
      };

      stepReturn(1, previousPoint);
    };

    const startPausePhase = pausePoint => {
      if (splitTimings.pauseTicks <= 0) {
        startReturnPhase(pausePoint);
        return;
      }

      invokeHandler("onPause", {
        phase: "pause",
        phaseTick: 0,
        phaseDuration: splitTimings.pauseTicks,
        curvePoint: pausePoint.copy(),
      });

      const stepPause = currentTick => {
        if (shouldStopProjectile(projectile)) {
          return;
        }

        projectile?.clearVelocity();

        if (currentTick >= splitTimings.pauseTicks) {
          invokeHandler("onPauseEnd", {
            phase: "pause",
            phaseTick: currentTick,
            phaseDuration: splitTimings.pauseTicks,
            curvePoint: pausePoint.copy(),
          });
          startReturnPhase(pausePoint);
          return;
        }

        system.runTimeout(() => {
          stepPause(currentTick + 1);
        }, 1);
      };

      stepPause(1);
    };

    invokeHandler("onShoot", {
      phase: "shoot",
      phaseTick: 0,
      phaseDuration: splitTimings.outboundTicks,
      curvePoint: BVector3.from({ x: 0, y: 0, z: 0 }),
    });

    const stepOutbound = (currentTick, previousPoint) => {
      if (shouldStopProjectile(projectile)) {
        return;
      }

      const isFinalTick = currentTick >= splitTimings.outboundTicks;
      const progress = Math.max(
        0,
        Math.min(1, currentTick / splitTimings.outboundTicks),
      );
      const targetPoint = isFinalTick
        ? midpoint.copy()
        : phaseCurvePoint("shoot", progress);
      const direction = BVector3.subtract(targetPoint, previousPoint);

      if (options?.cancelVerticalMovement) {
        direction.y = 0;
      }

      applyProjectileImpulse(projectile, direction);

      if (isFinalTick) {
        invokeHandler("onOutboundEnd", {
          phase: "shoot",
          phaseTick: currentTick,
          phaseDuration: splitTimings.outboundTicks,
          curvePoint: targetPoint.copy(),
        });
        startPausePhase(targetPoint);
        return;
      }

      system.runTimeout(() => {
        stepOutbound(currentTick + 1, targetPoint);
      }, 1);
    };

    stepOutbound(1, BVector3.from({ x: 0, y: 0, z: 0 }));
    return;
  }

  const outboundPhaseDuration = Math.max(1, Math.ceil(totalTicks / 2));
  const returnPhaseDuration = Math.max(1, totalTicks - outboundPhaseDuration);

  invokeHandler("onShoot", {
    phase: "shoot",
    phaseTick: 0,
    phaseDuration: outboundPhaseDuration,
    curvePoint: BVector3.from({ x: 0, y: 0, z: 0 }),
  });

  let didStartReturn = false;

  const step = (currentTick, previousPoint) => {
    if (shouldStopProjectile(projectile)) {
      return;
    }

    const normalizedTime = Math.max(0, Math.min(1, currentTick / totalTicks));
    const targetPoint = getCurvePoint(normalizedTime);

    if (normalizedTime >= 0.5 && !didStartReturn) {
      didStartReturn = true;
      addReturningTag();
      invokeHandler("onOutboundEnd", {
        phase: "shoot",
        phaseTick: currentTick,
        phaseDuration: outboundPhaseDuration,
        curvePoint: targetPoint.copy(),
      });
      invokeProjectileReturnHandlers({
        phase: "return",
        phaseTick: 0,
        phaseDuration: returnPhaseDuration,
        curvePoint: targetPoint.copy(),
      });

      if (shouldStopProjectile(projectile)) {
        return;
      }
    }

    const direction = BVector3.subtract(targetPoint, previousPoint);
    const isFinalTick = currentTick >= totalTicks;
    const directionToApply = direction;

    if (options?.cancelVerticalMovement) {
      directionToApply.y = 0;
    }

    const nextPoint = BVector3.add(previousPoint, directionToApply);

    applyProjectileImpulse(projectile, directionToApply);

    if (isFinalTick) {
      finalizeReturn({
        phase: "return",
        phaseTick: Math.max(1, currentTick - outboundPhaseDuration),
        phaseDuration: returnPhaseDuration,
        curvePoint: targetPoint.copy(),
      });
      return;
    }

    system.runTimeout(() => {
      step(currentTick + 1, nextPoint);
    }, 1);
  };

  step(1, BVector3.from({ x: 0, y: 0, z: 0 }));
}

/**
 * Propels a homing projectile towards the provided target.
 * @param {Entity} projectile - The projectile entity that is being propelled.
 * @param {Entity} target - The target towards which the projectile is being propelled.
 * @param {Object} attack - The attack object containing the attack data.
 * @param {BVector3} [homingLocation] - Optional snapshot location for homing instead of tracking the target.
 */
export function propelHomingProjectile(
  projectile,
  target,
  attack,
  homingLocation,
) {
  if (shouldStopProjectile(projectile)) {
    return;
  }

  const isUseSnapshot = homingLocation !== undefined && homingLocation !== null;

  if (
    !isUseSnapshot &&
    (target === undefined ||
      !target?.isValid ||
      !isSurvivalPlayerTarget(target))
  ) {
    const newDirection = BVector3.from(projectile?.getViewDirection());
    newDirection.setMagnitude(attack.attackOptions.projectileStrength);
    propelProjectile(projectile, newDirection, true);
    return;
  }

  const toTarget = isUseSnapshot
    ? BVector3.subtract(homingLocation, BVector3.from(projectile?.location))
    : getTargetVector(
        projectile,
        target,
        shouldTargetProjectileCenter(attack?.attackOptions),
      );

  if (attack?.attackOptions?.cancelVerticalMovement) {
    toTarget.y = 0;
  }

  const distance = toTarget.magnitude();
  const strength = Number(attack?.attackOptions?.projectileStrength ?? 0);

  if (!Number.isFinite(distance) || distance <= 0) {
    projectile?.clearVelocity();
    return;
  }

  const SWITCH_TO_CONTINUOUS_MIN = 0.1;
  const SWITCH_TO_CONTINUOUS_MAX = 1;
  if (
    distance >= SWITCH_TO_CONTINUOUS_MIN &&
    distance <= SWITCH_TO_CONTINUOUS_MAX
  ) {
    try {
      projectile?.addTag(SETTINGS.entities.global_tags.projectile_stop_homing);
    } catch (error) {
      logIgnoredError(
        "attack_system/entity_attack:propelHomingProjectile",
        error,
      );
    }

    let continueDirection = BVector3.from(projectile?.getVelocity());
    if (!continueDirection || continueDirection.magnitude() === 0) {
      continueDirection = toTarget.copy();
    }

    if (attack?.attackOptions?.cancelVerticalMovement) {
      continueDirection.y = 0;
    }

    if (continueDirection.magnitude() === 0) {
      continueDirection = BVector3.from(projectile?.getViewDirection());
    }

    if (continueDirection.magnitude() === 0) {
      continueDirection.z = 1;
    }

    if (Number.isFinite(strength) && strength > 0) {
      continueDirection.setMagnitude(strength);
    }

    propelProjectile(projectile, continueDirection, true);
    return;
  }

  if (!Number.isFinite(strength) || strength <= 0) {
    return;
  }

  toTarget.setMagnitude(strength);
  applyProjectileImpulse(projectile, toTarget);
  system.runTimeout(() => {
    if (
      projectile?.isValid &&
      !shouldStopProjectile(projectile) &&
      !projectile?.hasTag(SETTINGS.entities.global_tags.projectile_stop_homing)
    ) {
      if (isUseSnapshot) {
        propelHomingProjectile(projectile, target, attack, homingLocation);
      } else if (isSurvivalPlayerTarget(target)) {
        propelHomingProjectile(projectile, target, attack);
      } else {
        const newDirection = BVector3.from(projectile?.getViewDirection());
        newDirection.setMagnitude(attack.attackOptions.projectileStrength);
        propelProjectile(projectile, newDirection, true);
      }
    }
  }, 1);
}

/**
 * Handles the projectile body rotation.
 * @param {Entity} projectile - The projectile entity whose rotation is to be set.
 * @param {BVector3} direction - The direction at which the projectile should be rotated.
 */
export function handleProjectileRotation(projectile, direction) {
  try {
    projectile.setProperty(
      SETTINGS.entities.projectiles.properties.rotation.x,
      direction.angles().phi,
    );
    projectile.setProperty(
      SETTINGS.entities.projectiles.properties.rotation.y,
      direction.angles().theta,
    );
  } catch (error) {
    logIgnoredError(
      "attack_system/entity_attack:handleProjectileRotation",
      error,
    );
  }
}

/**
 * Handles the vanilla and custom entity effects.
 * @param {Entity} entity - The entity unto which the effects will be applied.
 * @param {EntityEffect[]} effects - The array of vanilla and custom effects that will be applied to the entity. Effects may optionally define `startTime`, `endTime`, and `interval` in seconds to repeat after the hit.
 */
export function handleEntityEffects(entity, effects) {
  if (!entity?.isValid) {
    return;
  }

  for (const effect of effects) {
    if (!entity?.isValid || effect === undefined || effect === null) {
      continue;
    }

    applyTimedHitEffect(
      effect,
      () => {
        if (effect.isCustom) {
          applyCustomEffect(entity, effect);
        } else {
          entity.addEffect(effect.id, secondsToTicks(effect.duration), {
            amplifier: effect.amplifier,
            showParticles: effect.showParticles,
          });
        }
      },
      () => entity?.isValid,
    );
  }
}

/**
 * Handles the custom entity sound effects.
 * @param {Entity} entity - The source entity that is emitting the sound effects.
 * @param {SoundEffect[]} soundEffects - The array of sound effects that will be applied to the entity.
 */
export function handleSoundEffects(entity, soundEffects) {
  if (!entity?.isValid) {
    return;
  }

  for (const soundEffect of soundEffects) {
    if (!entity?.isValid || soundEffect === undefined || soundEffect === null) {
      return;
    }

    entity.dimension?.playSound(soundEffect.id, entity.location, {
      pitch: soundEffect.pitch,
      volume: soundEffect.volume,
    });
  }
}

/**
 * Handles the custom entity particle effects.
 * @param {Entity} entity - The source entity that is emitting the particle effects.
 * @param {ParticleEffect[]} particleEffects - The array of particle effects that will be applied to the entity.
 */
export function handleParticleEffects(entity, particleEffects) {
  if (!entity?.isValid) {
    return;
  }

  for (const particleEffect of particleEffects) {
    if (
      !entity?.isValid ||
      particleEffect === undefined ||
      particleEffect === null
    ) {
      return;
    }

    const loc =
      particleEffect.location ??
      rotationRelativeOffset(entity, particleEffect.offset);
    entity.dimension?.spawnParticle(particleEffect.id, loc);
  }
}

/**
 * Handles attack-start effects authored on the attack config itself.
 * This is separate from on-hit effects such as `knockbackOptions` and `hitEffects`.
 * @param {Entity} entity - The attacking entity.
 * @param {AttackOptions|Object} attackOptions - Attack config that may include sound/particle/camera/area-knockback start effects.
 */
export function handleAttackStartEffects(entity, attackOptions) {
  if (!entity?.isValid || !attackOptions) {
    return;
  }

  handleSoundEffects(entity, attackOptions.soundEffects ?? []);
  handleParticleEffects(entity, attackOptions.particleEffects ?? []);
  handleCameraShakeEffect(entity, attackOptions.cameraShakeEffect);

  if (attackOptions.knockback) {
    void applyAreaKnockback(entity, attackOptions.knockback);
  }
}

/**
 * Handles the custom entity camera shake effects.
 * @param {Entity} entity - The source entity that is emitting the camera shakle effect.
 * @param {CameraShake} cameraShakeEffect - The camera shake effect that will be applied to the entities around the source. Camera shake may optionally define `delay` or `startTime`, plus `endTime` and `interval`, in seconds.
 */
export function handleCameraShakeEffect(entity, cameraShakeEffect) {
  if (
    !entity?.isValid ||
    cameraShakeEffect === undefined ||
    cameraShakeEffect === null
  ) {
    return;
  }

  applyTimedHitEffect(
    cameraShakeEffect,
    () =>
      entity?.runCommand(
        `/camerashake add @a[r=${cameraShakeEffect.radius ?? CAMERA_SHAKE_DEFAULTS.radius}] ${
          cameraShakeEffect.intensity ?? CAMERA_SHAKE_DEFAULTS.intensity
        } ${cameraShakeEffect.duration ?? CAMERA_SHAKE_DEFAULTS.duration} ${
          cameraShakeEffect.shakeType ?? CAMERA_SHAKE_DEFAULTS.shakeType
        }`,
      ),
    () => entity?.isValid,
  );
}

/**
 * Returns the entity's target, if any.
 * @param {Entity} entity - The entity whose target is being requeted.
 */
export function getTarget(entity, shouldBypassHasTargetCheck = false) {
  if (entity === undefined || !isValid(entity)) {
    return undefined;
  }

  const entityId = entity?.id;
  if (typeof entityId === "string" && inFlightTargetRequests.has(entityId)) {
    return inFlightTargetRequests.get(entityId);
  }

  if (
    !shouldBypassHasTargetCheck &&
    entity.getProperty(SETTINGS.entities.global_properties.has_target) === false
  ) {
    return Promise.resolve(undefined);
  }

  const requestPromise = runTargetRequest(entity, entityId);

  targetRequestState.queue = settleQuietly(requestPromise);

  if (typeof entityId === "string") {
    inFlightTargetRequests.set(entityId, requestPromise);
  }

  return requestPromise;
}

/**
 * Wait for the queue tail, then run one get_target scriptevent round trip.
 * Reading targetRequestState.queue here still happens before getTarget
 * reassigns it, because this body runs synchronously up to the first await.
 * @param {Entity} entity
 * @param {string|undefined} entityId
 */
async function runTargetRequest(entity, entityId) {
  // settleQuietly is what keeps a failed request from wedging the queue, so
  // the tail never rejects and this await needs no guard of its own.
  await settleQuietly(targetRequestState.queue);

  try {
    return await new Promise(resolve => {
      let isResolved = false;
      const event = system.afterEvents.scriptEventReceive.subscribe(data => {
        if (data.id !== SETTINGS.attack_system.get_target_event) {
          return;
        }

        isResolved = true;
        system.afterEvents.scriptEventReceive.unsubscribe(event);
        resolve(data.sourceEntity);
      });

      try {
        entity.triggerEvent(SETTINGS.attack_system.get_target_event);
      } catch {
        system.afterEvents.scriptEventReceive.unsubscribe(event);
        resolve(undefined);
        return;
      }

      system.runTimeout(() => {
        system.afterEvents.scriptEventReceive.unsubscribe(event);
        if (!isResolved) {
          resolve(undefined);
        }
      }, TARGET_REQUEST_TIMEOUT_TICKS);
    });
  } finally {
    if (typeof entityId === "string") {
      inFlightTargetRequests.delete(entityId);
    }
  }
}

/**
 * Settle with the promise without adopting its rejection, so one failed
 * request cannot wedge the shared queue.
 * @param {Promise<unknown>} promise
 */
async function settleQuietly(promise) {
  try {
    await promise;
  } catch (error) {
    // The queue only orders requests; whether one failed is the caller's problem.
    logIgnoredError("attack_system/entity_attack:settleQuietly", error);
  }
}

/**
 * Caches the entity's target to its target_id dynamic property.
 * @param {Entity} entity - The entity whose target is being cached.
 */
export async function cacheTarget(entity) {
  if (!entity?.isValid) {
    return;
  }

  const target = await getTarget(entity, true);

  if (target?.isValid) {
    entity.setDynamicProperty(
      SETTINGS.entities.global_properties.target_id,
      target.id,
    );
  }
}

export async function clearTarget(entity) {
  if (!entity?.isValid) {
    return;
  }

  entity.setDynamicProperty(
    SETTINGS.entities.global_properties.target_id,
    undefined,
  );
}

/**
 * Returns the entity's cached target. If it doesnt exist or is invalid, returns undefined.
 * @param {Entity} entity - The entity whose target is being requeted.
 */
export function getTargetV2(entity) {
  if (!entity?.isValid) {
    return undefined;
  }

  const targetId = entity.getDynamicProperty(
    SETTINGS.entities.global_properties.target_id,
  );

  if (!targetId) {
    return undefined;
  }

  const target = world.getEntity(/** @type {string} */ (targetId));

  if (!target?.isValid) {
    return undefined;
  }

  return target;
}

/**
 * Returns whether the entity is still waiting for its global attack cooldown.
 *
 * @param {Entity} entity - Entity whose cooldown state should be checked.
 * @returns {boolean} True when the entity has a positive cooldown remaining.
 */
export function isOnCooldown(entity) {
  if (!entity?.isValid) {
    return false;
  }

  const cooldownSeconds = Number(
    entity.getProperty(SETTINGS.entities.global_properties.cooldown_ticks) ?? 0,
  );

  return Number.isFinite(cooldownSeconds) && cooldownSeconds > 0;
}

/**
 * Checks whether an entity's current target is within the authored attack range.
 * If the target is in range and the entity is not on cooldown, the entity is moved
 * into the preparing attack state.
 *
 * @param {Entity} entity - Entity attempting to start an attack.
 * @param {Object} attackConfig - Attack config or wrapper containing `attack_data`.
 * @param {Object} [callbacks] - Optional lifecycle callbacks for range checks.
 * @param {Function} [callbacks.onCooldownInRange] - Invoked when the target is in range but the entity is still on cooldown.
 * @param {Function} [callbacks.onOutOfRange] - Invoked when the target exists but is outside the authored range.
 * @param {Function} [callbacks.onMissingTarget] - Invoked when target lookup produces no valid target.
 * @param {boolean} [callbacks.bypassHasTargetCheck] - When true, target lookup ignores the synced `has_target` property and asks the engine directly.
 * @param {string} [callbacks.requiredState] - When provided, the entity must still be in this state after async target lookup before entering preparing_attack.
 * @returns {Promise<boolean>} True when the target is in range and the entity enters the preparing attack state.
 */
export async function isTargetInRange(entity, attackConfig, callbacks = {}) {
  if (!entity?.isValid) {
    return false;
  }

  const target = await getTarget(
    entity,
    callbacks?.bypassHasTargetCheck === true,
  );

  if (!entity?.isValid || !target?.isValid || !target?.location) {
    if (typeof callbacks?.onMissingTarget === "function") {
      callbacks.onMissingTarget({
        entity,
        attackConfig,
      });
    }

    return false;
  }

  const attackData = attackConfig?.attack_data ?? attackConfig;
  const range = Number(attackData?.range ?? 0);

  if (!Number.isFinite(range) || range <= 0) {
    return false;
  }

  const distanceToTarget = getTargetVector(entity, target).magnitude();
  if (distanceToTarget > range) {
    if (typeof callbacks?.onOutOfRange === "function") {
      callbacks.onOutOfRange({
        entity,
        target,
        attackConfig,
        distanceToTarget,
        range,
      });
    }

    return false;
  }

  if (isOnCooldown(entity)) {
    if (typeof callbacks?.onCooldownInRange === "function") {
      const cooldownSeconds = Number(
        entity.getProperty(
          SETTINGS.entities.global_properties.cooldown_ticks,
        ) ?? 0,
      );

      callbacks.onCooldownInRange({
        entity,
        target,
        attackConfig,
        cooldownSeconds,
        distanceToTarget,
        range,
      });
    }

    return false;
  }

  if (
    typeof callbacks?.requiredState === "string" &&
    entity.getProperty(SETTINGS.entities.global_properties.state) !==
      callbacks.requiredState
  ) {
    return false;
  }

  entity.setProperty(
    SETTINGS.entities.global_properties.state,
    SETTINGS.entities.global_states.preparing_attack,
  );
  return true;
}

/**
 * Returns the direction from an entity to its target, if it has one, otherwise returns undefined.
 * @param {Entity} entity - The entity, the distance to whose target will be fetched.
 */
export async function getDirectionToTarget(entity) {
  if (!entity?.isValid) {
    return undefined;
  }

  const target = await getTarget(entity);

  if (!entity?.isValid || !target?.isValid || !target?.location) {
    return undefined;
  }

  return getTargetVector(entity, target);
}

export function getDirectionToTargetV2(entity) {
  if (!entity?.isValid) {
    return undefined;
  }

  const target = getTargetV2(entity);

  if (!entity?.isValid || !target?.isValid || !target?.location) {
    return undefined;
  }

  return getTargetVector(entity, target);
}

/**
 * Returns the distance from an entity to its target, if it has one, otherwise returns undefined.
 * @param {Entity} entity - The entity, the distance to whose target will be fetched.
 */
export async function getDistanceToTarget(entity) {
  const direction = await getDirectionToTarget(entity);
  return direction?.magnitude();
}

export function getDistanceToTargetV2(entity) {
  return getDirectionToTargetV2(entity)?.magnitude();
}

/**
 * Returns whether the entity is valid and alive or not, utilizing the custom dead property
 * @param {Entity} entity - The entity whose valid state is being requeted.
 */
export function isValid(entity) {
  return (
    entity?.isValid &&
    !entity?.getProperty(SETTINGS.entities.global_properties.dead)
  );
}

/**
 * Apply knockback using the resolved attack knockback settings.
 * @param {Entity} entity - Source entity.
 * @param {Entity} targetEntity - Target entity receiving knockback.
 * @param {Object} attackOptions - Attack options containing knockback configuration. Knockback may optionally define `delay` or `startTime`, plus `endTime` and `interval`, in seconds.
 */
export function handleKnockback(entity, targetEntity, attackOptions) {
  if (attackOptions.knockbackOptions === undefined) {
    return;
  }

  applyTimedHitEffect(
    attackOptions.knockbackOptions,
    () => {
      if (
        attackOptions.knockbackOptions.horizontalStrength !== undefined &&
        attackOptions.knockbackOptions.verticalStrength !== undefined
      ) {
        const splitKnockback = getTargetVector(entity, targetEntity);
        splitKnockback.y = 0;
        splitKnockback.setMagnitude(
          attackOptions.knockbackOptions?.horizontalStrength,
        );
        splitKnockback.y = attackOptions.knockbackOptions.verticalStrength;
        targetEntity.applyKnockback(splitKnockback, splitKnockback.y);
        return;
      }

      if (attackOptions.knockbackOptions.strength === undefined) {
        return;
      }

      const targetVector = getTargetVector(entity, targetEntity);
      targetVector.setMagnitude(attackOptions.knockbackOptions?.strength);
      targetEntity.applyKnockback(targetVector, targetVector.y);
    },
    () => entity?.isValid && targetEntity?.isValid,
  );
}

/**
 * Pushes all entities away within a radius to simulate a solid collider.
 * @param {Entity} entity - The entity which will push others away.
 * @param {number} radius - The distance between the entity and the other entities it should push.
 */
export function doEntityCollider(entity, radius) {
  if (!entity.isValid) {
    return;
  }

  const others = entity.dimension.getEntities({
    location: { ...entity.location, y: entity.location.y + 1 },
    maxDistance: radius,
  });

  for (const other of others) {
    if (!other?.isValid || entity.id === other.id) {
      continue;
    }

    const targetVector = getTargetVector(entity, other);
    targetVector.y = 0;
    targetVector.setMagnitude(COLLIDER_PUSH_STRENGTH);

    try {
      other.applyKnockback(targetVector, 0);
    } catch (error) {
      // Some entities reject knockback, or are already gone; skip the push.
      logIgnoredError("attack_system/entity_attack:doEntityCollider", error);
    }
  }
}
