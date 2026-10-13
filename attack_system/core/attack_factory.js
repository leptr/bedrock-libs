// Developed by: Petar Mijailovic (leptr)
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

import { system, TicksPerSecond, world } from "@minecraft/server";
import { SETTINGS } from "../../game_settings.js";
import {
  applyAreaKnockback,
  cleanupAttackStateControls,
  isValid,
  setupAttackStateControls,
  getTarget,
  propelHomingProjectile,
  propelReturningProjectile,
  handleProjectileRotation,
  shouldStopProjectile,
  getTargetV2,
  shouldTargetProjectileCenter,
} from "../entity_attack.js";
import {
  AngleOffset,
  DirectionalOffset,
  getAttackReferenceYaw,
  rotationRelativeOffset,
  getTargetVector,
} from "../../toolkit/toolkit.js";
import {
  BVector2,
  BVector3,
  FULL_CIRCLE,
  HALF_CIRCLE,
  RIGHT_ANGLE,
} from "../../better_vectors/better_vectors.js";
import {
  ATTACK_SHAPES,
  DAMAGE_PATTERNS,
  DIFFICULTY_INTS,
} from "../constants.js";
import { breakBlock } from "../entity_utility.js";
import { TargetFinder } from "./target_finder.js";
import { EffectRegistry } from "../../toolkit/effect_registry.js";
import { DamageCalculator } from "./damage_calculator.js";
import { AttackValidator } from "./attack_validator.js";
import {
  AttackEventEmitter,
  globalAttackEmitter,
} from "./attack_event_emitter.js";
import { globalAttackLogger } from "./attack_logger.js";
import { logIgnoredError } from "../../utils/logger.js";

/** @import { Entity } from "@minecraft/server" */
/** @import { AttackConfig } from "../types.js" */

const APPLIED_DAMAGE_DIVISOR = 3;
// Just above the top face of the block a ground-projected spawn lands on.
const GROUND_SPAWN_Y_OFFSET_BLOCKS = 1.05;
const DEFAULT_PROJECTILE_Y_OFFSET_BLOCKS = 1.5;
const CACHE_STATS_MAX_KEYS = 5;

const activeAttackRuntimeCounts = new Map();

export function hasActiveAttackRuntime(entity) {
  const entityId = entity?.id;

  return (
    typeof entityId === "string" &&
    entityId.length > 0 &&
    (activeAttackRuntimeCounts.get(entityId) ?? 0) > 0
  );
}

const TIMING_FIELDS_SECONDS = [
  "delay",
  "duration",
  "damageDuration",
  "interval",
  "shootingDuration",
  "startDelay",
  "endDelay",
  "areaExpansionTime",
  "delayedHoming",
  "flightTime",
  "outboundFlightTime",
  "returnPauseTime",
  "returnFlightTime",
  "arcGrowthTime",
  "disableMovementAfterTime",
  "lockRotationAfterTime",
  "enableMovementAfterTime",
  "unlockRotationAfterTime",
];

const REGULAR_POLYGON_SIDES = {
  [ATTACK_SHAPES.TRIANGLE]: 3,
  [ATTACK_SHAPES.PENTAGON]: 5,
  [ATTACK_SHAPES.HEXAGON]: 6,
  [ATTACK_SHAPES.OCTAGON]: 8,
  [ATTACK_SHAPES.SQUARE]: 4,
};

const STAR_INNER_RADIUS_SCALE = 0.45;
const STAR_VERTEX_ANGLE_STEP = 36;
const MIN_LINE_SPACING = 0.01;
const MIN_GENERATED_SHOT_SPACING = 0.5;
const SHOT_DISTRIBUTION_CENTER_OFFSET = 0.5;
const GENERATED_LAYER_DISTANCE_PRECISION = 10_000;
const DEFAULT_ATTACK_INTERVAL_SECONDS = 0.05;

function secondsToTicks(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.max(0, Math.round(value * TicksPerSecond));
}

const DEFAULT_ATTACK_INTERVAL_TICKS = secondsToTicks(
  DEFAULT_ATTACK_INTERVAL_SECONDS,
);

function toFiniteNumber(value, fallback = 0) {
  const resolved = Number(value);
  return Number.isFinite(resolved) ? resolved : fallback;
}

function getGeneratedShotsCount(config) {
  if (!config || typeof config !== "object") {
    return 0;
  }

  const rawCount = config.count ?? config.numberOfShots ?? config.shots;
  const count = Number(rawCount);
  return Number.isSafeInteger(count) && count > 0 ? count : 0;
}

function getGeneratedHitsCount(config) {
  if (!config || typeof config !== "object") {
    return 0;
  }

  const rawCount =
    config.count ?? config.numberOfHits ?? config.numberOfShots ?? config.hits;
  const count = Number(rawCount);
  return Number.isSafeInteger(count) && count > 0 ? count : 0;
}

function resolveDirectionalOffsetConfig(offsetConfig) {
  if (offsetConfig instanceof DirectionalOffset) {
    return new DirectionalOffset(
      offsetConfig.ground,
      offsetConfig.side,
      offsetConfig.front,
      offsetConfig.ignoreVertical,
      offsetConfig.useViewDirection,
      offsetConfig.useTargetDirection,
    );
  }

  return new DirectionalOffset(
    offsetConfig?.ground ?? 0,
    offsetConfig?.side ?? 0,
    offsetConfig?.front ?? 0,
    offsetConfig?.ignoreVertical ?? false,
    offsetConfig?.useViewDirection ?? false,
    offsetConfig?.useTargetDirection ?? false,
  );
}

function resolveAngleOffsetConfig(angleConfig) {
  if (typeof angleConfig === "number") {
    return new AngleOffset(angleConfig, 0);
  }

  if (angleConfig instanceof AngleOffset) {
    return new AngleOffset(angleConfig.theta, angleConfig.phi);
  }

  return new AngleOffset(angleConfig?.theta ?? 0, angleConfig?.phi ?? 0);
}

function getProjectileTargetLocation(target, shouldTargetCenter = true) {
  const targetLocation = BVector3.from(target.location);
  if (!shouldTargetCenter || typeof target?.getHeadLocation !== "function") {
    return targetLocation;
  }

  return BVector3.lerp(
    targetLocation,
    BVector3.from(target.getHeadLocation()),
    0.5,
  );
}

function shouldUseDefaultFullCircleSpacing(config) {
  return (
    config?.angleSpacing === undefined &&
    config?.angle === undefined &&
    (config?.shape === ATTACK_SHAPES.CIRCLE ||
      config?.shape === ATTACK_SHAPES.LINES)
  );
}

function getShotSpacing(count, shotConfig) {
  if (shotConfig?.angleSpacing !== undefined) {
    return toFiniteNumber(shotConfig.angleSpacing, 0);
  }

  if (shouldUseDefaultFullCircleSpacing(shotConfig)) {
    return count > 0 ? FULL_CIRCLE / count : 0;
  }

  const totalAngle = toFiniteNumber(shotConfig?.angle, 0);
  return count > 1 ? totalAngle / (count - 1) : 0;
}

function getCenteredShotOffset(index, count, spacing, shotConfig) {
  if (count <= 1) {
    return 0;
  }

  if (shotConfig?.angleSpacing !== undefined) {
    return (index - (count - 1) / 2) * spacing;
  }

  if (shouldUseDefaultFullCircleSpacing(shotConfig)) {
    return index * spacing;
  }

  return (index - (count - 1) / 2) * spacing;
}

function createGeneratedShot(
  baseDirectionalOffset,
  radius,
  theta,
  phi,
  useSphere,
) {
  const thetaRad = (theta * Math.PI) / HALF_CIRCLE;
  const phiRad = useSphere ? (-phi * Math.PI) / HALF_CIRCLE : 0;
  const horizontalRadius = useSphere ? radius * Math.cos(phiRad) : radius;
  const sideOffset = Math.sin(thetaRad) * horizontalRadius;
  const frontOffset = Math.cos(thetaRad) * horizontalRadius;
  const groundOffset = useSphere ? radius * Math.sin(phiRad) : 0;

  return {
    projectileOffset: new DirectionalOffset(
      toFiniteNumber(baseDirectionalOffset.ground, 0) + groundOffset,
      toFiniteNumber(baseDirectionalOffset.side, 0) + sideOffset,
      toFiniteNumber(baseDirectionalOffset.front, 0) + frontOffset,
      baseDirectionalOffset.ignoreVertical ?? false,
      baseDirectionalOffset.useViewDirection ?? false,
      baseDirectionalOffset.useTargetDirection ?? false,
    ),
    projectileAngleOffset: new AngleOffset(theta, phi),
  };
}

/**
 * Expand authored multi_ranged `shotsConfig` into concrete runtime shots.
 *
 * For radial 360 layouts, set `shape: ATTACK_SHAPES.CIRCLE` (or `LINES`) and
 * omit `angle`/`angleSpacing`; the generator will space `count` shots evenly
 * around the circle. In that mode, `angleOffset.theta` is the base heading for
 * the first shot and each generated shot adds its own per-shot theta spacing.
 * `angleOffset.phi` stays fixed for every shot unless `sphere/useSphere` is
 * enabled. Positive phi pitches downward, negative phi pitches upward.
 */
function createShotsFromConfig(shotConfig) {
  const count = getGeneratedShotsCount(shotConfig);
  if (count <= 0) {
    return [];
  }

  const baseDirectionalOffset = resolveDirectionalOffsetConfig(
    shotConfig?.directionalOffset,
  );
  const baseAngleOffset = resolveAngleOffsetConfig(shotConfig?.angleOffset);
  const radius = Math.max(0, toFiniteNumber(shotConfig?.radius, 0));
  const spacing = getShotSpacing(count, shotConfig);
  const isSphere = shotConfig?.sphere ?? shotConfig?.useSphere ?? false;

  return Array.from({ length: count }, (_, index) => {
    const thetaOffset = getCenteredShotOffset(
      index,
      count,
      spacing,
      shotConfig,
    );
    const phiOffset = isSphere
      ? getCenteredShotOffset(index, count, spacing, shotConfig)
      : 0;

    return createGeneratedShot(
      baseDirectionalOffset,
      radius,
      toFiniteNumber(baseAngleOffset.theta, 0) + thetaOffset,
      toFiniteNumber(baseAngleOffset.phi, 0) + phiOffset,
      isSphere,
    );
  });
}

function resolveSpacing(config, count, radius, keys = ["spacing"]) {
  for (const key of keys) {
    const value = toFiniteNumber(config?.[key], Number.NaN);
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }

  if (radius <= 0) {
    return 1;
  }

  if (count <= 1) {
    return radius;
  }

  return Math.max(
    radius / Math.ceil(Math.sqrt(count)),
    MIN_GENERATED_SHOT_SPACING,
  );
}

function rotatePlanePoint(side, front, angleDegrees) {
  const point = new BVector2(side, front);
  point.rotate(angleDegrees);
  return {
    side: point.x,
    front: point.y,
  };
}

function createGeneratedDirectionalOffset(
  baseDirectionalOffset,
  sideOffset,
  frontOffset,
  groundOffset = 0,
) {
  return new DirectionalOffset(
    toFiniteNumber(baseDirectionalOffset.ground, 0) + groundOffset,
    toFiniteNumber(baseDirectionalOffset.side, 0) + sideOffset,
    toFiniteNumber(baseDirectionalOffset.front, 0) + frontOffset,
    baseDirectionalOffset.ignoreVertical ?? false,
    baseDirectionalOffset.useViewDirection ?? false,
    baseDirectionalOffset.useTargetDirection ?? false,
  );
}

