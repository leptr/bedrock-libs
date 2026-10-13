// Developed by: Petar Mijailovic (leptr)
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

import { InputPermissionCategory, world } from "@minecraft/server";
import { getSettingsVersion, SETTINGS } from "../game_settings.js";
import { getScannedDimensionIds } from "./scan_dimension.js";
import {
  BVector3,
  FULL_CIRCLE,
  HALF_CIRCLE,
} from "../better_vectors/better_vectors.js";
import { random } from "../utils/utils.js";
import { logIgnoredError } from "../utils/logger.js";

/** @import { Block, Entity, Player } from "@minecraft/server" */

const waterBlockId = "minecraft:water";
const entitySettingsCache = {
  /** @type {Map<string, Object|null>} */
  byTypeId: new Map(),
  settingsVersion: -1,
};
// Names of the Block methods that return a neighbouring block.
const BLOCK_SEARCH_DIRECTIONS = [
  "above",
  "below",
  "north",
  "south",
  "east",
  "west",
];

function getDirectionalBlock(source, direction, iterations) {
  try {
    return source?.[direction]?.(iterations);
  } catch {
    // Past the world's height limits or in an
    // unloaded chunk: not a place to stand.
    return undefined;
  }
}

function isAirOrWaterBlock(block) {
  return Boolean(
    block?.isValid && (block.isAir || block.typeId === waterBlockId),
  );
}

function findNearestTraversableBlock(source, directions, maxDistance) {
  for (let iterations = 1; iterations <= maxDistance; iterations++) {
    for (const direction of directions) {
      const block = getDirectionalBlock(source, direction, iterations);
      if (isAirOrWaterBlock(block)) {
        return block;
      }
    }
  }

  return undefined;
}

/**
 * Forget every cached entity settings lookup. `configureLibrary` does this
 * automatically. Call it after adding an entry to `SETTINGS.entities` by hand.
 */
export function invalidateEntitySettingsCache() {
  entitySettingsCache.byTypeId.clear();
}

/**
 * Find the entry in `SETTINGS.entities` whose `id` is the given entity type.
 * Lookups are cached, including the ones that find nothing.
 * @param {string} typeId Entity type id.
 * @returns {Object|undefined}
 */
export function getEntitySettingsConfig(typeId) {
  if (typeof typeId !== "string" || typeId.length === 0) {
    return undefined;
  }

  const settingsVersion = getSettingsVersion();
  if (entitySettingsCache.settingsVersion !== settingsVersion) {
    entitySettingsCache.settingsVersion = settingsVersion;
    entitySettingsCache.byTypeId.clear();
  }
  const entitySettingsByTypeId = entitySettingsCache.byTypeId;

  if (entitySettingsByTypeId.has(typeId)) {
    return entitySettingsByTypeId.get(typeId) ?? undefined;
  }

  const config = Object.values(SETTINGS.entities).find(
    entry =>
      entry &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      entry.id === typeId,
  );

  entitySettingsByTypeId.set(typeId, config ?? null);
  return config;
}

/**
 * Whether an entity's settings say its yaw comes from the engine rotation
 * instead of the modeled rotation property. Reads `uses_legacy_rotation`, and
 * the older spelling `usesLegacyRotation`.
 * @param {Object|undefined} entityConfig Entry from `SETTINGS.entities`.
 * @returns {boolean}
 */
export function usesLegacyRotation(entityConfig) {
  return (
    (entityConfig?.uses_legacy_rotation ?? entityConfig?.usesLegacyRotation) ===
    true
  );
}

export function getAttackReferenceYaw(entity) {
  const legacyYaw = Number(entity?.getRotation?.()?.y);
  const fallbackYaw = Number.isFinite(legacyYaw) ? legacyYaw : 0;
  const entityConfig = getEntitySettingsConfig(entity?.typeId);

  if (usesLegacyRotation(entityConfig)) {
    return fallbackYaw;
  }

  const modeledYaw = Number(
    entity?.getProperty?.(SETTINGS.entities.global_properties.rotation),
  );

  return Number.isFinite(modeledYaw) ? modeledYaw : fallbackYaw;
}

