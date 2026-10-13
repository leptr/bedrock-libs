// Developed by: Petar Mijailovic (leptr)
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

import {
  ATTACK_DIRECTIONS,
  ATTACK_SHAPES,
  DAMAGE_PATTERNS,
} from "../constants.js";
import { logger } from "../../utils/logger.js";
import { FULL_CIRCLE } from "../../better_vectors/better_vectors.js";

const SPAWN_ENTITY_ATTACK_LABEL = `${DAMAGE_PATTERNS.SPAWN_ENTITY} attack`;

/**
 * Attack Validation System
 * Validates attack configurations against a defined schema to catch errors early.
 */
export const AttackValidator = {
  /**
   * Validation error types
   */
  ErrorTypes: {
    MISSING_REQUIRED: "MISSING_REQUIRED",
    INVALID_TYPE: "INVALID_TYPE",
    OUT_OF_RANGE: "OUT_OF_RANGE",
    INVALID_ENUM: "INVALID_ENUM",
    MALFORMED_OBJECT: "MALFORMED_OBJECT",
  },

  /**
   * Defines the validation schema for attack configurations.
   * Can be extended or customized per use case.
   */
  SCHEMA: {
    type: {
      type: "string",
      required: true,
      enum: ["single", "multi", "continuous", "ranged", "multi_ranged"],
      description:
        "Attack execution type: 'single' for one-time hits, 'multi' for multiple sequential hits, 'continuous' for repeated ticking damage, 'ranged' for projectile attacks, 'multi_ranged' for multiple projectiles. See ATTACK_TYPES in constant.js",
    },
    damage: {
      type: ["number", "array"],
      required: false,
      validate: value => {
        if (typeof value === "number") {
          return value >= 0;
        }
        if (Array.isArray(value)) {
          return (
            value.length === 2 &&
            typeof value[0] === "number" &&
            typeof value[1] === "number" &&
            value[0] >= 0 &&
            value[1] >= 0
          );
        }
        return false;
      },
    },
    range: {
      type: "number",
      required: true,
      min: 0,
      max: 100,
    },
    duration: {
      type: "number",
      required: false,
      min: 0,
      // Authored in seconds. Runtime converts to ticks.
      max: 1000,
    },
    cooldown: {
      type: "number",
      required: false,
      min: 0,
      max: 1000,
      default: 1,
      description:
        "Cooldown in seconds after the attack finishes before the entity can begin another attack.",
    },
    useLegacyAttackStartDetection: {
      type: "boolean",
      required: false,
      default: false,
      description:
        "When true, the shared cooldown writer is skipped because the entity still relies on legacy attack-start detection outside the new cooldown flow.",
    },
    lockRotation: {
      type: "boolean",
      required: false,
      default: false,
      description:
        "When true, the attacker rotation is locked immediately when the attack starts.",
    },
    disableMovement: {
      type: "boolean",
      required: false,
      default: false,
      description:
        "When true, the attacker movement is disabled immediately when the attack starts.",
    },
    disableMovementAfterTime: {
      type: ["number", "array"],
      required: false,
      min: 0,
      max: 1000,
      default: 0,
      validate: value => {
        if (typeof value === "number") {
          return value >= 0;
        }

        return (
          Array.isArray(value) &&
          value.every(
            entry =>
              typeof entry === "number" && Number.isFinite(entry) && entry >= 0,
          )
        );
      },
      description:
        "Delay in seconds after attack start before movement is disabled.",
    },
    lockRotationAfterTime: {
      type: ["number", "array"],
      required: false,
      min: 0,
      max: 1000,
      default: 0,
      validate: value => {
        if (typeof value === "number") {
          return value >= 0;
        }

        return (
          Array.isArray(value) &&
          value.every(
            entry =>
              typeof entry === "number" && Number.isFinite(entry) && entry >= 0,
          )
        );
      },
      description:
        "Delay in seconds after attack start before rotation is locked.",
    },
    enableMovementAfterTime: {
      type: ["number", "array"],
      required: false,
      min: 0,
      max: 1000,
      default: 0,
      validate: value => {
        if (typeof value === "number") {
          return value >= 0;
        }

        return (
          Array.isArray(value) &&
          value.every(
            entry =>
              typeof entry === "number" && Number.isFinite(entry) && entry >= 0,
          )
        );
      },
      description:
        "Delay in seconds after attack start before movement is enabled.",
    },
    unlockRotationAfterTime: {
      type: ["number", "array"],
      required: false,
      min: 0,
      max: 1000,
      default: 0,
      validate: value => {
        if (typeof value === "number") {
          return value >= 0;
        }

        return (
          Array.isArray(value) &&
          value.every(
            entry =>
              typeof entry === "number" && Number.isFinite(entry) && entry >= 0,
          )
        );
      },
      description:
        "Delay in seconds after attack start before rotation is unlocked.",
    },
    shootingDuration: {
      type: "number",
      required: false,
      min: 0,
      // Authored in seconds. Runtime converts to ticks.
      max: 1000,
      description:
        "Continuous ranged firing window in seconds. Starts when startDelay elapses and stops shooting after this duration.",
    },
    flightTime: {
      type: "number",
      required: false,
      min: 0,
      max: 1000,
      default: 0,
      description:
        "Returning projectile round-trip time in seconds. When omitted or 0, timing is derived from the curve length using range and projectileStrength.",
    },
    splitReturnPhases: {
      type: "boolean",
      required: false,
      default: false,
      description:
        "When true, returning projectiles treat outbound travel, pause, and return as separate phases instead of a single continuous round trip.",
    },
    outboundFlightTime: {
      type: "number",
      required: false,
      min: 0,
      max: 1000,
      default: 0,
      description:
        "Outbound phase duration in seconds for split returning projectiles. When omitted, the runtime derives it from flightTime or the outbound curve length.",
    },
    returnPauseTime: {
      type: "number",
      required: false,
      min: 0,
      max: 1000,
      default: 0,
      description:
        "Pause duration in seconds at the turnaround point for split returning projectiles.",
    },
    returnFlightTime: {
      type: "number",
      required: false,
      min: 0,
      max: 1000,
      default: 0,
      description:
        "Return phase duration in seconds for split returning projectiles. When omitted, the runtime derives it from flightTime or the return curve length.",
    },
    arcGrowthTime: {
      type: "number",
      required: false,
      min: 0,
      max: 1000,
      default: 0,
      description:
        "Legacy alias for arc sweep growth time in seconds. Arc attacks now use damageDuration for sweep growth when it is set.",
    },
    startAngle: {
      type: "number",
      required: false,
      min: -360,
      max: 360,
      default: 0,
      description:
        "Starting angle offset in degrees for arc attacks, relative to the attacker's facing and damageAngleOffset. Defaults to 0.",
    },
    arcDirection: {
      type: "string",
      required: false,
      enum: [ATTACK_DIRECTIONS.CLOCKWISE, ATTACK_DIRECTIONS.COUNTER_CLOCKWISE],
      default: ATTACK_DIRECTIONS.CLOCKWISE,
      description:
        "Sweep direction for arc attacks. `clockwise` grows toward increasing rotation; `counter_clockwise` grows toward decreasing rotation.",
    },
    pattern: {
      type: "string",
      required: false,
      enum: [
        DAMAGE_PATTERNS.CONE,
        DAMAGE_PATTERNS.AREA,
        DAMAGE_PATTERNS.RING,
        DAMAGE_PATTERNS.ARC,
        DAMAGE_PATTERNS.LINE,
        DAMAGE_PATTERNS.RANGED,
        DAMAGE_PATTERNS.SPAWN_ENTITY,
      ],
      default: "area",
    },
    delay: {
      type: "number",
      required: false,
      min: 0,
      // Authored in seconds. Runtime converts to ticks.
      max: 1000,
      default: 0,
    },
    interval: {
      type: "number",
      required: false,
      min: 0,
      max: 1000,
      default: 0.05,
      description:
        "Tick interval in seconds for continuous or repeating attack execution. Runtime converts this to ticks.",
    },
    tickRate: {
      type: "number",
      required: false,
      min: 0,
      max: 1000,
      default: 0.05,
      description:
        "Alias for interval, authored in seconds and converted to ticks at runtime.",
    },
    angle: {
      type: "number",
      required: false,
      min: 0,
      max: 100_000,
    },
    isContinuous: {
      type: "boolean",
      required: false,
      default: false,
    },
    isHoming: {
      type: "boolean",
      required: false,
      default: false,
    },
    projectileTargetCenter: {
      type: "boolean",
      required: false,
      default: true,
      description:
        "When true, projectile attacks aim at the midpoint between the target's feet and head instead of the raw location.",
    },
    isReturning: {
      type: "boolean",
      required: false,
      default: false,
    },
    shouldArc: {
      type: "boolean",
      required: false,
      default: false,
      description:
        "When true, returning projectiles follow a curved path shaped by their projectile angle offset.",
    },
    useEasing: {
      type: "boolean",
      required: false,
      default: true,
      description:
        "When true, returning projectiles ease into the turnaround. When false, they traverse the return curve at constant speed.",
    },
    minimumReturnSpeedScale: {
      type: "number",
      required: false,
      min: 0,
      max: 1,
      default: 0.5,
      description:
        "Minimum speed floor for returning projectiles, expressed as a fraction of projectileStrength.",
    },
    despawnOnReturn: {
      type: "boolean",
      required: false,
      default: true,
      description:
        "When true, returning projectiles remove themselves immediately after completing the return path.",
    },
    verticalRange: {
      type: "number",
      required: false,
      min: 0,
      default: 2,
    },
    damageCause: {
      type: "string",
      required: false,
      enum: [
        "anvil",
        "blockExplosion",
        "charging",
        "contact",
        "drowning",
        "entityAttack",
        "entityExplosion",
        "fall",
        "fallingBlock",
        "fire",
        "fireTicket",
        "freezing",
        "lava",
        "lightning",
        "miningFatigue",
        "none",
        "projectile",
        "stalactite",
        "stalagmite",
        "suffocation",
        "suicide",
        "temperature",
        "thorns",
        "void",
        "wither",
        "witherHeadProjectile",
      ],
      default: "entityAttack",
    },
    knockback: {
      type: "object",
      required: false,
      properties: {
        pattern: { type: "string", required: false },
        strength: { type: "number", min: 0, default: 0 },
        horizontalStrength: { type: "number", min: 0, default: 0 },
        verticalStrength: { type: "number", default: 0 },
        range: { type: "number", min: 0, default: 10 },
        verticalRange: { type: "number", min: 0, default: 2 },
        yStrength: { type: "number", default: 0.1 },
        duration: { type: "number", min: 0, default: 0 },
        interval: { type: "number", min: 0, default: 0 },
        startTime: { type: "number", min: 0, default: 0 },
        endTime: { type: "number", min: 0, default: 0 },
        cameraShakeEffect: { type: "object", required: false },
      },
    },
    projectile: {
      type: "string",
      required: false,
    },
    projectileComponentShoot: {
      type: "boolean",
      required: false,
      default: false,
      description:
        "When true, a plain (non-homing, non-returning, non-continuous) projectile is launched with its minecraft:projectile component's shoot() instead of applyImpulse. Falls back to applyImpulse if the projectile has no such component.",
    },
    projectileSpawnEvent: {
      type: "string",
      required: false,
      description:
        "Event triggered on the projectile entity when it spawns. Defaults to the entity's own spawn event.",
    },
    entity: {
      type: "string",
      required: false,
      description:
        "Entity type identifier to spawn when using the spawn_entity pattern.",
    },
    directionalOffset: {
      type: "object",
      required: false,
      description:
        "Directional offset used as the spawn origin for spawn_entity patterns.",
    },
    spawnAtTargetLocation: {
      type: "boolean",
      required: false,
      default: false,
      description:
        "When true, spawn_entity patterns use the target's location as their origin instead of the attacker's location.",
    },
    projectToGround: {
      type: "boolean",
      required: false,
      default: false,
      description:
        "When true, spawn_entity patterns project their final spawn point straight down to the first solid block below.",
    },
    matchSourceRotation: {
      type: "boolean",
      required: false,
      default: false,
      description:
        "When true, spawn_entity patterns inherit the source entity's yaw as the spawned entity's initialRotation.",
    },
    initialRotation: {
      type: ["number", "object"],
      required: false,
      description:
        "Optional initial yaw override for spawn_entity patterns. Accepts a number or an AngleOffset-like object and is applied relative to the source entity's yaw.",
    },
    hits: {
      type: "array",
      required: false,
    },
    spawnConfig: {
      type: "object",
      required: false,
      description:
        "Procedural entity-spawn layout for the spawn_entity pattern. Expanded into runtime hits during attack creation.",
    },
    shots: {
      type: "array",
      required: false,
    },
    shotsConfig: {
      type: "object",
      required: false,
      description:
        "Procedural multi_ranged projectile layout. For a full radial burst, use shape: ATTACK_SHAPES.CIRCLE and omit angle/angleSpacing; generated spacing is added per shot to angleOffset.theta, while angleOffset.phi remains fixed for every shot unless sphere/useSphere is enabled. Positive phi pitches downward and negative phi pitches upward.",
    },
  },

  isContinuousRangedAttack(config) {
    return config.type === "continuous" && config.pattern === "ranged";
  },

  isProjectileAttack(config) {
    return (
      config.type === "ranged" ||
      config.type === "multi_ranged" ||
      config.pattern === "ranged"
    );
  },

  isSpawnEntityPattern(config) {
    return config?.pattern === DAMAGE_PATTERNS.SPAWN_ENTITY;
  },

  isMultiAttackWithNestedHits(config) {
    return (
      config.type === "multi" &&
      Array.isArray(config.hits) &&
      config.hits.length > 0
    );
  },

  requiresDamage(config) {
    return (
      !AttackValidator.isSpawnEntityPattern(config) &&
      !AttackValidator.isProjectileAttack(config) &&
      !AttackValidator.isMultiAttackWithNestedHits(config)
    );
  },

  requiresRange() {
    return true;
  },

  requiresProjectile(config) {
    return (
      config.type === "ranged" ||
      AttackValidator.isContinuousRangedAttack(config)
    );
  },

  requiresSpawnEntityId(config) {
    return AttackValidator.isSpawnEntityPattern(config);
  },

  isConditionallyRequiredField(key) {
    return ["damage", "range", "projectile", "entity"].includes(key);
  },

  isFieldRequired(key, config, rules) {
    if (!rules?.required) {
      return false;
    }

    if (key === "damage") {
      return AttackValidator.requiresDamage(config);
    }

    if (key === "range") {
      return AttackValidator.requiresRange();
    }

    if (key === "projectile") {
      return AttackValidator.requiresProjectile(config);
    }

    if (key === "entity") {
      return AttackValidator.requiresSpawnEntityId(config);
    }

    return true;
  },

  getGeneratedShotsCount(config) {
    if (!config || typeof config !== "object") {
      return undefined;
    }

    const rawCount = config.count ?? config.numberOfShots ?? config.shots;
    const count = Number(rawCount);
    return Number.isSafeInteger(count) ? count : undefined;
  },

  isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  },

  pushError(errors, error) {
    errors.push(error);
  },

  validateShotsArray(shots, inheritedProjectile, errors, path = "shots") {
    if (!Array.isArray(shots)) {
      AttackValidator.pushError(errors, {
        type: AttackValidator.ErrorTypes.INVALID_TYPE,
        field: path,
        actual: typeof shots,
        expected: ["array"],
        message: `Invalid type for ${path}: expected array`,
      });
      return;
    }

    if (shots.length === 0) {
      AttackValidator.pushError(errors, {
        type: AttackValidator.ErrorTypes.MALFORMED_OBJECT,
        field: path,
        message: `${path} must contain at least one shot`,
      });
      return;
    }

    for (const [index, shot] of shots.entries()) {
      const shotPath = `${path}[${index}]`;

      if (!shot || typeof shot !== "object" || Array.isArray(shot)) {
        AttackValidator.pushError(errors, {
          type: AttackValidator.ErrorTypes.MALFORMED_OBJECT,
          field: shotPath,
          message: `${shotPath} must be an object`,
        });
        continue;
      }

      if (shot.projectile === undefined && inheritedProjectile === undefined) {
        AttackValidator.pushError(errors, {
          type: AttackValidator.ErrorTypes.MISSING_REQUIRED,
          field: `${shotPath}.projectile`,
          message: `Required field missing: ${shotPath}.projectile`,
        });
      }

      if (
        shot.delay !== undefined &&
        (!AttackValidator.isFiniteNumber(shot.delay) || shot.delay < 0)
      ) {
        AttackValidator.pushError(errors, {
          type: AttackValidator.ErrorTypes.OUT_OF_RANGE,
          field: `${shotPath}.delay`,
          value: shot.delay,
          min: 0,
          message: `${shotPath}.delay must be a finite number greater than or equal to 0`,
        });
      }

      if (
        shot.projectileOffset !== undefined &&
        (typeof shot.projectileOffset !== "object" ||
          shot.projectileOffset === null ||
          Array.isArray(shot.projectileOffset))
      ) {
        AttackValidator.pushError(errors, {
          type: AttackValidator.ErrorTypes.INVALID_TYPE,
          field: `${shotPath}.projectileOffset`,
          actual: Array.isArray(shot.projectileOffset)
            ? "array"
            : typeof shot.projectileOffset,
          expected: ["object"],
          message: `Invalid type for ${shotPath}.projectileOffset: expected object`,
        });
      }

      if (
        shot.projectileAngleOffset !== undefined &&
        (typeof shot.projectileAngleOffset !== "object" ||
          shot.projectileAngleOffset === null ||
          Array.isArray(shot.projectileAngleOffset))
      ) {
        AttackValidator.pushError(errors, {
          type: AttackValidator.ErrorTypes.INVALID_TYPE,
          field: `${shotPath}.projectileAngleOffset`,
          actual: Array.isArray(shot.projectileAngleOffset)
            ? "array"
            : typeof shot.projectileAngleOffset,
          expected: ["object"],
          message: `Invalid type for ${shotPath}.projectileAngleOffset: expected object`,
        });
      }
    }
  },

  validateGeneratedShotsConfig(config, errors, path = "shotsConfig") {
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      AttackValidator.pushError(errors, {
        type: AttackValidator.ErrorTypes.MALFORMED_OBJECT,
        field: path,
        message: `${path} must be an object`,
      });
      return;
    }

    const count = AttackValidator.getGeneratedShotsCount(config);
    if (count === undefined || count <= 0) {
      AttackValidator.pushError(errors, {
        type: AttackValidator.ErrorTypes.MISSING_REQUIRED,
        field: `${path}.count`,
        message: `${path} must define a positive integer shot count using count or numberOfShots`,
      });
    }

    if (
      config.radius !== undefined &&
      (!AttackValidator.isFiniteNumber(config.radius) || config.radius < 0)
    ) {
      AttackValidator.pushError(errors, {
        type: AttackValidator.ErrorTypes.OUT_OF_RANGE,
        field: `${path}.radius`,
        value: config.radius,
        min: 0,
        message: `${path}.radius must be a finite number greater than or equal to 0`,
      });
    }

    if (
      config.angle !== undefined &&
      (!AttackValidator.isFiniteNumber(config.angle) ||
        Math.abs(config.angle) > FULL_CIRCLE)
    ) {
      AttackValidator.pushError(errors, {
        type: AttackValidator.ErrorTypes.OUT_OF_RANGE,
        field: `${path}.angle`,
        value: config.angle,
        min: -FULL_CIRCLE,
        max: FULL_CIRCLE,
        message: `${path}.angle must be a finite number between -${FULL_CIRCLE} and ${FULL_CIRCLE}`,
      });
    }

    if (
      config.angleSpacing !== undefined &&
      !AttackValidator.isFiniteNumber(config.angleSpacing)
    ) {
      AttackValidator.pushError(errors, {
        type: AttackValidator.ErrorTypes.INVALID_TYPE,
        field: `${path}.angleSpacing`,
        actual: typeof config.angleSpacing,
        expected: ["number"],
        message: `${path}.angleSpacing must be a finite number`,
      });
    }

    if (
      config.directionalOffset !== undefined &&
      (typeof config.directionalOffset !== "object" ||
        config.directionalOffset === null ||
        Array.isArray(config.directionalOffset))
    ) {
      AttackValidator.pushError(errors, {
        type: AttackValidator.ErrorTypes.INVALID_TYPE,
        field: `${path}.directionalOffset`,
        actual: Array.isArray(config.directionalOffset)
          ? "array"
          : typeof config.directionalOffset,
        expected: ["object"],
        message: `${path}.directionalOffset must be an object`,
      });
    }

    if (
      config.angleOffset !== undefined &&
      (typeof config.angleOffset !== "object" ||
        config.angleOffset === null ||
        Array.isArray(config.angleOffset))
    ) {
      AttackValidator.pushError(errors, {
        type: AttackValidator.ErrorTypes.INVALID_TYPE,
        field: `${path}.angleOffset`,
        actual: Array.isArray(config.angleOffset)
          ? "array"
          : typeof config.angleOffset,
        expected: ["object"],
        message: `${path}.angleOffset must be an object`,
      });
    }

    const sphere = config.sphere ?? config.useSphere;
    if (sphere !== undefined && typeof sphere !== "boolean") {
      AttackValidator.pushError(errors, {
        type: AttackValidator.ErrorTypes.INVALID_TYPE,
        field: `${path}.sphere`,
        actual: typeof sphere,
        expected: ["boolean"],
        message: `${path}.sphere must be a boolean`,
      });
    }
  },

  getGeneratedHitsCount(config) {
    if (!config || typeof config !== "object") {
      return undefined;
    }

    const rawCount =
      config.count ??
      config.numberOfHits ??
      config.numberOfShots ??
      config.hits;
    const count = Number(rawCount);
    return Number.isSafeInteger(count) ? count : undefined;
  },

  validateGeneratedHitsConfig(config, errors, path = "spawnConfig") {
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      AttackValidator.pushError(errors, {
        type: AttackValidator.ErrorTypes.MALFORMED_OBJECT,
        field: path,
        message: `${path} must be an object`,
      });
      return;
    }

    const count = AttackValidator.getGeneratedHitsCount(config);
    if (count === undefined || count <= 0) {
      AttackValidator.pushError(errors, {
        type: AttackValidator.ErrorTypes.MISSING_REQUIRED,
        field: `${path}.count`,
        message: `${path} must define a positive integer hit count using count or numberOfHits`,
      });
    }

    if (
      config.radius !== undefined &&
      (!AttackValidator.isFiniteNumber(config.radius) || config.radius < 0)
    ) {
      AttackValidator.pushError(errors, {
        type: AttackValidator.ErrorTypes.OUT_OF_RANGE,
        field: `${path}.radius`,
        value: config.radius,
        min: 0,
        message: `${path}.radius must be a finite number greater than or equal to 0`,
      });
    }

    if (
      config.angle !== undefined &&
      (!AttackValidator.isFiniteNumber(config.angle) ||
        Math.abs(config.angle) > FULL_CIRCLE)
    ) {
      AttackValidator.pushError(errors, {
        type: AttackValidator.ErrorTypes.OUT_OF_RANGE,
        field: `${path}.angle`,
        value: config.angle,
        min: -FULL_CIRCLE,
        max: FULL_CIRCLE,
        message: `${path}.angle must be a finite number between -${FULL_CIRCLE} and ${FULL_CIRCLE}`,
      });
    }

    for (const key of [
      "spacing",
      "rowSpacing",
      "columnSpacing",
      "lineSpacing",
      "angleSpacing",
      "layerDelay",
    ]) {
      if (
        config[key] !== undefined &&
        !AttackValidator.isFiniteNumber(config[key])
      ) {
        AttackValidator.pushError(errors, {
          type: AttackValidator.ErrorTypes.INVALID_TYPE,
          field: `${path}.${key}`,
          actual: typeof config[key],
          expected: ["number"],
          message: `${path}.${key} must be a finite number`,
        });
      }

      if (
        key === "layerDelay" &&
        config[key] !== undefined &&
        AttackValidator.isFiniteNumber(config[key]) &&
        config[key] < 0
      ) {
        AttackValidator.pushError(errors, {
          type: AttackValidator.ErrorTypes.OUT_OF_RANGE,
          field: `${path}.${key}`,
          value: config[key],
          min: 0,
          message: `${path}.${key} must be a finite number greater than or equal to 0`,
        });
      }
    }

    for (const key of ["count", "numberOfHits"]) {
      if (
        config[key] !== undefined &&
        (!Number.isSafeInteger(Number(config[key])) || Number(config[key]) <= 0)
      ) {
        AttackValidator.pushError(errors, {
          type: AttackValidator.ErrorTypes.OUT_OF_RANGE,
          field: `${path}.${key}`,
          value: config[key],
          min: 1,
          message: `${path}.${key} must be a positive integer`,
        });
      }
    }

    if (
      config.directionalOffset !== undefined &&
      (typeof config.directionalOffset !== "object" ||
        config.directionalOffset === null ||
        Array.isArray(config.directionalOffset))
    ) {
      AttackValidator.pushError(errors, {
        type: AttackValidator.ErrorTypes.INVALID_TYPE,
        field: `${path}.directionalOffset`,
        actual: Array.isArray(config.directionalOffset)
          ? "array"
          : typeof config.directionalOffset,
        expected: ["object"],
        message: `${path}.directionalOffset must be an object`,
      });
    }

    if (
      config.angleOffset !== undefined &&
      (typeof config.angleOffset !== "object" ||
        config.angleOffset === null ||
        Array.isArray(config.angleOffset))
    ) {
      AttackValidator.pushError(errors, {
        type: AttackValidator.ErrorTypes.INVALID_TYPE,
        field: `${path}.angleOffset`,
        actual: Array.isArray(config.angleOffset)
          ? "array"
          : typeof config.angleOffset,
        expected: ["object"],
        message: `${path}.angleOffset must be an object`,
      });
    }

    if (
      config.shape !== undefined &&
      !Object.values(ATTACK_SHAPES).includes(config.shape)
    ) {
      AttackValidator.pushError(errors, {
        type: AttackValidator.ErrorTypes.INVALID_ENUM,
        field: `${path}.shape`,
        actual: config.shape,
        allowed: Object.values(ATTACK_SHAPES),
        message: `${path}.shape must be one of ${Object.values(
          ATTACK_SHAPES,
        ).join(", ")}`,
      });
    }

    if (
      config.spawnOnEdges !== undefined &&
      typeof config.spawnOnEdges !== "boolean"
    ) {
      AttackValidator.pushError(errors, {
        type: AttackValidator.ErrorTypes.INVALID_TYPE,
        field: `${path}.spawnOnEdges`,
        actual: typeof config.spawnOnEdges,
        expected: ["boolean"],
        message: `${path}.spawnOnEdges must be a boolean`,
      });
    }

    for (const key of ["matchSourceRotation"]) {
      if (config[key] !== undefined && typeof config[key] !== "boolean") {
        AttackValidator.pushError(errors, {
          type: AttackValidator.ErrorTypes.INVALID_TYPE,
          field: `${path}.${key}`,
          actual: typeof config[key],
          expected: ["boolean"],
          message: `${path}.${key} must be a boolean`,
        });
      }
    }

    if (
      config.initialRotation !== undefined &&
      typeof config.initialRotation !== "number" &&
      (typeof config.initialRotation !== "object" ||
        config.initialRotation === null ||
        Array.isArray(config.initialRotation))
    ) {
      AttackValidator.pushError(errors, {
        type: AttackValidator.ErrorTypes.INVALID_TYPE,
        field: `${path}.initialRotation`,
        actual: Array.isArray(config.initialRotation)
          ? "array"
          : typeof config.initialRotation,
        expected: ["number", "object"],
        message: `${path}.initialRotation must be a number or AngleOffset-like object`,
      });
    }
  },

  validateSpawnEntityDefinition(
    config,
    errors,
    path = "",
    inheritedSpawnConfig = {},
  ) {
    if (!config || typeof config !== "object") {
      return;
    }

    const hasHitsArray = config.hits !== undefined;
    const hasSpawnConfig = config.spawnConfig !== undefined;
    const spawnPathPrefix = path ? `${path}.` : "";
    const inheritedEntity = inheritedSpawnConfig.entity;
    const inheritedDirectionalOffset = inheritedSpawnConfig.directionalOffset;

    if (!AttackValidator.isSpawnEntityPattern(config)) {
      if (Array.isArray(config.hits)) {
        for (const [index, hit] of config.hits.entries()) {
          AttackValidator.validateSpawnEntityDefinition(
            hit,
            errors,
            `${spawnPathPrefix}hits[${index}]`.replace(/^\./u, ""),
            inheritedSpawnConfig,
          );
        }
      }
      return;
    }

    const effectiveEntity = config.entity ?? inheritedEntity;
    const effectiveDirectionalOffset =
      config.directionalOffset ?? inheritedDirectionalOffset;

    if (
      config.directionalOffset !== undefined &&
      (typeof config.directionalOffset !== "object" ||
        config.directionalOffset === null ||
        Array.isArray(config.directionalOffset))
    ) {
      AttackValidator.pushError(errors, {
        type: AttackValidator.ErrorTypes.INVALID_TYPE,
        field: `${spawnPathPrefix}directionalOffset`.replace(/^\./u, ""),
        actual: Array.isArray(config.directionalOffset)
          ? "array"
          : typeof config.directionalOffset,
        expected: ["object"],
        message: `${path || SPAWN_ENTITY_ATTACK_LABEL} directionalOffset must be an object`,
      });
    }

    if (hasHitsArray && hasSpawnConfig) {
      AttackValidator.pushError(errors, {
        type: AttackValidator.ErrorTypes.MALFORMED_OBJECT,
        field: `${spawnPathPrefix}spawnConfig`.replace(/^\./u, ""),
        message: `${path || SPAWN_ENTITY_ATTACK_LABEL} cannot define both hits and spawnConfig`,
      });
    }

    if (hasHitsArray && !Array.isArray(config.hits)) {
      AttackValidator.pushError(errors, {
        type: AttackValidator.ErrorTypes.INVALID_TYPE,
        field: `${spawnPathPrefix}hits`.replace(/^\./u, ""),
        actual: typeof config.hits,
        expected: ["array"],
        message: `${path || SPAWN_ENTITY_ATTACK_LABEL} hits must be an array`,
      });
    }

    if (hasSpawnConfig) {
      AttackValidator.validateGeneratedHitsConfig(
        config.spawnConfig,
        errors,
        `${spawnPathPrefix}spawnConfig`.replace(/^\./u, ""),
      );
    }

    if (effectiveEntity === undefined) {
      AttackValidator.pushError(errors, {
        type: AttackValidator.ErrorTypes.MISSING_REQUIRED,
        field: `${spawnPathPrefix}entity`.replace(/^\./u, ""),
        message: `Required field missing: ${spawnPathPrefix}entity`,
      });
    }

    if (
      !hasHitsArray &&
      !hasSpawnConfig &&
      effectiveDirectionalOffset === undefined
    ) {
      AttackValidator.pushError(errors, {
        type: AttackValidator.ErrorTypes.MISSING_REQUIRED,
        field: `${spawnPathPrefix}directionalOffset`.replace(/^\./u, ""),
        message: `Required field missing: ${spawnPathPrefix}directionalOffset`,
      });
    }

    if (Array.isArray(config.hits)) {
      for (const [index, hit] of config.hits.entries()) {
        AttackValidator.validateSpawnEntityDefinition(
          hit,
          errors,
          `${spawnPathPrefix}hits[${index}]`.replace(/^\./u, ""),
          {
            entity: effectiveEntity,
            directionalOffset: effectiveDirectionalOffset,
          },
        );
      }
    }
  },

  validateShotDefinition(
    config,
    errors,
    path = "",
    inheritedProjectile = undefined,
  ) {
    if (!config || typeof config !== "object") {
      return;
    }

    const hasShotsArray = config.shots !== undefined;
    const hasShotsConfig = config.shotsConfig !== undefined;
    const shotPathPrefix = path ? `${path}.` : "";
    const effectiveProjectile = config.projectile ?? inheritedProjectile;

    if (config.type === "multi_ranged" || hasShotsArray || hasShotsConfig) {
      if (!hasShotsArray && !hasShotsConfig) {
        AttackValidator.pushError(errors, {
          type: AttackValidator.ErrorTypes.MISSING_REQUIRED,
          field: `${shotPathPrefix}shots`,
          message: `${path || "multi_ranged attack"} must define either shots or shotsConfig`,
        });
      }

      if (hasShotsArray && hasShotsConfig) {
        AttackValidator.pushError(errors, {
          type: AttackValidator.ErrorTypes.MALFORMED_OBJECT,
          field: `${shotPathPrefix}shotsConfig`,
          message: `${path || "multi_ranged attack"} cannot define both shots and shotsConfig`,
        });
      }

      if (hasShotsArray) {
        AttackValidator.validateShotsArray(
          config.shots,
          effectiveProjectile,
          errors,
          `${shotPathPrefix}shots`.replace(/^\./u, ""),
        );
      }

      if (hasShotsConfig) {
        if (effectiveProjectile === undefined) {
          AttackValidator.pushError(errors, {
            type: AttackValidator.ErrorTypes.MISSING_REQUIRED,
            field: `${shotPathPrefix}projectile`.replace(/^\./u, ""),
            message:
              `Required field missing: ${shotPathPrefix}projectile`.replace(
                /^\./u,
                "",
              ),
          });
        }

        AttackValidator.validateGeneratedShotsConfig(
          config.shotsConfig,
          errors,
          `${shotPathPrefix}shotsConfig`.replace(/^\./u, ""),
        );
      }
    }

    if (Array.isArray(config.hits)) {
      for (const [index, hit] of config.hits.entries()) {
        AttackValidator.validateShotDefinition(
          hit,
          errors,
          `${shotPathPrefix}hits[${index}]`.replace(/^\./u, ""),
          effectiveProjectile,
        );
      }
    }
  },

  /**
   * Validates one schema field of an attack configuration.
   * @param {string} key - The field name
   * @param {Object} rules - The field's schema rules
   * @param {Object} config - The attack configuration being validated
   * @param {Array} errors - Receives the errors found
   */
  validateField(key, rules, config, errors) {
    const value = config[key];
    const isRequired = AttackValidator.isFieldRequired(key, config, rules);

    if (value === undefined || value === null) {
      if (isRequired) {
        errors.push({
          type: AttackValidator.ErrorTypes.MISSING_REQUIRED,
          field: key,
          message: `Required field missing: ${key}`,
        });
      }
      return;
    }

    const expectedTypes = Array.isArray(rules.type) ? rules.type : [rules.type];
    const actualType = Array.isArray(value) ? "array" : typeof value;

    if (!expectedTypes.includes(actualType)) {
      errors.push({
        type: AttackValidator.ErrorTypes.INVALID_TYPE,
        field: key,
        actual: actualType,
        expected: expectedTypes,
        message: `Invalid type for ${key}: expected ${expectedTypes.join(" | ")}, got ${actualType}`,
      });
      return;
    }

    if (rules.validate && !rules.validate(value)) {
      errors.push({
        type: AttackValidator.ErrorTypes.INVALID_TYPE,
        field: key,
        message: `Validation failed for field ${key}`,
      });
      return;
    }

    // Enum validation
    if (rules.enum && !rules.enum.includes(value)) {
      errors.push({
        type: AttackValidator.ErrorTypes.INVALID_ENUM,
        field: key,
        actual: value,
        allowed: rules.enum,
        message: `Invalid enum value for ${key}: ${value}. Allowed: ${rules.enum.join(", ")}`,
      });
      return;
    }

    // Range validation
    if (rules.min !== undefined && value < rules.min) {
      errors.push({
        type: AttackValidator.ErrorTypes.OUT_OF_RANGE,
        field: key,
        min: rules.min,
        message: `${key} is below minimum: ${value} < ${rules.min}`,
        value,
      });
    }

    if (rules.max !== undefined && value > rules.max) {
      errors.push({
        type: AttackValidator.ErrorTypes.OUT_OF_RANGE,
        field: key,
        max: rules.max,
        message: `${key} is above maximum: ${value} > ${rules.max}`,
        value,
      });
    }

    // Nested object validation
    if (
      rules.properties &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      AttackValidator.validateNestedProperties(
        key,
        rules.properties,
        value,
        errors,
      );
    }
  },

  /**
   * Validates the nested properties of an object-valued schema field.
   * @param {string} key - The parent field name
   * @param {Object} properties - Schema rules keyed by property name
   * @param {Object} value - The parent field's value
   * @param {Array} errors - Receives the errors found
   */
  validateNestedProperties(key, properties, value, errors) {
    for (const [propertyKey, propertyRules] of Object.entries(properties)) {
      const propertyValue = value[propertyKey];

      if (propertyRules.required && propertyValue === undefined) {
        errors.push({
          type: AttackValidator.ErrorTypes.MISSING_REQUIRED,
          field: `${key}.${propertyKey}`,
          message: `Required field missing: ${key}.${propertyKey}`,
        });
        continue;
      }

      if (
        propertyRules.type &&
        propertyValue !== undefined &&
        typeof propertyValue !== propertyRules.type
      ) {
        errors.push({
          type: AttackValidator.ErrorTypes.INVALID_TYPE,
          field: `${key}.${propertyKey}`,
          message: `Invalid type for ${key}.${propertyKey}`,
        });
      }

      if (
        propertyRules.min !== undefined &&
        propertyValue < propertyRules.min
      ) {
        errors.push({
          type: AttackValidator.ErrorTypes.OUT_OF_RANGE,
          field: `${key}.${propertyKey}`,
          message: `${key}.${propertyKey} is below minimum`,
        });
      }

      if (
        propertyRules.max !== undefined &&
        propertyValue > propertyRules.max
      ) {
        errors.push({
          type: AttackValidator.ErrorTypes.OUT_OF_RANGE,
          field: `${key}.${propertyKey}`,
          message: `${key}.${propertyKey} is above maximum`,
        });
      }
    }
  },

  /**
   * Validates an attack configuration against the schema.
   * @param {Object} config - The attack configuration to validate
   * @param {Object} customSchema - Optional custom schema to extend the default
   * @returns {Object} Validation result { valid: boolean, errors: Array, warnings: Array }
   */
  validate(config, customSchema = undefined) {
    if (!config || typeof config !== "object") {
      return {
        valid: false,
        errors: [
          {
            type: AttackValidator.ErrorTypes.MALFORMED_OBJECT,
            message: "Configuration must be an object",
          },
        ],
        warnings: [],
      };
    }

    const schema = customSchema || AttackValidator.SCHEMA;
    const errors = [];
    const warnings = [];

    if (AttackValidator.requiresDamage(config) && config.damage === undefined) {
      errors.push({
        type: AttackValidator.ErrorTypes.MISSING_REQUIRED,
        field: "damage",
        message: "Required field missing: damage",
      });
    }

    if (AttackValidator.requiresRange() && config.range === undefined) {
      errors.push({
        type: AttackValidator.ErrorTypes.MISSING_REQUIRED,
        field: "range",
        message: "Required field missing: range",
      });
    }

    if (
      AttackValidator.requiresProjectile(config) &&
      config.projectile === undefined
    ) {
      errors.push({
        type: AttackValidator.ErrorTypes.MISSING_REQUIRED,
        field: "projectile",
        message: "Required field missing: projectile",
      });
    }

    if (
      AttackValidator.requiresSpawnEntityId(config) &&
      config.entity === undefined
    ) {
      errors.push({
        type: AttackValidator.ErrorTypes.MISSING_REQUIRED,
        field: "entity",
        message: "Required field missing: entity",
      });
    }

    for (const [key, rules] of Object.entries(schema)) {
      AttackValidator.validateField(key, rules, config, errors);
    }

    for (const key of Object.keys(config)) {
      if (!Object.hasOwn(schema, key)) {
        warnings.push({
          field: key,
          message: `Unknown field in configuration: ${key}`,
        });
      }
    }

    AttackValidator.validateShotDefinition(config, errors);
    AttackValidator.validateSpawnEntityDefinition(config, errors);

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  },

  /**
   * Validates and returns a config with defaults applied.
   * @param {Object} config - The configuration to validate and normalize
   * @param {Object} customSchema - Optional custom schema
   * @returns {Object} { config: normalizedConfig, validation: validationResult }
   */
  validateAndNormalize(config, customSchema = undefined) {
    const schema = customSchema || AttackValidator.SCHEMA;
    const validation = AttackValidator.validate(config, schema);
    const normalized = { ...config };

    for (const [key, rules] of Object.entries(schema)) {
      if (rules.default !== undefined && normalized[key] === undefined) {
        normalized[key] = rules.default;
      }
    }

    return {
      config: normalized,
      validation,
    };
  },

  /**
   * Registers a custom schema for a specific attack type.
   * @param {string} attackType - Name of the attack type
   * @param {Object} schema - Custom validation schema
   */
  registerCustomSchema(attackType, schema) {
    if (!AttackValidator.customSchemas) {
      AttackValidator.customSchemas = {};
    }
    AttackValidator.customSchemas[attackType] = schema;
    logger.info(`Registered schema for attack type: ${attackType}`);
  },

  /**
   * Gets a registered custom schema.
   * @param {string} attackType - Name of the attack type
   * @returns {Object|undefined} The schema or undefined if not found
   */
  getSchema(attackType) {
    if (!AttackValidator.customSchemas) {
      AttackValidator.customSchemas = {};
    }
    return AttackValidator.customSchemas[attackType] || undefined;
  },

  /**
   * Combines base schema with custom schema.
   * @param {Object} baseSchema - Base schema
   * @param {Object} customSchema - Custom schema to merge
   * @returns {Object} Merged schema
   */
  mergeSchemas(baseSchema, customSchema) {
    return {
      ...baseSchema,
      ...customSchema,
    };
  },
};
