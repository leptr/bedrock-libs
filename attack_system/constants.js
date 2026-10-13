// Developed by: Petar Mijailovic (leptr)
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

/**
 * Attack System Constants
 * Centralized constant definitions for the attack system.
 * Use these instead of magic strings throughout your code.
 *
 * Note: Use vanilla @minecraft/server imports where possible:
 * - EntityDamageCause instead of custom DAMAGE_CAUSES
 * - TicksPerSecond for time conversions
 * - Other enums like GameMode, Direction, EquipmentSlot, etc.
 */

/**
 * Attack types - defines how the attack executes
 */
export const ATTACK_TYPES = {
  /** Single-hit attack - one damage instance after delay */
  SINGLE: "single",

  /** Multi-hit attack - multiple damage instances at different timings */
  MULTI: "multi",

  /** Continuous attack - repeated damage over duration (ticking) */
  CONTINUOUS: "continuous",

  /** Ranged attack - spawns projectiles */
  RANGED: "ranged",

  /** Multi-ranged attack - spawns multiple projectiles */
  MULTI_RANGED: "multi_ranged",
};

/**
 * Damage patterns - defines the area/shape of damage
 */
export const DAMAGE_PATTERNS = {
  /** Cone-shaped damage in front of attacker */
  CONE: "cone",

  /** Circular area around attacker or target */
  AREA: "area",

  /** Ring/donut shape with inner and outer radius */
  RING: "ring",

  /** Ring-like arc sector with directional sweep */
  ARC: "arc",

  /** Line/beam from attacker in facing direction */
  LINE: "line",

  /** Ranged projectile pattern (for continuous attacks) */
  RANGED: "ranged",

  /** Spawns entities without dealing damage */
  SPAWN_ENTITY: "spawn_entity",
};

/**
 * Direction constants for directional attack patterns such as growing arcs.
 */
export const ATTACK_DIRECTIONS = {
  /** Sweep toward increasing rotation */
  CLOCKWISE: "clockwise",

  /** Sweep toward decreasing rotation */
  COUNTER_CLOCKWISE: "counter_clockwise",
};

/**
 * Procedural layout shapes for generated spawn_entity hits.
 * All shape dimensions are based on radius and are applied relative to the attacker's rotation.
 */
export const ATTACK_SHAPES = {
  /** Evenly samples a filled square centered on the origin */
  GRID: "grid",

  /** Samples a circular arc or disk, depending on spawnOnEdges */
  CIRCLE: "circle",

  /** Samples a filled equilateral triangle */
  TRIANGLE: "triangle",

  /** Samples a filled regular pentagon */
  PENTAGON: "pentagon",

  /** Samples a filled regular hexagon */
  HEXAGON: "hexagon",

  /** Samples a filled regular octagon */
  OCTAGON: "octagon",

  /** Creates one or more radial lines extending out to radius */
  LINES: "lines",

  /** Samples a filled square aligned to the local forward/side axes */
  SQUARE: "square",

  /** Samples a filled diamond aligned to the local forward/side axes */
  DIAMOND: "diamond",

  /** Samples a simple five-point star footprint */
  STAR: "star",
};

/**
 * Attack lifecycle events
 * From AttackEventEmitter.Events
 */
export const ATTACK_EVENTS = {
  /** Attack starts execution */
  ATTACK_START: "attackStart",

  /** Attack config validation occurs */
  ATTACK_VALIDATE: "attackValidate",

  /** Target(s) found for attack */
  TARGET_FOUND: "targetFound",

  /** Targets filtered (e.g., by immunity, team) */
  TARGET_FILTERED: "targetFiltered",

  /** Before damage is applied to target */
  BEFORE_DAMAGE: "beforeDamage",

  /** Damage successfully applied */
  DAMAGE_APPLIED: "damageApplied",

  /** After damage is applied */
  AFTER_DAMAGE: "afterDamage",

  /** Knockback applied to target */
  KNOCKBACK_APPLIED: "knockbackApplied",

  /** Effect applied (particle, sound, status) */
  EFFECT_APPLIED: "effectApplied",

  /** Sound effect played */
  SOUND_PLAYED: "soundPlayed",

  /** Particle spawned */
  PARTICLE_SPAWNED: "particleSpawned",

  /** Attack cancelled before completion */
  ATTACK_CANCEL: "attackCancel",

  /** Attack finished execution */
  ATTACK_END: "attackEnd",

  /** Error occurred during attack */
  ATTACK_ERROR: "attackError",
};

/**
 * Damage Causes:
 * Use the vanilla EntityDamageCause enum from @minecraft/server instead of a custom constant.
 *
 * Example:
 * import { EntityDamageCause } from "@minecraft/server";
 * entity.applyDamage(5, { cause: EntityDamageCause.entityAttack });
 */

/**
 * Validation error types
 * From AttackValidator.ErrorTypes
 */
export const VALIDATION_ERRORS = {
  /** Required field is missing */
  MISSING_REQUIRED: "MISSING_REQUIRED",

  /** Value has incorrect type */
  INVALID_TYPE: "INVALID_TYPE",

  /** Numeric value outside allowed range */
  OUT_OF_RANGE: "OUT_OF_RANGE",

  /** Value not in allowed enum */
  INVALID_ENUM: "INVALID_ENUM",

  /** Object structure is malformed */
  MALFORMED_OBJECT: "MALFORMED_OBJECT",
};

/**
 * Log categories for AttackLogger
 */
export const LOG_CATEGORIES = {
  /** General attack lifecycle logs */
  ATTACK: "ATTACK",

  /** Damage calculation and application */
  DAMAGE: "DAMAGE",

  /** Target finding and filtering */
  TARGET: "TARGET",

  /** Effect application (particle, sound, status) */
  EFFECT: "EFFECT",

  /** Configuration validation */
  VALIDATION: "VALIDATION",

  /** Cache operations */
  CACHE: "CACHE",

  /** Performance metrics and profiling */
  PERFORMANCE: "PERFORMANCE",

  /** Error conditions */
  ERROR: "ERROR",
};

/**
 * Log levels for AttackLogger
 */
export const LOG_LEVELS = {
  /** Detailed debug information */
  DEBUG: 0,

  /** Informational messages */
  INFO: 1,

  /** Warning conditions */
  WARN: 2,

  /** Error conditions */
  ERROR: 3,
};

/**
 * Entity event types for EntityDispatcher
 */
export const ENTITY_EVENTS = {
  /** Entity's onTick handler */
  TICK: "onTick",

  /** Entity hits another entity */
  HIT_ENTITY: "onHitEntity",

  /** Entity is hit by another entity */
  HURT: "onHurt",

  /** Entity spawns/loads */
  SPAWN: "onSpawn",

  /** Entity dies */
  DIE: "onDie",

  /** Entity projectile hits block */
  PROJECTILE_HIT_BLOCK: "onProjectileHitBlock",

  /** Entity projectile hits entity */
  PROJECTILE_HIT_ENTITY: "onProjectileHitEntity",

  /** Entity receives script event */
  SCRIPT_EVENT: "onScriptEvent",
};

/**
 * World difficulty as a number, used to scale values such as projectile
 * inaccuracy. Keys match `world.getDifficulty()`.
 */
export const DIFFICULTY_INTS = {
  Peaceful: 0,
  Easy: 1,
  Normal: 2,
  Hard: 3,
};