/** Map Bedrock block-facing strings to entity yaw values. */
export const blockToEntityRotation = {
  north: 0,
  south: 180,
  west: -90,
  east: 90,
};

/**
 * Attempt to move an entity to the nearest air or water block around its current position.
 *
 * @param {Entity} entity
 * @param {Boolean} onlyCheckUp Restrict the search to upward blocks only.
 * @param {Number} maxDistance Maximum search distance in blocks.
 * @returns {Promise<Boolean>} True when the entity was moved.
 */
export async function unstuckEntity(entity, onlyCheckUp, maxDistance = 32) {
  const source = entity.dimension.getBlock(entity.location);

  if (!source || source?.isAir || source?.typeId === waterBlockId) {
    return false;
  }

  const directions = onlyCheckUp
    ? [BLOCK_SEARCH_DIRECTIONS[0]]
    : BLOCK_SEARCH_DIRECTIONS;
  const targetBlock = findNearestTraversableBlock(
    source,
    directions,
    maxDistance,
  );

  if (!targetBlock) {
    return false;
  }

  entity.teleport(targetBlock.location);
  return true;
}

/**
 * Return the nearest air or water block around a source block.
 *
 * @param {Block} block
 * @param {Number} maxDistance Maximum search distance in blocks.
 */
export function findNearestAir(block, maxDistance = 32) {
  if (block?.isAir || block?.typeId === waterBlockId) {
    return block;
  }

  return (
    findNearestTraversableBlock(block, BLOCK_SEARCH_DIRECTIONS, maxDistance) ||
    block
  );
}

/**
 * Whether a value is a valid player entity.
 * @param {unknown} entity
 * @returns {entity is Player}
 */
export function isPlayer(entity) {
  const candidate = /** @type {any} */ (entity);
  return (
    candidate?.isValid === true &&
    candidate.typeId === SETTINGS.general.player_id
  );
}

/**
 * Disable player movement input.
 * @param {Player} player
 */
export function disablePlayerMovement(player) {
  player.inputPermissions.setPermissionCategory(
    InputPermissionCategory.Movement,
    false,
  );
}

/**
 * Enable player movement input.
 * @param {Player} player
 */
export function enablePlayerMovement(player) {
  player.inputPermissions.setPermissionCategory(
    InputPermissionCategory.Movement,
    true,
  );
}

/**
 * Disable player camera input.
 * @param {Player} player
 */
export function disablePlayerCamera(player) {
  player.inputPermissions.setPermissionCategory(
    InputPermissionCategory.Camera,
    false,
  );
}

/**
 * Enable player camera input.
 * @param {Player} player
 */
export function enablePlayerCamera(player) {
  player.inputPermissions.setPermissionCategory(
    InputPermissionCategory.Camera,
    true,
  );
}

/**
 * Collect matching entities from every scanned dimension (the vanilla three
 * plus any custom dimension registered with `registerScannedDimensionId`).
 *
 * @param {Object} filter Entity query options passed to `getEntities`.
 * @param {String} sourceId Optional entity id to exclude from the results.
 */
export function getAllDimensions(filter, sourceId) {
  const result = [];
  for (const dimensionId of getScannedDimensionIds()) {
    let dimension;
    try {
      dimension = world.getDimension(dimensionId);
    } catch {
      continue;
    }
    const entityFilter = filter;

    for (const entity of dimension.getEntities(entityFilter)) {
      if (sourceId === undefined || entity.id !== sourceId) {
        result.push(entity);
      }
    }
  }
  return result;
}

/**
 * Return the nearest player to an entity, optionally requiring line of sight.
 *
 * @param {Entity} source
 * @param {Boolean} checkForBlocks When true, rejects players blocked by solid terrain.
 */
