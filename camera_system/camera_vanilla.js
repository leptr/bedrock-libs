// Developed by: Petar Mijailovic (leptr)
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

/**
 * Helpers for transitioning between this library's free-camera controls and
 * Bedrock's built-in vanilla camera presets.
 */

import {
  CAMERA_EASE_TYPES,
  CAMERA_FOLLOW_MODES,
  CAMERA_PRESET_IDS,
} from "./constants.js";
import { SETTINGS } from "../game_settings.js";

/** Canonical vanilla preset ids supported by the camera bridge. */
export const VANILLA_CAMERA_PRESET_IDS = {
  FIRST_PERSON: "minecraft:first_person",
  THIRD_PERSON: "minecraft:third_person",
  THIRD_PERSON_FRONT: "minecraft:third_person_front",
};

/**
 * Player tag used while this system owns a vanilla camera override.
 * Built from the pack's namespace so two packs in one world do not share it.
 * @returns {string}
 */
export function getVanillaCameraOverrideTag() {
  return (
    SETTINGS.camera_system?.vanilla_override_tag ??
    `${SETTINGS.general.namespace}_vanilla_camera`
  );
}

const VANILLA_CAMERA_EASE_TIME_SECONDS = 0.2;
const VANILLA_THIRD_PERSON_DISTANCE = 4;
const VANILLA_FIRST_PERSON_DISTANCE = 0.01;
const VANILLA_CAMERA_COLLISION_STEP = 0.2;
const VANILLA_CAMERA_COLLISION_PADDING = 0.25;
const FIRST_PERSON_CAMERA_COLLISION_PADDING = 0.05;
const VANILLA_ORBIT_PITCH_LIMIT = 89;

function normalizeId(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toLowerCase();
}

/**
 * Resolves user-friendly ids into official vanilla preset ids.
 * Accepts e.g. `first_person`, `third_person_front`, or full `minecraft:*` ids.
 * @param {string} input
 * @returns {string|undefined}
 */
export function resolveVanillaCameraId(input) {
  const id = normalizeId(input);
  if (!id) {
    return undefined;
  }

  if (id === VANILLA_CAMERA_PRESET_IDS.FIRST_PERSON) {
    return VANILLA_CAMERA_PRESET_IDS.FIRST_PERSON;
  }
  if (id === VANILLA_CAMERA_PRESET_IDS.THIRD_PERSON) {
    return VANILLA_CAMERA_PRESET_IDS.THIRD_PERSON;
  }
  if (id === VANILLA_CAMERA_PRESET_IDS.THIRD_PERSON_FRONT) {
    return VANILLA_CAMERA_PRESET_IDS.THIRD_PERSON_FRONT;
  }

  if (["first_person", "firstperson", "first"].includes(id)) {
    return VANILLA_CAMERA_PRESET_IDS.FIRST_PERSON;
  }
  if (["third_person", "thirdperson", "third"].includes(id)) {
    return VANILLA_CAMERA_PRESET_IDS.THIRD_PERSON;
  }
  if (
    [
      "third_person_front",
      "thirdpersonfront",
      "third_front",
      "front",
      "front_third",
    ].includes(id)
  ) {
    return VANILLA_CAMERA_PRESET_IDS.THIRD_PERSON_FRONT;
  }

  return undefined;
}

/**
 * Returns a free-camera config that mimics a vanilla camera mode.
 * Use this to ease a player into a pose that matches a vanilla preset before
 * switching to the actual preset.
 *
 * @param {string} vanillaPresetId Must be a resolved id from resolveVanillaCameraId.
 * @returns {Object}
 */
export function getFreeCameraMimicConfigForVanilla(vanillaPresetId) {
  const base = {
    preset: CAMERA_PRESET_IDS.FREE,
    followMode: CAMERA_FOLLOW_MODES.PLAYER_ROTATED,
    useHeadLocationForPosition: true,
    disablePlayerInput: false,
    easeType: CAMERA_EASE_TYPES.OUT_CUBIC,
    easeTimeSeconds: VANILLA_CAMERA_EASE_TIME_SECONDS,
    focusTarget: false,
    distance: VANILLA_THIRD_PERSON_DISTANCE,
    heightOffset: 0,
    sideOffset: 0,
    backOffset: 0,
    minOrbitPitch: -VANILLA_ORBIT_PITCH_LIMIT,
    maxOrbitPitch: VANILLA_ORBIT_PITCH_LIMIT,
  };

  if (vanillaPresetId === VANILLA_CAMERA_PRESET_IDS.FIRST_PERSON) {
    return {
      ...base,
      distance: VANILLA_FIRST_PERSON_DISTANCE,
      backOffset: 0,
      avoidBlockClipping: false,
      cameraCollisionPadding: FIRST_PERSON_CAMERA_COLLISION_PADDING,
      cameraCollisionStep: VANILLA_CAMERA_COLLISION_STEP,
      focusTarget: false,
    };
  }

  if (vanillaPresetId === VANILLA_CAMERA_PRESET_IDS.THIRD_PERSON_FRONT) {
    const distance = VANILLA_THIRD_PERSON_DISTANCE;
    return {
      ...base,
      distance,
      backOffset: distance * 2,
      focusTarget: true,
      avoidBlockClipping: true,
      cameraCollisionPadding: VANILLA_CAMERA_COLLISION_PADDING,
      cameraCollisionStep: VANILLA_CAMERA_COLLISION_STEP,
    };
  }

  return {
    ...base,
    distance: VANILLA_THIRD_PERSON_DISTANCE,
    focusTarget: false,
    avoidBlockClipping: true,
    cameraCollisionPadding: VANILLA_CAMERA_COLLISION_PADDING,
    cameraCollisionStep: VANILLA_CAMERA_COLLISION_STEP,
  };
}
