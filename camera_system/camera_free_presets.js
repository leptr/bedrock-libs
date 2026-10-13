// Developed by: Petar Mijailovic (leptr)
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

/**
 * Free Camera Configuration Presets
 * Pre-configured settings for common camera modes.
 */

import { system } from "@minecraft/server";

import {
  CAMERA_BLEND_THRESHOLD,
  CAMERA_EASE_TYPES,
  CAMERA_FOLLOW_MODES,
} from "./constants.js";

const FREE_CAMERA_PRESET_VALUES = Object.freeze({
  distances: {
    closeUp: 2,
    minimal: 3,
    combat: 5,
    standard: 6,
    rpg: 7,
    cinematic: 8,
    dramatic: 10,
    stealth: 12,
    overview: 20,
  },
  heights: {
    low: 0.3,
    exploration: 0.5,
    spectator: 1,
    thirdPerson: 1.2,
    overShoulder: 1.3,
    rpg: 1.4,
    cinematic: 1.5,
    combat: 1.8,
    dramatic: 2,
    stealth: 3,
    overview: 5,
    topDown: 6,
  },
  sideOffsets: {
    overShoulder: 1.5,
    dramatic: 5,
  },
  backOffsets: {
    thirdPerson: -1.5,
    overShoulder: -1,
  },
  easeTimes: {
    immediate: 0.05,
    fast: 0.1,
    responsive: 0.15,
    steady: 0.2,
    smooth: 0.3,
    dramatic: 0.4,
    cinematic: 0.5,
    pan: 1,
  },
  ranges: {
    closeUp: { min: 0.5, max: 8 },
    minimal: { min: 1, max: 8 },
    cinematic: { min: 1, max: 30 },
    spectator: { min: 1, max: 50 },
    exploration: { min: 2, max: 20 },
    combat: { min: 2, max: 12 },
    overShoulder: { min: 2, max: 12 },
    thirdPerson: { min: 3, max: 15 },
    rpg: { min: 3, max: 18 },
    topDown: { min: 5, max: 20 },
    dramatic: { min: 5, max: 25 },
    cinematicPan: { min: 5, max: 30 },
    stealth: { min: 8, max: 25 },
    overview: { min: 10, max: 50 },
  },
});

function createFreeCameraPreset(config) {
  return {
    sideOffset: 0,
    backOffset: 0,
    ...config,
  };
}

/**
 * @typedef {Object} FreeCameraPreset
 * @property {number} distance
 * @property {number} heightOffset
 * @property {number} sideOffset
 * @property {number} backOffset
 * @property {string} easeType
 * @property {number} easeTimeSeconds
 * @property {boolean} disablePlayerInput
 * @property {string} followMode
 * @property {number} minDistance
 * @property {number} maxDistance
 */