export function getNearestPlayer(source, checkForBlocks) {
  const player = source.dimension.getEntities({
    type: "minecraft:player",
    location: source.location,
    closest: 1,
  })[0];

  if (player?.isValid) {
    if (!checkForBlocks) {
      return player;
    }
    const sPos = BVector3.from(source.getHeadLocation());
    const tPos = BVector3.from(player.location);
    // The ray has to point from the source towards the player.
    const direction = BVector3.subtract(tPos, sPos);
    const distance = Math.round(BVector3.distance(sPos, tPos));

    if (
      source.dimension.getBlockFromRay(sPos, direction, {
        maxDistance: distance,
        includePassableBlocks: false,
        includeLiquidBlocks: false,
      }) === undefined
    ) {
      return player;
    }
  }
  return undefined;
}

/**
 * Raycast with Bedrock compatibility fallbacks.
 * Retries with a reduced options set when full options are unsupported.
 */
export function tryGetBlockFromRay(dimension, origin, direction, maxDistance) {
  const attempts = [
    {
      maxDistance,
      includeLiquidBlocks: false,
      includePassableBlocks: false,
    },
    {
      maxDistance,
      includePassableBlocks: false,
    },
  ];

  for (const options of attempts) {
    try {
      const hit = dimension.getBlockFromRay?.(origin, direction, options);
      if (hit) {
        return hit;
      }
    } catch (error) {
      // Try next compatibility option set.
      logIgnoredError("toolkit/toolkit:tryGetBlockFromRay", error);
    }
  }

  return undefined;
}

/**
 * Angular offset descriptor used by targeting and projectile helpers.
 * Scalar values are used directly; tuple values are treated as random ranges.
 */
export class AngleOffset {
  /**
   * @param {Number|number[]} theta Horizontal angle offset in degrees.
   * @param {Number|number[]} phi Vertical angle offset in degrees.
   */
  constructor(theta = 0, phi = 0) {
    this.theta = theta;
    this.phi = phi;
  }

  /**
   * Builds an offset from named angles, so data tables label each value.
   * Omitted angles fall back to the constructor defaults.
   *
   * @param {{ theta?: Number|number[], phi?: Number|number[] }} [angles]
   * @returns {AngleOffset}
   */
  static from({ theta, phi } = {}) {
    return new AngleOffset(theta, phi);
  }

  getTheta() {
    if (typeof this.theta === "number") {
      return this.theta;
    }
    if (this.theta[0] !== undefined) {
      return random(this.theta[0], this.theta[1]);
    }

    return 0;
  }

  getPhi() {
    if (typeof this.phi === "number") {
      return this.phi;
    }
    if (this.phi[0] !== undefined) {
      return random(this.phi[0], this.phi[1]);
    }

    return 0;
  }
}

/**
 * Direction-relative position offset for an entity.
 * Components may be fixed numbers or `[min, max]` random ranges.
 */
export class DirectionalOffset {
  /**
   * @param {Number|number[]} ground Vertical offset.
   * @param {Number|number[]} side Lateral offset.
   * @param {Number|number[]} front Forward offset.
   * @param {Boolean} shouldIgnoreVertical Ignore the vertical component of the facing vector.
   * @param {Boolean} shouldUseViewDirection Use the entity view vector instead of yaw rotation.
   * @param {Boolean} shouldUseTargetDirection Reserve a target-direction override flag for callers.
   */
  constructor(
    ground = 0,
    side = 0,
    front = 0,
    shouldIgnoreVertical = false,
    shouldUseViewDirection = false,
    shouldUseTargetDirection = false,
  ) {
    this.ground = ground;
    this.side = side;
    this.front = front;
    this.ignoreVertical = shouldIgnoreVertical;
    this.useViewDirection = shouldUseViewDirection;
    this.useTargetDirection = shouldUseTargetDirection;
  }