function getGeneratedSpawnHitBaseConfig(config) {
  if (!config || typeof config !== "object") {
    return {};
  }

  return {
    pattern: config.pattern,
    entity: config.entity,
    range: config.range,
    delay: config.delay,
    directionalOffset: config.directionalOffset,
    spawnAtTargetLocation: config.spawnAtTargetLocation,
    projectToGround: config.projectToGround,
    matchSourceRotation: config.matchSourceRotation,
    initialRotation: config.initialRotation,
  };
}

function selectDistributedCandidates(candidates, count) {
  if (candidates.length <= count) {
    return candidates;
  }

  if (count <= 1) {
    return [candidates[Math.floor(candidates.length / 2)]];
  }

  const lastIndex = candidates.length - 1;
  return Array.from({ length: count }, (_, index) => {
    const candidateIndex = Math.round((index * lastIndex) / (count - 1));
    return candidates[candidateIndex];
  });
}

function createRegularPolygonVertices(sides, radius, rotationDegrees = 0) {
  const angleStep = FULL_CIRCLE / sides;
  const startAngle = rotationDegrees - RIGHT_ANGLE;

  return Array.from({ length: sides }, (_, index) => {
    const point = BVector2.fromAngle(startAngle + angleStep * index);
    point.multiply(radius);
    return {
      side: point.x,
      front: point.y,
    };
  });
}

function createStarVertices(radius, rotationDegrees = 0) {
  return Array.from({ length: 10 }, (_, index) => {
    const currentRadius =
      index % 2 === 0 ? radius : radius * STAR_INNER_RADIUS_SCALE;
    const point = BVector2.fromAngle(
      rotationDegrees - RIGHT_ANGLE + index * STAR_VERTEX_ANGLE_STEP,
    );
    point.multiply(currentRadius);
    return {
      side: point.x,
      front: point.y,
    };
  });
}

function isPointInPolygon(point, vertices) {
  let isInside = false;

  for (
    let index = 0, previousIndex = vertices.length - 1;
    index < vertices.length;
    previousIndex = index, index++
  ) {
    const current = vertices[index];
    const previous = vertices[previousIndex];
    const isIntersects =
      current.front > point.front !== previous.front > point.front &&
      point.side <
        ((previous.side - current.side) * (point.front - current.front)) /
          (previous.front - current.front) +
          current.side;

    if (isIntersects) {
      isInside = !isInside;
    }
  }

  return isInside;
}

function getDistanceToSegment(point, start, end) {
  const pointVector = new BVector2(point.side, point.front);
  const startVector = new BVector2(start.side, start.front);
  const endVector = new BVector2(end.side, end.front);
  const segment = BVector2.subtract(endVector, startVector);

  if (segment.magnitudeSqr() === 0) {
    return pointVector.distance(startVector);
  }

  const pointOffset = BVector2.subtract(pointVector, startVector);
  const projection = pointOffset.dotProduct(segment) / segment.magnitudeSqr();
  const clamped = Math.max(0, Math.min(1, projection));
  const closestPoint = startVector.copy();
  const scaledSegment = segment.copy();
  scaledSegment.multiply(clamped);
  closestPoint.add(scaledSegment);

  return pointVector.distance(closestPoint);
}

function isPointOnPolygonEdge(point, vertices, threshold) {
  for (let index = 0; index < vertices.length; index++) {
    const nextIndex = (index + 1) % vertices.length;
    if (
      getDistanceToSegment(point, vertices[index], vertices[nextIndex]) <=
      threshold
    ) {
      return true;
    }
  }

  return false;
}

function buildCircleCandidates(config, count, radius, baseAngleOffset) {
  const spacing = getShotSpacing(count, config);
  const spawnOnEdges = config?.spawnOnEdges ?? false;

  return Array.from({ length: count }, (_, index) => {
    const thetaOffset = getCenteredShotOffset(index, count, spacing, config);
    const theta = toFiniteNumber(baseAngleOffset.theta, 0) + thetaOffset;
    const thetaRad = (theta * Math.PI) / HALF_CIRCLE;
    const radialDistance = spawnOnEdges
      ? radius
      : radius * Math.sqrt((index + SHOT_DISTRIBUTION_CENTER_OFFSET) / count);
    const point = new BVector2(Math.sin(thetaRad), Math.cos(thetaRad));
    point.multiply(radialDistance);

    return {
      angle: theta,
      distance: radialDistance,
      side: point.x,
      front: point.y,
    };
  });
}

function buildLineCandidates(config, lineCount, radius, baseAngleOffset) {
  const angleSpacing = getShotSpacing(lineCount, config);
  const lineSpacing = resolveSpacing(config, lineCount, radius, [
    "lineSpacing",
    "spacing",
  ]);
  const spawnOnEdges = config?.spawnOnEdges ?? false;
  const maxSegments = Math.max(
    1,
    Math.floor(radius / Math.max(lineSpacing, MIN_LINE_SPACING)),
  );
  const candidates = [];

  for (let lineIndex = 0; lineIndex < lineCount; lineIndex++) {
    const thetaOffset = getCenteredShotOffset(
      lineIndex,
      lineCount,
      angleSpacing,
      config,
    );
    const theta = toFiniteNumber(baseAngleOffset.theta, 0) + thetaOffset;
    const thetaRad = (theta * Math.PI) / HALF_CIRCLE;
    const direction = new BVector2(Math.sin(thetaRad), Math.cos(thetaRad));

    if (spawnOnEdges) {
      const point = direction.copy();
      point.multiply(radius);
      candidates.push({
        angle: theta,
        distance: radius,
        side: point.x,
        front: point.y,
      });
      continue;
    }

    for (let segment = 1; segment <= maxSegments; segment++) {
      const distance = Math.min(radius, lineSpacing * segment);
      const point = direction.copy();
      point.multiply(distance);
      candidates.push({
        angle: theta,
        side: point.x,
        front: point.y,
        distance,
      });
    }
  }

  return candidates;
}

function getLatticeVertices(shape, radius, rotation) {
  if (shape === ATTACK_SHAPES.STAR) {
    return createStarVertices(radius, rotation);
  }

  if (Object.hasOwn(REGULAR_POLYGON_SIDES, shape)) {
    return createRegularPolygonVertices(
      REGULAR_POLYGON_SIDES[shape],
      radius,
      rotation,
    );
  }

  return undefined;
}

function evaluateLatticePoint(point, shape, radius, edgeThreshold, vertices) {
  if (shape === ATTACK_SHAPES.GRID || shape === ATTACK_SHAPES.SQUARE) {
    return {
      includePoint:
        Math.abs(point.side) <= radius && Math.abs(point.front) <= radius,
      onEdge:
        Math.abs(Math.abs(point.side) - radius) <= edgeThreshold ||
        Math.abs(Math.abs(point.front) - radius) <= edgeThreshold,
    };
  }

  if (shape === ATTACK_SHAPES.DIAMOND) {
    return {
      includePoint: Math.abs(point.side) + Math.abs(point.front) <= radius,
      onEdge:
        Math.abs(Math.abs(point.side) + Math.abs(point.front) - radius) <=
        edgeThreshold,
    };
  }

  if (vertices) {
    return {
      includePoint: isPointInPolygon(point, vertices),
      onEdge: isPointOnPolygonEdge(point, vertices, edgeThreshold),
    };
  }

  return {
    includePoint: false,
    onEdge: false,
  };
}

function buildLatticeCandidates(config, count, radius, shape, baseAngleOffset) {
  const sideSpacing = resolveSpacing(config, count, radius, [
    "columnSpacing",
    "spacing",
  ]);
  const frontSpacing = resolveSpacing(config, count, radius, [
    "rowSpacing",
    "spacing",
  ]);
  const rotation = toFiniteNumber(baseAngleOffset.theta, 0);
  const edgeThreshold = Math.max(sideSpacing, frontSpacing) * 0.5;
  const spawnOnEdges = config?.spawnOnEdges ?? false;
  const candidates = [];
  const vertices = getLatticeVertices(shape, radius, rotation);

  for (
    let side = -radius;
    side <= radius + sideSpacing * 0.5;
    side += sideSpacing
  ) {
    for (
      let front = -radius;
      front <= radius + frontSpacing * 0.5;
      front += frontSpacing
    ) {
      const point =
        !vertices && rotation !== 0
          ? rotatePlanePoint(side, front, rotation)
          : { side, front };

      const { includePoint, onEdge } = evaluateLatticePoint(
        point,
        shape,
        radius,
        edgeThreshold,
        vertices,
      );

      if (includePoint && (!spawnOnEdges || onEdge)) {
        candidates.push(point);
      }
    }
  }

  return candidates;
}

function createGeneratedHitsFromConfig(hitConfig, inheritedConfig = undefined) {
  const mergedConfig = {
    ...getGeneratedSpawnHitBaseConfig(inheritedConfig),
    ...hitConfig,
  };
  const shape = mergedConfig?.shape ?? ATTACK_SHAPES.CIRCLE;
  const count = getGeneratedHitsCount(mergedConfig);
  if (count <= 0) {
    return [];
  }

  const generatedHitBaseConfig = { ...mergedConfig };
  delete generatedHitBaseConfig.count;
  delete generatedHitBaseConfig.numberOfHits;
  delete generatedHitBaseConfig.numberOfShots;
  delete generatedHitBaseConfig.hits;
  delete generatedHitBaseConfig.type;
  delete generatedHitBaseConfig.spawnConfig;
  delete generatedHitBaseConfig.shots;
  delete generatedHitBaseConfig.shotsConfig;
  delete generatedHitBaseConfig.radius;
  delete generatedHitBaseConfig.directionalOffset;
  delete generatedHitBaseConfig.angleOffset;
  delete generatedHitBaseConfig.shape;
  delete generatedHitBaseConfig.angle;
  delete generatedHitBaseConfig.angleSpacing;
  delete generatedHitBaseConfig.spacing;
  delete generatedHitBaseConfig.rowSpacing;
  delete generatedHitBaseConfig.columnSpacing;
  delete generatedHitBaseConfig.lineSpacing;
  delete generatedHitBaseConfig.layerDelay;
  delete generatedHitBaseConfig.spawnOnEdges;

  const baseDirectionalOffset = resolveDirectionalOffsetConfig(
    mergedConfig?.directionalOffset,
  );
  const baseAngleOffset = resolveAngleOffsetConfig(mergedConfig?.angleOffset);
  const radius = Math.max(0, toFiniteNumber(mergedConfig?.radius, 0));
  let candidates;
  if (shape === ATTACK_SHAPES.CIRCLE) {
    candidates = buildCircleCandidates(
      mergedConfig,
      count,
      radius,
      baseAngleOffset,
    );
  } else if (shape === ATTACK_SHAPES.LINES) {
    candidates = buildLineCandidates(
      mergedConfig,
      count,
      radius,
      baseAngleOffset,
    );
  } else {
    candidates = buildLatticeCandidates(
      mergedConfig,
      count,
      radius,
      shape,
      baseAngleOffset,
    );
  }

  const selectedCandidates =
    shape === ATTACK_SHAPES.LINES
      ? candidates
      : selectDistributedCandidates(candidates, count);

  const layerDelay = toFiniteNumber(mergedConfig?.layerDelay, 0);
  const layerIndicesByDistance = new Map();

  if (layerDelay > 0) {
    const sortedLayerDistances = [
      ...new Set(
        selectedCandidates.map(
          candidate =>
            Math.round(
              Math.hypot(candidate.side ?? 0, candidate.front ?? 0) *
                GENERATED_LAYER_DISTANCE_PRECISION,
            ) / GENERATED_LAYER_DISTANCE_PRECISION,
        ),
      ),
    ];
    sortedLayerDistances.sort((left, right) => left - right);

    for (const [index, distance] of sortedLayerDistances.entries()) {
      layerIndicesByDistance.set(distance, index);
    }
  }

  return selectedCandidates.map(candidate => ({
    ...generatedHitBaseConfig,
    delay:
      layerDelay > 0
        ? toFiniteNumber(generatedHitBaseConfig.delay, 0) +
          (layerIndicesByDistance.get(
            Math.round(
              Math.hypot(candidate.side ?? 0, candidate.front ?? 0) *
                GENERATED_LAYER_DISTANCE_PRECISION,
            ) / GENERATED_LAYER_DISTANCE_PRECISION,
          ) ?? 0) *
            layerDelay
        : generatedHitBaseConfig.delay,
    generatedSpawnAngle: candidate.angle,
    directionalOffset: createGeneratedDirectionalOffset(
      baseDirectionalOffset,
      candidate.side,
      candidate.front,
    ),
  }));
}