/** Pre-configured free camera presets keyed by name. */
export const FREE_CAMERA_PRESETS = {
  /**
   * Default exploration camera - balanced for casual exploration
   */
  exploration: {
    ...createFreeCameraPreset({
      distance: FREE_CAMERA_PRESET_VALUES.distances.standard,
      heightOffset: FREE_CAMERA_PRESET_VALUES.heights.exploration,
      easeType: CAMERA_EASE_TYPES.OUT_CUBIC,
      easeTimeSeconds: FREE_CAMERA_PRESET_VALUES.easeTimes.fast,
      disablePlayerInput: false,
      followMode: CAMERA_FOLLOW_MODES.CENTERED,
      minDistance: FREE_CAMERA_PRESET_VALUES.ranges.exploration.min,
      maxDistance: FREE_CAMERA_PRESET_VALUES.ranges.exploration.max,
    }),
  },

  /**
   * Third-person action camera - behind the player, follows their rotation
   */
  thirdPerson: {
    ...createFreeCameraPreset({
      distance: FREE_CAMERA_PRESET_VALUES.distances.standard,
      heightOffset: FREE_CAMERA_PRESET_VALUES.heights.thirdPerson,
      backOffset: FREE_CAMERA_PRESET_VALUES.backOffsets.thirdPerson,
      easeType: CAMERA_EASE_TYPES.OUT_CUBIC,
      easeTimeSeconds: FREE_CAMERA_PRESET_VALUES.easeTimes.responsive,
      disablePlayerInput: true,
      followMode: CAMERA_FOLLOW_MODES.PLAYER_ROTATED,
      minDistance: FREE_CAMERA_PRESET_VALUES.ranges.thirdPerson.min,
      maxDistance: FREE_CAMERA_PRESET_VALUES.ranges.thirdPerson.max,
    }),
  },

  /**
   * Close-up inspection camera - for examining details
   */
  closeUp: {
    ...createFreeCameraPreset({
      distance: FREE_CAMERA_PRESET_VALUES.distances.closeUp,
      heightOffset: FREE_CAMERA_PRESET_VALUES.heights.low,
      easeType: CAMERA_EASE_TYPES.OUT_SINE,
      easeTimeSeconds: FREE_CAMERA_PRESET_VALUES.easeTimes.smooth,
      disablePlayerInput: false,
      followMode: CAMERA_FOLLOW_MODES.CENTERED,
      minDistance: FREE_CAMERA_PRESET_VALUES.ranges.closeUp.min,
      maxDistance: FREE_CAMERA_PRESET_VALUES.ranges.closeUp.max,
    }),
  },

  /**
   * Long-distance observer - for wide overview shots
   */
  overview: {
    ...createFreeCameraPreset({
      distance: FREE_CAMERA_PRESET_VALUES.distances.overview,
      heightOffset: FREE_CAMERA_PRESET_VALUES.heights.overview,
      easeType: CAMERA_EASE_TYPES.OUT_CUBIC,
      easeTimeSeconds: FREE_CAMERA_PRESET_VALUES.easeTimes.cinematic,
      disablePlayerInput: false,
      followMode: CAMERA_FOLLOW_MODES.CENTERED,
      minDistance: FREE_CAMERA_PRESET_VALUES.ranges.overview.min,
      maxDistance: FREE_CAMERA_PRESET_VALUES.ranges.overview.max,
    }),
  },

  /**
   * Cinematic locked camera - for cutscenes and story moments
   */
  cinematic: {
    ...createFreeCameraPreset({
      distance: FREE_CAMERA_PRESET_VALUES.distances.cinematic,
      heightOffset: FREE_CAMERA_PRESET_VALUES.heights.cinematic,
      easeType: CAMERA_EASE_TYPES.OUT_CUBIC,
      easeTimeSeconds: FREE_CAMERA_PRESET_VALUES.easeTimes.smooth,
      disablePlayerInput: true,
      followMode: CAMERA_FOLLOW_MODES.CENTERED,
      minDistance: FREE_CAMERA_PRESET_VALUES.ranges.cinematic.min,
      maxDistance: FREE_CAMERA_PRESET_VALUES.ranges.cinematic.max,
    }),
  },

  /**
   * High overhead perspective - top-down view
   */
  topDown: {
    ...createFreeCameraPreset({
      distance: FREE_CAMERA_PRESET_VALUES.distances.cinematic,
      heightOffset: FREE_CAMERA_PRESET_VALUES.heights.topDown,
      easeType: CAMERA_EASE_TYPES.LINEAR,
      easeTimeSeconds: FREE_CAMERA_PRESET_VALUES.easeTimes.steady,
      disablePlayerInput: true,
      followMode: CAMERA_FOLLOW_MODES.CENTERED,
      minDistance: FREE_CAMERA_PRESET_VALUES.ranges.topDown.min,
      maxDistance: FREE_CAMERA_PRESET_VALUES.ranges.topDown.max,
    }),
  },

  /**
   * Dramatic side-angle camera - for emphasizing surroundings
   */
  dramatic: {
    ...createFreeCameraPreset({
      distance: FREE_CAMERA_PRESET_VALUES.distances.dramatic,
      heightOffset: FREE_CAMERA_PRESET_VALUES.heights.dramatic,
      sideOffset: FREE_CAMERA_PRESET_VALUES.sideOffsets.dramatic,
      easeType: CAMERA_EASE_TYPES.IN_OUT_CUBIC,
      easeTimeSeconds: FREE_CAMERA_PRESET_VALUES.easeTimes.dramatic,
      disablePlayerInput: true,
      followMode: CAMERA_FOLLOW_MODES.CENTERED,
      minDistance: FREE_CAMERA_PRESET_VALUES.ranges.dramatic.min,
      maxDistance: FREE_CAMERA_PRESET_VALUES.ranges.dramatic.max,
    }),
  },

  /**
   * Shoulder camera - slightly over-shoulder third-person
   */
  overShoulder: {
    ...createFreeCameraPreset({
      distance: FREE_CAMERA_PRESET_VALUES.distances.combat,
      heightOffset: FREE_CAMERA_PRESET_VALUES.heights.overShoulder,
      sideOffset: FREE_CAMERA_PRESET_VALUES.sideOffsets.overShoulder,
      backOffset: FREE_CAMERA_PRESET_VALUES.backOffsets.overShoulder,
      easeType: CAMERA_EASE_TYPES.OUT_CUBIC,
      easeTimeSeconds: FREE_CAMERA_PRESET_VALUES.easeTimes.responsive,
      disablePlayerInput: true,
      followMode: CAMERA_FOLLOW_MODES.PLAYER_ROTATED,
      minDistance: FREE_CAMERA_PRESET_VALUES.ranges.overShoulder.min,
      maxDistance: FREE_CAMERA_PRESET_VALUES.ranges.overShoulder.max,
    }),
  },

  /**
   * RPG follow camera - moderately close with good viewing angle
   */
  rpg: {
    ...createFreeCameraPreset({
      distance: FREE_CAMERA_PRESET_VALUES.distances.rpg,
      heightOffset: FREE_CAMERA_PRESET_VALUES.heights.rpg,
      easeType: CAMERA_EASE_TYPES.OUT_CUBIC,
      easeTimeSeconds: FREE_CAMERA_PRESET_VALUES.easeTimes.responsive,
      disablePlayerInput: false,
      followMode: CAMERA_FOLLOW_MODES.CENTERED,
      minDistance: FREE_CAMERA_PRESET_VALUES.ranges.rpg.min,
      maxDistance: FREE_CAMERA_PRESET_VALUES.ranges.rpg.max,
    }),
  },

  /**
   * Combat camera - optimized for action sequences
   */
  combat: {
    ...createFreeCameraPreset({
      distance: FREE_CAMERA_PRESET_VALUES.distances.combat,
      heightOffset: FREE_CAMERA_PRESET_VALUES.heights.combat,
      easeType: CAMERA_EASE_TYPES.OUT_QUAD,
      easeTimeSeconds: FREE_CAMERA_PRESET_VALUES.easeTimes.fast,
      disablePlayerInput: true,
      followMode: CAMERA_FOLLOW_MODES.PLAYER_ROTATED,
      minDistance: FREE_CAMERA_PRESET_VALUES.ranges.combat.min,
      maxDistance: FREE_CAMERA_PRESET_VALUES.ranges.combat.max,
    }),
  },

  /**
   * Stealth/tactical camera - wider view with locked player input
   */
  stealth: {
    ...createFreeCameraPreset({
      distance: FREE_CAMERA_PRESET_VALUES.distances.stealth,
      heightOffset: FREE_CAMERA_PRESET_VALUES.heights.stealth,
      easeType: CAMERA_EASE_TYPES.LINEAR,
      easeTimeSeconds: FREE_CAMERA_PRESET_VALUES.easeTimes.steady,
      disablePlayerInput: true,
      followMode: CAMERA_FOLLOW_MODES.CENTERED,
      minDistance: FREE_CAMERA_PRESET_VALUES.ranges.stealth.min,
      maxDistance: FREE_CAMERA_PRESET_VALUES.ranges.stealth.max,
    }),
  },

  /**
   * Spectator mode - free exploration without locked input
   */
  spectator: {
    ...createFreeCameraPreset({
      distance: FREE_CAMERA_PRESET_VALUES.distances.cinematic,
      heightOffset: FREE_CAMERA_PRESET_VALUES.heights.spectator,
      easeType: CAMERA_EASE_TYPES.LINEAR,
      easeTimeSeconds: FREE_CAMERA_PRESET_VALUES.easeTimes.immediate,
      disablePlayerInput: false,
      followMode: CAMERA_FOLLOW_MODES.CENTERED,
      minDistance: FREE_CAMERA_PRESET_VALUES.ranges.spectator.min,
      maxDistance: FREE_CAMERA_PRESET_VALUES.ranges.spectator.max,
    }),
  },

  /**
   * Minimalist camera - closest to player perspective
   */
  minimal: {
    ...createFreeCameraPreset({
      distance: FREE_CAMERA_PRESET_VALUES.distances.minimal,
      heightOffset: 0,
      easeType: CAMERA_EASE_TYPES.LINEAR,
      easeTimeSeconds: FREE_CAMERA_PRESET_VALUES.easeTimes.immediate,
      disablePlayerInput: false,
      followMode: CAMERA_FOLLOW_MODES.PLAYER_ROTATED,
      minDistance: FREE_CAMERA_PRESET_VALUES.ranges.minimal.min,
      maxDistance: FREE_CAMERA_PRESET_VALUES.ranges.minimal.max,
    }),
  },

  /**
   * Cinematic pan camera - optimized for smooth pans
   */
  cinematicPan: {
    ...createFreeCameraPreset({
      distance: FREE_CAMERA_PRESET_VALUES.distances.stealth,
      heightOffset: FREE_CAMERA_PRESET_VALUES.heights.dramatic,
      easeType: CAMERA_EASE_TYPES.IN_OUT_SINE,
      easeTimeSeconds: FREE_CAMERA_PRESET_VALUES.easeTimes.pan,
      disablePlayerInput: true,
      followMode: CAMERA_FOLLOW_MODES.CENTERED,
      minDistance: FREE_CAMERA_PRESET_VALUES.ranges.cinematicPan.min,
      maxDistance: FREE_CAMERA_PRESET_VALUES.ranges.cinematicPan.max,
    }),
  },
};