  /**
   * Builds an offset from named components, so data tables label each value.
   * Omitted components fall back to the constructor defaults.
   *
   * @param {{ ground?: Number|number[], side?: Number|number[], front?: Number|number[], ignoreVertical?: Boolean, useViewDirection?: Boolean, useTargetDirection?: Boolean }} [components]
   * @returns {DirectionalOffset}
   */
  static from({
    ground,
    side,
    front,
    ignoreVertical,
    useViewDirection,
    useTargetDirection,
  } = {}) {
    return new DirectionalOffset(
      ground,
      side,
      front,
      ignoreVertical,
      useViewDirection,
      useTargetDirection,
    );
  }

  getGround() {
    if (typeof this.ground === "number") {
      return this.ground;
    }
    if (this.ground[0] !== undefined) {
      return random(this.ground[0], this.ground[1]);
    }

    return 0;
  }

  getSide() {
    if (typeof this.side === "number") {
      return this.side;
    }
    if (this.side[0] !== undefined) {
      return random(this.side[0], this.side[1]);
    }

    return 0;
  }

  getFront() {
    if (typeof this.front === "number") {
      return this.front;
    }
    if (this.front[0] !== undefined) {
      return random(this.front[0], this.front[1]);
    }

    return 0;
  }
}

/** Resolve one directional offset component from either methods or raw fields. */
export function resolveDirectionalOffsetValue(offset, key, fallback = 0) {
  if (!offset || typeof offset !== "object") {
    return fallback;
  }

  const getterByKey = {
    ground: "getGround",
    side: "getSide",
    front: "getFront",
  };

  const getter = getterByKey[key];
  if (getter && typeof offset[getter] === "function") {
    return offset[getter]();
  }

  const value = offset[key];
  return typeof value === "number" ? value : fallback;
}

/** Normalize offset-like objects to DirectionalOffset instances. */
export function toDirectionalOffset(offset) {
  if (!offset || typeof offset !== "object") {
    return undefined;
  }

  if (offset instanceof DirectionalOffset) {
    return offset;
  }

  return new DirectionalOffset(
    resolveDirectionalOffsetValue(offset, "ground", 0),
    resolveDirectionalOffsetValue(offset, "side", 0),
    resolveDirectionalOffsetValue(offset, "front", 0),
    offset.ignoreVertical ?? false,
    offset.useViewDirection ?? false,
    offset.useTargetDirection ?? false,
  );
}

/** Resolve horizontal angle offsets from numbers, AngleOffset instances, or compatible objects. */
export function resolveAngleTheta(angleOffset) {
  if (angleOffset === undefined || angleOffset === null) {
    return undefined;
  }

  if (typeof angleOffset === "number") {
    return angleOffset;
  }

  if (angleOffset instanceof AngleOffset) {
    return angleOffset.getTheta();
  }

  if (typeof angleOffset?.getTheta === "function") {
    return angleOffset.getTheta();
  }

  if (typeof angleOffset?.theta === "number") {
    return angleOffset.theta;
  }

  return undefined;
}

/** Absolute XYZ offset descriptor. */
export class PositionalOffset {
  /**
   * @param {Number} x Positive moves east.
   * @param {Number} y Positive moves up.
   * @param {Number} z Positive moves south.
   */
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  getX() {
    return typeof this.x === "number" ? this.x : 0;
  }

  getY() {
    return typeof this.y === "number" ? this.y : 0;
  }

  getZ() {
    return typeof this.z === "number" ? this.z : 0;
  }
}

/** Serializable effect payload for entity effect application. */
export class EntityEffect {
  /**
   * @param {{id:String, duration?:Number, amplifier?:Number, showParticles?:Boolean, isCustom?:Boolean, startTime?:Number, endTime?:Number, interval?:Number}} options start/end/interval are authored in seconds.
   */
  constructor(options) {
    this.id = options.id;
    this.duration = options.duration ?? 1;
    this.amplifier = options.amplifier ?? 0;
    this.showParticles = options.showParticles ?? true;
    this.isCustom = options.isCustom ?? false;
    this.startTime = options.startTime;
    this.endTime = options.endTime;
    this.interval = options.interval;
  }

