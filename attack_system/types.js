// Developed by: Petar Mijailovic (leptr)
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

/**
 * Shapes of the objects a pack writes for the attack system.
 *
 * This file contains no code. It exists so editors can suggest and check the
 * fields of an attack while it is being written. An attack config also accepts
 * fields that are not listed here: the validator in core/attack_validator.js
 * is the full reference.
 */

/**
 * The fields of an attack config.
 * @typedef {Object} AttackConfigFields
 * @property {Object} [attack_data] The attack configuration, when `config` is a wrapper object around it.
 * @property {string} type Attack type: 'single', 'multi', 'continuous', 'ranged', or 'multi_ranged'. See ATTACK_TYPES constant.
 * @property {string} pattern Attack pattern: 'cone', 'area', 'ring', 'arc', 'line', 'ranged', or 'spawn_entity'. See DAMAGE_PATTERNS constant.
 * @property {number|number[]} damage Damage value (number or [min, max] array)
 * @property {number} range Attack range in blocks
 * @property {string} [entity] Entity type id spawned by spawn_entity attacks.
 * @property {Object} [directionalOffset] Rotated offset used by spawn_entity attacks.
 * @property {boolean} [spawnAtTargetLocation] When true, spawn_entity uses the target location as its origin.
 * @property {Object} [spawnConfig] Generated spawn layout for spawn_entity MULTI attacks. Supports count, radius, angle, angleSpacing, directionalOffset, angleOffset, spawnOnEdges, shape, spacing, rowSpacing, columnSpacing, lineSpacing, and layerDelay. For radial layouts like CIRCLE and LINES, omitting angleSpacing and angle defaults to evenly spacing entries across 360 degrees using count. `layerDelay` adds extra delay per distinct radial layer from nearest to farthest.
 * @property {Object} [shotsConfig] Generated projectile layout for multi_ranged attacks. Supports count, radius, angle, angleSpacing, directionalOffset, angleOffset, and sphere/useSphere. For radial 360 layouts, set `shape: ATTACK_SHAPES.CIRCLE` and omit `angle`/`angleSpacing` to space `count` shots evenly around the full circle. In that mode, `angleOffset.theta` is the starting yaw and each generated shot adds its own theta spacing, while `angleOffset.phi` stays constant for all shots unless sphere/useSphere is enabled. Positive phi pitches downward and negative phi pitches upward.
 * @property {boolean} [projectToGround] When true, spawn_entity patterns project their final spawn point straight down to the first solid block below. Defaults to false.
 * @property {number} [duration] Attack duration in seconds
 * @property {number} [cooldown] Cooldown in seconds applied after the attack finishes before the attacker can start another attack. Defaults to 1.0.
 * @property {number} [delay] Delay before damage in seconds
 * @property {boolean} [despawnOnReturn] When true, returning projectiles are removed immediately when their return phase completes. Defaults to true.
 * @property {number} [startAngle] Additional angular offset, in degrees, that determines where an arc sweep starts relative to the attacker's facing and damageAngleOffset. Defaults to 0.
 * @property {string} [arcDirection] Sweep direction for arc attacks. Supported values are `clockwise` and `counter_clockwise`.
 * @property {number} [arcGrowthTime] Legacy alias for arc sweep growth time in seconds. When present, it is only used if damageDuration is not set.
 * @property {boolean} [splitReturnPhases] When true, returning projectiles treat outbound travel and return travel as separate phases.
 * @property {number} [outboundFlightTime] Outbound duration in seconds for split returning projectiles.
 * @property {number} [returnPauseTime] Pause duration in seconds at the turnaround point for split returning projectiles.
 * @property {number} [returnFlightTime] Return duration in seconds for split returning projectiles.
 * @property {number} [verticalRange] Vertical reach in blocks, above and below the attacker.
 * @property {number} [angle] Cone or arc angle in degrees.
 * @property {number} [interval] Time between hits or shots of a continuous attack, in seconds.
 * @property {AttackConfig[]} [hits] Sub-hits of a multi attack.
 * @property {AttackConfig[]} [shots] Shots of a multi_ranged attack.
 * @property {KnockbackConfig} [knockbackOptions] Knockback applied to hit targets.
 * @property {Object[]} [hitEffects] EntityEffect payloads applied to hit targets.
 * @property {Object[]} [soundEffects] SoundEffect payloads played on hit.
 * @property {Object[]} [particleEffects] ParticleEffect payloads spawned on hit.
 * @property {Object} [cameraShakeEffect] CameraShake payload applied on hit.
 * @property {string} [projectile] Entity type id of the projectile a ranged attack shoots.
 * @property {number} [projectileStrength] Speed the projectile is shot with.
 * @property {boolean} [lockRotation] Keep the attacker facing one way during the attack.
 * @property {boolean} [disableMovement] Stop the attacker from moving during the attack.
 * @property {string} [startEvent] Entity event triggered when the attack starts.
 * @property {string} [endEvent] Entity event triggered when the attack ends.
 * @property {Record<string, Object>} [difficultyMods] Field overrides by difficulty: `easy`, `normal`, `hard`.
 */

/**
 * @typedef {AttackConfigFields & Record<string, any>} AttackConfig
 */

/**
 * Knockback applied by an attack. Give either `strength`, or both
 * `horizontalStrength` and `verticalStrength`.
 * @typedef {Object} KnockbackConfigFields
 * @property {number} [strength] Knockback strength away from the attacker.
 * @property {number} [horizontalStrength] Horizontal part of the knockback.
 * @property {number} [verticalStrength] Vertical part of the knockback.
 * @property {number} [range] Reach of area knockback in blocks.
 * @property {boolean} [scaleWithKR] Scale up against netherite armor so its knockback resistance is cancelled out.
 * @property {number} [startTime] First application, in seconds after the hit.
 * @property {number} [endTime] Last application, in seconds after the hit.
 * @property {number} [interval] Time between repeated applications, in seconds.
 */

/**
 * @typedef {KnockbackConfigFields & Record<string, any>} KnockbackConfig
 */

export {};