/**
 * Get a preset by name.
 * Falls back to the `exploration` preset if the name is unknown.
 *
 * @param {string} name Preset name
 * @returns {FreeCameraPreset}
 */
export function getFreeCameraPreset(name) {
  return FREE_CAMERA_PRESETS[name] || FREE_CAMERA_PRESETS.exploration;
}

/**
 * Create a custom preset by blending two presets.
 *
 * @param {string} presetA First preset name
 * @param {string} presetB Second preset name
 * @param {number} blend Blend factor (0-1, 0 = presetA, 1 = presetB)
 * @returns {FreeCameraPreset}
 */
export function blendFreeCameraPresets(presetA, presetB, blend) {
  const configA = getFreeCameraPreset(presetA);
  const configB = getFreeCameraPreset(presetB);

  const t = Math.max(0, Math.min(1, blend));
  const invT = 1 - t;

  return {
    distance: configA.distance * invT + configB.distance * t,
    heightOffset: configA.heightOffset * invT + configB.heightOffset * t,
    sideOffset: configA.sideOffset * invT + configB.sideOffset * t,
    backOffset: configA.backOffset * invT + configB.backOffset * t,
    easeType: t < CAMERA_BLEND_THRESHOLD ? configA.easeType : configB.easeType,
    easeTimeSeconds:
      configA.easeTimeSeconds * invT + configB.easeTimeSeconds * t,
    disablePlayerInput:
      t < CAMERA_BLEND_THRESHOLD
        ? configA.disablePlayerInput
        : configB.disablePlayerInput,
    followMode:
      t < CAMERA_BLEND_THRESHOLD ? configA.followMode : configB.followMode,
    minDistance: configA.minDistance * invT + configB.minDistance * t,
    maxDistance: configA.maxDistance * invT + configB.maxDistance * t,
  };
}