  stringify() {
    return JSON.stringify(this);
  }
}

/** Serializable sound payload for toolkit consumers. */
export class SoundEffect {
  /**
   * @param {{id:String, pitch?:Number, volume?:Number}} options
   */
  constructor(options) {
    this.id = options.id;
    this.pitch = options.pitch ?? 1;
    this.volume = options.volume ?? 1;
  }

  stringify() {
    return JSON.stringify(this);
  }
}

/** Serializable particle payload with optional location or directional offset. */
export class ParticleEffect {
  /**
   * @param {{id:String, location?:BVector3, offset?:DirectionalOffset}} options
   */
  constructor(options) {
    this.id = options.id;
    this.location = options.location;
    this.offset = options.offset ?? new DirectionalOffset(0, 0, 0);
  }

  stringify() {
    return JSON.stringify(this);
  }
}

/** Serializable camera shake payload. */
export class CameraShake {
  /**
   * @param {{intensity?:Number, duration?:Number, shakeType?:String, radius?:Number, startTime?:Number, endTime?:Number, interval?:Number}} options start/end/interval are authored in seconds.
   */
  constructor(options) {
    this.intensity = options.intensity ?? 0.1;
    this.duration = options.duration ?? 1;
    this.shakeType = options.shakeType ?? "positional";
    this.radius = options.radius ?? 16;
    this.startTime = options.startTime;
    this.endTime = options.endTime;
    this.interval = options.interval;
  }

  stringify() {
    return JSON.stringify(this);
  }
}

/**
 * Resolve an offset component from a number or a [min, max] random range.
 * Unlike resolveDirectionalOffsetValue, this ignores getter methods.
 */
function resolveOffsetComponent(value) {
  if (typeof value === "number") {
    return value;
  }
  if (Array.isArray(value) && value.length >= 2) {
    return random(value[0], value[1]);
  }
  return 0;
}

/**
 * Resolve a world position from an entity-relative directional offset.
 *
 * @param {Entity} entity
 * @param {DirectionalOffset|Object} offset Offset description.
 * @param {Boolean} [isVerticalIgnored=false] Ignore the vertical component of the resolved facing vector.
 * @param {Boolean} [shouldPreferViewDirection=false] Prefer the entity view direction over yaw rotation.
 * @param {BVector3} [directionOverride] Optional explicit forward vector.
 */
export function rotationRelativeOffset(
  entity,
  offset,
  isVerticalIgnored = false,
  shouldPreferViewDirection = false,
  directionOverride = undefined,
) {
  const location = BVector3.from(entity.location);

  const ground =
    typeof offset?.getGround === "function"
      ? offset.getGround()
      : resolveOffsetComponent(offset?.ground);
  const front =
    typeof offset?.getFront === "function"
      ? offset.getFront()
      : resolveOffsetComponent(offset?.front);
  const side =
    typeof offset?.getSide === "function"
      ? offset.getSide()
      : resolveOffsetComponent(offset?.side);

  const shouldIgnoreVertical = isVerticalIgnored || offset.ignoreVertical;
  const shouldUseViewDirection =
    shouldPreferViewDirection || offset.useViewDirection;

  location.y += ground;
  const forward = directionOverride
    ? BVector3.from(directionOverride)
    : shouldUseViewDirection
      ? BVector3.from(entity.getViewDirection())
      : (() => {
          const yawDeg = getAttackReferenceYaw(entity);
          const yawRad = (yawDeg * Math.PI) / HALF_CIRCLE;
          return new BVector3(-Math.sin(yawRad), 0, Math.cos(yawRad));
        })();
  if (shouldIgnoreVertical) {
    forward.y = 0;
  }

  if (forward.magnitude() === 0) {
    forward.z = 1;
  } else {
    forward.setMagnitude(1);
  }

  if (front !== 0) {
    const force = forward.copy();
    force.setMagnitude(front);
    location.add(force);
  }

  if (side !== 0) {
    const sideVector = BVector3.crossProduct(forward, new BVector3(0, 1, 0));
    if (sideVector && sideVector.magnitude() !== 0) {
      sideVector.setMagnitude(side);
      location.add(sideVector);
    }
  }

  return location;
}

