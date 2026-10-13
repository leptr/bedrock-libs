// Developed by: Petar Mijailovic (leptr)
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

/**
 * Shared settings for every library in this repository.
 *
 * The libraries read ids, property names and tuning values from `SETTINGS`
 * instead of hard-coding them, so one copy of the code works in every project.
 * A project sets its own values once, before anything else runs:
 *
 * ```javascript
 * // scripts/library_setup.js — must be the FIRST import in main.js
 * import { configureLibrary } from "./bedrock-libs/game_settings.js";
 *
 * configureLibrary({
 *   namespace: "my_pack",
 *   settings: {
 *     attack_system: { defaults: { range: 6 } },
 *   },
 * });
 * ```
 *
 * `configureLibrary` changes the existing `SETTINGS` object in place, so
 * modules that already imported it see the new values.
 *
 * This module must stay free of imports from the rest of the repository so
 * that any library can load it without creating an import cycle.
 */

const DEFAULT_NAMESPACE = "lib";
const TICKS_PER_SECOND = 20;
const MOVEMENT_FAILSAFE_SECONDS = 2;

const libraryState = { isConfigured: false, version: 0 };

/**
 * Build the default settings for a namespace.
 * @param {string} namespace
 * @returns {Object}
 */
function buildDefaultSettings(namespace) {
  return {
    general: {
      namespace,
      player_id: "minecraft:player",
      chunk_size: 16,
    },
    script_events: {
      clear_velocity: `${namespace}:clear_velocity`,
      tick_entity: `${namespace}:tick_entity`,
      tick_projectile: `${namespace}:tick_projectile`,
    },
    attack_system: {
      defaults: {
        damage: 1,
        range: 5,
        vertical_range: 2,
        area_expansion_time: 1,
        ring_thickness: 1,
        angle: 30,
        projectile_strength: 1,
        minimum_return_speed_scale: 0.5,
      },
      /** Item ids that count as a shield when checking for blocking. */
      shield_item_ids: ["minecraft:shield"],
      /** Event an entity fires so the script can read its current target. */
      get_target_event: `${namespace}:get_target`,
    },
    blocks: {
      vanilla: {
        air: { id: "minecraft:air" },
        lava: { id: "minecraft:lava" },
        flowing_lava: { id: "minecraft:flowing_lava" },
        water: { id: "minecraft:water" },
        flowing_water: { id: "minecraft:flowing_water" },
      },
    },
    entities: {
      components: {
        tameable: { id: "minecraft:tameable" },
        rideable: { id: "minecraft:rideable" },
      },
      global_ids: {
        player: "minecraft:player",
        arrow: "minecraft:arrow",
      },
      global_properties: {
        state: `${namespace}:state`,
        rotation: `${namespace}:rotation`,
        rotation_locked: `${namespace}:rotation_locked`,
        attack_type: `${namespace}:attack_type`,
        attack_type2: `${namespace}:attack_type2`,
        has_target: `${namespace}:has_target`,
        dead: `${namespace}:dead`,
        cooldown_ticks: `${namespace}:cooldown_ticks`,
        last_hit_by_player: `${namespace}:last_hit_by_player`,
        target_id: `${namespace}:target_id`,
        owner_id: `${namespace}:owner_id`,
        difficulty: `${namespace}:difficulty`,
      },
      global_dynamic_properties: {
        /** When set on an entity, its attack cooldown stops counting down. */
        attack_cooldown_paused: `${namespace}:attack_cooldown_paused`,
        spawned_position: `${namespace}:spawnedPos`,
      },
      global_states: {
        none: "none",
        preparing_attack: "preparing_attack",
        attacking: "attacking",
      },
      global_events: {
        death: `${namespace}:death`,
        despawn: `${namespace}:despawn`,
        movement_off: `${namespace}:movement_off`,
        movement_on: `${namespace}:movement_on`,
        vulnerable: `${namespace}:vulnerable`,
        attack_start: `${namespace}:attack_start`,
        attack_end: `${namespace}:attack_end`,
        choose_attack: `${namespace}:choose_attack`,
        target_detected_v2: `${namespace}:target_detected_v2`,
        target_escaped_v2: `${namespace}:target_escaped_v2`,
      },
      global_tags: {
        projectile_entity: `${namespace}.projectile_entity`,
        projectile_stopped: `${namespace}_projectile_stopped`,
        projectile_stop_homing: `${namespace}_projectile_stop_homing`,
        projectile_returning: `${namespace}_projectile_returning`,
      },
      projectiles: {
        properties: {
          rotation: {
            x: `${namespace}:rotation_x`,
            y: `${namespace}:rotation_y`,
          },
        },
      },
      timers: {
        movement_failsafe: MOVEMENT_FAILSAFE_SECONDS * TICKS_PER_SECOND,
      },
      /** Falling-block entity spawned by `doBlockKnockup`. */
      block_jump: {
        id: `${namespace}:block_jump`,
        distance_property: `${namespace}:distance`,
      },
    },
    camera_system: {
      /**
       * Player tag set while a vanilla camera override is active.
       * Defaults to `<namespace>_vanilla_camera` when left unset.
       */
      vanilla_override_tag: undefined,
    },
    cutscenes: {
      /** Set `active_player` to tag players while a cutscene plays. */
      tags: {},
    },
    /** Named camera entries read by project gameplay cameras. */
    cameras: {},
    gameplay: {
      cameras: {},
    },
  };
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/**
 * Copy `source` into `target` in place. Plain objects are merged key by key;
 * everything else (arrays, class instances, primitives) replaces the old value.
 */
function mergeInto(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (isPlainObject(value) && isPlainObject(target[key])) {
      mergeInto(target[key], value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

/** Live settings object shared by every library. */
export const SETTINGS = buildDefaultSettings(DEFAULT_NAMESPACE);

/**
 * Set the project's namespace and setting overrides.
 * Call it once at startup, before importing the rest of the libraries.
 *
 * @param {Object} [options]
 * @param {string} [options.namespace] Namespace of the pack's identifiers, as in `my_pack:state`.
 * @param {Object} [options.settings] Values that override or extend the defaults.
 * @returns {Object} The shared `SETTINGS` object.
 */
export function configureLibrary({ namespace, settings } = {}) {
  if (namespace !== undefined) {
    if (typeof namespace !== "string" || namespace.length === 0) {
      throw new TypeError("configureLibrary: namespace must be a string.");
    }
    mergeInto(SETTINGS, buildDefaultSettings(namespace));
  }

  if (settings !== undefined) {
    if (!isPlainObject(settings)) {
      throw new TypeError("configureLibrary: settings must be an object.");
    }
    mergeInto(SETTINGS, settings);
  }

  libraryState.isConfigured = true;
  libraryState.version += 1;
  return SETTINGS;
}

/**
 * Whether `configureLibrary` has been called.
 * @returns {boolean}
 */
export function isLibraryConfigured() {
  return libraryState.isConfigured;
}

/**
 * A number that goes up every time `configureLibrary` runs. Libraries that
 * cache something derived from `SETTINGS` compare it to know when to rebuild.
 * @returns {number}
 */
export function getSettingsVersion() {
  return libraryState.version;
}