/**
 * Preset usage examples
 */
export const PRESET_EXAMPLES = {
  useExploration(CameraSystem, player) {
    return CameraSystem.startFreeCamera(
      player,
      getFreeCameraPreset("exploration"),
    );
  },

  useThirdPerson(CameraSystem, player) {
    return CameraSystem.startFreeCamera(
      player,
      getFreeCameraPreset("thirdPerson"),
    );
  },

  useCinematic(CameraSystem, player) {
    return CameraSystem.startFreeCamera(
      player,
      getFreeCameraPreset("cinematic"),
    );
  },

  useTopDown(CameraSystem, player) {
    return CameraSystem.startFreeCamera(player, getFreeCameraPreset("topDown"));
  },

  useCombat(CameraSystem, player) {
    return CameraSystem.startFreeCamera(player, getFreeCameraPreset("combat"));
  },

  // Transition between presets
  transitionPreset(freeCamera, fromPreset, toPreset, durationSeconds = 1) {
    const steps = Math.round(durationSeconds * 20); // Assuming 20 ticks per second
    let step = 0;

    const runId = system.runInterval(() => {
      step += 1;
      const blend = step / steps;
      const config = blendFreeCameraPresets(fromPreset, toPreset, blend);

      freeCamera.setDistance(config.distance);
      freeCamera.updateOffset(
        config.backOffset,
        config.heightOffset,
        config.sideOffset,
      );

      if (step >= steps) {
        system.clearRun(runId);
        // Apply final config
        const finalConfig = getFreeCameraPreset(toPreset);
        freeCamera.setInputLocked(finalConfig.disablePlayerInput);
        freeCamera.setFollowMode(finalConfig.followMode);
      }
    }, 1);
  },
};