function expandGeneratedShots(config) {
  if (!config || typeof config !== "object") {
    return config;
  }

  const expanded = { ...config };

  if (Array.isArray(expanded.hits)) {
    expanded.hits = expanded.hits.map(hit => expandGeneratedShots(hit));
  } else if (expanded.spawnConfig === undefined) {
    // do nothing
  } else {
    expanded.hits = createGeneratedHitsFromConfig(
      expanded.spawnConfig,
      expanded,
    ).map(hit => expandGeneratedShots(hit));
    delete expanded.spawnConfig;
  }

  if (expanded.shotsConfig !== undefined) {
    expanded.shots = createShotsFromConfig(expanded.shotsConfig);
    delete expanded.shotsConfig;
  } else if (Array.isArray(expanded.shots)) {
    expanded.shots = expanded.shots.map(shot =>
      shot && typeof shot === "object" ? { ...shot } : shot,
    );
  } else {
    // do nothing
  }

  return expanded;
}

/**
 * Attack configs are authored in seconds at the boundary, but the runtime uses ticks.
 * This normalizes only the known attack-timing fields, and recurses only through
 * nested attack configs (hits/shots) to avoid mutating unrelated nested objects
 * (e.g., camera shake effect durations).
 */
function normalizeAttackTimingSecondsToTicks(config) {
  if (!config || typeof config !== "object") {
    return config;
  }

  const normalized = { ...config };

  for (const key of TIMING_FIELDS_SECONDS) {
    if (Array.isArray(normalized[key])) {
      normalized[key] = normalized[key]
        .filter(
          value =>
            typeof value === "number" && Number.isFinite(value) && value > 0,
        )
        .map(value => secondsToTicks(value));
    } else if (typeof normalized[key] === "number") {
      normalized[key] = secondsToTicks(normalized[key]);
    } else {
      // do nothing
    }
  }

  if (Array.isArray(normalized.hits)) {
    normalized.hits = normalized.hits.map(hit =>
      normalizeAttackTimingSecondsToTicks(hit),
    );
  }

  if (Array.isArray(normalized.shots)) {
    normalized.shots = normalized.shots.map(shot =>
      normalizeAttackTimingSecondsToTicks(shot),
    );
  }

  return normalized;
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function mergeAttackConfig(baseConfig, overrides) {
  if (overrides === undefined) {
    return baseConfig;
  }

  if (Array.isArray(overrides)) {
    return [...overrides];
  }

  if (!isPlainObject(baseConfig) || !isPlainObject(overrides)) {
    return overrides;
  }

  const merged = { ...baseConfig };

  for (const [key, overrideValue] of Object.entries(overrides)) {
    const baseValue = merged[key];

    if (Array.isArray(overrideValue)) {
      merged[key] = [...overrideValue];
    } else if (isPlainObject(overrideValue) && isPlainObject(baseValue)) {
      merged[key] = mergeAttackConfig(baseValue, overrideValue);
    } else {
      merged[key] = overrideValue;
    }
  }

  return merged;
}

/**
 * Attack Factory - Unified attack creation system.
 * Builds every attack type from one configuration object.
 */
export const AttackFactory = {
  cache: new Map(),

  /**
   * Creates an attack instance from configuration
   * @param {AttackConfig|{attack_data: AttackConfig}} config - Attack configuration, or an object that holds one under `attack_data`. See `AttackConfig` in ../types.js for the fields.
   * @param {Object} [overrides] - Optional runtime overrides merged into the extracted attack config before validation. Nested plain objects such as spawnConfig are merged recursively, while arrays such as hits or shots replace the original array.
   * @returns {Object} Attack instance with performAttack method
   */
  createAttack(config, overrides = undefined) {
    if (!config || typeof config !== "object") {
      globalAttackLogger.error(
        "VALIDATION",
        "Invalid attack config: config is undefined or not an object",
        { config },
      );
      return undefined;
    }

    const attackConfig = config.attack_data || config;
    const resolvedAttackConfig = mergeAttackConfig(attackConfig, overrides);

    if (resolvedAttackConfig?.range === undefined) {
      const error = new Error(
        "AttackFactory.createAttack requires a top-level range value on attack_data",
      );
      globalAttackLogger.error("VALIDATION", error.message, {
        originalConfig: config,
        extractedConfig: resolvedAttackConfig,
        overrides,
      });
      throw error;
    }

    if (!resolvedAttackConfig || typeof resolvedAttackConfig !== "object") {
      globalAttackLogger.error(
        "VALIDATION",
        "Invalid attack config: extracted config is undefined or not an object",
        { config, overrides, attackConfig: resolvedAttackConfig },
      );
      return undefined;
    }

    const validation =
      AttackValidator.validateAndNormalize(resolvedAttackConfig);
    if (!validation.validation.valid) {
      const rangeValidationError = validation.validation.errors?.find(
        error => error?.field === "range",
      );

      if (rangeValidationError) {
        const error = new Error(rangeValidationError.message);
        globalAttackLogger.error("VALIDATION", error.message, {
          errors: validation.validation.errors,
          originalConfig: config,
          extractedConfig: resolvedAttackConfig,
          overrides,
        });
        throw error;
      }

      globalAttackLogger.error("VALIDATION", "Invalid attack config", {
        errors: validation.validation.errors,
        originalConfig: config,
        extractedConfig: resolvedAttackConfig,
        overrides,
      });
      return undefined;
    }

    const expandedConfig = expandGeneratedShots(validation.config);
    const normalized = normalizeAttackTimingSecondsToTicks(expandedConfig);

    const cacheKey = JSON.stringify(normalized);
    if (AttackFactory.cache.has(cacheKey)) {
      return AttackFactory.cache.get(cacheKey);
    }

    const attack = {
      type: normalized.type,
      pattern: normalized.pattern,
      config: normalized,
      attackOptions: normalized, // For compatibility with existing code

      /**
       * Performs the attack with the provided data
       * @param {Object} attackData - Attack execution data
       * @param {Entity} attackData.entity - The entity performing the attack.
       * @param {(context: Object) => void} [attackData.callback] - Called once when the attack fully ends.
       * @param {(context: Object) => void} [attackData.onHitTarget] - Called when an entity is hit.
       * @param {(context: Object) => void} [attackData.onHit] - Called for single-hit attacks after damage resolution.
       * @param {(context: Object) => void} [attackData.onSubHitStart] - Called once for each MULTI sub-hit when that sub-hit's delay elapses, before its damage/projectile/continuous logic starts. The callback context includes `hitNumber`, `hitConfig`, and `attackOptions` for the active sub-hit.
       * @param {(context: Object) => void} [attackData.onSubHitEnd] - Called once for each MULTI sub-hit after that sub-hit completes. For continuous and repeating multi_ranged sub-hits, this fires when their timed execution window finishes.
       * @param {(context: Object) => void} [attackData.perTick] - Called each tick for continuous attacks.
       * @param {(context: Object) => void} [attackData.projectileMods] - Called after a projectile or spawn_entity entity is spawned.
       * @param {(context: Object) => void} [attackData.perShot] - Called for shots in continuous ranged attacks.
       * @param {(context: Object) => void} [attackData.onShoot] - Called when a returning projectile begins its outbound phase. The callback receives the original attack context plus `projectile`, `phase`, `phaseTick`, `phaseDuration`, and `curvePoint`.
       * @param {(context: Object) => void} [attackData.onOutboundEnd] - Called when a returning projectile reaches its turnaround point.
       * @param {(context: Object) => void} [attackData.onPause] - Called when a returning projectile enters its configured pause window at the turnaround point.
       * @param {(context: Object) => void} [attackData.onPauseEnd] - Called when a returning projectile finishes its configured pause window and is about to return.
       * @param {(context: Object) => void} [attackData.onProjectileReturn] - Called when a returning projectile starts its return phase. The callback context includes `projectile` alongside the other attack fields.
       * @param {(context: Object) => void} [attackData.onReturnStart] - Called when a returning projectile starts its return phase.
       * @param {(context: Object) => void} [attackData.onReturnEnd] - Called when a returning projectile completes its return phase, before optional despawn.
       * @param {(context: Object) => number|[number, number]} [attackData.damageModifier] - Called when calculating damage.
       * @param {Object} [attackData.direction] - Optional world-space direction override for line attacks.
       * @param {(context: Object) => void} [attackData.onLineAim] - Called while line-attack aim tracking updates.
       * @param {(candidate: Entity, context: Object) => boolean} [attackData.validateTarget] - Function which filters the chosen attack targets. Returns true when the target candidate should be kept in the list, and false when it should be excluded. Implemnted only on continious attacks.
       */
      async performAttack(attackData) {
        // Resolve difficulty mods
        const difficultyModConfig =
          attackConfig.difficultyMods?.[
            /** @type {string} */ (
              attackData.entity.getProperty(
                SETTINGS.entities.global_properties.difficulty,
              )
            )
          ];
        const attackOptions = difficultyModConfig
          ? mergeAttackConfig(attack.config, difficultyModConfig)
          : attack.config;

        const emitter = new AttackEventEmitter();
        const context = {
          entity: attackData.entity,
          attack,
          attackOptions,
          ...attackData,
        };

        try {
          emitter.emit(AttackEventEmitter.Events.ATTACK_START, context);
          globalAttackEmitter.emit(
            AttackEventEmitter.Events.ATTACK_START,
            context,
          );

          switch (attack.type) {
            case "single": {
              await AttackFactory.executeSingleHit(attack, context, emitter);
              break;
            }
            case "multi": {
              await AttackFactory.executeMultiHit(attack, context, emitter);
              break;
            }
            case "continuous": {
              await AttackFactory.executeContinuous(attack, context, emitter);
              break;
            }
            case "ranged": {
              await AttackFactory.executeRanged(attack, context);
              break;
            }
            case "multi_ranged": {
              await AttackFactory.executeMultiRanged(attack, context);
              break;
            }
            default: {
              // Default to single hit
              await AttackFactory.executeSingleHit(attack, context, emitter);
            }
          }

          emitter.emit(AttackEventEmitter.Events.ATTACK_END, context);
          globalAttackEmitter.emit(
            AttackEventEmitter.Events.ATTACK_END,
            context,
          );
        } catch (error) {
          globalAttackLogger.error("ATTACK", "Attack execution failed", error);
          emitter.emit(AttackEventEmitter.Events.ATTACK_ERROR, {
            error,
            context,
          });
          globalAttackEmitter.emit(AttackEventEmitter.Events.ATTACK_ERROR, {
            error,
            context,
          });
        }

        if (attackData.callback) {
          attackData.callback(context);
        }
      },

      stringify() {
        return JSON.stringify(attack.config);
      },
    };

    // Cache the attack
    AttackFactory.cache.set(cacheKey, attack);
    return attack;
  },

  /**
   * Breaks blocks in the attack's shape pattern.
   * @private
   */
  breakBlocks(entity, attack, context) {
    const breakBlocks = attack?.attackOptions?.breakBlocks;
    const pattern = attack?.attackOptions?.pattern ?? "area";
    const r = attack?.attackOptions?.range;
    const breakContext = breakBlocks.evaluateContext?.(entity, context);

    const onValidBlockPos = offset => {
      const entityLcation = BVector3.from(
        TargetFinder.getAttackLocation(entity, attack, context),
      );
      const blockLocation = BVector3.add(entityLcation, offset);
      breakBlock(blockLocation, entity.dimension, breakBlocks, breakContext);
    };

    // Validate block locs within shapes
    for (let dx = -r / 2; dx < r / 2; dx++) {
      for (let dz = -r / 2; dz < r / 2; dz++) {
        for (
          let dy = breakBlocks.offsetY ?? 0;
          dy < (breakBlocks.height ?? 2);
          dy++
        ) {
          const offset = new BVector3(dx, dy, dz);
          const isWithinRange = offset.magnitude() <= r;

          if (pattern === "cone" || pattern === "arc") {
            const angleOffset =
              attack?.attackOptions?.damageAngleOffset?.getTheta?.() ?? 0;
            const entityRotation = getAttackReferenceYaw(entity) + angleOffset;
            const targetVector = offset;
            const targetAngle = targetVector.angles().theta;

            const diff = Math.abs(entityRotation - targetAngle) % FULL_CIRCLE;
            const angleDifference =
              diff > HALF_CIRCLE ? FULL_CIRCLE - diff : diff;

            if (
              angleDifference <= attack.attackOptions.angle &&
              isWithinRange
            ) {
              onValidBlockPos(offset);
            }
          } else if (pattern === "area" && isWithinRange) {
            onValidBlockPos(offset);
          } else {
            // do nothing
          }
        }
      }
    }
  },

  /**
   * Executes a single-hit attack
   * @private
   */
  async executeSingleHit(attack, context, emitter) {
    const { entity, validateTarget, keyframes } = context;
    const config = attack.config;

    // Pre-attack setup
    const runtimeControlToken = AttackFactory.setupAttack(entity, config);

    return new Promise(
      /** @param {(value?: any) => void} resolve */ resolve => {
        const { end, hasDuration, hasEnded } = AttackFactory.scheduleAttackEnd(
          entity,
          config,
          runtimeControlToken,
          resolve,
        );

        // Wait for delay, then deal damage (if not already ended)
        system.runTimeout(() => {
          if (!isValid(entity) || hasEnded()) {
            return;
          }

          AttackFactory.playStartEffects(entity, config);

          if (AttackFactory.isSpawnEntityConfig(config)) {
            void (async () => {
              const target = config.spawnAtTargetLocation
                ? await getTarget(entity)
                : undefined;
              await AttackFactory.spawnConfiguredEntity(
                entity,
                config,
                context,
                target,
              );

              if (context.onHit) {
                context.onHit(context);
              }

              if (!hasDuration) {
                end();
              }
            })();
            return;
          }

          // Break blocks
          if (attack?.attackOptions?.breakBlocks) {
            AttackFactory.breakBlocks(entity, attack, context);
          }

          let targets = TargetFinder.findTargets(entity, attack, context);
          context.targets = targets;
          emitter.emit(AttackEventEmitter.Events.TARGET_FOUND, {
            count: targets.length,
          });

          if (validateTarget) {
            targets = targets.filter(candidate =>
              validateTarget(candidate, context),
            );
          }

          if (typeof context.afterDelay === "function") {
            context.afterDelay(context);
          }

          for (const target of targets) {
            AttackFactory.applyDamageToTarget(
              entity,
              target,
              config,
              context,
              emitter,
            );
          }

          if (context.onHit) {
            context.onHit(context);
          }

          // Back-compat: if no duration was provided, end right after damage.
          if (!hasDuration) {
            end();
          }
        }, config.delay || 0);

        // Keyframes..
        if (keyframes) {
          for (const keyframeData of keyframes) {
            const { kf, func } = keyframeData;
            system.runTimeout(() => {
              func(context);
            }, secondsToTicks(kf));
          }
        }
      },
    );
  },

  /**
   * Executes a multi-hit attack
   * @private
   */
  async executeMultiHit(attack, context, emitter) {
    const { entity, keyframes } = context;
    const config = attack.config;

    const runtimeControlToken = AttackFactory.setupAttack(entity, config);

    const shouldTrackLineAim =
      config.pattern === "line" ||
      (Array.isArray(config.hits) &&
        config.hits.some(hit => hit?.pattern === "line"));
    if (shouldTrackLineAim && context.onLineAim) {
      AttackFactory.startLineAimTracking(
        entity,
        attack,
        context,
        config.duration,
      );
    }

    return new Promise(
      /** @param {(value?: any) => void} resolve */ resolve => {
        const { end, hasDuration, hasEnded } = AttackFactory.scheduleAttackEnd(
          entity,
          config,
          runtimeControlToken,
          resolve,
        );

        const hitPromises = [];
        const hits = Array.isArray(config.hits) ? config.hits : [];

        for (const [hitNumber, hit] of hits.entries()) {
          hitPromises.push(
            AttackFactory.scheduleMultiHitStep(
              config,
              hit,
              hitNumber,
              hasEnded,
              context,
              emitter,
            ),
          );
        }

        // Keyframes..
        if (keyframes) {
          for (const keyframeData of keyframes) {
            const { kf, func } = keyframeData;
            system.runTimeout(() => {
              func(context);
            }, secondsToTicks(kf));
          }
        }

        if (!hasDuration) {
          void (async () => {
            try {
              await Promise.all(hitPromises);
              if (!isValid(entity)) {
                resolve();
                return;
              }
              end();
            } catch (error) {
              // Covers a throw out of isValid or end. A sub-hit whose runTimeout
              // callback throws before it resolves leaves its own promise
              // pending instead of rejecting, so this cannot see that case.
              globalAttackLogger.error(
                "ATTACK",
                "Multi-hit wait failed",
                error,
              );
              resolve();
            }
          })();
        }
      },
    );
  },

  /**
   * Schedules one sub-hit of a MULTI attack after its delay. The promise
   * resolves once the sub-hit has been dispatched. A sub-hit that throws
   * leaves it pending, see the wait at the end of executeMultiHit.
   * @private
   */
  scheduleMultiHitStep(config, hit, hitNumber, hasEnded, context, emitter) {
    const { entity, perTick, validateTarget } = context;

    return new Promise(
      /** @param {(value?: any) => void} resolve */ resolve => {
        system.runTimeout(async () => {
          if (!isValid(entity) || hasEnded()) {
            resolve();
            return;
          }

          const mergedHitConfig = AttackFactory.mergeMultiHitConfig(
            config,
            hit,
          );

          if (hit.hasSpecialEffects) {
            AttackFactory.playStartEffects(entity, mergedHitConfig);
          } else if (AttackFactory.hasExplicitStartEffects(hit)) {
            AttackFactory.playStartEffects(entity, hit);
          } else {
            // do nothing
          }

          const subHitContext = {
            ...context,
            hitNumber,
            hitIndex: hitNumber,
            hitConfig: mergedHitConfig,
            attackOptions: mergedHitConfig,
            hasSpecialEffects: mergedHitConfig.hasSpecialEffects ?? false,
          };

          if (typeof context.onSubHitStart === "function") {
            try {
              context.onSubHitStart(subHitContext);
            } catch (error) {
              globalAttackLogger.error(
                "ATTACK",
                "onSubHitStart callback failed during MULTI attack",
                error,
              );
            }
          }

          const notifySubHitEnd = () => {
            if (typeof context.onSubHitEnd !== "function") {
              return;
            }

            try {
              context.onSubHitEnd(subHitContext);
            } catch (error) {
              globalAttackLogger.error(
                "ATTACK",
                "onSubHitEnd callback failed during MULTI attack",
                error,
              );
            }
          };

          const hitType =
            mergedHitConfig.type ||
            (mergedHitConfig.shots && Array.isArray(mergedHitConfig.shots)
              ? "multi_ranged"
              : "single");

          if (hitType === "continuous") {
            AttackFactory.startMultiHitContinuous(
              entity,
              mergedHitConfig,
              subHitContext,
              emitter,
              perTick,
              notifySubHitEnd,
            );
            resolve();
            return;
          }

          if (
            AttackFactory.isSpawnEntityConfig(mergedHitConfig) &&
            mergedHitConfig.spawnConfig !== undefined &&
            !Array.isArray(mergedHitConfig.hits)
          ) {
            const generatedHits = createGeneratedHitsFromConfig(
              mergedHitConfig.spawnConfig,
              mergedHitConfig,
            ).map(generatedHit => expandGeneratedShots(generatedHit));

            await AttackFactory.executeMultiHit(
              {
                config: {
                  ...mergedHitConfig,
                  type: "multi",
                  hits: generatedHits,
                  // null, not deleted: overrides the inherited spread value
                  startEvent: null,
                  endEvent: null,
                  disableMovement: false,
                  lockRotation: false,
                  disableMovementAfterTime: 0,
                  lockRotationAfterTime: 0,
                  enableMovementAfterTime: 0,
                  unlockRotationAfterTime: 0,
                },
              },
              subHitContext,
              emitter,
            );
            notifySubHitEnd();
            resolve();
            return;
          }

          if (
            AttackFactory.isSpawnEntityConfig(mergedHitConfig) &&
            !Array.isArray(mergedHitConfig.hits)
          ) {
            const target = mergedHitConfig.spawnAtTargetLocation
              ? await getTarget(entity)
              : undefined;
            await AttackFactory.spawnConfiguredEntity(
              entity,
              mergedHitConfig,
              subHitContext,
              target,
            );
            notifySubHitEnd();
            resolve();
            return;
          }

          if (hitType === "multi" || Array.isArray(mergedHitConfig.hits)) {
            await AttackFactory.executeMultiHit(
              {
                config: {
                  ...mergedHitConfig,
                  // null, not deleted: overrides the inherited spread value
                  startEvent: null,
                  endEvent: null,
                  disableMovement: false,
                  lockRotation: false,
                  disableMovementAfterTime: 0,
                  lockRotationAfterTime: 0,
                  enableMovementAfterTime: 0,
                  unlockRotationAfterTime: 0,
                },
              },
              subHitContext,
              emitter,
            );
            notifySubHitEnd();
            resolve();
            return;
          }

          if (
            hitType === "multi_ranged" ||
            (mergedHitConfig.shots && Array.isArray(mergedHitConfig.shots))
          ) {
            const target = await getTarget(entity);
            AttackFactory.startMultiHitMultiRanged(
              entity,
              mergedHitConfig,
              subHitContext,
              target,
              notifySubHitEnd,
            );
            resolve();
            return;
          }

          if (hitType === "ranged") {
            const target = await getTarget(entity);
            await AttackFactory.spawnProjectile(
              entity,
              mergedHitConfig,
              subHitContext,
              target,
            );
            notifySubHitEnd();
            resolve();
            return;
          }

          // Default: execute as a single damage application
          const hitAttack = {
            attackOptions: mergedHitConfig,
            config: mergedHitConfig,
          };

          if (hitAttack?.attackOptions?.breakBlocks) {
            AttackFactory.breakBlocks(entity, hitAttack, subHitContext);
          }

          let targets = TargetFinder.findTargets(
            entity,
            hitAttack,
            subHitContext,
          );

          if (validateTarget) {
            targets = targets.filter(candidate =>
              validateTarget(candidate, context),
            );
          }

          for (const target of targets) {
            AttackFactory.applyDamageToTarget(
              entity,
              target,
              mergedHitConfig,
              subHitContext,
              emitter,
            );
          }

          notifySubHitEnd();

          resolve();
        }, hit.delay || 0);
      },
    );
  },

  /**
   * Merge per-hit config without leaking parent hits[] into the sub-hit.
   * @private
   */
  mergeMultiHitConfig(parentConfig, hitConfig) {
    const base = { ...parentConfig };
    delete base.hits;
    delete base.spawnConfig;
    delete base.shots;
    delete base.shotsConfig;

    return { ...base, ...hitConfig };
  },

  /**
   * Wraps a MULTI sub-hit's onComplete so it runs at most once, whichever of
   * the sub-hit's stop paths (window over, entity gone, safety timeout)
   * reaches it first.
   * @private
   */
  createSubHitFinish(onComplete) {
    let isFinished = false;

    return () => {
      if (isFinished) {
        return;
      }
      isFinished = true;
      if (typeof onComplete === "function") {
        onComplete();
      }
    };
  },

  /**
   * Start a continuous sub-hit inside a MULTI attack.
   * @private
   */
  startMultiHitContinuous(
    entity,
    config,
    context,
    emitter,
    perTick,
    onComplete,
  ) {
    const interval =
      config.interval || config.tickRate || DEFAULT_ATTACK_INTERVAL_TICKS;
    const damageDuration =
      config.damageDuration ??
      config.duration ??
      context.attack?.config?.duration ??
      0;
    const maxDuration =
      context.attack?.config?.duration === undefined
        ? damageDuration
        : Math.min(damageDuration, context.attack.config.duration);
    let tickCount = 0;

    const finish = AttackFactory.createSubHitFinish(onComplete);

    const executeTick = () => {
      tickCount += 1;

      if (typeof perTick === "function") {
        try {
          context.tick = tickCount;
          perTick(context);
        } catch (error) {
          globalAttackLogger.error(
            "ATTACK",
            "perTick callback failed during MULTI continuous sub-hit",
            error,
          );
        }
      }

      if (config.pattern === DAMAGE_PATTERNS.SPAWN_ENTITY) {
        void (async () => {
          const target = config.spawnAtTargetLocation
            ? await getTarget(entity)
            : undefined;
          await AttackFactory.spawnConfiguredEntity(
            entity,
            config,
            context,
            target,
          );
        })();
        return;
      }

      if (config.pattern === "ranged") {
        void (async () => {
          const target = await getTarget(entity);
          await AttackFactory.spawnProjectile(entity, config, context, target);
        })();
        return;
      }

      const hitAttack = {
        attackOptions: config,
        config,
      };

      const targets = TargetFinder.findTargets(entity, hitAttack, context);
      for (const target of targets) {
        AttackFactory.applyDamageToTarget(
          entity,
          target,
          config,
          context,
          emitter,
        );
      }
    };

    executeTick();

    if (maxDuration > 0 && tickCount * interval >= maxDuration) {
      finish();
      return;
    }

    const tickInterval = system.runInterval(() => {
      if (!isValid(entity)) {
        system.clearRun(tickInterval);
        finish();
        return;
      }

      if (maxDuration > 0 && tickCount * interval >= maxDuration) {
        system.clearRun(tickInterval);
        finish();
        return;
      }

      executeTick();
    }, interval);

    if (maxDuration > 0) {
      system.runTimeout(() => {
        system.clearRun(tickInterval);
        finish();
      }, maxDuration + 1);
    }
  },

  /**
   * Start a multi-ranged sub-hit inside a MULTI attack.
   * Supports repeating salvos when interval + damageDuration are provided.
   * @private
   */
  startMultiHitMultiRanged(entity, config, context, target, onComplete) {
    if (!config.shots || !Array.isArray(config.shots)) {
      if (typeof onComplete === "function") {
        onComplete();
      }
      return;
    }

    const interval = config.interval || 0;
    const damageDuration = config.damageDuration || 0;
    const maxShotDelay = Math.max(
      0,
      ...config.shots.map(shot => Number(shot?.delay ?? 0)),
    );

    const finish = AttackFactory.createSubHitFinish(onComplete);

    const spawnSalvo = () => {
      for (const shot of config.shots) {
        system.runTimeout(async () => {
          if (isValid(entity)) {
            await AttackFactory.spawnProjectile(
              entity,
              { ...config, ...shot },
              context,
              target,
            );
          }
        }, shot.delay || 0);
      }
    };

    // One-time salvo
    if (!interval || !damageDuration) {
      spawnSalvo();
      system.runTimeout(() => {
        finish();
      }, maxShotDelay);
      return;
    }

    // Repeating salvos
    let elapsed = 0;
    const maxDuration =
      context.attack?.config?.duration === undefined
        ? damageDuration
        : Math.min(damageDuration, context.attack.config.duration);

    // Fire immediately, then repeat
    spawnSalvo();
    elapsed += interval;

    const salvoInterval = system.runInterval(() => {
      if (!isValid(entity)) {
        system.clearRun(salvoInterval);
        finish();
        return;
      }

      if (maxDuration > 0 && elapsed > maxDuration) {
        system.clearRun(salvoInterval);
        finish();
        return;
      }

      spawnSalvo();
      elapsed += interval;
    }, interval);

    if (maxDuration > 0) {
      system.runTimeout(
        () => {
          system.clearRun(salvoInterval);
          finish();
        },
        maxDuration + maxShotDelay + 1,
      );
    }
  },

  /**
   * Executes a continuous attack (ticking damage)
   * @private
   */
  async executeContinuous(attack, context, emitter) {
    const { entity, perTick, validateTarget, keyframes } = context;
    const config = attack.config;

    if (config.pattern === DAMAGE_PATTERNS.SPAWN_ENTITY) {
      return AttackFactory.executeContinuousSpawnEntity(attack, context);
    }

    if (config.pattern === "ranged") {
      return AttackFactory.executeContinuousRanged(attack, context);
    }

    const runtimeControlToken = AttackFactory.setupAttack(entity, config);

    const isLineAttack = config.pattern === "line";
    if (isLineAttack && context.onLineAim) {
      AttackFactory.startLineAimTracking(
        entity,
        attack,
        context,
        config.duration,
      );
    }

    const isRingAttack = config.pattern === DAMAGE_PATTERNS.RING;
    const isArcAttack = config.pattern === DAMAGE_PATTERNS.ARC;
    const areaExpansionTime = config.areaExpansionTime || 0;
    const arcGrowthDuration =
      config.damageDuration || config.arcGrowthTime || 0;
    const ringThickness = config.ringThickness || 1;
    const delayTicks = Math.max(0, config.delay || 0);
    const interval = Math.max(
      1,
      config.interval || config.tickRate || DEFAULT_ATTACK_INTERVAL_TICKS,
    );
    const durationTicks = config.duration ?? 0;
    const hasDuration = Number.isFinite(durationTicks) && durationTicks > 0;
    const activeDuration = Math.max(
      interval,
      config.damageDuration ||
        (hasDuration ? Math.max(0, durationTicks - delayTicks) : 0),
    );

    return new Promise(
      /** @param {(value?: any) => void} resolve */ resolve => {
        let tickInterval;
        let tickCount = 0;
        let isEnded = false;

        const end = () => {
          if (isEnded) {
            return;
          }

          isEnded = true;
          if (tickInterval !== undefined) {
            system.clearRun(tickInterval);
          }
          AttackFactory.cleanupAttack(entity, config, runtimeControlToken);
          resolve();
        };

        const executeTick = () => {
          tickCount += 1;

          // The tick count is kept on the context even when the attack has no
          // perTick callback, so other callbacks can read it.
          context.tick = tickCount;

          if (typeof perTick === "function") {
            perTick(context);
          }

          let modifiedAttack = attack;
          if (
            (isRingAttack || isArcAttack) &&
            (areaExpansionTime > 0 || arcGrowthDuration > 0)
          ) {
            const intervalTicks = Math.max(1, interval);
            const previousElapsedTicks = Math.max(
              0,
              (tickCount - 1) * intervalTicks,
            );
            const elapsedTicks = tickCount * intervalTicks;
            let currentMaxRange = config.range;

            if (areaExpansionTime > 0) {
              const expansionTicks = Math.max(1, Math.round(areaExpansionTime));
              const radiusProgress = Math.min(1, elapsedTicks / expansionTicks);
              currentMaxRange = radiusProgress * config.range;
            }

            const currentArcAngle =
              isArcAttack && arcGrowthDuration > 0
                ? Math.min(
                    1,
                    elapsedTicks / Math.max(1, Math.round(arcGrowthDuration)),
                  ) * (config.angle ?? 0)
                : config.angle;
            const previousArcAngle =
              isArcAttack && arcGrowthDuration > 0
                ? Math.min(
                    1,
                    previousElapsedTicks /
                      Math.max(1, Math.round(arcGrowthDuration)),
                  ) * (config.angle ?? 0)
                : 0;

            const attackOptions = {
              ...attack.attackOptions,
              range: currentMaxRange,
              angle: currentArcAngle,
            };

            const configOverrides = {
              ...attack.config,
              range: currentMaxRange,
              angle: currentArcAngle,
            };

            if (isArcAttack) {
              attackOptions.minSweep = previousArcAngle;
              configOverrides.minSweep = previousArcAngle;
            }

            if (isRingAttack) {
              const thickness = Math.max(0, ringThickness);
              const currentMinRange =
                thickness > 0
                  ? Math.max(0, currentMaxRange - thickness)
                  : currentMaxRange;
              attackOptions.minRange = currentMinRange;
              configOverrides.minRange = currentMinRange;
            }

            modifiedAttack = {
              ...attack,
              attackOptions,
              config: configOverrides,
            };
          }

          AttackFactory.playStartEffects(entity, config);
          let targets = TargetFinder.findTargets(
            entity,
            modifiedAttack,
            context,
          );

          if (validateTarget) {
            targets = targets.filter(candidate =>
              validateTarget(candidate, context),
            );
          }

          for (const target of targets) {
            AttackFactory.applyDamageToTarget(
              entity,
              target,
              config,
              context,
              emitter,
            );
          }
        };

        const totalDuration = hasDuration
          ? durationTicks
          : delayTicks + activeDuration;

        system.runTimeout(() => {
          if (!isValid(entity)) {
            resolve();
            return;
          }

          end();
        }, totalDuration);

        system.runTimeout(() => {
          if (!isValid(entity) || isEnded) {
            return;
          }

          executeTick();

          if (tickCount * interval >= activeDuration) {
            return;
          }

          tickInterval = system.runInterval(() => {
            if (!isValid(entity) || isEnded) {
              if (tickInterval !== undefined) {
                system.clearRun(tickInterval);
              }
              return;
            }

            if (tickCount * interval >= activeDuration) {
              if (tickInterval !== undefined) {
                system.clearRun(tickInterval);
              }
              return;
            }

            executeTick();
          }, interval);
        }, delayTicks);

        // Keyframes..
        if (keyframes) {
          for (const keyframeData of keyframes) {
            const { kf, func } = keyframeData;
            system.runTimeout(() => {
              func(context);
            }, secondsToTicks(kf));
          }
        }
      },
    );
  },

  /**
   * Executes a continuous projectile attack.
   * @private
   */
  async executeContinuousRanged(attack, context) {
    const { entity, onStart, afterDelay, onEnd, perShot } = context;
    const config = attack.config;
    const firingWindowConfig =
      AttackFactory.scheduleContinuousAttackStartEffects(entity, config);
    const firingDuration = config.shootingDuration ?? config.duration ?? 0;
    const shotInterval =
      config.interval || config.tickRate || DEFAULT_ATTACK_INTERVAL_TICKS;
    const shouldFireImmediately = config.shootingDuration !== undefined;

    const runtimeControlToken = AttackFactory.setupAttack(entity, config);

    if (typeof onStart === "function") {
      onStart(context);
    }

    return new Promise(
      /** @param {(value?: any) => void} resolve */ resolve => {
        let intervalId;

        const fireShot = async () => {
          if (!isValid(entity)) {
            return;
          }

          context.tick = (context.tick ?? 0) + 1;
          const target = await getTarget(entity);
          await AttackFactory.spawnProjectile(
            entity,
            config,
            {
              ...context,
              projectileMods: projectileContext => {
                if (typeof perShot === "function") {
                  perShot(projectileContext);
                }

                if (typeof context.projectileMods === "function") {
                  context.projectileMods(projectileContext);
                }
              },
            },
            target,
          );
        };

        const finish = AttackFactory.createContinuousAttackFinish(
          entity,
          config,
          context,
          onEnd,
          runtimeControlToken,
          resolve,
        );

        system.runTimeout(() => {
          if (!isValid(entity)) {
            resolve();
            return;
          }

          if (typeof afterDelay === "function") {
            afterDelay(context);
          }

          AttackFactory.playStartEffects(entity, firingWindowConfig);

          if (shouldFireImmediately) {
            void fireShot();
          }

          intervalId = system.runInterval(async () => {
            if (!isValid(entity)) {
              if (intervalId !== undefined) {
                system.clearRun(intervalId);
              }
              finish();
              return;
            }

            await fireShot();
          }, shotInterval);

          system.runTimeout(() => {
            if (intervalId !== undefined) {
              system.clearRun(intervalId);
            }
            finish();
          }, firingDuration);
        }, config.startDelay || 0);
      },
    );
  },

  /**
   * Executes a ranged attack (projectile spawn)
   * @private
   */
  async executeRanged(attack, context) {
    const { entity, keyframes } = context;
    const config = attack.config;

    const runtimeControlToken = AttackFactory.setupAttack(entity, config);

    return new Promise(
      /** @param {(value?: any) => void} resolve */ resolve => {
        const { end, hasDuration, hasEnded } = AttackFactory.scheduleAttackEnd(
          entity,
          config,
          runtimeControlToken,
          resolve,
        );

        system.runTimeout(
          async () => {
            if (!isValid(entity) || hasEnded()) {
              return;
            }

            AttackFactory.playStartEffects(entity, config);

            const target = getTargetV2(entity) ?? (await getTarget(entity));
            await AttackFactory.spawnProjectile(
              entity,
              config,
              context,
              target,
            );

            // Back-compat: if no duration was provided, end right after the spawn.
            if (!hasDuration) {
              end();
            }
          },
          config.startDelay || config.delay || 0,
        );

        // Keyframes..
        if (keyframes) {
          for (const keyframeData of keyframes) {
            const { kf, func } = keyframeData;
            system.runTimeout(() => {
              func(context);
            }, secondsToTicks(kf));
          }
        }
      },
    );
  },

  /**
   * Executes multi-ranged attack (multiple projectiles)
   * @private
   */
  async executeMultiRanged(attack, context) {
    const { entity } = context;
    const config = attack.config;

    const runtimeControlToken = AttackFactory.setupAttack(entity, config);

    const target = getTargetV2(entity) ?? (await getTarget(entity));

    return new Promise(
      /** @param {(value?: any) => void} resolve */ resolve => {
        const { end, hasDuration, hasEnded } = AttackFactory.scheduleAttackEnd(
          entity,
          config,
          runtimeControlToken,
          resolve,
        );

        if (config.shots && Array.isArray(config.shots)) {
          for (const shot of config.shots) {
            system.runTimeout(
              async () => {
                if (!isValid(entity) || hasEnded()) {
                  return;
                }

                if (typeof context.afterDelay === "function") {
                  context.afterDelay(context);
                }

                const shotConfig = { ...config, ...shot };

                await AttackFactory.spawnProjectile(
                  entity,
                  shotConfig,
                  context,
                  target,
                );
              },
              shot.delay ?? config.delay ?? config.startDelay ?? 0,
            );
          }
        }

        // Back-compat: if no duration was provided, end on the next tick.
        // (We can't reliably know the last shot's completion time due to async spawns.)
        if (!hasDuration) {
          system.runTimeout(() => {
            if (isValid(entity)) {
              end();
            } else {
              resolve();
            }
          }, 0);
        }
      },
    );
  },

  /**
   * Sets up attack (events, movement lock, etc)
   * @private
   */
  setupAttack(entity, config) {
    if (!isValid(entity)) {
      return undefined;
    }

    const runtimeControlToken = Symbol("attack_runtime_control");

    const entityId = entity.id;
    if (typeof entityId === "string" && entityId.length > 0) {
      activeAttackRuntimeCounts.set(
        entityId,
        (activeAttackRuntimeCounts.get(entityId) ?? 0) + 1,
      );
    }

    if (config.startEvent) {
      entity.triggerEvent(config.startEvent);
    }

    setupAttackStateControls(entity, config, runtimeControlToken);
    return runtimeControlToken;
  },

  /**
   * Cleans up after attack
   * @private
   */
  cleanupAttack(entity, config, runtimeControlToken) {
    const entityId = entity?.id;
    let remainingActiveRuntimes = 0;

    if (typeof entityId === "string" && entityId.length > 0) {
      const activeRuntimes = activeAttackRuntimeCounts.get(entityId) ?? 0;
      remainingActiveRuntimes = Math.max(0, activeRuntimes - 1);

      if (remainingActiveRuntimes > 0) {
        activeAttackRuntimeCounts.set(entityId, remainingActiveRuntimes);
      } else {
        activeAttackRuntimeCounts.delete(entityId);
      }
    }

    if (isValid(entity)) {
      cleanupAttackStateControls(entity, config, runtimeControlToken);
    }

    if (!isValid(entity) || remainingActiveRuntimes > 0) {
      return;
    }

    if (!config?.useLegacyAttackStartDetection) {
      const cooldownProperty =
        SETTINGS.entities.global_properties.cooldown_ticks;
      const configuredCooldown = Number(config?.cooldown ?? 1);

      if (Number.isFinite(configuredCooldown) && configuredCooldown >= 0) {
        try {
          entity.setProperty(cooldownProperty, configuredCooldown);
        } catch (error) {
          logIgnoredError(
            "attack_system/core/attack_factory:cleanupAttack",
            error,
          );
        }
      }
    }

    let isTriggeredGlobalAttackEnd = false;

    if (config.endEvent) {
      entity.triggerEvent(config.endEvent);
      isTriggeredGlobalAttackEnd =
        config.endEvent === SETTINGS.entities.global_events.attack_end;
    } else if (config.startEvent) {
      entity.triggerEvent(SETTINGS.entities.global_events.attack_end);
      isTriggeredGlobalAttackEnd = true;
    } else {
      // do nothing
    }

    // Defensive: make state reset visible immediately to animation queries.
    // Only do this for the global attack_end event so we don't clobber custom state machines.
    if (isTriggeredGlobalAttackEnd) {
      const stateProperty = SETTINGS.entities.global_properties.state;
      const currentState = entity?.getProperty?.(stateProperty);

      if (
        currentState === SETTINGS.entities.global_states.attacking ||
        currentState === SETTINGS.entities.global_states.preparing_attack
      ) {
        entity?.setProperty?.(
          stateProperty,
          SETTINGS.entities.global_states.none,
        );
      }
    }
  },

  /**
   * Shared end handling for the single, multi, ranged and multi_ranged
   * runners. `end` cleans up and resolves at most once. Duration is authored
   * as total time from attack start, so a positive one calls `end` when it
   * elapses, or only resolves if the entity is gone by then. `hasEnded` lets
   * delayed work skip running once `end` has run.
   * @private
   */
  scheduleAttackEnd(entity, config, runtimeControlToken, resolve) {
    let isEnded = false;
    const end = () => {
      if (isEnded) {
        return;
      }
      isEnded = true;
      AttackFactory.cleanupAttack(entity, config, runtimeControlToken);
      resolve();
    };

    const durationTicks = config.duration ?? 0;
    const hasDuration = Number.isFinite(durationTicks) && durationTicks > 0;
    if (hasDuration) {
      system.runTimeout(() => {
        if (!isValid(entity)) {
          resolve();
          return;
        }
        end();
      }, durationTicks);
    }

    return { end, hasDuration, hasEnded: () => isEnded };
  },

  /**
   * Shared finish for the continuous ranged and spawn_entity runners. Runs at
   * most once: calls onEnd, then after endDelay cleans up if the entity is
   * still valid, and resolves.
   * @private
   */
  createContinuousAttackFinish(
    entity,
    config,
    context,
    onEnd,
    runtimeControlToken,
    resolve,
  ) {
    let isFinished = false;

    return () => {
      if (isFinished) {
        return;
      }
      isFinished = true;

      if (typeof onEnd === "function") {
        onEnd(context);
      }

      system.runTimeout(() => {
        if (isValid(entity)) {
          AttackFactory.cleanupAttack(entity, config, runtimeControlToken);
        }
        resolve();
      }, config.endDelay || 0);
    };
  },

  /**
   * Plays start effects (sounds, particles, camera shake)
   * @private
   */
  playStartEffects(entity, config) {
    if (!isValid(entity)) {
      return;
    }

    if (config.soundEffects) {
      EffectRegistry.apply("sound", entity, config.soundEffects);
    }

    if (config.particleEffects) {
      EffectRegistry.apply("particle", entity, config.particleEffects);
    }

    if (config.cameraShakeEffect) {
      EffectRegistry.apply("cameraShake", entity, config.cameraShakeEffect);
    }

    if (config.knockback) {
      void applyAreaKnockback(entity, config.knockback);
    }

    if (config.shootSound) {
      entity.dimension?.playSound(config.shootSound, entity.location);
    }
  },

  hasExplicitStartEffects(config) {
    if (!config || typeof config !== "object") {
      return false;
    }

    return Boolean(
      config.soundEffects ||
      config.particleEffects ||
      config.cameraShakeEffect ||
      config.knockback ||
      config.shootSound,
    );
  },

  hasDelayedStartEffect(effectConfig, attackStartDelay = 0) {
    if (
      !effectConfig ||
      typeof effectConfig !== "object" ||
      !Number.isFinite(attackStartDelay) ||
      attackStartDelay <= 0
    ) {
      return false;
    }

    return (
      effectConfig.delay !== undefined || effectConfig.startTime !== undefined
    );
  },

  scheduleContinuousAttackStartEffects(entity, config) {
    if (!isValid(entity)) {
      return config;
    }

    const attackStartDelay = Number(config?.startDelay ?? 0);
    const shouldScheduleCameraShake = AttackFactory.hasDelayedStartEffect(
      config?.cameraShakeEffect,
      attackStartDelay,
    );
    const shouldScheduleKnockback = AttackFactory.hasDelayedStartEffect(
      config?.knockback,
      attackStartDelay,
    );

    if (!shouldScheduleCameraShake && !shouldScheduleKnockback) {
      return config;
    }

    const firingWindowConfig = {
      ...config,
    };

    if (shouldScheduleCameraShake) {
      EffectRegistry.apply("cameraShake", entity, config.cameraShakeEffect);
      delete firingWindowConfig.cameraShakeEffect;
    }

    if (shouldScheduleKnockback) {
      void applyAreaKnockback(entity, config.knockback);
      delete firingWindowConfig.knockback;
    }

    return firingWindowConfig;
  },

  /**
   * Applies damage to a single target
   * @private
   */
  applyDamageToTarget(source, target, config, context, emitter) {
    if (!target?.isValid) {
      return;
    }

    const damageContext = DamageCalculator.createContext({
      ...config,
      ...context,
      damage: config.damage,
      baseDamage: config.damage,
      target,
      source,
      entity: source,
      hitConfig: context.hitConfig ?? config,
      attackOptions: config,
      hasSpecialEffects:
        context.hasSpecialEffects ?? config.hasSpecialEffects ?? false,
      damageModifier: context.damageModifier,
    });

    // For whatever reason, the value of finalDamage is not what is actually applied to the entity. What is applied is finalDamage *3/2.
    const finalDamage = DamageCalculator.calculate(damageContext);
    context.damage = finalDamage;

    if (finalDamage > 0) {
      emitter.emit(AttackEventEmitter.Events.BEFORE_DAMAGE, {
        target,
        damage: (finalDamage * 2) / APPLIED_DAMAGE_DIVISOR,
      });

      const targetHealthComponent = target.getComponent("health");
      const oldHealth = targetHealthComponent.currentValue;

      target.applyDamage((finalDamage * 2) / APPLIED_DAMAGE_DIVISOR, {
        cause: config.damageCause || "entityAttack",
        damagingEntity: config.dontAssignDamagingEntity
          ? undefined
          : (context.damagingEntity ?? source),
      });

      const hasDealtDamage = oldHealth > targetHealthComponent.currentValue;

      // Guaranteed damage is damage the player takes regardless of his armor
      if (hasDealtDamage && config.guaranteedDamage && targetHealthComponent) {
        const nextHealth = Math.max(
          targetHealthComponent.effectiveMin,
          targetHealthComponent.currentValue - config.guaranteedDamage,
        );
        targetHealthComponent.setCurrentValue(nextHealth);
      }

      emitter.emit(AttackEventEmitter.Events.AFTER_DAMAGE, {
        target,
        damage: finalDamage,
      });
    }

    if (config.hitEffects) {
      EffectRegistry.apply("entity", target, config.hitEffects);
    }

    if (config.knockbackOptions) {
      EffectRegistry.apply("knockback", source, {
        target,
        knockbackOptions: config.knockbackOptions,
      });
    }

    if (context.onHitTarget) {
      context.target = target;
      context.onHitTarget(context);
    }
  },

  isSpawnEntityConfig(config) {
    return config?.pattern === DAMAGE_PATTERNS.SPAWN_ENTITY;
  },

  getDirectionalSpawnLocation(entity, origin, directionalOffset, target) {
    const offset = resolveDirectionalOffsetConfig(directionalOffset);
    const offsetDirection =
      offset.useTargetDirection && target?.isValid
        ? getTargetVector(entity, target, true)
        : undefined;
    const rotatedLocation = rotationRelativeOffset(
      entity,
      offset,
      offset.ignoreVertical,
      offset.useViewDirection,
      offsetDirection,
    );
    const translatedLocation = BVector3.add(
      BVector3.from(origin),
      BVector3.subtract(
        BVector3.from(rotatedLocation),
        BVector3.from(entity.location),
      ),
    );

    return translatedLocation.toVector3();
  },

  getSpawnEntityOrigin(entity, config, target) {
    if (config.spawnAtTargetLocation && target?.isValid) {
      return target.location;
    }

    return entity.location;
  },

  getSpawnEntityInitialRotation(entity, config) {
    const explicitInitialRotation = config?.initialRotation;
    if (explicitInitialRotation !== undefined) {
      const angleOffset = resolveAngleOffsetConfig(explicitInitialRotation);
      return getAttackReferenceYaw(entity) + angleOffset.getTheta();
    }

    const matchSourceRotation = config?.matchSourceRotation ?? false;

    return matchSourceRotation ? getAttackReferenceYaw(entity) : undefined;
  },

  getGroundProjectedSpawnLocation(entity, spawnLocation, config) {
    if (!config?.projectToGround || !entity?.dimension || !spawnLocation) {
      return spawnLocation;
    }

    const maxDistance = 64;
    const liquidBlockIds = new Set([
      SETTINGS.blocks.vanilla.lava.id,
      SETTINGS.blocks.vanilla.flowing_lava.id,
      SETTINGS.blocks.vanilla.water.id,
      SETTINGS.blocks.vanilla.flowing_water.id,
    ]);
    const startY = Math.floor(spawnLocation.y);

    for (let offset = 0; offset <= maxDistance; offset++) {
      const block = entity.dimension.getBlock({
        x: spawnLocation.x,
        y: startY - offset,
        z: spawnLocation.z,
      });

      if (!block?.isValid || block.isAir || liquidBlockIds.has(block.typeId)) {
        continue;
      }

      return {
        x: spawnLocation.x,
        y: block.location.y + GROUND_SPAWN_Y_OFFSET_BLOCKS,
        z: spawnLocation.z,
      };
    }

    return spawnLocation;
  },

  async spawnConfiguredEntity(entity, config, context, target = undefined) {
    if (!isValid(entity) || !entity?.dimension) {
      return undefined;
    }

    try {
      const origin = AttackFactory.getSpawnEntityOrigin(entity, config, target);
      const spawnLocation = AttackFactory.getDirectionalSpawnLocation(
        entity,
        origin,
        config.directionalOffset,
        target,
      );
      const projectedSpawnLocation =
        AttackFactory.getGroundProjectedSpawnLocation(
          entity,
          spawnLocation,
          config,
        );
      if (
        !Number.isFinite(projectedSpawnLocation?.x) ||
        !Number.isFinite(projectedSpawnLocation?.y) ||
        !Number.isFinite(projectedSpawnLocation?.z)
      ) {
        globalAttackLogger.error(
          "ATTACK",
          "Failed to spawn attack entity due to invalid spawn coordinates",
          {
            entityId: config.entity,
            spawnLocation,
            projectedSpawnLocation,
          },
        );
        return undefined;
      }
      const initialRotation = AttackFactory.getSpawnEntityInitialRotation(
        entity,
        config,
      );
      const spawnedEntity = entity.dimension.spawnEntity(
        config.entity,
        projectedSpawnLocation,
      );

      if (spawnedEntity?.isValid && initialRotation !== undefined) {
        const currentRotation = spawnedEntity.getRotation?.();
        spawnedEntity.setRotation({
          x: currentRotation?.x ?? 0,
          y: initialRotation,
        });
      }

      if (context?.projectileMods && spawnedEntity?.isValid) {
        context.spawnedEntity = spawnedEntity;
        context.projectile = spawnedEntity;
        context.projectileMods(context);
      }

      return spawnedEntity;
    } catch (error) {
      globalAttackLogger.error("ATTACK", "Failed to spawn attack entity", {
        error: error.message || error,
        stack: error.stack,
        entityId: config.entity,
        spawnAtTargetLocation: config.spawnAtTargetLocation ?? false,
      });
      return undefined;
    }
  },

  async executeContinuousSpawnEntity(attack, context) {
    const { entity, onStart, afterDelay, onEnd, perShot } = context;
    const config = attack.config;
    const firingWindowConfig =
      AttackFactory.scheduleContinuousAttackStartEffects(entity, config);
    const firingDuration = config.shootingDuration ?? config.duration ?? 0;
    const spawnInterval =
      config.interval || config.tickRate || DEFAULT_ATTACK_INTERVAL_TICKS;
    const shouldSpawnImmediately = config.shootingDuration !== undefined;

    const runtimeControlToken = AttackFactory.setupAttack(entity, config);

    if (typeof onStart === "function") {
      onStart(context);
    }

    return new Promise(
      /** @param {(value?: any) => void} resolve */ resolve => {
        let intervalId;

        const spawnEntity = async () => {
          if (!isValid(entity)) {
            return;
          }

          context.tick = (context.tick ?? 0) + 1;
          const target = config.spawnAtTargetLocation
            ? await getTarget(entity)
            : undefined;
          await AttackFactory.spawnConfiguredEntity(
            entity,
            config,
            {
              ...context,
              projectileMods: spawnContext => {
                if (typeof perShot === "function") {
                  perShot(spawnContext);
                }

                if (typeof context.projectileMods === "function") {
                  context.projectileMods(spawnContext);
                }
              },
            },
            target,
          );
        };

        const finish = AttackFactory.createContinuousAttackFinish(
          entity,
          config,
          context,
          onEnd,
          runtimeControlToken,
          resolve,
        );

        system.runTimeout(() => {
          if (!isValid(entity)) {
            resolve();
            return;
          }

          if (typeof afterDelay === "function") {
            afterDelay(context);
          }

          AttackFactory.playStartEffects(entity, firingWindowConfig);

          if (shouldSpawnImmediately) {
            void spawnEntity();
          }

          intervalId = system.runInterval(async () => {
            if (!isValid(entity)) {
              if (intervalId !== undefined) {
                system.clearRun(intervalId);
              }
              finish();
              return;
            }

            await spawnEntity();
          }, spawnInterval);

          system.runTimeout(() => {
            if (intervalId !== undefined) {
              system.clearRun(intervalId);
            }
            finish();
          }, firingDuration);
        }, config.startDelay || 0);
      },
    );
  },

  /**
   * Spawns a projectile
   * @private
   */
  async spawnProjectile(entity, config, context, target = undefined) {
    if (!isValid(entity)) {
      return undefined;
    }

    try {
      if (
        typeof config.projectile !== "string" ||
        config.projectile.length === 0
      ) {
        globalAttackLogger.error(
          "ATTACK",
          "Failed to spawn projectile: missing projectile identifier",
          {
            type: config.type,
            pattern: config.pattern,
            projectile: config.projectile,
          },
        );
        return undefined;
      }

      let location;
      let locationFromWhichDirectionIsComputed;
      let offsetDirection;

      if (config.projectileOffset?.useTargetDirection && target?.isValid) {
        offsetDirection = getTargetVector(entity, target, true);
      }

      if (config.projectileDirOffset) {
        locationFromWhichDirectionIsComputed = rotationRelativeOffset(
          entity,
          config.projectileDirOffset,
          config.projectileDirOffset.ignoreVertical,
          config.projectileDirOffset.useViewDirection,
          offsetDirection,
        );
      }

      if (config.projectileOffset?.getGround) {
        location = rotationRelativeOffset(
          entity,
          config.projectileOffset,
          config.projectileOffset.ignoreVertical,
          config.projectileOffset.useViewDirection,
          offsetDirection,
        );
      } else {
        const offset = config.projectileOffset || { x: 0, y: 0, z: 0 };
        location = BVector3.add(
          BVector3.from(entity.location),
          new BVector3(
            offset.x || 0,
            offset.y || DEFAULT_PROJECTILE_Y_OFFSET_BLOCKS,
            offset.z || 0,
          ),
        ).toVector3();
      }

      const projectile = entity.dimension.spawnEntity(
        config.projectile,
        location,
        {
          spawnEvent: config.projectileSpawnEvent,
          initialRotation: getAttackReferenceYaw(entity),
        },
      );

      if (!projectile?.isValid) {
        return projectile;
      }

      // Assign projectile owner
      const projectileComponent = projectile.getComponent(
        "minecraft:projectile",
      );
      if (projectileComponent && entity?.isValid) {
        projectileComponent.owner = entity;
      }
      projectile.setDynamicProperty(
        SETTINGS.entities.global_properties.owner_id,
        entity.id,
      );

      const homingSnapshotLocation =
        config.isHoming && config.homeToTargetLocation && target?.isValid
          ? AttackFactory.getHomingSnapshotLocation(
              target,
              shouldTargetProjectileCenter(config),
            )
          : undefined;

      let projectileThetaOffset = 0;
      let projectilePhiOffset = 0;

      if (projectile && config.projectileStrength) {
        let direction;
        if (target?.isValid) {
          const targetPos = getProjectileTargetLocation(
            target,
            shouldTargetProjectileCenter(config),
          );
          const projPos = locationFromWhichDirectionIsComputed ?? location;

          if (config.projectileTargetYOffset) {
            targetPos.add(new BVector3(0, config.projectileTargetYOffset, 0));
          }

          if (config.projectileTargetPrediction) {
            direction = BVector3.subtract(targetPos, projPos);
            const distanceToTarget = direction.magnitude();
            const ticks = distanceToTarget / config.projectileSpeed;
            const offsetForward = BVector3.from(target.getVelocity());
            offsetForward.y = 0;
            offsetForward.multiply(ticks);
            targetPos.add(offsetForward);
          }

          context.targetPos = targetPos;

          direction = BVector3.subtract(targetPos, projPos);

          if (config.projectileYDirectionDistScaling) {
            // Apply Y correction based on distance to the target
            const planeDistance = new BVector2(
              direction.x,
              direction.z,
            ).magnitude();
            direction.add(
              new BVector3(
                0,
                planeDistance * config.projectileYDirectionDistScaling,
                0,
              ),
            );
          }

          direction.normalize();

          // Apply inaccuracy
          let inaccuracy = config.projectileBaseInaccuracy ?? 0;

          if (config.projectileInaccuracyChangePerDifficulty) {
            inaccuracy +=
              DIFFICULTY_INTS[world.getDifficulty()] *
              config.projectileInaccuracyChangePerDifficulty;
          }

          direction.add(
            new BVector3(
              (Math.random() - 0.5) * inaccuracy,
              0,
              (Math.random() - 0.5) * inaccuracy,
            ),
          );
          // direction.y += (Math.random() - 0.5) * inaccuracy;

          direction.normalize();
        } else {
          direction = entity.getViewDirection();
        }

        if (config.projectileAngleOffset?.getTheta) {
          const thetaOffset = config.projectileAngleOffset.getTheta();
          const phiOffset = config.projectileAngleOffset.getPhi();
          projectileThetaOffset = thetaOffset;
          projectilePhiOffset = phiOffset;

          if (thetaOffset !== 0 || phiOffset !== 0) {
            // Derive current angles (in radians) from the existing direction vector
            const currentTheta = Math.atan2(-direction.x, direction.z);
            const currentPhi = Math.asin(
              Math.max(-1, Math.min(1, direction.y)),
            );

            // Apply offset angles on top of existing angles
            const newTheta =
              currentTheta + (thetaOffset * Math.PI) / HALF_CIRCLE;
            const newPhi = currentPhi - (phiOffset * Math.PI) / HALF_CIRCLE;

            direction = {
              x: -Math.sin(newTheta) * Math.cos(newPhi),
              y: Math.sin(newPhi),
              z: Math.cos(newTheta) * Math.cos(newPhi),
            };
          }
        }

        if (config.projectileDirection) {
          direction = config.projectileDirection;
        }

        // Cancel vertical if needed
        if (config.cancelVerticalMovement) {
          direction.y = 0;
        }

        // Convert to BVector3 for homing support
        const directionVector = BVector3.from(direction);
        directionVector.setMagnitude(config.projectileStrength);

        handleProjectileRotation(projectile, directionVector);

        if (context.projectileMods) {
          context.projectile = projectile;
          context.direction = BVector3.from(direction);
          context.projectileMods(context);
        }

        const delayedHomingTicks = Math.max(
          0,
          Math.floor(config.delayedHoming ?? 0),
        );
        if (config.isReturning) {
          const returningProjectileOptions = {
            target,
            initialDirection: directionVector,
            sourceEntity: entity,
            attackConfig: config,
            attackContext: context,
            baseYaw: entity.getRotation().y,
            thetaOffset: projectileThetaOffset,
            phiOffset: projectilePhiOffset,
            initialStrength: config.projectileStrength,
            flightTime: config.flightTime,
            splitReturnPhases: config.splitReturnPhases,
            outboundFlightTime: config.outboundFlightTime,
            returnPauseTime: config.returnPauseTime,
            returnFlightTime: config.returnFlightTime,
            range: config.range,
            shouldArc: config.shouldArc,
            useEasing: config.useEasing,
            minimumReturnSpeedScale: config.minimumReturnSpeedScale,
            despawnOnReturn: config.despawnOnReturn,
            cancelVerticalMovement: config.cancelVerticalMovement,
            onShoot: context.onShoot,
            onOutboundEnd: context.onOutboundEnd,
            onPause: context.onPause,
            onPauseEnd: context.onPauseEnd,
            onProjectileReturn: context.onProjectileReturn,
            onReturnStart: context.onReturnStart,
            onReturnEnd: context.onReturnEnd,
          };

          propelReturningProjectile(projectile, returningProjectileOptions);
        } else if (
          config.isHoming &&
          delayedHomingTicks > 0 &&
          (target?.isValid || homingSnapshotLocation)
        ) {
          // Propel for initial ticks, then start homing
          AttackFactory.propelProjectileForTicks(
            projectile,
            directionVector,
            delayedHomingTicks,
          );
          system.runTimeout(() => {
            if (!projectile?.isValid || shouldStopProjectile(projectile)) {
              return;
            }

            const attackWrapper = { attackOptions: config };
            propelHomingProjectile(
              projectile,
              target,
              attackWrapper,
              homingSnapshotLocation,
            );
          }, delayedHomingTicks);
        } else if (
          config.isHoming &&
          (target?.isValid || homingSnapshotLocation)
        ) {
          const attackWrapper = { attackOptions: config };
          propelHomingProjectile(
            projectile,
            target,
            attackWrapper,
            homingSnapshotLocation,
          );
        } else if (config.isContinuous) {
          // Continuous propulsion without homing
          AttackFactory.propelProjectile(projectile, directionVector, true);
        } else if (config.projectileComponentShoot && projectileComponent) {
          // Shoot through the projectile component. Spread comes from the
          // attack's own inaccuracy settings, not the component's uncertainty.
          projectileComponent.shoot(directionVector, { uncertainty: 0 });
        } else {
          // Single impulse
          projectile.applyImpulse(directionVector);
        }
      }

      if (config.shootSound) {
        entity.dimension?.playSound(config.shootSound, entity.location);
      }

      return projectile;
    } catch (error) {
      globalAttackLogger.error("ATTACK", "Failed to spawn projectile", {
        error: error.message || error,
        stack: error.stack,
        projectileId: config.projectile,
        hasOffset: Boolean(config.projectileOffset),
        offsetType: config.projectileOffset?.constructor?.name,
      });
      return undefined;
    }
  },

  /**
   * Propels a projectile continuously
   * @private
   */
  propelProjectile(projectile, direction, isContinuous) {
    if (shouldStopProjectile(projectile)) {
      return;
    }

    projectile.clearVelocity();
    projectile.applyImpulse(direction);

    if (isContinuous) {
      system.runTimeout(() => {
        if (!shouldStopProjectile(projectile)) {
          AttackFactory.propelProjectile(projectile, direction, isContinuous);
        }
      }, 1);
    }
  },

  /**
   * Propels a projectile for a fixed number of ticks
   * @param {Entity} projectile
   * @param {BVector3} direction
   * @param {Number} ticks
   * @param {() => void} [onComplete]
   * @private
   */
  propelProjectileForTicks(projectile, direction, ticks, onComplete) {
    if (ticks <= 0) {
      if (typeof onComplete === "function") {
        onComplete();
      }
      return;
    }

    if (shouldStopProjectile(projectile)) {
      return;
    }

    projectile.clearVelocity();
    projectile.applyImpulse(direction);

    system.runTimeout(() => {
      if (!shouldStopProjectile(projectile)) {
        AttackFactory.propelProjectileForTicks(
          projectile,
          direction,
          ticks - 1,
          onComplete,
        );
      }
    }, 1);
  },

  /**
   * Gets homing snapshot location (target's feet location)
   * @private
   */
  getHomingSnapshotLocation(target, shouldTargetCenter = true) {
    if (!target?.isValid) {
      return undefined;
    }

    return getProjectileTargetLocation(target, shouldTargetCenter);
  },

  /**
   * Starts line aim tracking for continuous line attacks
   * @private
   */
  startLineAimTracking(entity, _attack, context, duration) {
    if (!entity?.isValid || !context.onLineAim) {
      return;
    }

    let cachedTarget;
    let hasInitialized = false;

    system.runTimeout(async () => {
      if (!entity?.isValid) {
        return;
      }
      try {
        cachedTarget = await getTarget(entity);
        if (!hasInitialized) {
          AttackFactory.updateLineAim(entity, context, cachedTarget);
          hasInitialized = true;
        }
      } catch (error) {
        logIgnoredError(
          "attack_system/core/attack_factory:startLineAimTracking",
          error,
        );
      }
    }, 0);

    const interval = system.runInterval(() => {
      if (
        !entity?.isValid ||
        entity.getProperty(SETTINGS.entities.global_properties.dead)
      ) {
        system.clearRun(interval);
        return;
      }
      if (hasInitialized) {
        AttackFactory.updateLineAim(entity, context, cachedTarget);
      }
    }, 1);

    // Clear interval after duration
    if (duration) {
      system.runTimeout(() => {
        system.clearRun(interval);
      }, duration);
    }
  },

  /**
   * Helper function to calculate rotation (yaw, pitch) from direction vector
   * @private
   */
  rotationFromDirection(direction) {
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
  },

  /**
   * Updates line aim calculations and calls onLineAim callback
   * @private
   */
  updateLineAim(entity, context, cachedTarget) {
    if (!entity?.isValid) {
      return;
    }

    let directionVector;
    if (cachedTarget?.isValid) {
      const source = BVector3.from(entity.getHeadLocation());
      const tLoc = BVector3.from(cachedTarget.location);
      const thLoc = BVector3.from(cachedTarget.getHeadLocation());
      const tgtMid = BVector3.lerp(tLoc, thLoc, 0.5);
      directionVector = BVector3.subtract(tgtMid, source);
    } else {
      directionVector = BVector3.from(entity.getViewDirection());
    }

    const { yaw: lineYaw, pitch: linePitch } =
      AttackFactory.rotationFromDirection(directionVector);
    context.lineYaw = lineYaw;
    context.linePitch = linePitch;
    context.lineDirection = directionVector;
    context.direction = directionVector;

    if (typeof context.onLineAim === "function") {
      context.onLineAim(context);
    }
  },

  /**
   * Clears the attack cache
   */
  clearCache() {
    AttackFactory.cache.clear();
  },

  /**
   * Gets cache statistics
   */
  getCacheStats() {
    return {
      size: AttackFactory.cache.size,
      keys: [...AttackFactory.cache.keys()].slice(0, CACHE_STATS_MAX_KEYS),
    };
  },
};