/** Return the raw direction vector from one entity to another. */
export function getDirection(fromEntity, toEntity) {
  const floc = BVector3.from(fromEntity?.location);
  const sloc = BVector3.from(toEntity?.location);
  return BVector3.subtract(sloc, floc);
}

/**
 * Return a direction vector from an entity to a target.
 *
 * @param {Entity} entity
 * @param {Entity} target
 * @param {Boolean} [middlePoint] Aim between the target feet and head when true.
 */
export function getTargetVector(entity, target, middlePoint) {
  const entityLoc = BVector3.from(entity?.location);
  let tLoc = BVector3.from(target?.location);
  if (middlePoint) {
    const thLoc = BVector3.from(target?.getHeadLocation());
    tLoc = new BVector3(
      (tLoc.x + thLoc.x) / 2,
      (tLoc.y + thLoc.y) / 2,
      (tLoc.z + thLoc.z) / 2,
    );
  }
  return BVector3.subtract(tLoc, entityLoc);
}

/**
 * Build the entity query shared by the cone and area searches. The source
 * entity's own type and the "inanimate" family are always excluded.
 *
 * @param {Entity} entity Source entity.
 * @param {Object} options Query options including range, type filters, and exclusions.
 */
function buildEntitySearchOptions(entity, options) {
  const searchOptions = {
    location: options.location ?? entity.location,
    excludeNames: [...(options.excludeNames ?? [])],
    excludeTags: [...(options.excludeTags ?? [])],
    excludeFamilies: ["inanimate", ...(options.excludeFamilies ?? [])],
    excludeTypes: [entity.typeId, ...(options.excludeTypes ?? [])],
    maxDistance: options.range,
  };

  if (options.closest !== undefined) {
    searchOptions.closest = options.closest;
  }
  if (options.type !== undefined) {
    searchOptions.type = options.type;
  }

  return searchOptions;
}

/**
 * Query entities within a cone in front of an entity.
 *
 * @param {Entity} entity Source entity.
 * @param {Object} options Query options including angle, range, and exclusions.
 */
export function getEntitiesCone(entity, options) {
  if (!entity?.isValid) {
    return [];
  }

  const targets = [];
  const entities =
    entity.dimension.getEntities(buildEntitySearchOptions(entity, options)) ??
    [];
  const referenceYaw = getAttackReferenceYaw(entity);

  for (const t of entities) {
    if (!t?.isValid) {
      continue;
    }
    const angleOffset = options.angleOffset?.getTheta?.() ?? 0;
    const entityRotation = referenceYaw + angleOffset;
    const targetVector = getTargetVector(entity, t);
    const targetAngle = targetVector.angles().theta;

    const diff = Math.abs(entityRotation - targetAngle) % FULL_CIRCLE;
    const angleDifference = diff > HALF_CIRCLE ? FULL_CIRCLE - diff : diff;
    if (angleDifference <= options.angle) {
      targets.push(t);
    }
  }

  return targets;
}

/**
 * Query entities within a radius-based area around an entity or explicit location.
 *
 * @param {Entity} entity Source entity.
 * @param {Object} options Query options including range, type filters, and exclusions.
 */
export function getEntitiesArea(entity, options) {
  if (!entity?.isValid) {
    return [];
  }

  return (
    entity.dimension.getEntities(buildEntitySearchOptions(entity, options)) ??
    []
  );
}

/** Mount a rider onto a rideable entity when the component is available. */
export function mountEntity(rider, mount) {
  if (!rider?.isValid || !mount?.isValid) {
    return;
  }

  const rideable = mount.getComponent(SETTINGS.entities.components.rideable.id);

  if (rideable) {
    rideable.addRider(rider);
  }
}
