// Developed by: Petar Mijailovic (leptr)
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

/**
 * Runtime for executing camera timelines against a bound player.
 */

import {
  EasingType,
  HudElement,
  HudVisibility,
  system,
  TicksPerSecond,
  world,
} from "@minecraft/server";
import {
  AngleOffset,
  DirectionalOffset,
  disablePlayerCamera,
  disablePlayerMovement,
  enablePlayerCamera,
  enablePlayerMovement,
  findNearestAir,
  resolveAngleTheta,
  resolveDirectionalOffsetValue,
  rotationRelativeOffset,
  toDirectionalOffset,
} from "../toolkit/toolkit.js";
import { BVector2, BVector3 } from "../better_vectors/better_vectors.js";
import { SETTINGS } from "../game_settings.js";
import { EffectRegistry } from "../toolkit/effect_registry.js";
import {
  CAMERA_EASE_MODES,
  CAMERA_EASE_TYPES,
  CAMERA_FOLLOW_MODE_PRESERVATION_TYPES,
  CAMERA_PRESET_IDS,
  TARGET_POINT_MODES,
  CAMERA_BLEND_MODES,
  CAMERA_LOCATION_SOURCES,
  CAMERA_RIG_TYPES,
  CAMERA_FOLLOW_MODES,
  CAMERA_SHAKE_DEFAULTS,
} from "./constants.js";
import {
  getFreeCameraMimicConfigForVanilla,
  resolveVanillaCameraId,
  getVanillaCameraOverrideTag,
} from "./camera_vanilla.js";
import { FreeCamera } from "./camera_free.js";
import { logIgnoredError } from "../utils/logger.js";

const lastRotationByPlayerId = new Map();
const lastLocationByPlayerId = new Map();

const cameraActionSessionByPlayerKey = new Map();
const hudElementByToken = buildHudElementTokenMap();
const CAMERA_ROTATION_EPSILON = 0.001;
const FULL_TURN_DEGREES = 360;
const FULL_TURN_NORMALIZATION_EPSILON = 0.0001;
const LARGE_ROTATION_ARC_THRESHOLD = 179.999;
const FULL_TURN_THRESHOLD = 359.999;
const FULL_TURN_FALLBACK = 359.99;
const SINGLE_TICK = 1;
const ZERO_SECONDS = 0;
const SUBTITLE_FIELDS = ["actionbar", "title", "subtitle"];
const SUBTITLE_TITLE_STAY_DURATION = TicksPerSecond * 60 * 60;
const TRANSIENT_CAMERA_TRACK_KEYS = new Set([
  "clear",
  "fade",
  "fov",
  "fovRamp",
  "shake",
  "shakes",
  "hud",
  "rotate",
  "setDefault",
  "preserveRotation",
]);
const TRANSIENT_CAMERA_SET_OPTION_KEYS = new Set(["easeOptions"]);

function getCutsceneActivePlayerTag() {
  const tag = SETTINGS?.cutscenes?.tags?.active_player;
  return typeof tag === "string" && tag.length > 0 ? tag : undefined;
}

function addCutsceneActivePlayerTag(player) {
  const tag = getCutsceneActivePlayerTag();
  if (!player?.isValid || !tag) {
    return;
  }

  try {
    if (!player.hasTag?.(tag)) {
      player.addTag?.(tag);
    }
  } catch (error) {
    logIgnoredError(
      "camera_system/camera_runtime:addCutsceneActivePlayerTag",
      error,
    );
  }
}

function removeCutsceneActivePlayerTag(player) {
  const tag = getCutsceneActivePlayerTag();
  if (!player?.isValid || !tag) {
    return;
  }

  try {
    if (player.hasTag?.(tag)) {
      player.removeTag?.(tag);
    }
  } catch (error) {
    logIgnoredError(
      "camera_system/camera_runtime:removeCutsceneActivePlayerTag",
      error,
    );
  }
}

function normalizeHudElementToken(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replaceAll(/[\s\-_]+/gu, "");
}

function buildHudElementTokenMap() {
  const map = new Map();
  const hudElements = HudElement || {};

  for (const [key, value] of Object.entries(hudElements)) {
    if (typeof value !== "string" && typeof value !== "number") {
      continue;
    }
    map.set(normalizeHudElementToken(key), value);
    map.set(normalizeHudElementToken(value), value);
  }

  for (const value of Object.values(hudElements)) {
    if (typeof value !== "string" && typeof value !== "number") {
      continue;
    }
    map.set(normalizeHudElementToken(value), value);
  }

  return map;
}

function resolveHudElementValue(value) {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }

  return hudElementByToken.get(normalizeHudElementToken(value));
}

function applyHudVisibility(player, elements, visibility, runtime, logger) {
  if (
    !player?.onScreenDisplay ||
    !Array.isArray(elements) ||
    elements.length === 0
  ) {
    return;
  }

  try {
    player.onScreenDisplay.setHudVisibility(visibility, elements);
    if (runtime) {
      if (!(runtime.hiddenHudElements instanceof Set)) {
        runtime.hiddenHudElements = new Set();
      }

      if (visibility === HudVisibility.Hide) {
        for (const element of elements) {
          runtime.hiddenHudElements.add(element);
        }
      } else if (visibility === HudVisibility.Reset) {
        for (const element of elements) {
          runtime.hiddenHudElements.delete(element);
        }
      } else {
        // do nothing
      }
    }
  } catch (error) {
    logger?.warn?.("CAMERA", "camera hud visibility failed", error);
  }
}

function hideAllHud(player, runtime, logger) {
  if (!player?.onScreenDisplay) {
    return;
  }

  try {
    player.onScreenDisplay.setHudVisibility(HudVisibility.Hide);
    if (runtime) {
      runtime.hudAllHidden = true;
      if (!(runtime.hiddenHudElements instanceof Set)) {
        runtime.hiddenHudElements = new Set();
      }
      runtime.hiddenHudElements.clear();
    }
  } catch (error) {
    logger?.warn?.("CAMERA", "camera hud hide-all failed", error);
  }
}

function resetAllHud(player, runtime, logger) {
  if (!player?.onScreenDisplay) {
    return;
  }

  try {
    player.onScreenDisplay.resetHudElementsVisibility();
    if (runtime) {
      runtime.hudAllHidden = false;
      if (!(runtime.hiddenHudElements instanceof Set)) {
        runtime.hiddenHudElements = new Set();
      }
      runtime.hiddenHudElements.clear();
    }
  } catch (error) {
    logger?.warn?.("CAMERA", "camera hud reset-all failed", error);
  }
}

function applyCameraHudConfig(player, hudConfig, runtime, logger) {
  if (!player?.onScreenDisplay || hudConfig === undefined) {
    return;
  }

  if (hudConfig === false) {
    if (runtime?.hudAllHidden) {
      resetAllHud(player, runtime, logger);
      return;
    }

    const hidden = runtime?.hiddenHudElements
      ? [...runtime.hiddenHudElements]
      : [];
    applyHudVisibility(player, hidden, HudVisibility.Reset, runtime, logger);
    return;
  }

  if (!hudConfig || typeof hudConfig !== "object") {
    return;
  }

  if (!(runtime?.hiddenHudElements instanceof Set)) {
    runtime.hiddenHudElements = new Set();
  }

  const hidden = [];
  const reset = [];

  if (hudConfig.all === true) {
    hideAllHud(player, runtime, logger);
  } else if (hudConfig.all === false) {
    resetAllHud(player, runtime, logger);
  } else {
    // do nothing
  }

  for (const [key, value] of Object.entries(hudConfig)) {
    if (key === "all") {
      continue;
    }

    const element = resolveHudElementValue(key);
    if (element === undefined) {
      continue;
    }

    if (value === true) {
      hidden.push(element);
    } else if (value === false) {
      reset.push(element);
    } else {
      // do nothing
    }
  }

  const hiddenElements = [...new Set(hidden)];
  const resetElements = [...new Set(reset)].filter(
    element => !hiddenElements.includes(element),
  );

  applyHudVisibility(
    player,
    hiddenElements,
    HudVisibility.Hide,
    runtime,
    logger,
  );
  applyHudVisibility(
    player,
    resetElements,
    HudVisibility.Reset,
    runtime,
    logger,
  );
}

function resetCutsceneHud(player, runtime, logger) {
  if (runtime?.hudAllHidden) {
    resetAllHud(player, runtime, logger);
    return;
  }

  const hidden = runtime?.hiddenHudElements
    ? [...runtime.hiddenHudElements]
    : [];
  applyHudVisibility(player, hidden, HudVisibility.Reset, runtime, logger);
}

function cloneSubtitleState(state) {
  if (!state || typeof state !== "object") {
    return {};
  }

  const cloned = {};
  for (const field of SUBTITLE_FIELDS) {
    const value = state[field];
    if (value !== undefined) {
      cloned[field] = value;
    }
  }

  return cloned;
}

function isSubtitleMessagePayload(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeSubtitleMessage(value) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || value === false) {
    return null;
  }

  if (typeof value === "string") {
    return { text: value };
  }

  if (!isSubtitleMessagePayload(value)) {
    return undefined;
  }

  if (value.clear === true) {
    return null;
  }

  if (value.text !== undefined) {
    return { text: value.text, with: value.with };
  }

  if (value.translate !== undefined) {
    return { translate: value.translate, with: value.with };
  }

  return null;
}

function normalizeSubtitlesTrack(subtitlesData) {
  if (subtitlesData === undefined) {
    return undefined;
  }

  if (subtitlesData === null || subtitlesData === false) {
    return {
      clearOtherFields: true,
      actionbar: null,
      title: null,
      subtitle: null,
    };
  }

  if (typeof subtitlesData === "string") {
    return {
      clearOtherFields: true,
      actionbar: { text: subtitlesData },
    };
  }

  if (!isSubtitleMessagePayload(subtitlesData)) {
    return undefined;
  }

  const normalized = {
    clearOtherFields: subtitlesData.clearOtherFields !== false,
  };

  const actionbarMessage = normalizeSubtitleMessage(
    subtitlesData.actionbar && typeof subtitlesData.actionbar === "object"
      ? subtitlesData.actionbar
      : subtitlesData.text !== undefined ||
          subtitlesData.translate !== undefined
        ? {
            text: subtitlesData.text,
            translate: subtitlesData.translate,
            with: subtitlesData.with,
          }
        : subtitlesData.actionbar,
  );
  const titleMessage = normalizeSubtitleMessage(subtitlesData.title);
  const subtitleMessage = normalizeSubtitleMessage(subtitlesData.subtitle);

  if (actionbarMessage !== undefined) {
    normalized.actionbar = actionbarMessage;
  }
  if (titleMessage !== undefined) {
    normalized.title = titleMessage;
  }
  if (subtitleMessage !== undefined) {
    normalized.subtitle = subtitleMessage;
  }

  return normalized;
}

function subtitleStateHasAnyField(state) {
  if (!state || typeof state !== "object") {
    return false;
  }

  return SUBTITLE_FIELDS.some(field => state[field] !== undefined);
}

function mergeSubtitleState(baseState, subtitlesTrack) {
  const shouldClearOtherFields = subtitlesTrack?.clearOtherFields !== false;
  const nextState = shouldClearOtherFields ? {} : cloneSubtitleState(baseState);

  for (const field of SUBTITLE_FIELDS) {
    if (subtitlesTrack?.[field] === undefined) {
      continue;
    }

    if (subtitlesTrack[field] === null) {
      delete nextState[field];
      continue;
    }

    nextState[field] = subtitlesTrack[field];
  }

  return nextState;
}

function getSubtitleStateBeforeIndex(index, orderedKeyframes) {
  let state = {};
  if (!Array.isArray(orderedKeyframes) || orderedKeyframes.length === 0) {
    return state;
  }

  for (let index_ = 0; index_ < index; index_ += 1) {
    const entry = orderedKeyframes[index_];
    const tracks = resolveTrackData(entry?.data || {});
    const subtitlesTrack = tracks?.subtitles;
    if (!subtitlesTrack) {
      continue;
    }

    state = mergeSubtitleState(state, subtitlesTrack);
  }

  return state;
}

function getSubtitleStateForEntry(runtime, index, orderedKeyframes) {
  const lastProcessedIndex = runtime?.lastProcessedKeyframeIndex;
  if (
    typeof lastProcessedIndex === "number" &&
    lastProcessedIndex === index - 1
  ) {
    return cloneSubtitleState(runtime?.currentSubtitleState);
  }

  return getSubtitleStateBeforeIndex(index, orderedKeyframes);
}

function resolveRawScreenMessage(message) {
  if (!message || typeof message !== "object") {
    return "";
  }

  if (message.text !== undefined) {
    return String(message.text ?? "");
  }

  if (message.translate !== undefined) {
    const resolved = {
      translate: String(message.translate),
    };

    if (Array.isArray(message.with)) {
      resolved.with = message.with;
    }

    return resolved;
  }

  return "";
}

function clearActionBar(player, logger) {
  if (!player?.onScreenDisplay) {
    return;
  }

  try {
    player.onScreenDisplay.setActionBar("");
  } catch (error) {
    logger?.warn?.("CAMERA", "subtitle actionbar clear failed", error);
  }
}

function scheduleDeferredActionBarClear(player, logger) {
  if (!player?.onScreenDisplay) {
    return;
  }

  const activePlayerTag = getCutsceneActivePlayerTag();
  const clearTicks = [1, 2];

  for (const delayTicks of clearTicks) {
    system.runTimeout(() => {
      if (!player?.isValid || !player?.onScreenDisplay) {
        return;
      }

      try {
        if (activePlayerTag && player.hasTag?.(activePlayerTag)) {
          return;
        }
      } catch (error) {
        logIgnoredError(
          "camera_system/camera_runtime:scheduleDeferredActionBarClear",
          error,
        );
      }

      try {
        player.onScreenDisplay.setActionBar("");
      } catch (error) {
        logger?.warn?.(
          "CAMERA",
          "subtitle deferred actionbar clear failed",
          error,
        );
      }
    }, delayTicks);
  }
}

function applyActionBarSubtitle(player, message, logger) {
  if (!player?.onScreenDisplay) {
    return;
  }

  try {
    player.onScreenDisplay.setActionBar(resolveRawScreenMessage(message));
  } catch (error) {
    logger?.warn?.("CAMERA", "subtitle actionbar update failed", error);
  }
}

function applyTitleSubtitleFields(player, state, logger) {
  if (!player?.onScreenDisplay) {
    return;
  }

  const hasTitle = state?.title !== undefined;
  const hasSubtitle = state?.subtitle !== undefined;

  try {
    if (!hasTitle && !hasSubtitle) {
      player.onScreenDisplay.setTitle("", {
        fadeInDuration: 0,
        stayDuration: 0,
        fadeOutDuration: 0,
        subtitle: "",
      });
      return;
    }

    player.onScreenDisplay.setTitle(resolveRawScreenMessage(state?.title), {
      fadeInDuration: 0,
      stayDuration: SUBTITLE_TITLE_STAY_DURATION,
      fadeOutDuration: 0,
      subtitle: resolveRawScreenMessage(state?.subtitle),
    });
  } catch (error) {
    logger?.warn?.("CAMERA", "subtitle title/subtitle update failed", error);
  }
}

function buildExplicitSubtitleState(previousState, nextState, subtitlesTrack) {
  const shouldClearOtherFields = subtitlesTrack?.clearOtherFields !== false;
  if (shouldClearOtherFields) {
    return cloneSubtitleState(nextState);
  }

  const resolvedState = cloneSubtitleState(previousState);

  for (const field of SUBTITLE_FIELDS) {
    if (subtitlesTrack?.[field] === undefined) {
      continue;
    }

    if (nextState?.[field] === undefined) {
      delete resolvedState[field];
      continue;
    }

    resolvedState[field] = nextState[field];
  }

  return resolvedState;
}

function applyExplicitSubtitleTrack(
  player,
  previousState,
  nextState,
  subtitlesTrack,
  logger,
) {
  if (!player?.onScreenDisplay) {
    return buildExplicitSubtitleState(previousState, nextState, subtitlesTrack);
  }

  const shouldClearOtherFields = subtitlesTrack?.clearOtherFields !== false;
  const resolvedState = buildExplicitSubtitleState(
    previousState,
    nextState,
    subtitlesTrack,
  );

  if (shouldClearOtherFields || subtitlesTrack?.actionbar !== undefined) {
    if (resolvedState.actionbar === undefined) {
      clearActionBar(player, logger);
    } else {
      applyActionBarSubtitle(player, resolvedState.actionbar, logger);
    }
  }

  if (
    shouldClearOtherFields ||
    subtitlesTrack?.title !== undefined ||
    subtitlesTrack?.subtitle !== undefined
  ) {
    applyTitleSubtitleFields(player, resolvedState, logger);
  }

  return resolvedState;
}

function refreshPersistentSubtitleState(runtime, player) {
  if (runtime?.mutedTracks?.has("subtitles")) {
    return;
  }

  const subtitleState = runtime?.currentSubtitleState;
  if (!subtitleStateHasAnyField(subtitleState)) {
    return;
  }

  if (subtitleState.actionbar !== undefined) {
    applyActionBarSubtitle(player, subtitleState.actionbar, runtime?.logger);
  }
}

function clearSubtitleDisplay(
  player,
  logger,
  { deferActionBarClear = false } = {},
) {
  if (!player?.onScreenDisplay) {
    return;
  }

  clearActionBar(player, logger);
  if (deferActionBarClear) {
    scheduleDeferredActionBarClear(player, logger);
  }
  applyTitleSubtitleFields(player, {}, logger);
}

function getPlayerKey(player) {
  if (!player) {
    return "unknown";
  }
  return (
    player.id ||
    player.name ||
    player.nameTag ||
    (typeof player === "string" ? player : "unknown")
  );
}

function cameraTrackHasPose(cameraTrack) {
  if (!cameraTrack || typeof cameraTrack !== "object") {
    return false;
  }

  if (cameraTrack.preset !== undefined) {
    return true;
  }

  if (
    cameraTrack.blend !== undefined ||
    cameraTrack.freeCameraConfig !== undefined ||
    cameraTrack.freeCamera !== undefined ||
    cameraTrack.freeCameraTransition !== undefined ||
    cameraTrack.freeCameraBlend !== undefined ||
    cameraTrack.shot !== undefined ||
    cameraTrack.type !== undefined ||
    cameraTrack.setDefault !== undefined
  ) {
    return true;
  }

  if (
    cameraTrack.location !== undefined ||
    cameraTrack.position !== undefined ||
    cameraTrack.rotation !== undefined ||
    cameraTrack.facingEntity !== undefined ||
    cameraTrack.facingLocation !== undefined
  ) {
    return true;
  }

  if (cameraTrack.rig !== undefined) {
    return true;
  }

  if (cameraTrack.lookAt !== undefined) {
    return true;
  }

  const setOptions = cameraTrack.setOptions;
  if (
    setOptions &&
    typeof setOptions === "object" &&
    (setOptions.location !== undefined ||
      setOptions.rotation !== undefined ||
      setOptions.facingEntity !== undefined ||
      setOptions.facingLocation !== undefined)
  ) {
    return true;
  }

  return false;
}

function cameraTrackHasOnlyActions(cameraTrack) {
  if (!cameraTrack || typeof cameraTrack !== "object") {
    return false;
  }

  const actionKeys = ["clear", "fade", "fov", "fovRamp", "shake", "shakes"];
  return actionKeys.some(key => cameraTrack[key] !== undefined);
}

function cameraTrackShouldInheritPose(cameraTrack) {
  if (!cameraTrack || typeof cameraTrack !== "object") {
    return false;
  }

  if (cameraTrackHasPose(cameraTrack)) {
    return true;
  }

  if (cameraTrackHasOnlyActions(cameraTrack)) {
    return false;
  }

  return true;
}

function getCameraTrackPoseSnapshot(cameraTrack) {
  if (!cameraTrack || typeof cameraTrack !== "object") {
    return {};
  }

  const snapshot = {};

  for (const [key, value] of Object.entries(cameraTrack)) {
    if (value === undefined || TRANSIENT_CAMERA_TRACK_KEYS.has(key)) {
      continue;
    }

    if (key === "setOptions") {
      if (!value || typeof value !== "object") {
        continue;
      }

      const persistentSetOptions = {};
      for (const [optionKey, optionValue] of Object.entries(value)) {
        if (
          optionValue === undefined ||
          TRANSIENT_CAMERA_SET_OPTION_KEYS.has(optionKey)
        ) {
          continue;
        }
        persistentSetOptions[optionKey] = optionValue;
      }

      if (Object.keys(persistentSetOptions).length > 0) {
        snapshot.setOptions = persistentSetOptions;
      }
      continue;
    }

    snapshot[key] = value;
  }

  return snapshot;
}

function mergeCameraSetOptions(baseSetOptions, overrideSetOptions, override) {
  const merged = { ...baseSetOptions };

  for (const [key, value] of Object.entries(overrideSetOptions || {})) {
    if (value === undefined) {
      continue;
    }

    if (override || merged[key] === undefined) {
      merged[key] = value;
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
}

function mergePoseState(baseState, overrideState, { override = false } = {}) {
  const merged = { ...baseState };
  const incoming = overrideState || {};

  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined) {
      continue;
    }

    if (key === "setOptions" && value && typeof value === "object") {
      const mergedSetOptions = mergeCameraSetOptions(
        merged.setOptions,
        value,
        override,
      );

      if (mergedSetOptions) {
        merged.setOptions = mergedSetOptions;
      }
      continue;
    }

    if (override || merged[key] === undefined) {
      merged[key] = value;
    }
  }

  return merged;
}

function getPoseStateBeforeIndex(index, orderedKeyframes) {
  let state = {};
  if (!Array.isArray(orderedKeyframes) || orderedKeyframes.length === 0) {
    return state;
  }

  for (let index_ = index - 1; index_ >= 0; index_ -= 1) {
    const entry = orderedKeyframes[index_];
    const tracks = resolveTrackData(entry?.data || {});
    const cam = tracks?.camera;
    if (!cam || typeof cam !== "object") {
      continue;
    }

    const snapshot = getCameraTrackPoseSnapshot(cam);
    state = mergePoseState(state, snapshot, { override: false });
  }

  return state;
}

function resolveCameraTrackWithPoseInheritance(cameraTrack, poseState, mode) {
  if (!cameraTrack || typeof cameraTrack !== "object") {
    return cameraTrack;
  }

  const inherited = poseState && typeof poseState === "object" ? poseState : {};
  const original = cameraTrack;
  const inheritedState = getCameraTrackPoseSnapshot(inherited);
  const originalState = getCameraTrackPoseSnapshot(original);
  const result = {
    ...mergePoseState(inheritedState, originalState, { override: true }),
    ...original,
  };

  // Determine which aim controls are explicitly set on THIS keyframe.
  const explicitSetOptions =
    original.setOptions && typeof original.setOptions === "object"
      ? original.setOptions
      : undefined;
  const hasExplicitFacing =
    original.facingEntity !== undefined ||
    original.facingLocation !== undefined ||
    explicitSetOptions?.facingEntity !== undefined ||
    explicitSetOptions?.facingLocation !== undefined;
  const hasExplicitRotation =
    original.rotation !== undefined ||
    explicitSetOptions?.rotation !== undefined;

  const hasExplicitLocation =
    original.location !== undefined ||
    original.position !== undefined ||
    explicitSetOptions?.location !== undefined;

  const mergedSetOptions = mergeCameraSetOptions(
    inheritedState.setOptions,
    explicitSetOptions,
    true,
  );
  if (mergedSetOptions) {
    result.setOptions = mergedSetOptions;
  } else {
    delete result.setOptions;
  }

  if (
    hasExplicitLocation &&
    explicitSetOptions?.location !== undefined &&
    original.location === undefined &&
    original.position === undefined
  ) {
    delete result.location;
    delete result.position;
  }

  if (hasExplicitFacing) {
    delete result.rotation;
    if (result.setOptions && typeof result.setOptions === "object") {
      delete result.setOptions.rotation;
    }
  } else if (hasExplicitRotation) {
    delete result.facingEntity;
    delete result.facingLocation;
    if (result.setOptions && typeof result.setOptions === "object") {
      delete result.setOptions.facingEntity;
      delete result.setOptions.facingLocation;
    }
  } else {
    // do nothing
  }

  if (
    result.setOptions &&
    typeof result.setOptions === "object" &&
    Object.keys(result.setOptions).length === 0
  ) {
    delete result.setOptions;
  }

  return result;
}

function rememberRotation(player, rotation) {
  if (!player || !rotation || typeof rotation !== "object") {
    return;
  }

  const x = rotation.x;
  const y = rotation.y;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return;
  }

  lastRotationByPlayerId.set(getPlayerKey(player), { x, y });
}

function getPreservedRotation(player) {
  if (!player) {
    return undefined;
  }

  const stored = lastRotationByPlayerId.get(getPlayerKey(player));
  if (stored && typeof stored === "object") {
    return stored;
  }
  return undefined;
}

function rememberLocation(player, location) {
  if (!player || !location || typeof location !== "object") {
    return;
  }

  const x = location.x;
  const y = location.y;
  const z = location.z;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return;
  }

  lastLocationByPlayerId.set(getPlayerKey(player), { x, y, z });
}

function getPreservedLocation(player) {
  if (!player) {
    return undefined;
  }
  const stored = lastLocationByPlayerId.get(getPlayerKey(player));
  if (stored && typeof stored === "object") {
    return stored;
  }
  return undefined;
}

function getPreviousCameraLocation(player, freeCameraBridge, fallback) {
  if (freeCameraBridge && player?.isValid) {
    const active = freeCameraBridge.getActiveFreeCamera?.();
    const activeLoc = active?.currentLocation;
    if (activeLoc && active?.player?.id === player.id) {
      const x = activeLoc.x;
      const y = activeLoc.y;
      const z = activeLoc.z;
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        return { x, y, z };
      }
    }
  }

  return getPreservedLocation(player) || fallback;
}

function captureFreeCameraRotation(player, freeCameraBridge) {
  if (!player?.isValid || !freeCameraBridge) {
    return;
  }

  const active = freeCameraBridge.getActiveFreeCamera?.();
  if (!active || active?.player?.id !== player.id) {
    return;
  }

  const rot = active.currentRotation;
  if (rot && typeof rot.x === "number" && typeof rot.y === "number") {
    rememberRotation(player, rot);
    return;
  }

  const loc = active.currentLocation;
  const lookAt = active.currentLookAtPoint;
  if (loc && lookAt) {
    try {
      rememberRotation(player, calculateRotation(loc, lookAt));
    } catch (error) {
      logIgnoredError(
        "camera_system/camera_runtime:captureFreeCameraRotation",
        error,
      );
    }
  }
}

/**
 * Returns whether a value is a finite number.
 * @param {unknown} value Value to test.
 * @returns {boolean}
 */
function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function resolveTargetPointMode(mode) {
  if (
    mode === TARGET_POINT_MODES.RAW_LOCATION ||
    mode === TARGET_POINT_MODES.MIDDLE_POINT ||
    mode === TARGET_POINT_MODES.HEAD_LOCATION
  ) {
    return mode;
  }
  return TARGET_POINT_MODES.MIDDLE_POINT;
}

function getEntityLocationSafe(target) {
  if (!target || typeof target !== "object") {
    return undefined;
  }

  try {
    if (target.isValid === false) {
      return undefined;
    }
  } catch {
    return undefined;
  }

  try {
    const location = target.location;
    return location && typeof location === "object" ? location : undefined;
  } catch {
    return undefined;
  }
}

function resolveEntityFocusPoint(target, mode) {
  if (!target || typeof target !== "object") {
    return target;
  }

  const raw = getEntityLocationSafe(target);
  if (!raw || typeof raw !== "object") {
    return undefined;
  }

  if (mode === TARGET_POINT_MODES.RAW_LOCATION) {
    return raw;
  }

  let head;
  try {
    head = target.getHeadLocation?.();
  } catch {
    head = undefined;
  }
  if (!head) {
    try {
      const collisionBox = target.getComponent?.("minecraft:collision_box");
      const height = collisionBox?.height;
      if (typeof height === "number" && Number.isFinite(height)) {
        head = { x: raw.x, y: raw.y + height, z: raw.z };
      }
    } catch (error) {
      logIgnoredError(
        "camera_system/camera_runtime:resolveEntityFocusPoint",
        error,
      );
    }
  }
  head ||= raw;
  if (mode === TARGET_POINT_MODES.HEAD_LOCATION) {
    return head;
  }

  // Default: midpoint between raw location and head location.
  try {
    return BVector3.divide(
      BVector3.add(BVector3.from(raw), BVector3.from(head)),
      2,
    ).toVector3();
  } catch {
    return raw;
  }
}

function resolveRotateAngles(nextRotate) {
  let rotateTheta = 0;
  let rotatePhi = 0;

  try {
    rotateTheta = nextRotate.getTheta?.() ?? 0;
    rotatePhi = nextRotate.getPhi?.() ?? 0;
  } catch (error) {
    logIgnoredError("camera_system/camera_runtime:resolveRotateAngles", error);
  }

  return { rotateTheta, rotatePhi };
}

function tickFreeCameraInstant(activeFreeCamera) {
  try {
    const existingForce =
      typeof activeFreeCamera.forceInstantTicks === "number"
        ? activeFreeCamera.forceInstantTicks
        : 0;
    activeFreeCamera.forceInstantTicks = Math.max(existingForce, SINGLE_TICK);
    activeFreeCamera.tick?.();
  } catch (error) {
    logIgnoredError(
      "camera_system/camera_runtime:tickFreeCameraInstant",
      error,
    );
  }
}

function applyVanillaRotationStep({
  camera,
  easeTime,
  easeType,
  player,
  startLoc,
  targetRot,
}) {
  try {
    camera.setCamera(CAMERA_PRESET_IDS.FREE, {
      location: { x: startLoc.x, y: startLoc.y, z: startLoc.z },
      rotation: targetRot,
      easeOptions: {
        easeType,
        easeTime,
      },
    });
  } catch (error) {
    logIgnoredError(
      "camera_system/camera_runtime:applyVanillaRotationStep",
      error,
    );
  }

  rememberLocation(player, {
    x: startLoc.x,
    y: startLoc.y,
    z: startLoc.z,
  });
  rememberRotation(player, targetRot);
}

function applySegmentRotateFallback(segmentTransition, nextRotate) {
  try {
    segmentTransition.rotate = {
      theta: nextRotate.getTheta?.() ?? 0,
      phi: nextRotate.getPhi?.() ?? 0,
    };
  } catch (error) {
    logIgnoredError(
      "camera_system/camera_runtime:applySegmentRotateFallback",
      error,
    );
  }
}

function scheduleVanillaRotateTransition({
  activeFreeCamera,
  camera,
  freeCameraBridge,
  nextRotate,
  nextSegmentEaseType,
  nextSession,
  player,
  playerKey,
  segmentDuration,
  systemRef,
}) {
  const { rotateTheta, rotatePhi } = resolveRotateAngles(nextRotate);
  const hasMeaningfulRotation =
    (Math.abs(rotateTheta) > CAMERA_ROTATION_EPSILON ||
      Math.abs(rotatePhi) > CAMERA_ROTATION_EPSILON) &&
    segmentDuration > 0;

  if (!hasMeaningfulRotation) {
    return false;
  }

  tickFreeCameraInstant(activeFreeCamera);

  const startLoc = activeFreeCamera.currentLocation;
  const startRot = activeFreeCamera.currentRotation;
  const hasStartPose =
    startLoc &&
    startRot &&
    isNumber(startLoc.x) &&
    isNumber(startLoc.y) &&
    isNumber(startLoc.z) &&
    isNumber(startRot.x) &&
    isNumber(startRot.y);
  if (!hasStartPose) {
    return false;
  }

  try {
    freeCameraBridge.stopFreeCamera?.({
      clearCamera: false,
      restoreInput: false,
    });
  } catch (error) {
    logIgnoredError(
      "camera_system/camera_runtime:scheduleVanillaRotateTransition",
      error,
    );
  }

  const thetaAbs = Math.abs(rotateTheta);
  const isFullTurn =
    Math.abs((thetaAbs % FULL_TURN_DEGREES) - ZERO_SECONDS) <
    FULL_TURN_NORMALIZATION_EPSILON;
  const effectiveTheta =
    isFullTurn && thetaAbs >= FULL_TURN_THRESHOLD
      ? Math.sign(rotateTheta || SINGLE_TICK) * FULL_TURN_FALLBACK
      : rotateTheta;
  const endRotation = {
    x: startRot.x + rotatePhi,
    y: startRot.y + effectiveTheta,
  };

  if (Math.abs(effectiveTheta) > LARGE_ROTATION_ARC_THRESHOLD) {
    const totalTicks = Math.max(
      SINGLE_TICK,
      Math.round(segmentDuration * TicksPerSecond),
    );
    const easeFn = resolveEaseFunction(
      nextSegmentEaseType || CAMERA_EASE_TYPES.LINEAR,
    );
    let tick = 0;
    const runId = systemRef.runInterval(() => {
      if (
        (cameraActionSessionByPlayerKey.get(playerKey) ?? 0) !== nextSession
      ) {
        systemRef.clearRun(runId);
        return;
      }

      tick += SINGLE_TICK;
      const t = Math.min(1, tick / totalTicks);
      const eased = easeFn(t);
      const targetRot = {
        x: startRot.x + rotatePhi * eased,
        y: startRot.y + effectiveTheta * eased,
      };
      const tickEase = SINGLE_TICK / TicksPerSecond;

      applyVanillaRotationStep({
        camera,
        easeTime: tickEase,
        easeType: nextSegmentEaseType,
        player,
        startLoc,
        targetRot,
      });

      if (t >= 1) {
        systemRef.clearRun(runId);
      }
    }, SINGLE_TICK);

    return true;
  }

  scheduleDelayed(systemRef, ZERO_SECONDS, () => {
    if ((cameraActionSessionByPlayerKey.get(playerKey) ?? 0) !== nextSession) {
      return;
    }

    applyVanillaRotationStep({
      camera,
      easeTime: segmentDuration,
      easeType: nextSegmentEaseType,
      player,
      startLoc,
      targetRot: endRotation,
    });
  });

  return true;
}

/**
 * Normalizes any vector-like value into an {x,y,z} object.
 * @param {any} value Candidate vector.
 * @param {{x:number,y:number,z:number}} fallback Fallback vector.
 * @returns {{x:number,y:number,z:number}}
 */
function toVector3(value, fallback) {
  if (!value || typeof value !== "object") {
    return fallback;
  }

  return {
    x: isNumber(value.x) ? value.x : (fallback?.x ?? 0),
    y: isNumber(value.y) ? value.y : (fallback?.y ?? 0),
    z: isNumber(value.z) ? value.z : (fallback?.z ?? 0),
  };
}

/**
 * Adds two vectors.
 * @param {{x:number,y:number,z:number}} a
 * @param {{x:number,y:number,z:number}} b
 * @returns {{x:number,y:number,z:number}}
 */
function addVec(a, b) {
  return BVector3.add(BVector3.from(a), BVector3.from(b)).toVector3();
}

function isDirectionalOffsetLike(value) {
  if (!value || typeof value !== "object") {
    return false;
  }

  if (value instanceof DirectionalOffset) {
    return true;
  }

  return (
    typeof value.getGround === "function" ||
    typeof value.getSide === "function" ||
    typeof value.getFront === "function" ||
    value.ground !== undefined ||
    value.side !== undefined ||
    value.front !== undefined
  );
}

function isPositionalOffsetLike(value) {
  if (!value || typeof value !== "object") {
    return false;
  }

  return (
    typeof value.getX === "function" &&
    typeof value.getY === "function" &&
    typeof value.getZ === "function"
  );
}

/**
 * Converts an easing identifier into a runtime-compatible value.
 * @param {string|number|undefined} value Easing name or enum value.
 * @returns {string|number|undefined}
 */
function resolveEasingType(value) {
  if (!value) {
    return undefined;
  }

  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    if (EasingType?.[value] !== undefined) {
      return EasingType[value];
    }
    return value;
  }

  return value;
}

/**
 * Returns whether an easing type should behave as a step/cut transition.
 * @param {string|number|undefined} easeType Easing type value.
 * @returns {boolean}
 */
function isCutEaseType(easeType) {
  if (easeType === CAMERA_EASE_TYPES.CUT) {
    return true;
  }

  if (typeof easeType !== "string") {
    return false;
  }

  const normalized = easeType.trim().toLowerCase();
  return normalized === "cut" || normalized === "step" || normalized === "none";
}

/**
 * Extracts keyframe-level camera easing from a timeline entry.
 * @param {{time?:number,data?:Object}|undefined} entry Timeline keyframe entry.
 * @returns {string|number|undefined}
 */
function getEntryEaseType(entry) {
  const keyframe = entry?.data;
  if (!keyframe || typeof keyframe !== "object") {
    return undefined;
  }

  const tracks = keyframe.tracks || {};
  const camera = tracks.camera ?? keyframe.camera;

  return resolveEasingType(
    camera?.easeType || camera?.ease || keyframe.easeType || keyframe.ease,
  );
}

function getKeyframeFovEaseType(keyframe) {
  if (!keyframe || typeof keyframe !== "object") {
    return undefined;
  }

  const camera = keyframe.camera || {};
  return resolveEasingType(camera.fovEasingType || keyframe.fovEasingType);
}

/**
 * Resolves keyframe transition duration based on easing mode.
 * @param {number} index Current keyframe index.
 * @param {Array<{time:number}>} keyframes Ordered keyframes.
 * @param {string} mode Easing mode.
 * @returns {number}
 */
function resolveEaseDurationSeconds(index, keyframes, mode) {
  if (keyframes.length === 0) {
    return 0;
  }

  if (mode === CAMERA_EASE_MODES.TO_CURRENT) {
    // First keyframe eases from timeline start (t=0) -> keyframe time.
    if (index === 0) {
      return Math.max(0, keyframes[0].time ?? 0);
    }
    return Math.max(0, keyframes[index].time - keyframes[index - 1].time);
  }

  // TO_NEXT: ease duration uses the gap from this keyframe to the next.
  if (index >= keyframes.length - 1) {
    return 0;
  }
  return Math.max(0, keyframes[index + 1].time - keyframes[index].time);
}

/**
 * Builds camera ease options from keyframe and track data.
 * @param {Object} keyframe Keyframe data.
 * @param {number} index Current keyframe index.
 * @param {Array<{time:number,data?:Object}>} keyframes Ordered keyframes.
 * @param {string} mode Easing mode.
 * @returns {{easeType?:string|number,easeTime:number}|undefined}
 */
function resolveEaseOptions(keyframe, index, keyframes, mode) {
  const camera = keyframe.camera || {};
  const localEaseType = resolveEasingType(
    camera.easeType || camera.ease || keyframe.easeType || keyframe.ease,
  );
  const nextEaseType =
    mode === CAMERA_EASE_MODES.TO_NEXT
      ? getEntryEaseType(keyframes[index + 1])
      : undefined;
  const easeType = localEaseType ?? nextEaseType;
  const override =
    camera.easeTimeSeconds ??
    camera.easeSec ??
    keyframe.easeTimeSeconds ??
    keyframe.easeSec;
  let durationSeconds =
    typeof override === "number" && Number.isFinite(override)
      ? Math.max(0, override)
      : resolveEaseDurationSeconds(index, keyframes, mode);

  if (
    override === undefined &&
    mode === CAMERA_EASE_MODES.TO_NEXT &&
    durationSeconds > 0 &&
    index >= 0 &&
    index < keyframes.length - 1
  ) {
    try {
      const currentEntry = keyframes[index];
      const nextEntry = keyframes[index + 1];
      const currentTracks = resolveTrackData(currentEntry?.data || {});
      const nextTracks = resolveTrackData(nextEntry?.data || {});
      const currentCam = currentTracks?.camera;
      const nextCam = nextTracks?.camera;

      if (
        currentCam &&
        nextCam &&
        cameraTracksStructurallyEqual(currentCam, nextCam)
      ) {
        durationSeconds = 0;
      }
    } catch (error) {
      logIgnoredError("camera_system/camera_runtime:resolveEaseOptions", error);
    }
  }

  if (
    override === undefined &&
    mode === CAMERA_EASE_MODES.TO_CURRENT &&
    index === 0 &&
    durationSeconds <= 0 &&
    keyframes.length > 1
  ) {
    durationSeconds = Math.max(
      0,
      (keyframes[1]?.time ?? 0) - (keyframes[0]?.time ?? 0),
    );
  }

  if (isCutEaseType(localEaseType) || isCutEaseType(nextEaseType)) {
    return {
      easeType: CAMERA_EASE_TYPES.LINEAR,
      easeTime: 0,
    };
  }

  if (easeType === undefined && durationSeconds <= 0) {
    return undefined;
  }

  return {
    easeType,
    easeTime: durationSeconds,
  };
}

function applyEaseTypeOverride(easeOptions, easeType) {
  if (easeType === undefined) {
    return easeOptions;
  }

  if (!easeOptions) {
    return undefined;
  }

  if (isCutEaseType(easeType)) {
    return {
      easeType: CAMERA_EASE_TYPES.LINEAR,
      easeTime: 0,
    };
  }

  return {
    ...easeOptions,
    easeType,
  };
}

function resolveFovEaseOptions(keyframe, index, keyframes, mode) {
  return applyEaseTypeOverride(
    resolveEaseOptions(keyframe, index, keyframes, mode),
    getKeyframeFovEaseType(keyframe),
  );
}

function resolveSegmentEaseOptions(index, keyframes, mode) {
  if (!Array.isArray(keyframes) || index < 0 || index >= keyframes.length - 1) {
    return undefined;
  }

  if (mode === CAMERA_EASE_MODES.TO_CURRENT) {
    const nextEntry = keyframes[index + 1];
    return resolveEaseOptions(
      nextEntry?.data || {},
      index + 1,
      keyframes,
      mode,
    );
  }

  const currentEntry = keyframes[index];
  return resolveEaseOptions(currentEntry?.data || {}, index, keyframes, mode);
}

function resolveSegmentFovEaseOptions(index, keyframes, mode) {
  if (!Array.isArray(keyframes) || index < 0 || index >= keyframes.length - 1) {
    return undefined;
  }

  if (mode === CAMERA_EASE_MODES.TO_CURRENT) {
    const nextEntry = keyframes[index + 1];
    return resolveFovEaseOptions(
      nextEntry?.data || {},
      index + 1,
      keyframes,
      mode,
    );
  }

  const currentEntry = keyframes[index];
  return resolveFovEaseOptions(
    currentEntry?.data || {},
    index,
    keyframes,
    mode,
  );
}

function withResolvedCameraTrack(entry, cameraTrack) {
  if (!entry || !entry.data || cameraTrack === undefined) {
    return entry;
  }

  const data = entry.data;
  const tracks =
    data.tracks && typeof data.tracks === "object"
      ? {
          ...data.tracks,
          camera: cameraTrack,
        }
      : undefined;

  return {
    ...entry,
    data: {
      ...data,
      camera: cameraTrack,
      ...(tracks ? { tracks } : {}),
    },
  };
}

function keyframeHasExplicitCameraConfig(keyframe) {
  if (!keyframe || typeof keyframe !== "object") {
    return false;
  }

  const tracks = keyframe.tracks;
  if (tracks && typeof tracks === "object" && Object.hasOwn(tracks, "camera")) {
    return true;
  }

  return Object.hasOwn(keyframe, "camera");
}

function findNextExplicitCameraKeyframeEntry(index, orderedKeyframes) {
  if (!Array.isArray(orderedKeyframes) || orderedKeyframes.length === 0) {
    return undefined;
  }

  for (
    let nextIndex = index + 1;
    nextIndex < orderedKeyframes.length;
    nextIndex += 1
  ) {
    const candidate = orderedKeyframes[nextIndex];
    if (keyframeHasExplicitCameraConfig(candidate?.data)) {
      return candidate;
    }
  }

  return undefined;
}

function findPreviousExplicitCameraKeyframeEntry(index, orderedKeyframes) {
  if (!Array.isArray(orderedKeyframes) || orderedKeyframes.length === 0) {
    return undefined;
  }

  for (let previousIndex = index - 1; previousIndex >= 0; previousIndex -= 1) {
    const candidate = orderedKeyframes[previousIndex];
    if (keyframeHasExplicitCameraConfig(candidate?.data)) {
      return candidate;
    }
  }

  return undefined;
}

function buildResolvedCameraEaseEntries(
  currentEntry,
  currentCameraTrack,
  nextEntry,
  nextCameraTrack,
) {
  const currentResolvedEntry = withResolvedCameraTrack(
    currentEntry,
    currentCameraTrack,
  );
  if (!nextEntry) {
    return currentResolvedEntry ? [currentResolvedEntry] : [];
  }

  return [
    currentResolvedEntry,
    withResolvedCameraTrack(nextEntry, nextCameraTrack),
  ].filter(Boolean);
}

function resolveEffectiveEaseMode(cameraTrack, keyframe, fallbackMode) {
  const candidate = cameraTrack?.easeMode ?? keyframe?.easeMode;
  if (candidate === CAMERA_EASE_MODES.TO_CURRENT) {
    return CAMERA_EASE_MODES.TO_CURRENT;
  }
  if (candidate === CAMERA_EASE_MODES.TO_NEXT) {
    return CAMERA_EASE_MODES.TO_NEXT;
  }
  return fallbackMode;
}

function shouldPreEaseToNextVanillaCamera(nextCamera, easeOptions) {
  if (!nextCamera || typeof nextCamera !== "object" || !easeOptions) {
    return false;
  }

  if (
    typeof easeOptions.easeTime !== "number" ||
    easeOptions.easeTime <= 0 ||
    isCutEaseType(easeOptions.easeType)
  ) {
    return false;
  }

  if (
    nextCamera.rig ||
    nextCamera.blend ||
    nextCamera.freeCameraConfig ||
    nextCamera.freeCamera ||
    nextCamera.freeCameraTransition ||
    nextCamera.setDefault === true
  ) {
    return false;
  }

  return cameraTrackHasPose(nextCamera);
}

function applyVanillaSegmentEaseToNextCamera({
  camera,
  nextCamera,
  easeOptions,
  defaultPreset,
  bindings,
  player,
  origin,
  logger,
  freeCameraBridge,
  systemRef,
  playerKey,
  sessionId,
  delayTicks = 0,
}) {
  if (!shouldPreEaseToNextVanillaCamera(nextCamera, easeOptions)) {
    return false;
  }

  let resolvedSetOptions = resolveCameraSetOptions(nextCamera, {
    bindings,
    player,
    origin,
  });

  if (nextCamera.lookAt) {
    const target = nextCamera.lookAt.targetKey
      ? bindings?.[nextCamera.lookAt.targetKey]
      : nextCamera.lookAt.location;
    if (target) {
      if (nextCamera.lookAt.targetKey && target.isValid === false) {
        return false;
      }
      if (!resolvedSetOptions) {
        resolvedSetOptions = {};
      }
      const targetMode = resolveTargetPointMode(
        nextCamera.lookAt.targetPointMode ?? nextCamera.targetPointMode,
      );
      const targetPos = resolveTargetPosition(target, targetMode, {
        bindings,
        player,
        origin,
      });
      if (!targetPos) {
        return false;
      }
      if (
        !applyNativeLookAtTarget(
          resolvedSetOptions,
          shouldUseNativeLookAtTarget(nextCamera.lookAt, nextCamera)
            ? nextCamera.lookAt
            : undefined,
          target,
          targetPos,
        )
      ) {
        const location =
          resolvedSetOptions.location ||
          getPreviousCameraLocation(
            player,
            freeCameraBridge,
            player?.location || origin,
          );
        const lookAtRotation = calculateRotation(location, targetPos);
        const baseRotation = resolvedSetOptions.rotation || lookAtRotation;
        const weight = nextCamera.lookAt.weight ?? nextCamera.lookAt.soft ?? 1;
        resolvedSetOptions.rotation = blendRotation(
          baseRotation,
          lookAtRotation,
          weight,
        );
      }
    }
  }

  const rotateOffset = resolveAngleOffset(nextCamera.rotate);
  if (rotateOffset) {
    if (!resolvedSetOptions) {
      resolvedSetOptions = {};
    }

    const baseLocation =
      resolvedSetOptions.location ||
      getPreviousCameraLocation(
        player,
        freeCameraBridge,
        player?.location || origin,
      );

    let baseRotation = resolvedSetOptions.rotation;

    if (!baseRotation && baseLocation) {
      let targetPos;

      if (resolvedSetOptions.facingLocation) {
        targetPos = resolvedSetOptions.facingLocation;
      } else if (resolvedSetOptions.facingEntity === undefined) {
        // do nothing
      } else {
        const facingCandidate = isEntityLike(resolvedSetOptions.facingEntity)
          ? resolvedSetOptions.facingEntity
          : typeof resolvedSetOptions.facingEntity === "string"
            ? bindings?.[resolvedSetOptions.facingEntity]
            : undefined;

        const targetMode = resolveTargetPointMode(nextCamera.targetPointMode);
        targetPos = resolveTargetPosition(facingCandidate, targetMode, {
          bindings,
          player,
          origin,
        });
      }

      if (targetPos) {
        try {
          const lookAtRotation = calculateRotation(baseLocation, targetPos);
          if (lookAtRotation) {
            baseRotation = lookAtRotation;
          }
        } catch (error) {
          logIgnoredError(
            "camera_system/camera_runtime:applyVanillaSegmentEaseToNextCamera",
            error,
          );
        }
      }
    }

    if (!baseRotation) {
      baseRotation = getPreservedRotation(player) ||
        (player?.isValid ? player.getRotation?.() : undefined) || {
          x: 0,
          y: 0,
        };
    }

    resolvedSetOptions.rotation = {
      x: (baseRotation?.x ?? 0) + (rotateOffset.getPhi?.() ?? 0),
      y: (baseRotation?.y ?? 0) + (rotateOffset.getTheta?.() ?? 0),
    };

    delete resolvedSetOptions.facingEntity;
    delete resolvedSetOptions.facingLocation;
  }

  const shouldPreserveRotation = nextCamera.preserveRotation !== false;
  const canInheritRotation =
    shouldPreserveRotation &&
    resolvedSetOptions &&
    resolvedSetOptions.rotation === undefined &&
    resolvedSetOptions.facingEntity === undefined &&
    resolvedSetOptions.facingLocation === undefined &&
    !nextCamera.lookAt &&
    !nextCamera.rig;
  if (canInheritRotation) {
    resolvedSetOptions.rotation = getPreservedRotation(player);
  }

  const wantsPoseChange =
    nextCamera.preset !== undefined ||
    nextCamera.setOptions !== undefined ||
    nextCamera.location !== undefined ||
    nextCamera.position !== undefined ||
    nextCamera.rotation !== undefined ||
    nextCamera.rotate !== undefined ||
    nextCamera.facingEntity !== undefined ||
    nextCamera.facingLocation !== undefined ||
    Boolean(nextCamera.lookAt);

  if (!wantsPoseChange) {
    return false;
  }

  const preset = resolvePresetId(nextCamera.preset, defaultPreset);
  const setOptions = mergeEaseOptions(resolvedSetOptions, easeOptions);

  coerceFacingToExplicitRotation(setOptions, {
    bindings,
    player,
    origin,
    freeCameraBridge,
    targetPointMode: nextCamera.targetPointMode,
  });

  const applyTransition = () => {
    try {
      camera.setCamera(preset, setOptions);
      if (setOptions?.location) {
        rememberLocation(player, setOptions.location);
      }
      if (setOptions?.rotation) {
        rememberRotation(player, setOptions.rotation);
      } else if (setOptions?.facingEntity) {
        const baseLocation =
          setOptions.location ||
          getPreviousCameraLocation(
            player,
            freeCameraBridge,
            player?.location || origin,
          );
        const targetMode = resolveTargetPointMode(nextCamera.targetPointMode);
        const targetPos = resolveEntityFocusPoint(
          setOptions.facingEntity,
          targetMode,
        );
        if (targetPos && baseLocation) {
          rememberRotation(player, calculateRotation(baseLocation, targetPos));
        }
      } else if (setOptions?.facingLocation) {
        const baseLocation =
          setOptions.location ||
          getPreviousCameraLocation(
            player,
            freeCameraBridge,
            player?.location || origin,
          );
        if (baseLocation) {
          rememberRotation(
            player,
            calculateRotation(baseLocation, setOptions.facingLocation),
          );
        }
      } else {
        // do nothing
      }
    } catch (error) {
      logger?.warn?.(
        "CAMERA",
        "camera.setCamera vanilla pre-ease failed",
        error,
      );
    }
  };

  if (delayTicks > 0 && systemRef) {
    try {
      systemRef.runTimeout(() => {
        if (
          playerKey &&
          sessionId !== undefined &&
          (cameraActionSessionByPlayerKey.get(playerKey) ?? 0) !== sessionId
        ) {
          return;
        }
        applyTransition();
      }, delayTicks);
      return true;
    } catch (error) {
      logger?.warn?.(
        "CAMERA",
        "camera.setCamera vanilla pre-ease scheduling failed",
        error,
      );
      return false;
    }
  }

  applyTransition();
  return true;
}

function applyVanillaSegmentEaseToNextFov({
  camera,
  nextCamera,
  easeOptions,
  logger,
  systemRef,
  playerKey,
  sessionId,
  delayTicks = 0,
}) {
  if (!easeOptions || (easeOptions.easeTime ?? 0) <= 0) {
    return false;
  }

  const fovOptions = mergeFovOptions(nextCamera?.fov, easeOptions);
  if (!camera?.isValid || !fovOptions) {
    return false;
  }

  const applyTransition = () => {
    try {
      camera.setFov(fovOptions);
    } catch (error) {
      logger?.warn?.("CAMERA", "camera.setFov native pre-ease failed", error);
    }
  };

  if (delayTicks > 0 && systemRef) {
    try {
      systemRef.runTimeout(() => {
        if (
          playerKey &&
          sessionId !== undefined &&
          (cameraActionSessionByPlayerKey.get(playerKey) ?? 0) !== sessionId
        ) {
          return;
        }
        applyTransition();
      }, delayTicks);
      return true;
    } catch (error) {
      logger?.warn?.(
        "CAMERA",
        "camera.setFov native pre-ease scheduling failed",
        error,
      );
      return false;
    }
  }

  applyTransition();
  return true;
}

function isPlainObject(value) {
  if (!value || typeof value !== "object") {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function deepEqual(a, b) {
  if (a === b) {
    return true;
  }

  if (typeof a !== typeof b) {
    return false;
  }

  if (!a || !b) {
    return false;
  }

  if (Array.isArray(a) || Array.isArray(b)) {
    return deepEqualArrays(a, b);
  }

  if (!isPlainObject(a) || !isPlainObject(b)) {
    // Only compare plain JSON-like objects here; other types are treated as unequal.
    return false;
  }

  return deepEqualObjects(a, b);
}

function deepEqualArrays(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
    return false;
  }

  for (const [index, element] of a.entries()) {
    if (!deepEqual(element, b[index])) {
      return false;
    }
  }

  return true;
}

function deepEqualObjects(a, b) {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) {
    return false;
  }

  for (const key of aKeys) {
    if (!Object.hasOwn(b, key)) {
      return false;
    }
    if (!deepEqual(a[key], b[key])) {
      return false;
    }
  }

  return true;
}

function resolveCameraSourceEntity(context, sourceKey) {
  if (!context || typeof context !== "object") {
    return undefined;
  }

  if (typeof sourceKey === "string" && sourceKey) {
    const boundEntity = context.bindings?.[sourceKey];
    if (boundEntity?.isValid) {
      return boundEntity;
    }
  }

  if (context.entity?.isValid) {
    return context.entity;
  }

  if (context.player?.isValid) {
    return context.player;
  }

  return undefined;
}

function resolvePositionalCameraLocation(location, context) {
  const sourceEntity = resolveCameraSourceEntity(context, context?.sourceKey);
  const base = sourceEntity?.location ??
    context?.origin ?? {
      x: 0,
      y: 0,
      z: 0,
    };
  return {
    x: (base?.x ?? 0) + (location.getX?.() ?? 0),
    y: (base?.y ?? 0) + (location.getY?.() ?? 0),
    z: (base?.z ?? 0) + (location.getZ?.() ?? 0),
  };
}

function resolveDirectionalCameraLocation(location, context, fallback) {
  const sourceEntity = resolveCameraSourceEntity(
    context,
    location?.sourceKey ?? context?.sourceKey,
  );
  if (!sourceEntity?.isValid) {
    return fallback;
  }

  try {
    const directionalOffset =
      location instanceof DirectionalOffset
        ? location
        : new DirectionalOffset(
            resolveDirectionalOffsetValue(location, "ground", 0),
            resolveDirectionalOffsetValue(location, "side", 0),
            resolveDirectionalOffsetValue(location, "front", 0),
            location.ignoreVertical ?? false,
            location.useViewDirection ?? false,
            location.useTargetDirection ?? false,
          );
    const resolved = rotationRelativeOffset(
      sourceEntity,
      directionalOffset,
      directionalOffset.ignoreVertical,
      directionalOffset.useViewDirection,
    );
    if (resolved) {
      return { x: resolved.x, y: resolved.y, z: resolved.z };
    }
  } catch (error) {
    logIgnoredError(
      "camera_system/camera_runtime:resolveDirectionalCameraLocation",
      error,
    );
  }

  if (location && typeof location === "object") {
    return resolveVectorOrLocation(location, fallback, context);
  }

  return fallback;
}

function resolveCameraLocationValue(location, context, fallback) {
  if (location === undefined) {
    return fallback;
  }

  if (isPositionalOffsetLike(location)) {
    return resolvePositionalCameraLocation(location, context);
  }

  if (isDirectionalOffsetLike(location)) {
    return resolveDirectionalCameraLocation(location, context, fallback);
  }

  if (location && typeof location === "object") {
    return resolveVectorOrLocation(location, fallback, context);
  }

  return fallback;
}

function resolveCameraRotationValue(rotation, fallback, context) {
  const angleOffset = resolveAngleOffset(rotation);
  if (angleOffset) {
    const sourceEntity = resolveCameraSourceEntity(
      context,
      rotation?.sourceKey ?? context?.sourceKey,
    );
    const sourceRotation = sourceEntity?.isValid
      ? normalizeRotation(sourceEntity.getRotation?.(), fallback)
      : fallback;
    return {
      x: (sourceRotation?.x ?? 0) + (angleOffset.getPhi?.() ?? 0),
      y: (sourceRotation?.y ?? 0) + (angleOffset.getTheta?.() ?? 0),
    };
  }

  if (rotation && typeof rotation === "object") {
    const rotationTarget = rotation.targetKey
      ? context?.bindings?.[rotation.targetKey]
      : (rotation.targetLocation ?? rotation.location);
    if (rotationTarget) {
      const targetMode = resolveTargetPointMode(
        rotation.targetPointMode ?? context?.targetPointMode,
      );
      const targetPos = resolveTargetPosition(
        rotationTarget,
        targetMode,
        context,
      );
      const baseLocation = context?.baseLocation;

      if (targetPos && baseLocation) {
        return calculateRotation(baseLocation, targetPos);
      }
    }

    return normalizeRotation(rotation, fallback);
  }

  return fallback;
}

/**
 * Resolves shorthand camera fields into Camera.setCamera setOptions.
 * @param {Object} cameraData Keyframe camera data.
 * @param {{bindings?:Object,player?:any,entity?:any,origin?:{x:number,y:number,z:number},baseRotation?:{x:number,y:number}}} [context]
 * @returns {Object|undefined}
 */
function resolveCameraSetOptions(cameraData, context) {
  if (!cameraData || typeof cameraData !== "object") {
    return undefined;
  }

  const setOptions =
    cameraData.setOptions && typeof cameraData.setOptions === "object"
      ? { ...cameraData.setOptions }
      : {};

  const location = cameraData.location ?? cameraData.position;
  const resolvedLocation = resolveCameraLocationValue(
    location,
    {
      ...context,
      sourceKey: location?.sourceKey ?? cameraData.sourceKey,
    },
    setOptions.location,
  );
  if (resolvedLocation !== undefined) {
    setOptions.location = resolvedLocation;
  } else if (setOptions.location !== undefined) {
    const resolvedInheritedLocation = resolveCameraLocationValue(
      setOptions.location,
      {
        ...context,
        sourceKey: setOptions.location?.sourceKey ?? cameraData.sourceKey,
      },
      setOptions.location,
    );

    if (resolvedInheritedLocation !== undefined) {
      setOptions.location = resolvedInheritedLocation;
    }
  } else {
    // do nothing
  }

  if (cameraData.rotation !== undefined) {
    setOptions.rotation = resolveCameraRotationValue(
      cameraData.rotation,
      setOptions.rotation ?? context?.baseRotation,
      {
        ...context,
        baseLocation: resolvedLocation ?? setOptions.location,
        targetPointMode: cameraData.targetPointMode,
        sourceKey: cameraData.rotation?.sourceKey ?? cameraData.sourceKey,
      },
    );
  }

  if (cameraData.facingEntity !== undefined) {
    const facingCandidate =
      typeof cameraData.facingEntity === "string"
        ? (context?.bindings?.[cameraData.facingEntity] ??
          cameraData.facingEntity)
        : cameraData.facingEntity;
    const targetMode = resolveTargetPointMode(cameraData.targetPointMode);
    const targetPos = resolveTargetPosition(
      facingCandidate,
      targetMode,
      context,
    );

    if (targetPos) {
      setOptions.facingLocation = targetPos;
      delete setOptions.facingEntity;
      delete setOptions.rotation;
    } else {
      setOptions.facingEntity = facingCandidate;
      delete setOptions.facingLocation;
      delete setOptions.rotation;
    }
  }

  if (
    cameraData.facingLocation &&
    typeof cameraData.facingLocation === "object"
  ) {
    setOptions.facingLocation = resolveVectorOrLocation(
      cameraData.facingLocation,
      setOptions.facingLocation,
      context,
    );
  }

  return Object.keys(setOptions).length > 0 ? setOptions : undefined;
}

function applyAliasAssignments(normalized, aliasPairs) {
  for (const [canonicalKey, aliasKey] of aliasPairs) {
    if (
      normalized[canonicalKey] === undefined &&
      normalized[aliasKey] !== undefined
    ) {
      normalized[canonicalKey] = normalized[aliasKey];
    }
  }
}

function cameraTracksStructurallyEqual(a, b) {
  const pick = cam => ({
    preset: cam?.preset,
    sourceKey: cam?.sourceKey,
    rig: cam?.rig,
    lookAt: cam?.lookAt,
    location: cam?.location,
    position: cam?.position,
    rotation: cam?.rotation,
    facingEntity: cam?.facingEntity,
    facingLocation: cam?.facingLocation,
    setOptions: cam?.setOptions,
    blend: cam?.blend,
    shot: cam?.shot,
    freeCameraConfig: cam?.freeCameraConfig,
    freeCameraTransition: cam?.freeCameraTransition,
    targetPointMode: cam?.targetPointMode,
    followModePreservationType: cam?.followModePreservationType,
  });

  return deepEqual(pick(a), pick(b));
}
/**
 * Coerces angle-like values into an AngleOffset instance.
 * @param {any} candidate Angle candidate.
 * @returns {AngleOffset|undefined}
 */
function resolveAngleOffset(candidate) {
  if (!candidate) {
    return undefined;
  }

  if (candidate instanceof AngleOffset) {
    return candidate;
  }

  if (typeof candidate === "object") {
    const theta = candidate.theta;
    const phi = candidate.phi;
    const thetaOk = typeof theta === "number" || Array.isArray(theta);
    const phiOk = typeof phi === "number" || Array.isArray(phi);
    if (thetaOk && phiOk) {
      try {
        return new AngleOffset(theta, phi);
      } catch {
        return undefined;
      }
    }
  }

  return undefined;
}

/**
 * Merges `easeOptions` into camera setOptions when missing.
 * @param {Object|undefined} setOptions Camera set options.
 * @param {{easeType?:string|number,easeTime:number}|undefined} easeOptions Easing options.
 * @returns {Object|undefined}
 */
function mergeEaseOptions(setOptions, easeOptions) {
  if (!easeOptions) {
    return setOptions;
  }

  if (!setOptions || typeof setOptions !== "object") {
    return { easeOptions };
  }

  if (setOptions.easeOptions) {
    return setOptions;
  }

  return {
    ...setOptions,
    easeOptions,
  };
}

/**
 * Normalizes pitch/yaw data into a rotation object.
 * @param {any} value Rotation candidate.
 * @param {{x:number,y:number}|undefined} fallback Fallback rotation.
 * @returns {{x:number,y:number}|undefined}
 */
function normalizeRotation(value, fallback) {
  if (!value || typeof value !== "object") {
    return fallback;
  }

  return {
    x: isNumber(value.x) ? value.x : (fallback?.x ?? 0),
    y: isNumber(value.y) ? value.y : (fallback?.y ?? 0),
  };
}

function toFreeCameraTransition(easeOptions, fallbackTransition) {
  if (!easeOptions && !fallbackTransition) {
    return undefined;
  }

  const transition = {
    ...(fallbackTransition && typeof fallbackTransition === "object"
      ? fallbackTransition
      : {}),
  };

  if (easeOptions?.easeType !== undefined) {
    transition.easeType = easeOptions.easeType;
  }

  if (typeof easeOptions?.easeTime === "number") {
    transition.easeTimeSeconds = Math.max(0, easeOptions.easeTime);
  }

  return transition;
}

/**
 * Shallow-merges free-camera configuration values.
 * @param {Object|undefined} baseConfig Base config.
 * @param {Object|undefined} overrideConfig Override config.
 * @returns {Object}
 */
function mergeFreeCameraConfigs(baseConfig, overrideConfig) {
  const merged = {
    ...(baseConfig && typeof baseConfig === "object" ? baseConfig : {}),
  };

  if (overrideConfig && typeof overrideConfig === "object") {
    for (const [key, value] of Object.entries(overrideConfig)) {
      if (value !== undefined) {
        merged[key] = value;
      }
    }
  }

  return merged;
}

/**
 * Normalizes transition aliases to canonical transition keys.
 * @param {Object|undefined} transition Transition object.
 * @returns {Object|undefined}
 */
function normalizeEaseTransition(transition) {
  if (!transition || typeof transition !== "object") {
    return transition;
  }

  const normalized = { ...transition };

  if (normalized.easeType === undefined && normalized.ease !== undefined) {
    normalized.easeType = normalized.ease;
  }

  if (
    normalized.easeTimeSeconds === undefined &&
    normalized.easeSec !== undefined
  ) {
    normalized.easeTimeSeconds = normalized.easeSec;
  }

  if (
    normalized.followModePreservationType === undefined &&
    normalized.keepFollowMode !== undefined
  ) {
    normalized.followModePreservationType = normalized.keepFollowMode;
  }

  return normalized;
}

/**
 * Normalizes free-camera config aliases to canonical keys.
 * @param {Object|undefined} config Free-camera config.
 * @returns {Object|undefined}
 */
function normalizeFreeCameraConfig(config) {
  if (!config || typeof config !== "object") {
    return config;
  }

  const normalized = { ...config };

  const directionalOffset = toDirectionalOffset(
    normalized.directionalOffset ?? normalized.position ?? normalized.offset,
  );

  if (directionalOffset) {
    normalized.heightOffset ??= resolveDirectionalOffsetValue(
      directionalOffset,
      "ground",
      0,
    );
    normalized.sideOffset ??= resolveDirectionalOffsetValue(
      directionalOffset,
      "side",
      0,
    );
    normalized.backOffset ??= resolveDirectionalOffsetValue(
      directionalOffset,
      "front",
      0,
    );
  }

  applyAliasAssignments(normalized, [
    ["easeType", "ease"],
    ["easeTimeSeconds", "easeSec"],
    ["heightOffset", "height"],
    ["backOffset", "back"],
    ["sideOffset", "side"],
    ["cameraCollisionPadding", "clipPad"],
    ["cameraCollisionStep", "clipStep"],
    ["minOrbitPitch", "minPitch"],
    ["maxOrbitPitch", "maxPitch"],
    ["focusTarget", "focus"],
  ]);

  normalized.transition = normalizeEaseTransition(normalized.transition);

  return normalized;
}

/**
 * Normalizes free-camera transition aliases to canonical keys.
 * @param {Object|undefined} transitionData Transition data.
 * @returns {Object|undefined}
 */
function normalizeFreeCameraTransition(transitionData) {
  if (!transitionData || typeof transitionData !== "object") {
    return transitionData;
  }

  const normalized = { ...transitionData };

  if (normalized.cameraId === undefined && normalized.camId !== undefined) {
    normalized.cameraId = normalized.camId;
  }

  if (normalized.toCameraId === undefined && normalized.toCamId !== undefined) {
    normalized.toCameraId = normalized.toCamId;
  }

  if (
    normalized.fromCameraId === undefined &&
    normalized.fromCamId !== undefined
  ) {
    normalized.fromCameraId = normalized.fromCamId;
  }

  if (
    normalized.returnCameraId === undefined &&
    normalized.returnCamId !== undefined
  ) {
    normalized.returnCameraId = normalized.returnCamId;
  }

  normalized.transition = normalizeEaseTransition(normalized.transition);
  normalized.returnTransition = normalizeEaseTransition(
    normalized.returnTransition,
  );

  return normalized;
}

function normalizeSimpleCameraTrackAliases(normalized) {
  if (
    !normalized.rig &&
    normalized.orbit &&
    typeof normalized.orbit === "object"
  ) {
    normalized.rig = { ...normalized.orbit, type: CAMERA_RIG_TYPES.ORBIT };
  }

  if (
    !normalized.freeCameraConfig &&
    normalized.follow &&
    typeof normalized.follow === "object"
  ) {
    normalized.freeCameraConfig = normalizeFreeCameraConfig(normalized.follow);
  }

  if (
    !normalized.freeCameraTransition &&
    normalized.transition &&
    typeof normalized.transition === "object"
  ) {
    normalized.freeCameraTransition = normalizeFreeCameraTransition(
      normalized.transition,
    );
  }
}

function normalizeCameraTrackShotSchema(normalized) {
  if (
    normalized.rig ||
    normalized.freeCameraConfig ||
    normalized.freeCameraTransition
  ) {
    return;
  }

  const shotSource =
    normalized.shot && typeof normalized.shot === "object"
      ? normalized.shot
      : undefined;
  const typeSource = shotSource ?? normalized;
  const rawType = typeSource?.type;
  const type =
    typeof rawType === "string" ? rawType.trim().toLowerCase() : rawType;
  const configSource =
    shotSource?.config && typeof shotSource.config === "object"
      ? shotSource.config
      : shotSource;

  if (!configSource || typeof configSource !== "object") {
    return;
  }

  switch (type) {
    case "free":
    case "freecam":
    case "free_camera": {
      normalized.freeCameraConfig = normalizeFreeCameraConfig(configSource);
      return;
    }
    case "transition":
    case "free_transition":
    case "freecameratransition": {
      normalized.freeCameraTransition =
        normalizeFreeCameraTransition(configSource);
      return;
    }
    case "orbit":
    case "rig": {
      normalized.rig = {
        ...configSource,
        type: configSource.type ?? CAMERA_RIG_TYPES.ORBIT,
      };
      break;
    }
    default:
    // do nothing
  }
}

function normalizeCameraTrackRigAndFreeCamAliases(normalized) {
  if (normalized.rig && typeof normalized.rig === "object") {
    const theta = resolveAngleTheta(normalized.rig.angleOffset);
    if (normalized.rig.angle === undefined && theta !== undefined) {
      normalized.rig = {
        ...normalized.rig,
        angle: theta,
      };
    }
  }

  applyAliasAssignments(normalized, [
    ["easeType", "ease"],
    ["easeTimeSeconds", "easeSec"],
    ["followModePreservationType", "keepFollowMode"],
  ]);

  const freeCameraConfigSource =
    normalized.freeCameraConfig ?? normalized.freeCam;
  if (freeCameraConfigSource && typeof freeCameraConfigSource === "object") {
    normalized.freeCameraConfig = normalizeFreeCameraConfig(
      freeCameraConfigSource,
    );
  }

  const freeCameraTransitionSource =
    normalized.freeCameraTransition ?? normalized.freeCamTo;
  if (
    freeCameraTransitionSource &&
    typeof freeCameraTransitionSource === "object"
  ) {
    normalized.freeCameraTransition = normalizeFreeCameraTransition(
      freeCameraTransitionSource,
    );
  }
}

/**
 * Normalizes camera track aliases on a keyframe.
 * @param {Object|undefined} cameraData Camera track data.
 * @returns {Object|undefined}
 */
function normalizeCameraTrack(cameraData) {
  if (!cameraData || typeof cameraData !== "object") {
    return cameraData;
  }

  const normalized = { ...cameraData };

  normalizeSimpleCameraTrackAliases(normalized);
  normalizeCameraTrackShotSchema(normalized);
  normalizeCameraTrackRigAndFreeCamAliases(normalized);

  return normalized;
}

/**
 * Resolves movement event ids from booleans or explicit strings.
 * @param {boolean|string|undefined} value Requested event behavior.
 * @param {string|undefined} defaultEventId Default event id.
 * @returns {string|undefined}
 */
function resolveMovementEventId(value, defaultEventId) {
  if (!value) {
    return undefined;
  }

  if (value === true) {
    return defaultEventId;
  }

  if (typeof value === "string") {
    return value;
  }

  return undefined;
}

/**
 * Resolves easing curve function from easing type.
 * @param {string|number|undefined} easeType Easing type.
 * @returns {(t:number)=>number}
 */
function resolveEaseFunction(easeType) {
  if (isCutEaseType(easeType)) {
    return t => (t >= 1 ? 1 : 0);
  }

  switch (easeType) {
    case CAMERA_EASE_TYPES.IN_SINE: {
      return t => 1 - Math.cos((t * Math.PI) / 2);
    }
    case CAMERA_EASE_TYPES.OUT_SINE: {
      return t => Math.sin((t * Math.PI) / 2);
    }
    case CAMERA_EASE_TYPES.IN_OUT_SINE: {
      return t => -(Math.cos(Math.PI * t) - 1) / 2;
    }
    case CAMERA_EASE_TYPES.IN_QUAD: {
      return t => t * t;
    }
    case CAMERA_EASE_TYPES.OUT_QUAD: {
      return t => 1 - (1 - t) * (1 - t);
    }
    case CAMERA_EASE_TYPES.IN_OUT_QUAD: {
      return t => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
    }
    case CAMERA_EASE_TYPES.IN_CUBIC: {
      return t => t * t * t;
    }
    case CAMERA_EASE_TYPES.OUT_CUBIC: {
      return t => 1 - (1 - t) ** 3;
    }
    case CAMERA_EASE_TYPES.IN_OUT_CUBIC: {
      return t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
    }
    case CAMERA_EASE_TYPES.LINEAR:
    default: {
      return t => t;
    }
  }
}

/**
 * Ensures a preset id is a non-empty string.
 * @param {unknown} candidate Preset candidate.
 * @param {unknown} fallback Fallback preset candidate.
 * @returns {string|undefined}
 */
function resolvePresetId(candidate, fallback) {
  if (typeof candidate === "string" && candidate.trim()) {
    return candidate;
  }

  if (typeof fallback === "string" && fallback.trim()) {
    return fallback;
  }

  return CAMERA_PRESET_IDS.FREE;
}

/**
 * Linearly interpolates numeric values.
 * @param {number} a Start value.
 * @param {number} b End value.
 * @param {number} t Interpolation factor.
 * @returns {number}
 */
function lerpNumber(a, b, t) {
  return a + (b - a) * t;
}

function wrapAngleDegrees(degrees) {
  const value = ((((degrees + 180) % 360) + 360) % 360) - 180;
  return value === -180 ? 180 : value;
}

function lerpAngleDegrees(a, b, t) {
  const start = typeof a === "number" ? a : 0;
  const end = typeof b === "number" ? b : 0;
  const delta = wrapAngleDegrees(end - start);
  return start + delta * t;
}

/**
 * Resolves FOV scalar from numeric or object-based input.
 * @param {number|{fov?:number}|undefined} fovOptions FOV options.
 * @returns {number|undefined}
 */
function getFovValue(fovOptions) {
  if (!fovOptions) {
    return undefined;
  }
  if (typeof fovOptions === "number") {
    return fovOptions;
  }
  const value = fovOptions.fov;
  return typeof value === "number" ? value : undefined;
}

/**
 * Normalizes numeric or object-based FOV input into CameraFovOptions.
 * @param {number|{fov?:number,easeOptions?:Object}|undefined} fovOptions FOV options.
 * @param {{easeType?:string|number,easeTime:number}|undefined} easeOptions Easing options.
 * @returns {{fov?:number,easeOptions?:Object}|undefined}
 */
function mergeFovOptions(fovOptions, easeOptions) {
  const fovValue = getFovValue(fovOptions);
  if (typeof fovValue !== "number") {
    return undefined;
  }

  const normalized =
    fovOptions && typeof fovOptions === "object" ? { ...fovOptions } : {};
  normalized.fov = fovValue;

  if (!easeOptions || normalized.easeOptions) {
    return normalized;
  }

  return {
    ...normalized,
    easeOptions,
  };
}

/**
 * Schedules a callback after a delay in seconds.
 * @param {typeof system} systemReference System scheduler instance.
 * @param {number} delaySeconds Delay in seconds.
 * @param {() => void} callback Callback to run.
 * @returns {number|undefined}
 */
function scheduleDelayed(systemReference, delaySeconds, callback) {
  const ticks = Math.max(0, Math.round((delaySeconds ?? 0) * TicksPerSecond));
  if (ticks <= 0) {
    callback();
    return undefined;
  }
  return systemReference.runTimeout(callback, ticks);
}

/**
 * Resolves world position from source settings and relative offsets.
 * @param {Object} options Location resolution options.
 * @returns {{x:number,y:number,z:number}}
 */
function resolveLocation({
  location,
  locationSource,
  sourceKey,
  relative,
  bindings,
  player,
  entity,
  origin,
}) {
  const sourceType = locationSource || CAMERA_LOCATION_SOURCES.WORLD;
  const originVec = toVector3(origin, { x: 0, y: 0, z: 0 });

  if (isDirectionalOffsetLike(location)) {
    const referenceEntity =
      sourceType === CAMERA_LOCATION_SOURCES.PLAYER
        ? player
        : sourceType === CAMERA_LOCATION_SOURCES.ENTITY
          ? bindings?.[sourceKey] || entity || player
          : bindings?.[sourceKey];

    if (referenceEntity?.isValid) {
      const directionalOffset = toDirectionalOffset(location);
      const resolvedLocation = rotationRelativeOffset(
        referenceEntity,
        directionalOffset,
        directionalOffset?.ignoreVertical,
        directionalOffset?.useViewDirection,
      );

      if (resolvedLocation) {
        return {
          x: resolvedLocation.x,
          y: resolvedLocation.y,
          z: resolvedLocation.z,
        };
      }
    }
  }

  if (sourceType === CAMERA_LOCATION_SOURCES.ORIGIN) {
    const loc = toVector3(location, { x: 0, y: 0, z: 0 });
    return relative ? addVec(originVec, loc) : loc;
  }

  if (sourceType === CAMERA_LOCATION_SOURCES.CAMERA) {
    const base = player?.location || originVec;
    const loc = toVector3(location, { x: 0, y: 0, z: 0 });
    return relative ? addVec(base, loc) : loc;
  }

  if (sourceType === CAMERA_LOCATION_SOURCES.ENTITY) {
    const targetEntity = bindings?.[sourceKey] || entity || player;
    const base = targetEntity?.location || originVec;
    const loc = toVector3(location, { x: 0, y: 0, z: 0 });
    return relative ? addVec(base, loc) : loc;
  }

  if (sourceType === CAMERA_LOCATION_SOURCES.WORLD) {
    return toVector3(location, originVec);
  }

  return toVector3(location, originVec);
}

function isEntityLike(value) {
  return (
    value &&
    typeof value === "object" &&
    (typeof value.getHeadLocation === "function" ||
      typeof value.getComponent === "function" ||
      typeof value.teleport === "function" ||
      typeof value.isValid === "boolean")
  );
}

function resolveEntityActionLocation(action, fallback, context) {
  if (!action || typeof action !== "object") {
    return fallback;
  }

  if (action.location !== undefined) {
    return resolveVectorOrLocation(
      {
        location: action.location,
        locationSource: action.locationSource,
        sourceKey: action.sourceKey,
        relative: action.relative,
      },
      fallback,
      context,
    );
  }

  return resolveVectorOrLocation(action, fallback, context);
}

function applyEntitySafeTeleport(entity, safeTeleport, context) {
  if (!safeTeleport) {
    return;
  }

  const location = resolveEntityActionLocation(
    safeTeleport,
    entity.location,
    context,
  );
  let targetBlock = entity.dimension.getBlock(location);
  if (safeTeleport.findNearestAir && targetBlock) {
    targetBlock = findNearestAir(targetBlock, safeTeleport.maxDistance);
  }

  if (!targetBlock) {
    return;
  }

  if (safeTeleport.alignGround) {
    const below = targetBlock.below(1);
    const targetLocation = below?.isValid
      ? below.above(1).location
      : targetBlock.location;
    entity.teleport(
      targetLocation,
      resolveEntityTeleportOptions(safeTeleport.options, entity, context),
    );
    return;
  }

  entity.teleport(
    targetBlock.location,
    resolveEntityTeleportOptions(safeTeleport.options, entity, context),
  );
}

function applyEntityTeleport(entity, teleportAction, context) {
  if (!teleportAction) {
    return;
  }

  const location = resolveEntityActionLocation(
    teleportAction,
    entity.location,
    context,
  );
  if (location) {
    entity.teleport(
      location,
      resolveEntityTeleportOptions(teleportAction.options, entity, context),
    );
  }
}

function resolveEntityTeleportOptions(options, entity, context) {
  if (!options || typeof options !== "object") {
    return options;
  }

  const resolvedOptions = { ...options };
  if (options.rotation !== undefined) {
    resolvedOptions.rotation = resolveEntityActionRotation(
      options.rotation,
      normalizeRotation(entity.getRotation?.(), { x: 0, y: 0 }),
      context,
    );
  }

  return resolvedOptions;
}

function resolveEntityRotationSource(sourceType, sourceKey, context) {
  if (sourceType === CAMERA_LOCATION_SOURCES.CAMERA) {
    return context?.player;
  }

  if (sourceType === CAMERA_LOCATION_SOURCES.ENTITY) {
    return context?.bindings?.[sourceKey] || context?.entity || context?.player;
  }

  return undefined;
}

function resolveEntityRotationSnapshot(entity, fallback) {
  if (!entity?.isValid) {
    return fallback;
  }

  const resolvedRotation = normalizeRotation(entity.getRotation?.(), fallback);

  try {
    const projectileRotationX = entity.getProperty?.(
      SETTINGS.entities.projectiles.properties.rotation.x,
    );
    const projectileRotationY = entity.getProperty?.(
      SETTINGS.entities.projectiles.properties.rotation.y,
    );

    if (isNumber(projectileRotationX) || isNumber(projectileRotationY)) {
      return {
        x: isNumber(projectileRotationX)
          ? projectileRotationX
          : (resolvedRotation?.x ?? fallback?.x ?? 0),
        y: isNumber(projectileRotationY)
          ? wrapAngleDegrees(projectileRotationY)
          : (resolvedRotation?.y ?? fallback?.y ?? 0),
      };
    }
  } catch (error) {
    logIgnoredError(
      "camera_system/camera_runtime:resolveEntityRotationSnapshot",
      error,
    );
  }

  try {
    const ptrYaw = entity.getProperty?.("ptr:rotation");
    if (isNumber(ptrYaw)) {
      return {
        x: resolvedRotation?.x ?? fallback?.x ?? 0,
        y: wrapAngleDegrees(ptrYaw),
      };
    }
  } catch (error) {
    logIgnoredError(
      "camera_system/camera_runtime:resolveEntityRotationSnapshot",
      error,
    );
  }

  return resolvedRotation;
}

function resolveEntityActionRotation(rotationAction, fallback, context) {
  if (rotationAction === undefined || rotationAction === null) {
    return fallback;
  }

  const sourceType =
    rotationAction?.rotationSource ?? rotationAction?.locationSource;
  const sourceKey = rotationAction?.sourceKey;
  const rotationOffset = resolveAngleOffset(
    rotationAction?.rotate ?? rotationAction,
  );
  const sourceEntity =
    sourceType !== undefined || sourceKey !== undefined || rotationOffset
      ? resolveEntityRotationSource(
          sourceType ?? CAMERA_LOCATION_SOURCES.ENTITY,
          sourceKey,
          context,
        )
      : undefined;

  let resolvedRotation = sourceEntity?.isValid
    ? resolveEntityRotationSnapshot(sourceEntity, fallback)
    : fallback;

  if (rotationOffset) {
    resolvedRotation = {
      x: (resolvedRotation?.x ?? 0) + (rotationOffset.getPhi?.() ?? 0),
      y: wrapAngleDegrees(
        (resolvedRotation?.y ?? 0) + (rotationOffset.getTheta?.() ?? 0),
      ),
    };
  }

  if (rotationAction && typeof rotationAction === "object") {
    resolvedRotation = {
      x: isNumber(rotationAction.x)
        ? rotationAction.x
        : (resolvedRotation?.x ?? fallback?.x ?? 0),
      y: isNumber(rotationAction.y)
        ? wrapAngleDegrees(rotationAction.y)
        : (resolvedRotation?.y ?? fallback?.y ?? 0),
    };
  }

  return normalizeRotation(resolvedRotation, fallback);
}

function applyEntityAnimation(entity, playAnimation, player) {
  const animation = playAnimation?.animation;
  if (!animation || typeof entity.playAnimation !== "function") {
    return;
  }

  let resolvedOptions = playAnimation.options;
  if (player?.isValid) {
    resolvedOptions =
      !resolvedOptions || typeof resolvedOptions !== "object"
        ? {}
        : { ...resolvedOptions };
    resolvedOptions.players = [player];
  }

  entity.playAnimation(animation, resolvedOptions);
}

function applyEntityLookAt(entity, lookAt, bindings) {
  if (!lookAt) {
    return;
  }

  const target = lookAt.targetKey
    ? bindings?.[lookAt.targetKey]
    : lookAt.location;
  if (!target) {
    return;
  }

  const targetPos = isEntityLike(target)
    ? getEntityLocationSafe(target)
    : target;
  if (!targetPos) {
    return;
  }

  const rotation = calculateRotation(entity.location, targetPos);
  entity.teleport(entity.location, { rotation });
}

function applyEntityProperties(entity, properties) {
  if (!properties || typeof entity.setProperty !== "function") {
    return;
  }

  for (const [key, value] of Object.entries(properties)) {
    entity.setProperty(key, value);
  }
}

function applyEntityMovementLock(entity, lockMovement, defaultMovementEvents) {
  if (lockMovement === undefined) {
    return;
  }

  if (lockMovement === true || lockMovement === false) {
    const eventId = lockMovement
      ? defaultMovementEvents?.on
      : defaultMovementEvents?.off;
    if (eventId) {
      entity.triggerEvent(eventId);
    }
    return;
  }

  const { on, off } = lockMovement;
  const onEventId = resolveMovementEventId(on, defaultMovementEvents?.on);
  const offEventId = resolveMovementEventId(off, defaultMovementEvents?.off);
  if (onEventId) {
    entity.triggerEvent(onEventId);
  }
  if (offEventId) {
    entity.triggerEvent(offEventId);
  }
}

function triggerEntityEvents(entity, triggerEvent) {
  if (!triggerEvent) {
    return;
  }

  const events = Array.isArray(triggerEvent) ? triggerEvent : [triggerEvent];
  for (const eventId of events) {
    if (eventId) {
      entity.triggerEvent(eventId);
    }
  }
}

function applyEntityTags(entity, tagsValue, mode) {
  if (!tagsValue) {
    return;
  }

  const tags = Array.isArray(tagsValue) ? tagsValue : [tagsValue];
  for (const tag of tags) {
    if (!tag) {
      continue;
    }

    if (mode === "add") {
      entity.addTag(tag);
    } else if (mode === "remove") {
      entity.removeTag(tag);
    } else {
      // do nothing
    }
  }
}

function isLocationOptionsObject(value) {
  return (
    value &&
    typeof value === "object" &&
    (value.locationSource !== undefined ||
      value.relative !== undefined ||
      value.sourceKey !== undefined)
  );
}

function isLocationBinding(value) {
  return (
    value &&
    typeof value === "object" &&
    !isEntityLike(value) &&
    value.location &&
    typeof value.location === "object"
  );
}

/**
 * Resolve a vector-like or location-options object into an absolute world position.
 *
 * Supported inputs:
 * - `{x,y,z}` (treated as absolute world coordinates)
 * - `{ location: {x,y,z}, relative?, locationSource?, sourceKey? }` (location binding)
 * - `{x,y,z, relative?, locationSource?, sourceKey? }` (inline location options)
 */
function resolveVectorOrLocation(value, fallback, context) {
  if (!value || typeof value !== "object") {
    return fallback;
  }

  const { bindings, player, entity, origin } = context || {};

  if (isLocationBinding(value)) {
    if (isLocationOptionsObject(value)) {
      return resolveLocation({
        location: value.location,
        locationSource: value.locationSource,
        sourceKey: value.sourceKey,
        relative: value.relative,
        bindings,
        player,
        entity,
        origin,
      });
    }
    return toVector3(value.location, fallback);
  }

  if (isLocationOptionsObject(value)) {
    const loc =
      value.location && typeof value.location === "object"
        ? value.location
        : value;
    return resolveLocation({
      location: loc,
      locationSource: value.locationSource,
      sourceKey: value.sourceKey,
      relative: value.relative,
      bindings,
      player,
      entity,
      origin,
    });
  }

  return toVector3(value, fallback);
}

function resolveTargetPosition(candidate, targetMode, context) {
  if (!candidate) {
    return undefined;
  }

  if (isEntityLike(candidate)) {
    return resolveEntityFocusPoint(candidate, targetMode);
  }

  const fallback = toVector3(context?.origin, { x: 0, y: 0, z: 0 });
  return resolveVectorOrLocation(candidate, fallback, context);
}

/**
 * Calculates pitch/yaw from origin to target location.
 * @param {{x:number,y:number,z:number}} from Origin location.
 * @param {{x:number,y:number,z:number}} to Target location.
 * @returns {{x:number,y:number}}
 */
function calculateRotation(from, to) {
  const delta = BVector3.subtract(BVector3.from(to), BVector3.from(from));
  const yaw = (-Math.atan2(delta.x, delta.z) * 180) / Math.PI;
  const horizontal = new BVector2(delta.x, delta.z);
  const distance = horizontal.magnitude() || 0.0001;
  const pitch = (-Math.atan2(delta.y, distance) * 180) / Math.PI;
  return { x: pitch, y: yaw };
}

function shouldUseNativeLookAtTarget(lookAt, cameraData) {
  if (!lookAt) {
    return false;
  }

  const weight = lookAt.weight ?? lookAt.soft ?? 1;
  return weight >= 1 && cameraData?.rotate === undefined;
}

function applyNativeLookAtTarget(setOptions, lookAt, target, targetPos) {
  if (!setOptions || !lookAt) {
    return false;
  }

  if (lookAt.targetKey && isEntityLike(target)) {
    setOptions.facingEntity = target;
    delete setOptions.facingLocation;
    delete setOptions.rotation;
    return true;
  }

  if (targetPos) {
    setOptions.facingLocation = targetPos;
    delete setOptions.facingEntity;
    delete setOptions.rotation;
    return true;
  }

  return false;
}

function coerceFacingToExplicitRotation(
  setOptions,
  { bindings, player, origin, freeCameraBridge, targetPointMode },
) {
  if (!setOptions || typeof setOptions !== "object") {
    return false;
  }

  let targetPos;
  if (setOptions.facingLocation) {
    targetPos = setOptions.facingLocation;
  } else if (setOptions.facingEntity !== undefined) {
    const facingCandidate = isEntityLike(setOptions.facingEntity)
      ? setOptions.facingEntity
      : typeof setOptions.facingEntity === "string"
        ? bindings?.[setOptions.facingEntity]
        : undefined;

    targetPos = resolveTargetPosition(
      facingCandidate,
      resolveTargetPointMode(targetPointMode),
      { bindings, player, origin },
    );
  } else {
    // do nothing
  }

  if (!targetPos) {
    delete setOptions.facingEntity;
    delete setOptions.facingLocation;
    return false;
  }

  const baseLocation =
    setOptions.location ||
    getPreviousCameraLocation(
      player,
      freeCameraBridge,
      player?.location || origin,
    );

  if (!baseLocation) {
    delete setOptions.facingEntity;
    delete setOptions.facingLocation;
    return false;
  }

  setOptions.rotation = calculateRotation(baseLocation, targetPos);
  delete setOptions.facingEntity;
  delete setOptions.facingLocation;
  return true;
}

/**
 * Blends two rotations by weight.
 * @param {{x:number,y:number}} base Base rotation.
 * @param {{x:number,y:number}} target Target rotation.
 * @param {number} weight Blend weight.
 * @returns {{x:number,y:number}}
 */
function blendRotation(base, target, weight) {
  const t = Math.min(1, Math.max(0, weight ?? 1));
  return {
    x: base.x + (target.x - base.x) * t,
    y: base.y + (target.y - base.y) * t,
  };
}

function resolveRigTargetPosition(
  rig,
  bindings,
  origin,
  targetPointModeFallback,
  player,
  entity,
) {
  const target = rig.targetKey ? bindings?.[rig.targetKey] : undefined;
  if (
    rig.targetKey &&
    (!target || target.isValid === false) &&
    !rig.targetLocation
  ) {
    return { target, targetPos: undefined };
  }

  const targetMode = resolveTargetPointMode(
    rig.targetPointMode ?? targetPointModeFallback,
  );
  const context = { bindings, player, entity, origin };
  let targetPos = toVector3(origin, { x: 0, y: 0, z: 0 });
  if (rig.targetLocation) {
    targetPos = resolveTargetPosition(rig.targetLocation, targetMode, context);
  } else if (target) {
    targetPos = resolveTargetPosition(target, targetMode, context);
  } else {
    // do nothing
  }

  return { target, targetPos };
}

function resolveOrbitDirectionalOffsetLocation(rig, target, player) {
  const orbitDirectionalOffset = toDirectionalOffset(rig.directionalOffset);
  const referenceEntity = target?.isValid ? target : player;
  if (!orbitDirectionalOffset || !referenceEntity?.isValid) {
    return undefined;
  }

  try {
    let directionOverride;
    try {
      const ptrYaw = referenceEntity.getProperty?.("ptr:rotation");
      if (typeof ptrYaw === "number" && Number.isFinite(ptrYaw)) {
        directionOverride = BVector3.fromAngles(ptrYaw, 0);
      }
    } catch (error) {
      logIgnoredError(
        "camera_system/camera_runtime:resolveOrbitDirectionalOffsetLocation",
        error,
      );
    }

    return rotationRelativeOffset(
      referenceEntity,
      orbitDirectionalOffset,
      orbitDirectionalOffset.ignoreVertical,
      orbitDirectionalOffset.useViewDirection,
      directionOverride,
    );
  } catch {
    return undefined;
  }
}

function calculateOrbitPosition(rig, previousCameraLocation, targetPos) {
  let angle = 0;
  if (typeof rig.angle === "number" && Number.isFinite(rig.angle)) {
    angle = rig.angle * (Math.PI / 180);
  } else if (
    previousCameraLocation &&
    typeof previousCameraLocation === "object" &&
    Number.isFinite(previousCameraLocation.x) &&
    Number.isFinite(previousCameraLocation.z)
  ) {
    const dx = previousCameraLocation.x - targetPos.x;
    const dz = previousCameraLocation.z - targetPos.z;
    angle = Math.atan2(dz, dx);
  } else {
    // do nothing
  }

  const radius = rig.radius ?? 6;
  const height = rig.height ?? 2;
  return {
    x: targetPos.x + Math.cos(angle) * radius,
    y: targetPos.y + height,
    z: targetPos.z + Math.sin(angle) * radius,
  };
}

/**
 * Resolves rig camera location from rig settings and target bindings.
 * @param {Object} rig Rig configuration.
 * @param {Object} bindings Entity bindings.
 * @param {{x:number,y:number,z:number}} origin Fallback origin.
 * @param {{x:number,y:number,z:number}|undefined} previousCameraLocation Previous camera position (used for orbit shortest-path selection).
 * @param {string|undefined} targetPointModeFallback Optional target point mode to use when rig.targetPointMode is undefined.
 * @param {Object} [player] Player the rig belongs to.
 * @param {Object} [entity] Entity the rig is attached to.
 * @returns {{x:number,y:number,z:number}}
 */
function resolveRigLocation(
  rig,
  bindings,
  origin,
  previousCameraLocation,
  targetPointModeFallback,
  player,
  entity,
) {
  const { target, targetPos } = resolveRigTargetPosition(
    rig,
    bindings,
    origin,
    targetPointModeFallback,
    player,
    entity,
  );
  if (!targetPos) {
    return undefined;
  }

  if (rig.type === CAMERA_RIG_TYPES.ORBIT) {
    const directionalOffsetLocation = resolveOrbitDirectionalOffsetLocation(
      rig,
      target,
      player,
    );
    if (directionalOffsetLocation) {
      return directionalOffsetLocation;
    }

    return calculateOrbitPosition(rig, previousCameraLocation, targetPos);
  }

  const offset = toVector3(rig.offset, { x: 0, y: 0, z: 0 });
  return addVec(targetPos, offset);
}

/**
 * Applies a timed FOV ramp using easing.
 * @param {any} camera Player camera interface.
 * @param {Object} ramp Ramp config.
 * @param {typeof system} systemReference System scheduler instance.
 * @returns {number|undefined}
 */
function applyFovRamp(camera, ramp, systemReference) {
  if (!camera || !ramp) {
    return undefined;
  }

  const durationSeconds = Math.max(0, ramp.durationSeconds ?? 0);
  const totalTicks = Math.max(1, Math.round(durationSeconds * TicksPerSecond));
  const from = ramp.from;
  const to = ramp.to;

  if (!isNumber(from) || !isNumber(to)) {
    return undefined;
  }

  const easeFn = resolveEaseFunction(ramp.easeType || CAMERA_EASE_TYPES.LINEAR);
  let tick = 0;
  const runId = systemReference.runInterval(() => {
    tick += 1;
    const t = Math.min(1, tick / totalTicks);
    const eased = easeFn(t);
    const value = from + (to - from) * eased;
    camera.setFov({ fov: value });

    if (t >= 1) {
      systemReference.clearRun(runId);
    }
  }, 1);

  return runId;
}

/**
 * Applies entity action payload at a keyframe.
 * @param {Object} options Action context.
 * @returns {void}
 */
function applyActionsToEntity({
  entity,
  actions,
  defaultMovementEvents,
  bindings,
  player,
  origin,
  systemRef,
}) {
  if (!entity || !entity.isValid || !actions) {
    return;
  }

  const locationContext = { bindings, player, entity, origin };

  applyEntitySafeTeleport(entity, actions.safeTeleport, locationContext);
  applyEntityTeleport(entity, actions.teleport, locationContext);
  applyEntityAnimation(entity, actions.playAnimation, player);
  applyEntityLookAt(entity, actions.lookAt, bindings);
  applyEntityProperties(entity, actions.setProperty);
  applyEntityMovementLock(entity, actions.lockMovement, defaultMovementEvents);
  triggerEntityEvents(entity, actions.triggerEvent);
  applyEntityTags(entity, actions.addTag, "add");
  applyEntityTags(entity, actions.removeTag, "remove");

  const effectContext = { bindings, player, origin };
  scheduleEffects(
    systemRef,
    actions.soundEffects,
    effectContext,
    entity,
    "sound",
  );
  scheduleEffects(
    systemRef,
    actions.particleEffects,
    effectContext,
    entity,
    "particle",
  );
  scheduleEffects(
    systemRef,
    actions.entityEffects,
    effectContext,
    entity,
    "entity",
  );
}

/**
 * Schedules sound/particle/entity effects with per-effect delays.
 * @param {typeof system} systemReference System scheduler instance.
 * @param {Object|Object[]|undefined} effects Effects payload.
 * @param {Object} context Runtime context.
 * @param {any} entity Source entity.
 * @param {"sound"|"particle"|"entity"} type Effect type.
 * @returns {void}
 */
function scheduleEffects(systemReference, effects, context, entity, type) {
  if (!effects) {
    return;
  }

  const items = Array.isArray(effects) ? effects : [effects];
  for (const effect of items) {
    if (!effect) {
      continue;
    }

    const delay = effect.delaySeconds ?? 0;
    scheduleDelayed(systemReference, delay, () => {
      if (type === "entity") {
        EffectRegistry.applyEntityEffect(entity, effect);
        return;
      }

      const locationSource = effect.locationSource || "entity";
      const sourceKey = effect.sourceKey;
      const location = resolveLocation({
        location: effect.location,
        locationSource,
        sourceKey,
        relative: effect.relative ?? true,
        bindings: context.bindings,
        player: context.player,
        entity,
        origin: context.origin,
      });

      if (type === "sound") {
        entity.dimension?.playSound(effect.id, location, {
          pitch: effect.pitch ?? 1,
          volume: effect.volume ?? 1,
        });
        return;
      }

      if (type === "particle") {
        entity.dimension?.spawnParticle(effect.id, location);
      }
    });
  }
}

/**
 * Applies timeline-level global effects.
 * @param {Object} options Effect context.
 * @returns {void}
 */
function applyGlobalEffects({ keyframe, bindings, player, origin, systemRef }) {
  const effects = keyframe?.effects;
  if (!effects) {
    return;
  }

  const sourceKey = effects.sourceKey;
  const source = sourceKey ? bindings?.[sourceKey] : player;
  const entity = source?.isValid ? source : player;
  if (!entity) {
    return;
  }

  const context = { bindings, player, origin };
  scheduleEffects(systemRef, effects.soundEffects, context, entity, "sound");
  scheduleEffects(
    systemRef,
    effects.particleEffects,
    context,
    entity,
    "particle",
  );
  scheduleEffects(systemRef, effects.entityEffects, context, entity, "entity");
}

/**
 * Applies grouped entity actions resolved by selector.
 * @param {Object} options Group action context.
 * @returns {void}
 */
function applyEntityGroups({
  groups,
  bindings,
  player,
  origin,
  systemRef,
  defaultMovementEvents,
}) {
  if (!Array.isArray(groups) || groups.length === 0) {
    return;
  }

  const dimension = player?.dimension || world.getDimension("overworld");
  for (const group of groups) {
    const selector = group.selector || {};
    const options = {};
    if (selector.tags) {
      options.tags = selector.tags;
    }
    if (selector.families) {
      options.families = selector.families;
    }
    if (selector.typeIds) {
      options.type = selector.typeIds;
    }

    const entities = dimension.getEntities(options);
    for (const entity of entities) {
      applyActionsToEntity({
        entity,
        actions: group.actions,
        defaultMovementEvents,
        bindings,
        player,
        origin,
        systemRef,
      });
    }
  }
}

/**
 * Applies all camera operations for a keyframe.
 * @param {Object} options Camera action context.
 * @returns {void}
 */
function applyCameraActions({
  camera,
  keyframe,
  runtime,
  easeOptions,
  fovEaseOptions,
  segmentEaseOptions,
  segmentFovEaseOptions,
  followModePreservationType,
  nextCamera,
  segmentDurationSeconds,
  defaultPreset,
  bindings,
  player,
  origin,
  systemRef,
  logger,
  freeCameraBridge,
  forceCameraInputLocked,
  onCameraCleared,
}) {
  if (!camera || !camera.isValid || !keyframe.camera) {
    return;
  }

  const cameraData = keyframe.camera;
  let handoffFreeCamera;

  const keyframeEaseType = resolveEasingType(
    cameraData?.easeType ||
      cameraData?.ease ||
      keyframe?.easeType ||
      keyframe?.ease,
  );

  const keyframeFreeCameraConfig =
    cameraData.freeCameraConfig &&
    typeof cameraData.freeCameraConfig === "object"
      ? cameraData.freeCameraConfig
      : cameraData.freeCamera && typeof cameraData.freeCamera === "object"
        ? cameraData.freeCamera
        : undefined;

  // Special-case: rotate marker keyframe that immediately CUTs to the next
  // keyframe (e.g. 8.00 -> 8.01). The actual rotation is applied over the
  // previous segment. Applying this follow config (or canceling the running
  // rotate schedule) for ~1 tick can cause a visible snap at the marker time.
  const markerRotate = resolveAngleOffset(cameraData.rotate);
  const nextEaseTypeForMarker = resolveEasingType(nextCamera?.easeType);
  if (
    keyframeFreeCameraConfig &&
    markerRotate &&
    typeof segmentDurationSeconds === "number" &&
    segmentDurationSeconds > 0 &&
    segmentDurationSeconds < 0.15 &&
    isCutEaseType(nextEaseTypeForMarker)
  ) {
    return;
  }

  // Invalidate any delayed camera callbacks from older keyframes.
  const playerKey = getPlayerKey(player);
  const nextSession = (cameraActionSessionByPlayerKey.get(playerKey) ?? 0) + 1;
  cameraActionSessionByPlayerKey.set(playerKey, nextSession);

  // If the free camera tick is active, it will continuously re-apply its own
  // transforms and can override one-off setCamera rig/lookAt keyframes.
  // Stop it (without clearing) when this keyframe is about to drive the camera.
  // IMPORTANT: do this before resolving AngleOffset so the preserved rotation
  // is captured from the focused free-camera state (not the player's rotation).
  if (
    freeCameraBridge &&
    !keyframeFreeCameraConfig &&
    !cameraData.freeCameraTransition
  ) {
    const activeFreeCamera = freeCameraBridge.getActiveFreeCamera?.();
    if (activeFreeCamera?.player?.id === player?.id) {
      const willDriveCameraDirectly =
        Boolean(cameraData.rig) ||
        Boolean(cameraData.lookAt) ||
        Boolean(cameraData.blend) ||
        cameraData.setDefault === true ||
        cameraData.preset !== undefined ||
        (cameraData.setOptions && typeof cameraData.setOptions === "object") ||
        cameraData.location !== undefined ||
        cameraData.position !== undefined ||
        cameraData.rotation !== undefined ||
        cameraData.rotate !== undefined ||
        cameraData.facingEntity !== undefined ||
        cameraData.facingLocation !== undefined;

      if (willDriveCameraDirectly) {
        try {
          handoffFreeCamera = activeFreeCamera;

          // If the free camera was using native easing, its internal
          // currentRotation/currentLocation can represent the *target* for the
          // current easing window rather than the exact pose currently
          // displayed. Force one instant tick before capturing so the handoff
          // base pose matches what the player sees.
          try {
            if (isCutEaseType(keyframeEaseType)) {
              const existingForce =
                typeof activeFreeCamera.forceInstantTicks === "number"
                  ? activeFreeCamera.forceInstantTicks
                  : 0;
              activeFreeCamera.forceInstantTicks = Math.max(existingForce, 1);
              activeFreeCamera.tick?.();
            }
          } catch (error) {
            logIgnoredError(
              "camera_system/camera_runtime:applyCameraActions",
              error,
            );
          }

          captureFreeCameraRotation(player, freeCameraBridge);
          if (activeFreeCamera.currentLocation) {
            rememberLocation(player, activeFreeCamera.currentLocation);
          }
          freeCameraBridge.stopFreeCamera?.({
            clearCamera: false,
            restoreInput: false,
          });
        } catch (error) {
          logIgnoredError(
            "camera_system/camera_runtime:applyCameraActions",
            error,
          );
        }
      }
    }
  }

  let resolvedSetOptions = resolveCameraSetOptions(cameraData, {
    bindings,
    player,
    origin,
  });

  // If we just stopped a free camera and the keyframe uses a DirectionalOffset
  // ("position" shorthand), compute the location using free-camera semantics
  // to avoid subtle handoff offsets (freecam math != rotationRelativeOffset).
  const handoffOffsetCandidate = cameraData.location ?? cameraData.position;
  if (
    handoffFreeCamera &&
    isDirectionalOffsetLike(handoffOffsetCandidate) &&
    player?.isValid
  ) {
    // For CUT handoffs specifically, prefer the exact collision-safe freecam
    // location to avoid any jump caused by recomputing offsets (collision
    // resolution, head anchoring, etc.). This keeps the camera perfectly still
    // while switching from facingLocation-driven freecam to explicit rotation.
    if (
      isCutEaseType(keyframeEaseType) &&
      handoffFreeCamera.currentLocation &&
      isNumber(handoffFreeCamera.currentLocation.x) &&
      isNumber(handoffFreeCamera.currentLocation.y) &&
      isNumber(handoffFreeCamera.currentLocation.z)
    ) {
      if (!resolvedSetOptions) {
        resolvedSetOptions = {};
      }
      resolvedSetOptions.location = {
        x: handoffFreeCamera.currentLocation.x,
        y: handoffFreeCamera.currentLocation.y,
        z: handoffFreeCamera.currentLocation.z,
      };
    } else {
      try {
        const directionalOffset = toDirectionalOffset(handoffOffsetCandidate);
        if (directionalOffset) {
          const temporary = new FreeCamera({
            player,
            distance:
              typeof handoffFreeCamera.currentDistance === "number"
                ? handoffFreeCamera.currentDistance
                : handoffFreeCamera.distance,
            heightOffset: resolveDirectionalOffsetValue(
              directionalOffset,
              "ground",
              handoffFreeCamera.heightOffset ?? 0.5,
            ),
            sideOffset: resolveDirectionalOffsetValue(
              directionalOffset,
              "side",
              handoffFreeCamera.sideOffset ?? 0,
            ),
            backOffset: resolveDirectionalOffsetValue(
              directionalOffset,
              "front",
              handoffFreeCamera.backOffset ?? 0,
            ),
            followMode: handoffFreeCamera.followMode,
            useHeadLocationForPosition:
              handoffFreeCamera.useHeadLocationForPosition,
            minOrbitPitch: handoffFreeCamera.minOrbitPitch,
            maxOrbitPitch: handoffFreeCamera.maxOrbitPitch,
            focusTarget: handoffFreeCamera.focusTarget,
            targetPointMode: handoffFreeCamera.targetPointMode,
          });

          // Preserve orbit/freeze state only for NONE-mode handoffs.
          // For other follow modes, DirectionalOffset should be resolved from
          // the player's current rotation (not a potentially stale orbit yaw).
          if (temporary.followMode === CAMERA_FOLLOW_MODES.NONE) {
            temporary.currentOrbitYaw = handoffFreeCamera.currentOrbitYaw;
            temporary.currentOrbitPitch = handoffFreeCamera.currentOrbitPitch;
            temporary.frozenPlayerPosition =
              handoffFreeCamera.frozenPlayerPosition;
            temporary.frozenPlayerRotation =
              handoffFreeCamera.frozenPlayerRotation;
          }
          temporary.currentDistance =
            typeof handoffFreeCamera.currentDistance === "number"
              ? handoffFreeCamera.currentDistance
              : temporary.distance;

          const loc = temporary.getCameraPosition(player.location);
          if (loc && isNumber(loc.x) && isNumber(loc.y) && isNumber(loc.z)) {
            if (!resolvedSetOptions) {
              resolvedSetOptions = {};
            }
            resolvedSetOptions.location = { x: loc.x, y: loc.y, z: loc.z };
          }
        }
      } catch (error) {
        logIgnoredError(
          "camera_system/camera_runtime:applyCameraActions",
          error,
        );
      }
    }
  }

  // For CUT handoffs, make the camera pose match what the player is
  // *currently seeing* from the free camera.
  //
  // Bedrock can render slightly differently between presets and between
  // rotation-vs-facing modes. When the next keyframe is intended to be a pure
  // handoff/hold (no rotation), lock the rotation exactly
  // to the last freecam rotation so there is no visible snap.
  if (
    handoffFreeCamera &&
    isCutEaseType(keyframeEaseType) &&
    handoffFreeCamera.currentRotation &&
    isNumber(handoffFreeCamera.currentRotation.x) &&
    isNumber(handoffFreeCamera.currentRotation.y)
  ) {
    const wantsHoldRotation =
      cameraData.rotation === undefined && cameraData.rotate === undefined;

    const wantsExplicitRotationMode =
      !cameraData.lookAt &&
      !cameraData.rig &&
      cameraData.facingEntity === undefined &&
      cameraData.facingLocation === undefined;

    if (wantsHoldRotation && wantsExplicitRotationMode) {
      if (!resolvedSetOptions) {
        resolvedSetOptions = {};
      }
      resolvedSetOptions.rotation = {
        x: handoffFreeCamera.currentRotation.x,
        y: handoffFreeCamera.currentRotation.y,
      };
    }
  }
  const segmentDuration = Math.max(0, segmentDurationSeconds ?? 0);

  const shouldForceCameraInputLocked = forceCameraInputLocked === true;

  const shouldPreserveRotation = cameraData.preserveRotation !== false;
  const canInheritRotation =
    shouldPreserveRotation &&
    resolvedSetOptions &&
    resolvedSetOptions.rotation === undefined &&
    resolvedSetOptions.facingEntity === undefined &&
    resolvedSetOptions.facingLocation === undefined &&
    !cameraData.lookAt &&
    !cameraData.rig;
  if (canInheritRotation) {
    resolvedSetOptions.rotation = getPreservedRotation(player);
  }

  const resolveNextFreeCameraTarget = currentBaseConfig => {
    if (!nextCamera || typeof nextCamera !== "object" || !freeCameraBridge) {
      return undefined;
    }

    const nextFreeCameraConfig =
      nextCamera.freeCameraConfig &&
      typeof nextCamera.freeCameraConfig === "object"
        ? nextCamera.freeCameraConfig
        : nextCamera.freeCamera && typeof nextCamera.freeCamera === "object"
          ? nextCamera.freeCamera
          : undefined;
    if (nextFreeCameraConfig) {
      return {
        config: mergeFreeCameraConfigs(currentBaseConfig, nextFreeCameraConfig),
        transition:
          nextFreeCameraConfig.transition &&
          typeof nextFreeCameraConfig.transition === "object"
            ? nextFreeCameraConfig.transition
            : undefined,
      };
    }

    const nextFreeCameraTransition = nextCamera.freeCameraTransition;
    if (
      !nextFreeCameraTransition ||
      typeof nextFreeCameraTransition !== "object"
    ) {
      return undefined;
    }

    const targetCameraId =
      nextFreeCameraTransition.cameraId ||
      nextFreeCameraTransition.toCameraId ||
      nextFreeCameraTransition.presetId;
    if (!targetCameraId) {
      return undefined;
    }

    const targetCamera = freeCameraBridge.getRegisteredCamera?.(targetCameraId);
    if (!targetCamera?.camera) {
      return undefined;
    }

    return {
      config: mergeFreeCameraConfigs(currentBaseConfig, targetCamera.camera),
      transition:
        nextFreeCameraTransition.transition &&
        typeof nextFreeCameraTransition.transition === "object"
          ? nextFreeCameraTransition.transition
          : targetCamera.transition,
    };
  };

  if (keyframeFreeCameraConfig && freeCameraBridge) {
    let activeFreeCamera = freeCameraBridge.getActiveFreeCamera?.();
    if (activeFreeCamera) {
      if (
        shouldForceCameraInputLocked &&
        activeFreeCamera?.player?.id === player.id
      ) {
        try {
          activeFreeCamera.setForcedCameraInputLocked?.(true);
        } catch (error) {
          logIgnoredError(
            "camera_system/camera_runtime:applyCameraActions",
            error,
          );
        }
      }

      const inferredTransition = toFreeCameraTransition(
        easeOptions,
        keyframeFreeCameraConfig.transition,
      );
      const effectiveTransition = inferredTransition
        ? { ...inferredTransition }
        : {};
      if (
        followModePreservationType ===
          CAMERA_FOLLOW_MODE_PRESERVATION_TYPES.CURRENT &&
        effectiveTransition.followModePreservationType === undefined
      ) {
        effectiveTransition.followModePreservationType =
          CAMERA_FOLLOW_MODE_PRESERVATION_TYPES.CURRENT;
      }
      activeFreeCamera.transitionToConfig(
        keyframeFreeCameraConfig,
        effectiveTransition,
      );
    } else if (keyframeFreeCameraConfig.startIfMissing === false) {
      return;
    } else {
      // When starting a free camera from a timeline keyframe, apply the
      // keyframe's easing semantics to the free-camera's initial ease.
      const inferredStartTransition = toFreeCameraTransition(
        easeOptions,
        keyframeFreeCameraConfig.transition,
      );

      const startConfig = shouldForceCameraInputLocked
        ? { ...keyframeFreeCameraConfig, forceCameraInputLocked: true }
        : { ...keyframeFreeCameraConfig };

      if (
        inferredStartTransition?.easeType !== undefined &&
        startConfig.easeType === undefined && // Only propagate non-instant easing into the free camera. For CUT
        // keyframes we want an instant start, but we don't want to permanently
        // disable the free camera's own smoothing/easing defaults.
        !isCutEaseType(inferredStartTransition.easeType)
      ) {
        startConfig.easeType = inferredStartTransition.easeType;
      }

      if (
        typeof inferredStartTransition?.easeTimeSeconds === "number" &&
        startConfig.easeTimeSeconds === undefined && // Same rule as easeType: avoid locking the free camera into
        // easeTimeSeconds=0 just because the timeline keyframe is CUT.
        !isCutEaseType(inferredStartTransition?.easeType)
      ) {
        startConfig.easeTimeSeconds = Math.max(
          0,
          inferredStartTransition.easeTimeSeconds,
        );
      }

      // If the timeline keyframe is instant, force a true CUT for the first
      // free-camera tick, but keep normal smoothing defaults intact.
      const isInstantStart =
        isCutEaseType(inferredStartTransition?.easeType) ||
        (typeof inferredStartTransition?.easeTimeSeconds === "number" &&
          inferredStartTransition.easeTimeSeconds <= 0);
      if (isInstantStart) {
        startConfig.forceInstantTicks = Math.max(
          1,
          typeof startConfig.forceInstantTicks === "number"
            ? startConfig.forceInstantTicks
            : 0,
        );
      }

      activeFreeCamera = freeCameraBridge.startFreeCamera?.(
        player,
        startConfig,
      );
    }

    if (
      shouldForceCameraInputLocked &&
      activeFreeCamera?.player?.id === player.id
    ) {
      try {
        activeFreeCamera.setForcedCameraInputLocked?.(true);
      } catch (error) {
        logIgnoredError(
          "camera_system/camera_runtime:applyCameraActions",
          error,
        );
      }
    }

    if (activeFreeCamera && segmentDuration > 0) {
      const nextTarget = resolveNextFreeCameraTarget(keyframeFreeCameraConfig);
      if (nextTarget?.config) {
        const nextSegmentEaseType =
          resolveEasingType(nextCamera?.easeType) ||
          resolveEasingType(cameraData.easeType) ||
          nextTarget.transition?.easeType;

        // IMPORTANT: Do NOT pre-transition into a CUT/STEP next keyframe.
        // That would apply the next pose immediately (making the current
        // keyframe appear wrong, and causing the future keyframe to "do
        // nothing" when its time arrives). Instead, allow the next keyframe
        // to apply at its scheduled time.
        if (!isCutEaseType(nextSegmentEaseType)) {
          const segmentTransition = {
            ...nextTarget.transition,
            easeType: nextSegmentEaseType,
            easeTimeSeconds: segmentDuration,
          };

          // When easing from one follow keyframe to the next, applying boolean
          // focus changes (focusTarget) at the *start* of the segment can
          // override the current keyframe in the same tick it is applied.
          //
          // Preserve current follow/focus until the transition completes when
          // focusTarget differs, unless the author explicitly set a preservation
          // type on the transition.
          if (segmentTransition.followModePreservationType === undefined) {
            const currentFocus = keyframeFreeCameraConfig?.focusTarget;
            const nextFocus = nextTarget?.config?.focusTarget;
            if (
              typeof currentFocus === "boolean" &&
              typeof nextFocus === "boolean" &&
              currentFocus !== nextFocus
            ) {
              segmentTransition.followModePreservationType =
                CAMERA_FOLLOW_MODE_PRESERVATION_TYPES.CURRENT;
            }
          }

          // Support timeline `rotate` while using free camera configs.
          // This applies a relative delta over the segment duration.
          const nextRotate = resolveAngleOffset(nextCamera?.rotate);
          const scheduledVanillaRotate = nextRotate
            ? scheduleVanillaRotateTransition({
                activeFreeCamera,
                camera,
                freeCameraBridge,
                nextRotate,
                nextSegmentEaseType,
                nextSession,
                player,
                playerKey,
                segmentDuration,
                systemRef,
              })
            : false;

          if (!scheduledVanillaRotate && nextRotate) {
            applySegmentRotateFallback(segmentTransition, nextRotate);
          }

          if (!scheduledVanillaRotate) {
            if (
              followModePreservationType ===
                CAMERA_FOLLOW_MODE_PRESERVATION_TYPES.CURRENT &&
              segmentTransition.followModePreservationType === undefined
            ) {
              segmentTransition.followModePreservationType =
                CAMERA_FOLLOW_MODE_PRESERVATION_TYPES.CURRENT;
            }
            activeFreeCamera.transitionToConfig(
              nextTarget.config,
              segmentTransition,
            );
          }
        }
      }
    }

    if (cameraData.applyCutsceneCamera !== true) {
      return;
    }
  }

  if (cameraData.freeCameraTransition && freeCameraBridge) {
    const transitionData = cameraData.freeCameraTransition;
    const targetCameraId =
      transitionData.cameraId ||
      transitionData.toCameraId ||
      transitionData.presetId;

    if (targetCameraId) {
      const vanillaPresetId = resolveVanillaCameraId(targetCameraId);
      if (vanillaPresetId) {
        const fromCamera = transitionData.fromCameraId
          ? freeCameraBridge.getRegisteredCamera?.(transitionData.fromCameraId)
          : undefined;

        let activeFreeCamera = freeCameraBridge.getActiveFreeCamera?.();
        if (!activeFreeCamera) {
          if (transitionData.startIfMissing === false) {
            return;
          }

          const initialConfig =
            fromCamera?.camera ||
            getFreeCameraMimicConfigForVanilla(vanillaPresetId);
          const startConfig = shouldForceCameraInputLocked
            ? { ...initialConfig, forceCameraInputLocked: true }
            : initialConfig;
          activeFreeCamera = freeCameraBridge.startFreeCamera?.(
            player,
            startConfig,
          );
        }

        if (activeFreeCamera) {
          if (
            shouldForceCameraInputLocked &&
            activeFreeCamera?.player?.id === player.id
          ) {
            try {
              activeFreeCamera.setForcedCameraInputLocked?.(true);
            } catch (error) {
              logIgnoredError(
                "camera_system/camera_runtime:applyCameraActions",
                error,
              );
            }
          }

          const transitionOverride =
            transitionData.transition &&
            typeof transitionData.transition === "object"
              ? transitionData.transition
              : undefined;
          const inferredTransition = toFreeCameraTransition(
            easeOptions,
            transitionOverride,
          );
          const effectiveTransition = {
            ...inferredTransition,
            ...transitionOverride,
          };
          if (
            followModePreservationType ===
              CAMERA_FOLLOW_MODE_PRESERVATION_TYPES.CURRENT &&
            effectiveTransition.followModePreservationType === undefined
          ) {
            effectiveTransition.followModePreservationType =
              CAMERA_FOLLOW_MODE_PRESERVATION_TYPES.CURRENT;
          }

          const mimicConfig =
            getFreeCameraMimicConfigForVanilla(vanillaPresetId);
          activeFreeCamera.transitionToConfig(mimicConfig, effectiveTransition);

          const swapDelaySeconds =
            typeof effectiveTransition.easeTimeSeconds === "number"
              ? Math.max(0, effectiveTransition.easeTimeSeconds)
              : typeof mimicConfig.easeTimeSeconds === "number"
                ? Math.max(0, mimicConfig.easeTimeSeconds)
                : 0;

          scheduleDelayed(systemRef, swapDelaySeconds, () => {
            if (!player?.isValid) {
              return;
            }

            try {
              if (!player.hasTag?.(getVanillaCameraOverrideTag())) {
                player.addTag?.(getVanillaCameraOverrideTag());
              }
            } catch (error) {
              logIgnoredError(
                "camera_system/camera_runtime:applyCameraActions",
                error,
              );
            }

            try {
              player.camera?.setCamera(vanillaPresetId, {
                easeOptions: {
                  easeType: CAMERA_EASE_TYPES.CUT,
                  easeTime: 0,
                },
              });
            } catch {
              try {
                player.camera?.setCamera(vanillaPresetId);
              } catch (error) {
                logIgnoredError(
                  "camera_system/camera_runtime:applyCameraActions",
                  error,
                );
              }
            }

            // Stop the free camera without clearing the just-set vanilla preset.
            freeCameraBridge.stopFreeCamera?.({ clearCamera: false });
          });
        }

        if (cameraData.applyCutsceneCamera !== true) {
          return;
        }
      }

      const targetCamera =
        freeCameraBridge.getRegisteredCamera?.(targetCameraId);
      const fromCamera = transitionData.fromCameraId
        ? freeCameraBridge.getRegisteredCamera?.(transitionData.fromCameraId)
        : undefined;
      const returnCamera = transitionData.returnCameraId
        ? freeCameraBridge.getRegisteredCamera?.(transitionData.returnCameraId)
        : undefined;

      let activeFreeCamera = freeCameraBridge.getActiveFreeCamera?.();
      if (!activeFreeCamera) {
        if (transitionData.startIfMissing === false) {
          return;
        }

        const initialConfig =
          fromCamera?.camera || targetCamera?.camera || undefined;
        if (!initialConfig) {
          logger?.warn?.("CAMERA", "freeCameraTransition target not found", {
            targetCameraId,
          });
          return;
        }

        const startConfig = shouldForceCameraInputLocked
          ? { ...initialConfig, forceCameraInputLocked: true }
          : initialConfig;
        activeFreeCamera = freeCameraBridge.startFreeCamera?.(
          player,
          startConfig,
        );
      }

      if (activeFreeCamera && targetCamera?.camera) {
        if (
          shouldForceCameraInputLocked &&
          activeFreeCamera?.player?.id === player.id
        ) {
          try {
            activeFreeCamera.setForcedCameraInputLocked?.(true);
          } catch (error) {
            logIgnoredError(
              "camera_system/camera_runtime:applyCameraActions",
              error,
            );
          }
        }

        const shouldPreEaseToNextRig = segmentDuration > 0 && nextCamera?.rig;

        const transitionOverride =
          transitionData.transition &&
          typeof transitionData.transition === "object"
            ? transitionData.transition
            : undefined;
        const inferredTransition = toFreeCameraTransition(
          easeOptions,
          targetCamera.transition,
        );
        const effectiveTransition = {
          ...inferredTransition,
          ...transitionOverride,
        };
        if (
          followModePreservationType ===
            CAMERA_FOLLOW_MODE_PRESERVATION_TYPES.CURRENT &&
          effectiveTransition.followModePreservationType === undefined
        ) {
          effectiveTransition.followModePreservationType =
            CAMERA_FOLLOW_MODE_PRESERVATION_TYPES.CURRENT;
        }
        if (shouldPreEaseToNextRig) {
          // Keyframe semantics: this keyframe defines the starting state
          // (follow_default). Apply it immediately, then use the whole segment
          // duration to ease toward the next rig.
          try {
            const resetConfig = shouldForceCameraInputLocked
              ? { ...targetCamera.camera, forceCameraInputLocked: true }
              : targetCamera.camera;
            freeCameraBridge.startFreeCamera?.(player, resetConfig);
          } catch (error) {
            logIgnoredError(
              "camera_system/camera_runtime:applyCameraActions",
              error,
            );
          }
        } else {
          const copiedConfig = shouldForceCameraInputLocked
            ? { ...targetCamera.camera, forceCameraInputLocked: true }
            : { ...targetCamera.camera };

          // If this keyframe explicitly requests CUT/STEP, apply a 1-tick
          // "cut variant" of the referenced config (no native easing and no
          // script-side smoothing), then restore the real config next tick.
          // This guarantees an instant snap back to follow_default without
          // making other cameras globally choppy.
          if (
            isCutEaseType(keyframeEaseType) &&
            activeFreeCamera?.player?.id === player.id
          ) {
            const cutVariant = {
              ...copiedConfig,
              easeType: CAMERA_EASE_TYPES.CUT,
              easeTimeSeconds: 0,
              followSmoothTimeSeconds: 0,
              followVerticalSmoothTimeSeconds: 0,
              rotationSmoothTimeSeconds: 0,
              lookAtSmoothTimeSeconds: 0,
              followLeadSeconds: 0,
            };

            activeFreeCamera.transitionToConfig(cutVariant, {
              ...effectiveTransition,
              easeType: CAMERA_EASE_TYPES.CUT,
              easeTimeSeconds: 0,
            });

            // Apply immediately to avoid any 1-tick delay where the
            // free camera interval tick runs before this keyframe.
            try {
              activeFreeCamera.tick?.();
            } catch (error) {
              logIgnoredError(
                "camera_system/camera_runtime:applyCameraActions",
                error,
              );
            }

            try {
              systemRef.runTimeout(() => {
                const stillActive = freeCameraBridge.getActiveFreeCamera?.();
                if (!stillActive || stillActive?.player?.id !== player.id) {
                  return;
                }

                stillActive.transitionToConfig(copiedConfig, {
                  ...effectiveTransition,
                  easeType: CAMERA_EASE_TYPES.CUT,
                  easeTimeSeconds: 0,
                });

                // Apply immediately so the restored config takes effect
                // on the same tick the timeout fires.
                try {
                  stillActive.tick?.();
                } catch (error) {
                  logIgnoredError(
                    "camera_system/camera_runtime:applyCameraActions",
                    error,
                  );
                }
              }, 1);
            } catch (error) {
              logIgnoredError(
                "camera_system/camera_runtime:applyCameraActions",
                error,
              );
            }
          } else {
            activeFreeCamera.transitionToConfig(
              copiedConfig,
              effectiveTransition,
            );
          }
        }

        // If the next keyframe is a rig, start easing toward that rig immediately
        // (TO_NEXT semantics), similar to how we pre-ease toward the next free-camera
        // config. Without this, the camera appears to "wait" until the rig keyframe
        // time before moving.
        if (shouldPreEaseToNextRig) {
          const previousLocation = getPreviousCameraLocation(
            player,
            freeCameraBridge,
            player?.location || origin,
          );
          const rigLocation = resolveRigLocation(
            nextCamera.rig,
            bindings,
            origin,
            previousLocation,
            nextCamera.targetPointMode,
            player,
          );
          if (rigLocation) {
            // Stop free camera so its tick doesn't override the rig easing.
            try {
              captureFreeCameraRotation(player, freeCameraBridge);
              const activeToStop = freeCameraBridge.getActiveFreeCamera?.();
              if (activeToStop?.currentLocation) {
                rememberLocation(player, activeToStop.currentLocation);
              }
              freeCameraBridge.stopFreeCamera?.({
                clearCamera: false,
                restoreInput: false,
              });
            } catch (error) {
              logIgnoredError(
                "camera_system/camera_runtime:applyCameraActions",
                error,
              );
            }

            const rigSetOptions = {
              ...resolveCameraSetOptions(nextCamera, {
                bindings,
                player,
                origin,
              }),
              location: rigLocation,
            };

            if (nextCamera.rig.lookAt) {
              const target = nextCamera.rig.targetKey
                ? bindings?.[nextCamera.rig.targetKey]
                : nextCamera.rig.targetLocation;
              if (
                target &&
                !(nextCamera.rig.targetKey && target.isValid === false)
              ) {
                const targetMode = resolveTargetPointMode(
                  nextCamera.rig.targetPointMode ?? nextCamera.targetPointMode,
                );
                const targetPos = resolveTargetPosition(target, targetMode, {
                  bindings,
                  player,
                  origin,
                });
                if (!targetPos) {
                  return;
                }
                const lookAtRotation = calculateRotation(
                  rigLocation,
                  targetPos,
                );
                rigSetOptions.rotation =
                  rigSetOptions.rotation || lookAtRotation;
              }
            } else if (
              shouldPreserveRotation &&
              rigSetOptions.rotation === undefined &&
              rigSetOptions.facingEntity === undefined &&
              rigSetOptions.facingLocation === undefined
            ) {
              rigSetOptions.rotation = getPreservedRotation(player);
            } else {
              // do nothing
            }

            // Mirror rig-keyframe behavior: allow camera.lookAt to override/adjust
            // rotation during the pre-ease-to-next-rig segment.
            if (nextCamera.lookAt) {
              const target = nextCamera.lookAt.targetKey
                ? bindings?.[nextCamera.lookAt.targetKey]
                : nextCamera.lookAt.location;
              if (target) {
                if (nextCamera.lookAt.targetKey && target.isValid === false) {
                  // Ignore invalid entity binding and keep existing rotation.
                } else {
                  const targetMode = resolveTargetPointMode(
                    nextCamera.lookAt.targetPointMode ??
                      nextCamera.targetPointMode,
                  );
                  const targetPos = resolveTargetPosition(target, targetMode, {
                    bindings,
                    player,
                    origin,
                  });
                  if (targetPos) {
                    const lookAtRotation = calculateRotation(
                      rigLocation,
                      targetPos,
                    );
                    const baseRotation =
                      rigSetOptions.rotation || lookAtRotation;
                    const weight =
                      nextCamera.lookAt.weight ?? nextCamera.lookAt.soft ?? 1;
                    rigSetOptions.rotation = blendRotation(
                      baseRotation,
                      lookAtRotation,
                      weight,
                    );
                  }
                }
              }
            }

            const preset = resolvePresetId(nextCamera.preset, defaultPreset);
            const easeType =
              resolveEasingType(nextCamera.easeType) ||
              resolveEasingType(cameraData.easeType) ||
              CAMERA_EASE_TYPES.LINEAR;

            try {
              camera.setCamera(
                preset,
                mergeEaseOptions(rigSetOptions, {
                  easeType,
                  easeTime: segmentDuration,
                }),
              );
              if (rigSetOptions.rotation) {
                rememberRotation(player, rigSetOptions.rotation);
              }
              if (rigSetOptions.location) {
                rememberLocation(player, rigSetOptions.location);
              }
            } catch (error) {
              logger?.warn?.(
                "CAMERA",
                "camera.setCamera pre-rig ease failed",
                error,
              );
            }

            // We've started the segment interpolation (0->nextKeyframe). Avoid
            // running additional segment transitions from the free camera.
            if (cameraData.applyCutsceneCamera !== true) {
              return;
            }
          }
        }

        if (segmentDuration > 0) {
          const nextTarget = resolveNextFreeCameraTarget(targetCamera.camera);
          if (nextTarget?.config) {
            const nextSegmentEaseType =
              resolveEasingType(nextCamera?.easeType) ||
              resolveEasingType(cameraData.easeType) ||
              nextTarget.transition?.easeType;

            if (!isCutEaseType(nextSegmentEaseType)) {
              const segmentTransition = {
                ...nextTarget.transition,
                easeType: nextSegmentEaseType,
                easeTimeSeconds: segmentDuration,
              };
              if (
                followModePreservationType ===
                  CAMERA_FOLLOW_MODE_PRESERVATION_TYPES.CURRENT &&
                segmentTransition.followModePreservationType === undefined
              ) {
                segmentTransition.followModePreservationType =
                  CAMERA_FOLLOW_MODE_PRESERVATION_TYPES.CURRENT;
              }
              activeFreeCamera.transitionToConfig(
                nextTarget.config,
                segmentTransition,
              );
            }
          }
        }
      }

      if (activeFreeCamera && returnCamera?.camera) {
        const holdSeconds = Math.max(0, transitionData.holdTimeSeconds ?? 1.5);
        scheduleDelayed(systemRef, holdSeconds, () => {
          const activeAtReturn = freeCameraBridge.getActiveFreeCamera?.();
          if (!activeAtReturn) {
            return;
          }
          activeAtReturn.transitionToConfig(
            returnCamera.camera,
            transitionData.returnTransition || returnCamera.transition,
          );
        });
      }
    }

    if (cameraData.applyCutsceneCamera !== true) {
      return;
    }
  }

  if (cameraData.clear) {
    try {
      camera.clear();
      onCameraCleared?.(player);
    } catch (error) {
      logger?.warn?.("CAMERA", "camera.clear failed", error);
    }
  }

  if (cameraData.fade) {
    try {
      camera.fade(cameraData.fade);
    } catch (error) {
      logger?.warn?.("CAMERA", "camera.fade failed", error);
    }
  }

  if (cameraData.shake || cameraData.shakes) {
    const shakes = Array.isArray(cameraData.shakes)
      ? cameraData.shakes
      : cameraData.shake
        ? [cameraData.shake]
        : [];

    for (const shake of shakes) {
      if (!shake) {
        continue;
      }
      const intensity =
        shake.intensity ?? CAMERA_SHAKE_DEFAULTS.playerIntensity;
      const duration = shake.duration ?? CAMERA_SHAKE_DEFAULTS.playerDuration;
      const shakeType = shake.shakeType ?? CAMERA_SHAKE_DEFAULTS.shakeType;
      const radius = shake.radius;
      const radiusArgument = typeof radius === "number" ? ` ${radius}` : "";
      try {
        player?.runCommand?.(
          `camerashake add @s ${intensity} ${duration} ${shakeType}${radiusArgument}`,
        );
      } catch (error) {
        logger?.warn?.("CAMERA", "camera shake failed", error);
      }
    }
  }

  applyCameraHudConfig(player, cameraData.hud, runtime, logger);

  if (cameraData.fov !== undefined) {
    try {
      const currentFovOptions = mergeFovOptions(cameraData.fov, fovEaseOptions);
      if (currentFovOptions) {
        camera.setFov(currentFovOptions);
      }
    } catch (error) {
      logger?.warn?.("CAMERA", "camera.setFov failed", error);
    }
  }

  if (!cameraData.fovRamp && !nextCamera?.fovRamp) {
    applyVanillaSegmentEaseToNextFov({
      camera,
      nextCamera,
      easeOptions: segmentFovEaseOptions,
      logger,
      systemRef,
      playerKey: getPlayerKey(player),
      sessionId: nextSession,
      delayTicks: 1,
    });
  }

  if (cameraData.fovRamp) {
    applyFovRamp(camera, cameraData.fovRamp, systemRef);
  }

  if (cameraData.blend) {
    const blend = cameraData.blend;
    if (blend.fromPreset) {
      try {
        camera.setCamera(blend.fromPreset, blend.fromSetOptions);
        if (blend.fromSetOptions?.location) {
          rememberLocation(player, blend.fromSetOptions.location);
        }
      } catch (error) {
        logger?.warn?.("CAMERA", "camera.setCamera blend from failed", error);
      }
    }
    const blendEase = blend.durationSeconds
      ? {
          easeType: resolveEasingType(blend.easeType),
          easeTime: blend.durationSeconds,
        }
      : undefined;
    try {
      if (blend.toPreset) {
        const toSetOptions = { ...blend.toSetOptions };
        if (
          blend.mode === CAMERA_BLEND_MODES.RELATIVE &&
          blend.relativeLocation
        ) {
          toSetOptions.location = resolveLocation({
            location: blend.relativeLocation,
            locationSource: blend.relativeTo || CAMERA_LOCATION_SOURCES.ORIGIN,
            sourceKey: blend.sourceKey,
            relative: true,
            bindings,
            player,
            entity: player,
            origin,
          });
        }
        camera.setCamera(
          blend.toPreset,
          mergeEaseOptions(toSetOptions, blendEase),
        );
        if (toSetOptions.location) {
          rememberLocation(player, toSetOptions.location);
        }
      }
    } catch (error) {
      logger?.warn?.("CAMERA", "camera.setCamera blend to failed", error);
    }
  }

  if (cameraData.rig) {
    // If this rig keyframe is followed by a freeCameraTransition, start easing
    // toward that target pose over the segment duration (e.g., 4->6 return to
    // follow_default) instead of waiting until the later keyframe fires.
    if (
      segmentDuration > 0 &&
      nextCamera?.freeCameraTransition &&
      freeCameraBridge
    ) {
      const transitionData = nextCamera.freeCameraTransition;
      const targetCameraId =
        transitionData.cameraId ||
        transitionData.toCameraId ||
        transitionData.presetId;

      if (targetCameraId) {
        const targetCamera =
          freeCameraBridge.getRegisteredCamera?.(targetCameraId);
        if (targetCamera?.camera) {
          try {
            const temporary = new FreeCamera({
              ...targetCamera.camera,
              player,
            });
            const location = temporary.getCameraPosition(player.location);
            const focusTarget = targetCamera.camera.focusTarget ?? true;
            const easeType =
              resolveEasingType(nextCamera?.easeType) ||
              resolveEasingType(cameraData.easeType) ||
              CAMERA_EASE_TYPES.LINEAR;

            // NOTE: Using `facingEntity` here can cause a 1-tick rotation snap on
            // some Bedrock versions (especially noticeable when targetPointMode
            // changes). Use an explicit rotation so native easing smooths both
            // location + rotation.
            const setOptions = focusTarget
              ? {
                  location,
                  rotation: calculateRotation(
                    location,
                    resolveEntityFocusPoint(
                      player,
                      resolveTargetPointMode(
                        targetCamera.camera.targetPointMode,
                      ),
                    ),
                  ),
                }
              : {
                  location,
                  rotation: player.getRotation?.() || { x: 0, y: 0 },
                };

            camera.setCamera(
              resolvePresetId(cameraData.preset, defaultPreset),
              mergeEaseOptions(setOptions, {
                easeType,
                easeTime: segmentDuration,
              }),
            );
            if (setOptions.location) {
              rememberLocation(player, setOptions.location);
            }
            if (setOptions.rotation) {
              rememberRotation(player, setOptions.rotation);
            }
            return;
          } catch (error) {
            logger?.warn?.(
              "CAMERA",
              "camera.setCamera pre-freecam ease failed",
              error,
            );
          }
        }
      }
    }

    const previousLocation = getPreviousCameraLocation(
      player,
      freeCameraBridge,
      player?.location || origin,
    );
    const rigLocation = resolveRigLocation(
      cameraData.rig,
      bindings,
      origin,
      previousLocation,
      cameraData.targetPointMode,
      player,
    );
    if (!rigLocation) {
      logger?.warn?.("CAMERA", "camera rig target missing/invalid", {
        rig: cameraData.rig,
      });
      return;
    }
    const setOptions = {
      ...resolvedSetOptions,
      location: rigLocation,
    };

    if (
      shouldPreserveRotation &&
      setOptions.rotation === undefined &&
      setOptions.facingEntity === undefined &&
      setOptions.facingLocation === undefined &&
      !cameraData.rig.lookAt
    ) {
      setOptions.rotation = getPreservedRotation(player);
    }

    if (cameraData.rig.lookAt) {
      const target = cameraData.rig.targetKey
        ? bindings?.[cameraData.rig.targetKey]
        : cameraData.rig.targetLocation;
      if (target) {
        if (cameraData.rig.targetKey && target.isValid === false) {
          return;
        }
        const targetMode = resolveTargetPointMode(
          cameraData.rig.targetPointMode ?? cameraData.targetPointMode,
        );
        const targetPos = resolveTargetPosition(target, targetMode, {
          bindings,
          player,
          origin,
        });
        if (!targetPos) {
          return;
        }
        const lookAtRotation = calculateRotation(rigLocation, targetPos);
        const baseRotation = setOptions.rotation || lookAtRotation;
        const weight = cameraData.rig.lookAtWeight ?? 1;
        setOptions.rotation = blendRotation(
          baseRotation,
          lookAtRotation,
          weight,
        );
      }
    }

    // Allow camera.lookAt to override/adjust rotation even when using a rig.
    // This enables patterns like: orbit around the player, but look at a fixed
    // point or a separate binding key.
    if (cameraData.lookAt) {
      const target = cameraData.lookAt.targetKey
        ? bindings?.[cameraData.lookAt.targetKey]
        : cameraData.lookAt.location;
      if (target) {
        if (cameraData.lookAt.targetKey && target.isValid === false) {
          return;
        }
        const targetMode = resolveTargetPointMode(
          cameraData.lookAt.targetPointMode ?? cameraData.targetPointMode,
        );
        const targetPos = resolveTargetPosition(target, targetMode, {
          bindings,
          player,
          origin,
        });
        if (!targetPos) {
          return;
        }
        const lookAtRotation = calculateRotation(rigLocation, targetPos);
        const baseRotation = setOptions.rotation || lookAtRotation;
        const weight = cameraData.lookAt.weight ?? cameraData.lookAt.soft ?? 1;
        setOptions.rotation = blendRotation(
          baseRotation,
          lookAtRotation,
          weight,
        );
      }
    }

    const preset = resolvePresetId(cameraData.preset, defaultPreset);
    const mergedOptions = mergeEaseOptions(setOptions, easeOptions);
    try {
      camera.setCamera(preset, mergedOptions);
      if (setOptions.rotation) {
        rememberRotation(player, setOptions.rotation);
      }
      if (setOptions.location) {
        rememberLocation(player, setOptions.location);
      }
    } catch (error) {
      logger?.warn?.("CAMERA", "camera.setCamera rig failed", error);
    }
    return;
  }

  if (cameraData.lookAt) {
    const target = cameraData.lookAt.targetKey
      ? bindings?.[cameraData.lookAt.targetKey]
      : cameraData.lookAt.location;
    if (target) {
      if (cameraData.lookAt.targetKey && target.isValid === false) {
        return;
      }
      if (!resolvedSetOptions) {
        resolvedSetOptions = {};
      }
      const targetMode = resolveTargetPointMode(
        cameraData.lookAt.targetPointMode ?? cameraData.targetPointMode,
      );
      const targetPos = resolveTargetPosition(target, targetMode, {
        bindings,
        player,
        origin,
      });
      if (!targetPos) {
        return;
      }
      if (
        !applyNativeLookAtTarget(
          resolvedSetOptions,
          shouldUseNativeLookAtTarget(cameraData.lookAt, cameraData)
            ? cameraData.lookAt
            : undefined,
          target,
          targetPos,
        )
      ) {
        const location =
          resolvedSetOptions.location || player?.location || origin;
        const lookAtRotation = calculateRotation(location, targetPos);
        const baseRotation = resolvedSetOptions.rotation || lookAtRotation;
        const weight = cameraData.lookAt.weight ?? cameraData.lookAt.soft ?? 1;
        resolvedSetOptions.rotation = blendRotation(
          baseRotation,
          lookAtRotation,
          weight,
        );
        if (resolvedSetOptions.rotation) {
          rememberRotation(player, resolvedSetOptions.rotation);
        }
      }
    }
  }

  // Relative rotation delta (rotate): applies an AngleOffset on top of the
  // current rotation.
  //
  // If the camera is currently focused on a target (facingEntity/facingLocation
  // or lookAt-derived rotation), compute the base rotation from camera location
  // -> target location using BVector3 angle math for exact results.
  const rotateOffset = resolveAngleOffset(cameraData.rotate);
  if (rotateOffset) {
    if (!resolvedSetOptions) {
      resolvedSetOptions = {};
    }

    const rotationSourceEntity = resolveCameraSourceEntity(
      { bindings, player, entity: bindings?.[cameraData.sourceKey], origin },
      cameraData.rotate?.sourceKey ?? cameraData.sourceKey,
    );

    const baseLocation =
      resolvedSetOptions.location ||
      getPreviousCameraLocation(
        player,
        freeCameraBridge,
        player?.location || origin,
      );

    let baseRotation = resolvedSetOptions.rotation;

    if (!baseRotation && baseLocation) {
      let targetPos;

      if (resolvedSetOptions.facingLocation) {
        targetPos = resolvedSetOptions.facingLocation;
      } else if (resolvedSetOptions.facingEntity !== undefined) {
        const facingCandidate = isEntityLike(resolvedSetOptions.facingEntity)
          ? resolvedSetOptions.facingEntity
          : typeof resolvedSetOptions.facingEntity === "string"
            ? bindings?.[resolvedSetOptions.facingEntity]
            : undefined;

        const targetMode = resolveTargetPointMode(cameraData.targetPointMode);
        targetPos = resolveTargetPosition(facingCandidate, targetMode, {
          bindings,
          player,
          origin,
        });
      } else {
        // do nothing
      }

      if (targetPos) {
        try {
          const lookAtRotation = calculateRotation(baseLocation, targetPos);
          if (lookAtRotation) {
            baseRotation = lookAtRotation;
          }
        } catch (error) {
          logIgnoredError(
            "camera_system/camera_runtime:applyCameraActions",
            error,
          );
        }
      }
    }

    if (!baseRotation) {
      baseRotation = (rotationSourceEntity?.isValid
        ? normalizeRotation(rotationSourceEntity.getRotation?.(), undefined)
        : undefined) ||
        getPreservedRotation(player) ||
        (player?.isValid ? player.getRotation?.() : undefined) || {
          x: 0,
          y: 0,
        };
    }

    resolvedSetOptions.rotation = {
      x: (baseRotation?.x ?? 0) + (rotateOffset.getPhi?.() ?? 0),
      y: (baseRotation?.y ?? 0) + (rotateOffset.getTheta?.() ?? 0),
    };

    // When applying an explicit rotation, clear facing mode so it doesn't
    // override the intended result.
    delete resolvedSetOptions.facingEntity;
    delete resolvedSetOptions.facingLocation;
  }

  // Only apply camera.setCamera / setDefaultCamera when this keyframe actually
  // intends to drive camera pose or preset. Action-only keyframes (fade/fov/etc)
  // should not implicitly reset the camera by resolving a default preset.
  const skipHandoffHoldSetCamera = (() => {
    if (!handoffFreeCamera || !isCutEaseType(keyframeEaseType)) {
      return false;
    }

    // Only skip for "pure hold" keyframes.
    if (
      cameraData.setDefault === true ||
      cameraData.preset !== undefined ||
      cameraData.setOptions !== undefined ||
      cameraData.lookAt ||
      cameraData.rig ||
      cameraData.blend ||
      cameraData.freeCameraConfig ||
      cameraData.freeCamera ||
      cameraData.freeCameraTransition
    ) {
      return false;
    }

    if (
      cameraData.facingEntity !== undefined ||
      cameraData.facingLocation !== undefined
    ) {
      return false;
    }

    const locCandidate = cameraData.location ?? cameraData.position;
    if (!isDirectionalOffsetLike(locCandidate)) {
      return false;
    }
    const wantsHoldRotation =
      cameraData.rotation === undefined && cameraData.rotate === undefined;
    if (!wantsHoldRotation) {
      return false;
    }

    // We already forced an instant freecam tick + captured/remembered pose;
    // leaving the camera as-is avoids any last-frame engine differences.
    return true;
  })();

  const wantsPoseChange =
    !skipHandoffHoldSetCamera &&
    (cameraData.setDefault === true ||
      cameraData.preset !== undefined ||
      resolvedSetOptions !== undefined ||
      Boolean(cameraData.lookAt) ||
      Boolean(cameraData.rig) ||
      Boolean(cameraData.blend) ||
      Boolean(cameraData.freeCameraConfig) ||
      Boolean(cameraData.freeCamera) ||
      Boolean(cameraData.freeCameraTransition));

  const preset = wantsPoseChange
    ? resolvePresetId(
        cameraData.preset ??
          (handoffFreeCamera &&
          isCutEaseType(keyframeEaseType) &&
          cameraData.preset === undefined
            ? handoffFreeCamera.preset
            : undefined),
        defaultPreset,
      )
    : undefined;
  const setOptions = wantsPoseChange
    ? mergeEaseOptions(resolvedSetOptions, easeOptions)
    : undefined;

  coerceFacingToExplicitRotation(setOptions, {
    bindings,
    player,
    origin,
    freeCameraBridge,
    targetPointMode: cameraData.targetPointMode,
  });

  if (cameraData.setDefault && preset) {
    try {
      camera.setDefaultCamera(preset, easeOptions);
    } catch (error) {
      logger?.warn?.("CAMERA", "camera.setDefaultCamera failed", error);
    }
    return;
  }

  if (skipHandoffHoldSetCamera) {
    return;
  }

  let scheduledVanillaSegmentEase = false;

  if (preset || setOptions) {
    try {
      camera.setCamera(preset, setOptions);
      if (setOptions?.location) {
        rememberLocation(player, setOptions.location);
      }
      if (setOptions?.rotation) {
        rememberRotation(player, setOptions.rotation);
      } else if (setOptions?.facingEntity) {
        const baseLocation =
          setOptions?.location ||
          getPreviousCameraLocation(
            player,
            freeCameraBridge,
            player?.location || origin,
          );
        const targetMode = resolveTargetPointMode(cameraData.targetPointMode);
        const targetPos = resolveEntityFocusPoint(
          setOptions.facingEntity,
          targetMode,
        );
        if (targetPos && baseLocation) {
          rememberRotation(player, calculateRotation(baseLocation, targetPos));
        }
      } else if (setOptions?.facingLocation) {
        const baseLocation =
          setOptions?.location ||
          getPreviousCameraLocation(
            player,
            freeCameraBridge,
            player?.location || origin,
          );
        if (baseLocation) {
          rememberRotation(
            player,
            calculateRotation(baseLocation, setOptions.facingLocation),
          );
        }
      } else {
        // do nothing
      }

      applyVanillaSegmentEaseToNextCamera({
        camera,
        nextCamera,
        easeOptions: segmentEaseOptions,
        defaultPreset,
        bindings,
        player,
        origin,
        logger,
        freeCameraBridge,
        systemRef,
        playerKey,
        sessionId: nextSession,
        delayTicks: 1,
      });
      scheduledVanillaSegmentEase = true;
    } catch (error) {
      logger?.warn?.("CAMERA", "camera.setCamera failed", error);
    }
  }

  if (!scheduledVanillaSegmentEase) {
    applyVanillaSegmentEaseToNextCamera({
      camera,
      nextCamera,
      easeOptions: segmentEaseOptions,
      defaultPreset,
      bindings,
      player,
      origin,
      logger,
      freeCameraBridge,
      systemRef,
      playerKey,
      sessionId: nextSession,
      delayTicks: 1,
    });
  }
}

/**
 * Evaluates a single condition object.
 * @param {Object|undefined} condition Condition data.
 * @param {Object} context Runtime context.
 * @returns {boolean}
 */
function evaluateCondition(condition, context) {
  if (!condition || typeof condition !== "object") {
    return true;
  }

  const { bindings, callbacks } = context;
  switch (condition.type) {
    case "entityValid": {
      const entity = bindings?.[condition.targetKey];
      return Boolean(entity?.isValid);
    }
    case "tag": {
      const entity = bindings?.[condition.targetKey];
      return entity?.hasTag?.(condition.tag) ?? false;
    }
    case "property": {
      const entity = bindings?.[condition.targetKey];
      if (!entity?.getProperty) {
        return false;
      }
      const value = entity.getProperty(condition.propertyId);
      return condition.equals === undefined
        ? Boolean(value)
        : value === condition.equals;
    }
    case "score": {
      const entity = bindings?.[condition.targetKey];
      if (!entity?.scoreboardIdentity) {
        return false;
      }
      const objective = world.scoreboard.getObjective(condition.objective);
      if (!objective) {
        return false;
      }
      const score = objective.getScore(entity.scoreboardIdentity);
      if (condition.equals !== undefined) {
        return score === condition.equals;
      }
      if (condition.min !== undefined && score < condition.min) {
        return false;
      }
      if (condition.max !== undefined && score > condition.max) {
        return false;
      }
      return true;
    }
    case "callback": {
      const handler = callbacks?.[condition.name];
      if (typeof handler === "function") {
        return handler(context) === true;
      }
      return false;
    }
    default: {
      return true;
    }
  }
}

/**
 * Evaluates whether the current keyframe should run.
 * @param {Object} keyframe Keyframe payload.
 * @param {Object} context Runtime context.
 * @returns {boolean}
 */
function shouldRunKeyframe(keyframe, context) {
  const conditions = keyframe.conditions;
  if (!conditions) {
    return true;
  }

  if (conditions.callback) {
    return evaluateCondition(
      { type: "callback", name: conditions.callback },
      context,
    );
  }

  if (Array.isArray(conditions.all)) {
    return conditions.all.every(cond => evaluateCondition(cond, context));
  }

  if (Array.isArray(conditions.any)) {
    return conditions.any.some(cond => evaluateCondition(cond, context));
  }

  return true;
}

function coerceCallbackNameList(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (Array.isArray(value)) {
    return value
      .filter(v => typeof v === "string")
      .map(v => v.trim())
      .filter(Boolean);
  }
  return [];
}

function runKeyframeNamedCallbacks(keyframe, context, logger) {
  if (!keyframe || typeof keyframe !== "object") {
    return;
  }

  const names = [
    ...coerceCallbackNameList(keyframe.runCallback),
    ...coerceCallbackNameList(keyframe.runCallbacks),
  ];

  if (names.length === 0) {
    return;
  }

  for (const name of names) {
    const handler = context?.callbacks?.[name];
    if (typeof handler !== "function") {
      const timelineId = context?.timeline?.id ?? "";
      const time = context?.time;
      logger?.warn?.(
        "CAMERA",
        `Keyframe runCallback handler not found (name=${name}, timeline=${timelineId}, time=${time})`,
      );
      continue;
    }

    try {
      const result = handler(context);
      // Support async callbacks: log rejected promises instead of silently
      // dropping errors.
      if (result && typeof result?.then === "function") {
        result.catch(error => {
          const timelineId = context?.timeline?.id ?? "";
          const time = context?.time;
          const message =
            typeof error?.message === "string"
              ? error.message
              : String(error ?? "");
          logger?.warn?.(
            "CAMERA",
            `Keyframe runCallback handler rejected (name=${name}, timeline=${timelineId}, time=${time}): ${message}`,
          );
        });
      }
    } catch (error) {
      const timelineId = context?.timeline?.id ?? "";
      const time = context?.time;
      const message =
        typeof error?.message === "string" ? error.message : String(error);
      logger?.warn?.(
        "CAMERA",
        `Keyframe runCallback handler failed (name=${name}, timeline=${timelineId}, time=${time}): ${message}`,
      );
    }
  }
}

/**
 * Resolves camera/entity/effect/audio/group track data from keyframe payload.
 * @param {Object} keyframe Keyframe payload.
 * @returns {{camera:any,subtitles:any,entities:any,effects:any,audio:any,groups:any}}
 */
function resolveTrackData(keyframe) {
  const tracks = keyframe.tracks || {};
  const cameraTrack = tracks.camera ?? keyframe.camera;
  return {
    camera: normalizeCameraTrack(cameraTrack),
    subtitles: normalizeSubtitlesTrack(tracks.subtitles ?? keyframe.subtitles),
    entities: tracks.entities ?? keyframe.entities,
    effects: tracks.effects ?? keyframe.effects,
    audio: tracks.audio,
    groups: tracks.groups ?? keyframe.entityGroups,
  };
}

function coerceCommandList(value) {
  if (!value) {
    return [];
  }
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.filter(v => typeof v === "string");
  }
  return [];
}

function resolveCommandExecutor(entry, context) {
  const player = context?.player;
  const bindings = context?.bindings;

  const executorType =
    entry && typeof entry === "object"
      ? (entry.executor ?? entry.via ?? entry.source)
      : undefined;
  const targetKey =
    entry && typeof entry === "object"
      ? (entry.targetKey ?? entry.bindingKey)
      : undefined;

  const type = typeof executorType === "string" ? executorType : "player";

  if (type === "dimension") {
    // Prefer a target entity's dimension when provided; otherwise player's.
    const target = targetKey ? bindings?.[targetKey] : undefined;
    const dimension = target?.dimension ?? player?.dimension;
    return dimension && typeof dimension.runCommand === "function"
      ? { kind: "dimension", value: dimension }
      : undefined;
  }

  if (type === "entity" || type === "binding") {
    const entity = targetKey ? bindings?.[targetKey] : player;
    return entity && typeof entity.runCommand === "function"
      ? { kind: "entity", value: entity }
      : undefined;
  }

  // Default: run as player entity.
  return player && typeof player.runCommand === "function"
    ? { kind: "entity", value: player }
    : undefined;
}

function runCommandWithExecutor(executor, command) {
  executor?.value?.runCommand(command);
}

function runKeyframeCommands(keyframe, context, logger) {
  if (!keyframe) {
    return;
  }

  const payload = keyframe.commands ?? keyframe.runCommands;
  if (payload === undefined || payload === null) {
    return;
  }

  const entries =
    Array.isArray(payload) && payload.some(v => typeof v === "object")
      ? payload
      : [payload];

  for (const raw of entries) {
    if (raw === undefined || raw === null) {
      continue;
    }

    // Support:
    // - commands: "/say hi"
    // - commands: ["/say a", "/say b"]
    // - commands: { executor:"dimension"|"entity"|"player"|"binding", targetKey?, commands:[...] }
    const commands =
      typeof raw === "object" && !Array.isArray(raw)
        ? coerceCommandList(raw.commands ?? raw.command)
        : coerceCommandList(raw);

    if (commands.length === 0) {
      continue;
    }

    const entryConfig =
      typeof raw === "object" && !Array.isArray(raw)
        ? raw
        : { executor: "player" };

    const executor = resolveCommandExecutor(entryConfig, context);
    if (!executor) {
      logger?.warn?.("CAMERA", "Keyframe commands: no valid executor", {
        timelineId: context?.timeline?.id,
        time: context?.time,
        entry: entryConfig,
      });
      continue;
    }

    for (const command of commands) {
      try {
        runCommandWithExecutor(executor, command);
      } catch (error) {
        logger?.warn?.("CAMERA", "Keyframe command failed", {
          timelineId: context?.timeline?.id,
          time: context?.time,
          command,
          error,
        });
      }
    }
  }
}

function resolveKeyframeCameraState(runtime, entry, tracks, keyframe) {
  const orderedKeyframes = runtime.timeline.getOrderedKeyframes();
  const hasExplicitCurrentCamera = keyframeHasExplicitCameraConfig(keyframe);
  const poseBefore = getPoseStateBeforeIndex(entry.index, orderedKeyframes);
  const subtitleStateBefore = getSubtitleStateForEntry(
    runtime,
    entry.index,
    orderedKeyframes,
  );
  const rawCameraTrack = tracks.camera;
  const explicitSubtitlesTrack = tracks.subtitles;
  let resolvedCameraTrack = rawCameraTrack;
  let poseAfter = poseBefore;
  const resolvedSubtitleState = explicitSubtitlesTrack
    ? mergeSubtitleState(subtitleStateBefore, explicitSubtitlesTrack)
    : subtitleStateBefore;

  if (
    rawCameraTrack &&
    typeof rawCameraTrack === "object" &&
    cameraTrackShouldInheritPose(rawCameraTrack)
  ) {
    const mode = cameraTrackHasPose(rawCameraTrack) ? "partial" : "hold";
    resolvedCameraTrack = resolveCameraTrackWithPoseInheritance(
      rawCameraTrack,
      poseBefore,
      mode,
    );
    const snapshot = getCameraTrackPoseSnapshot(resolvedCameraTrack);
    poseAfter = mergePoseState(poseBefore, snapshot, { override: true });
    tracks = { ...tracks, camera: resolvedCameraTrack };
  }

  const cameraTrack = tracks.camera;
  let nextCameraTrack;
  let segmentDurationSeconds = 0;
  const effectiveEaseMode = resolveEffectiveEaseMode(
    cameraTrack,
    keyframe,
    runtime.timeline.easeMode,
  );
  let easeOptions;
  let fovEaseOptions;
  let segmentEaseOptions;
  let segmentFovEaseOptions;

  if (cameraTrack && hasExplicitCurrentCamera) {
    const nextKeyframeEntry = findNextExplicitCameraKeyframeEntry(
      entry.index,
      orderedKeyframes,
    );
    const nextKeyframeTracks = nextKeyframeEntry
      ? resolveTrackData(nextKeyframeEntry.data || {})
      : undefined;

    nextCameraTrack = nextKeyframeTracks?.camera;
    if (
      nextCameraTrack &&
      typeof nextCameraTrack === "object" &&
      cameraTrackShouldInheritPose(nextCameraTrack)
    ) {
      const mode = cameraTrackHasPose(nextCameraTrack) ? "partial" : "hold";
      nextCameraTrack = resolveCameraTrackWithPoseInheritance(
        nextCameraTrack,
        poseAfter,
        mode,
      );
    }

    segmentDurationSeconds = nextKeyframeEntry
      ? Math.max(0, nextKeyframeEntry.time - entry.timeSeconds)
      : 0;

    if (effectiveEaseMode === CAMERA_EASE_MODES.TO_CURRENT) {
      const previousKeyframeEntry = findPreviousExplicitCameraKeyframeEntry(
        entry.index,
        orderedKeyframes,
      );
      const currentResolvedEntry = withResolvedCameraTrack(
        orderedKeyframes[entry.index],
        cameraTrack,
      );
      const toCurrentEaseKeyframes = previousKeyframeEntry
        ? [previousKeyframeEntry, currentResolvedEntry]
        : [currentResolvedEntry];
      const currentEaseIndex = toCurrentEaseKeyframes.length - 1;

      easeOptions = resolveEaseOptions(
        toCurrentEaseKeyframes[currentEaseIndex]?.data || {},
        currentEaseIndex,
        toCurrentEaseKeyframes,
        effectiveEaseMode,
      );
      fovEaseOptions = resolveFovEaseOptions(
        toCurrentEaseKeyframes[currentEaseIndex]?.data || {},
        currentEaseIndex,
        toCurrentEaseKeyframes,
        effectiveEaseMode,
      );
    }

    const segmentEaseKeyframes = buildResolvedCameraEaseEntries(
      orderedKeyframes[entry.index],
      cameraTrack,
      nextKeyframeEntry,
      nextCameraTrack,
    );
    segmentEaseOptions = resolveSegmentEaseOptions(
      0,
      segmentEaseKeyframes,
      effectiveEaseMode,
    );
    segmentFovEaseOptions = resolveSegmentFovEaseOptions(
      0,
      segmentEaseKeyframes,
      effectiveEaseMode,
    );
  }

  return {
    tracks,
    cameraTrack,
    subtitleState: resolvedSubtitleState,
    hasExplicitSubtitles: Boolean(explicitSubtitlesTrack),
    nextCameraTrack,
    segmentDurationSeconds,
    easeOptions,
    fovEaseOptions,
    segmentEaseOptions,
    segmentFovEaseOptions,
  };
}

function applyResolvedKeyframeTracks(
  runtime,
  trackState,
  keyframe,
  player,
  origin,
  context,
) {
  const {
    tracks,
    cameraTrack,
    subtitleState,
    hasExplicitSubtitles,
    nextCameraTrack,
    segmentDurationSeconds,
    easeOptions,
    fovEaseOptions,
    segmentEaseOptions,
    segmentFovEaseOptions,
  } = trackState;

  const previousSubtitleState = cloneSubtitleState(
    runtime.currentSubtitleState,
  );

  if (!runtime.mutedTracks.has("camera") && cameraTrack) {
    applyCameraActions({
      camera: player.camera,
      keyframe: { camera: cameraTrack },
      runtime,
      easeOptions,
      fovEaseOptions,
      segmentEaseOptions,
      segmentFovEaseOptions,
      followModePreservationType:
        cameraTrack?.followModePreservationType ||
        (cameraTrack?.preserveKeyframeFollowMode === true
          ? CAMERA_FOLLOW_MODE_PRESERVATION_TYPES.CURRENT
          : CAMERA_FOLLOW_MODE_PRESERVATION_TYPES.NEXT),
      nextCamera: nextCameraTrack,
      segmentDurationSeconds,
      defaultPreset: runtime.timeline.defaultCameraPreset,
      bindings: runtime.bindings,
      player,
      origin,
      systemRef: system,
      logger: runtime.logger,
      freeCameraBridge: runtime.freeCameraBridge,
      forceCameraInputLocked: runtime.timeline.lockInput?.camera === true,
      onCameraCleared: runtime.onCameraCleared,
    });
  }

  runtime.currentSubtitleState =
    !runtime.mutedTracks.has("subtitles") && hasExplicitSubtitles
      ? applyExplicitSubtitleTrack(
          player,
          previousSubtitleState,
          subtitleState,
          tracks.subtitles,
          runtime.logger,
        )
      : cloneSubtitleState(subtitleState);

  if (!runtime.mutedTracks.has("entities") && tracks.entities) {
    for (const [bindingKey, actions] of Object.entries(tracks.entities)) {
      applyActionsToEntity({
        entity: runtime.bindings[bindingKey],
        actions,
        defaultMovementEvents: runtime.timeline.cameraEvents?.entityMovement,
        bindings: runtime.bindings,
        player,
        origin,
        systemRef: system,
      });
    }
  }

  if (!runtime.mutedTracks.has("effects") && tracks.effects) {
    applyGlobalEffects({
      keyframe: { effects: tracks.effects },
      bindings: runtime.bindings,
      player,
      origin,
      systemRef: system,
    });
  }

  if (!runtime.mutedTracks.has("audio") && tracks.audio) {
    applyGlobalEffects({
      keyframe: { effects: { soundEffects: tracks.audio.soundEffects } },
      bindings: runtime.bindings,
      player,
      origin,
      systemRef: system,
    });
  }

  runKeyframeCommands(keyframe, context, runtime.logger);

  if (!runtime.mutedTracks.has("entities") && tracks.groups) {
    applyEntityGroups({
      groups: tracks.groups,
      bindings: runtime.bindings,
      player,
      origin,
      systemRef: system,
      defaultMovementEvents: runtime.timeline.cameraEvents?.entityMovement,
    });
  }
}

function finalizeKeyframeFlow(runtime, keyframe, context) {
  if (Array.isArray(keyframe.startTimelines) && runtime.triggerTimeline) {
    for (const nested of keyframe.startTimelines) {
      const nestedBindings = nested.inheritBindings
        ? { ...runtime.bindings, ...nested.bindings }
        : nested.bindings || runtime.bindings;
      runtime.triggerTimeline(nested.id, nestedBindings, runtime.callbacks);
    }
  }

  if (keyframe.goto !== undefined) {
    const target = keyframe.goto;
    const markerTime =
      typeof target === "string" ? runtime.timeline.markers?.[target] : target;
    if (isNumber(markerTime)) {
      runtime.currentTick = Math.max(
        0,
        Math.ceil(markerTime * TicksPerSecond - 1e-9),
      );
      runtime.scheduleIndex = runtime.schedule.findIndex(
        item => item.timeTicks >= runtime.currentTick,
      );
      if (runtime.scheduleIndex < 0) {
        runtime.scheduleIndex = runtime.schedule.length;
      }
    }
  }

  if (keyframe.pause) {
    runtime.isPaused = true;
    runtime.pauseKey =
      typeof keyframe.pause === "string" ? keyframe.pause : keyframe.resumeKey;
  }

  if (typeof keyframe.onExit === "function") {
    keyframe.onExit(context);
  }
}

function resolveStreamingPair(runtime) {
  if (
    runtime.scheduleIndex <= 0 ||
    runtime.scheduleIndex >= runtime.schedule.length
  ) {
    return undefined;
  }

  const previous = runtime.schedule[runtime.scheduleIndex - 1];
  const next = runtime.schedule[runtime.scheduleIndex];
  if (!previous || !next || next.timeTicks <= previous.timeTicks) {
    return undefined;
  }

  if (
    runtime.currentTick < previous.timeTicks ||
    runtime.currentTick > next.timeTicks
  ) {
    return undefined;
  }

  return { previous, next };
}

function resolveStreamingSegmentEaseType(runtime, previous, next) {
  const mode = runtime?.timeline?.easeMode;
  const controllingEntry = mode === CAMERA_EASE_MODES.TO_NEXT ? previous : next;
  return getEntryEaseType(controllingEntry) ?? CAMERA_EASE_TYPES.LINEAR;
}

function applyStreamingFreeCameraLocation(
  camData,
  options,
  handoffFreeCamera,
  player,
) {
  const candidate = camData?.location ?? camData?.position;
  if (!isDirectionalOffsetLike(candidate) || !player?.isValid) {
    return;
  }

  try {
    const directionalOffset = toDirectionalOffset(candidate);
    if (!directionalOffset) {
      return;
    }
    const temporary = new FreeCamera({
      player,
      distance:
        typeof handoffFreeCamera.currentDistance === "number"
          ? handoffFreeCamera.currentDistance
          : handoffFreeCamera.distance,
      heightOffset: resolveDirectionalOffsetValue(
        directionalOffset,
        "ground",
        handoffFreeCamera.heightOffset ?? 0.5,
      ),
      sideOffset: resolveDirectionalOffsetValue(
        directionalOffset,
        "side",
        handoffFreeCamera.sideOffset ?? 0,
      ),
      backOffset: resolveDirectionalOffsetValue(
        directionalOffset,
        "front",
        handoffFreeCamera.backOffset ?? 0,
      ),
      followMode: handoffFreeCamera.followMode,
      useHeadLocationForPosition: handoffFreeCamera.useHeadLocationForPosition,
      minOrbitPitch: handoffFreeCamera.minOrbitPitch,
      maxOrbitPitch: handoffFreeCamera.maxOrbitPitch,
      focusTarget: handoffFreeCamera.focusTarget,
      targetPointMode: handoffFreeCamera.targetPointMode,
    });
    temporary.currentOrbitYaw = handoffFreeCamera.currentOrbitYaw;
    temporary.currentOrbitPitch = handoffFreeCamera.currentOrbitPitch;
    temporary.frozenPlayerPosition = handoffFreeCamera.frozenPlayerPosition;
    temporary.frozenPlayerRotation = handoffFreeCamera.frozenPlayerRotation;
    temporary.currentDistance =
      typeof handoffFreeCamera.currentDistance === "number"
        ? handoffFreeCamera.currentDistance
        : temporary.distance;
    const loc = temporary.getCameraPosition(player.location);
    if (loc && isNumber(loc.x) && isNumber(loc.y) && isNumber(loc.z)) {
      options.location = { x: loc.x, y: loc.y, z: loc.z };
    }
  } catch (error) {
    logIgnoredError(
      "camera_system/camera_runtime:applyStreamingFreeCameraLocation",
      error,
    );
  }
}

function applyStreamingFov(player, previousCam, nextCam, t) {
  const previousFov = getFovValue(previousCam.fov);
  const nextFov = getFovValue(nextCam.fov);
  if (typeof previousFov === "number" && typeof nextFov === "number") {
    const fovValue = lerpNumber(previousFov, nextFov, t);
    try {
      player.camera?.setFov({ fov: fovValue });
    } catch (error) {
      logIgnoredError("camera_system/camera_runtime:applyStreamingFov", error);
    }
  }
}

function cleanupActiveFreeCameraOnEnd(runtime, player) {
  try {
    const activeFreeCamera = runtime.freeCameraBridge?.getActiveFreeCamera?.();
    if (activeFreeCamera?.player?.id !== player.id) {
      return;
    }

    if (runtime.timeline.clearOnEnd) {
      runtime.freeCameraBridge?.stopFreeCamera?.({
        clearCamera: false,
        restoreInput: runtime.timeline.lockInput?.camera !== true,
      });
      return;
    }

    if (runtime.timeline.lockInput?.camera) {
      activeFreeCamera.setForcedCameraInputLocked?.(false);
    }
  } catch (error) {
    logIgnoredError(
      "camera_system/camera_runtime:cleanupActiveFreeCameraOnEnd",
      error,
    );
  }
}

function restorePlayerStateOnEnd(runtime, player) {
  resetCutsceneHud(player, runtime, runtime.logger);
  clearSubtitleDisplay(player, runtime.logger, { deferActionBarClear: true });
  runtime.currentSubtitleState = {};
  runtime.lastProcessedKeyframeIndex = undefined;

  if (runtime.timeline.clearOnEnd) {
    try {
      player.camera?.clear();
    } catch (error) {
      logIgnoredError(
        "camera_system/camera_runtime:restorePlayerStateOnEnd",
        error,
      );
    }
    try {
      runtime.onCameraCleared?.(player);
    } catch (error) {
      logIgnoredError(
        "camera_system/camera_runtime:restorePlayerStateOnEnd",
        error,
      );
    }
  }

  if (runtime.timeline.lockInput?.movement) {
    try {
      enablePlayerMovement(player);
    } catch (error) {
      logIgnoredError(
        "camera_system/camera_runtime:restorePlayerStateOnEnd",
        error,
      );
    }
  }
  if (runtime.timeline.lockInput?.camera) {
    try {
      enablePlayerCamera(player);
    } catch (error) {
      logIgnoredError(
        "camera_system/camera_runtime:restorePlayerStateOnEnd",
        error,
      );
    }
  }

  removeCutsceneActivePlayerTag(player);
}

/**
 * Executes a single timeline instance for one bound player.
 */
export class CameraCutsceneRuntime {
  /**
   * Creates a runtime instance for a single timeline execution.
   * @param {import("./camera_timeline.js").CameraTimeline} timeline Timeline instance.
   * @param {Record<string, any>} bindings Entity bindings map.
   * @param {Object} logger Logger with debug/info/warn/error methods.
   * @param {Object} [options] Runtime options.
   * @param {Record<string, Function>} [options.callbacks] Named callback handlers.
   * @param {string[]} [options.mutedTracks] Additional tracks to mute.
   * @param {(bindings:Record<string, any>) => any} [options.bindingsResolver] Fallback player resolver.
   * @param {Object} [options.freeCameraBridge] Free-camera bridge callbacks.
   * @param {(id:string, bindings:Record<string, any>, callbacks?:Record<string, Function>) => void} [options.triggerTimeline] Nested timeline trigger callback.
   * @param {(player:any) => void} [options.onCameraCleared] Called after the cutscene clears the player's camera.
   * @param {Function} [options.onEnd] Called once when the cutscene ends.
   */
  constructor(timeline, bindings, logger, options = {}) {
    this.timeline = timeline;
    this.bindings = bindings || {};
    this.logger = logger;
    this.callbacks = options.callbacks || {};
    this.bindingsResolver = options.bindingsResolver;
    this.triggerTimeline = options.triggerTimeline;
    this.freeCameraBridge = options.freeCameraBridge;
    this.onCameraCleared = options.onCameraCleared;
    this.onEnd =
      typeof options.onEnd === "function" ? options.onEnd : undefined;
    this.mutedTracks = new Set([
      ...(timeline.mutedTracks || []),
      ...(options.mutedTracks || []),
    ]);
    this.schedule = this.buildSchedule();
    this.currentTick = 0;
    this.scheduleIndex = 0;
    this.isRunning = false;
    this.isPaused = false;
    this.pauseKey = undefined;
    this.hasEnded = false;
    this.hudAllHidden = false;
    this.hiddenHudElements = new Set();
    this.currentSubtitleState = {};
    this.lastProcessedKeyframeIndex = undefined;
  }

  /**
   * Builds a tick-scheduled keyframe queue.
   * @returns {Array<{timeTicks:number,timeSeconds:number,index:number,keyframe:any}>}
   */
  buildSchedule() {
    const ordered = this.timeline.getOrderedKeyframes();
    return ordered.map((entry, index) => ({
      timeTicks: Math.max(0, Math.ceil(entry.time * TicksPerSecond - 1e-9)),
      timeSeconds: entry.time,
      index,
      keyframe: entry.data,
    }));
  }

  /**
   * Resolves the active player entity from bindings.
   * @returns {any|undefined}
   */
  resolvePlayer() {
    const player = this.bindings[this.timeline.playerKey];
    if (player?.isValid) {
      return player;
    }
    if (typeof this.bindingsResolver === "function") {
      const resolved = this.bindingsResolver(this.bindings);
      if (resolved) {
        this.bindings[this.timeline.playerKey] = resolved;
        return resolved;
      }
    }
    return undefined;
  }

  /**
   * Starts runtime processing and input locks.
   * @returns {void}
   */
  start() {
    if (this.isRunning) {
      return;
    }

    if (this.hasEnded) {
      // Allow re-starting a runtime instance if a consumer reuses it.
      this.hasEnded = false;
    }

    const player = this.resolvePlayer();
    if (!player) {
      this.logger?.warn?.("CAMERA", "No valid player binding found", {
        playerKey: this.timeline.playerKey,
      });
      return;
    }

    addCutsceneActivePlayerTag(player);

    if (this.timeline.lockInput?.movement) {
      disablePlayerMovement(player);
    }
    if (this.timeline.lockInput?.camera) {
      disablePlayerCamera(player);
      try {
        const activeFreeCamera = this.freeCameraBridge?.getActiveFreeCamera?.();
        if (activeFreeCamera?.player?.id === player.id) {
          activeFreeCamera.setForcedCameraInputLocked?.(true);
        }
      } catch (error) {
        logIgnoredError("camera_system/camera_runtime:start", error);
      }
    }

    this.isRunning = true;
    this.currentTick = 0;
    this.scheduleIndex = 0;
    this.lastProcessedKeyframeIndex = undefined;
    this.tickHandle = system.runInterval(() => this.tick(), 1);
  }

  /**
   * Advances runtime by one tick and processes due keyframes.
   * @returns {void}
   */
  tick() {
    if (!this.isRunning) {
      return;
    }

    const player = this.resolvePlayer();
    if (!player) {
      return;
    }

    refreshPersistentSubtitleState(this, player);

    if (this.isPaused) {
      return;
    }

    let isWaitingOnKeyframeCondition = false;
    let processedKeyframesThisTick = 0;
    const maxKeyframesThisTick = Math.max(1, (this.schedule?.length ?? 0) + 1);

    while (this.scheduleIndex < this.schedule.length) {
      processedKeyframesThisTick += 1;
      if (processedKeyframesThisTick > maxKeyframesThisTick) {
        this.logger?.warn?.(
          "CAMERA",
          "Safety stop: potential unbounded keyframe loop detected",
          {
            timelineId: this.timeline?.id,
            scheduleLength: this.schedule?.length,
            scheduleIndex: this.scheduleIndex,
            currentTick: this.currentTick,
          },
        );
        this.end("safety_keyframe_loop_guard");
        return;
      }

      const next = this.schedule[this.scheduleIndex];
      if (next.timeTicks > this.currentTick) {
        break;
      }

      const didProcessKeyframe = this.processKeyframe(next, player);
      if (!didProcessKeyframe) {
        isWaitingOnKeyframeCondition = true;
        break;
      }

      this.scheduleIndex += 1;

      if (this.isPaused) {
        break;
      }
    }

    if (!isWaitingOnKeyframeCondition) {
      this.currentTick += 1;
    }

    if (!this.isPaused && this.scheduleIndex >= this.schedule.length) {
      this.end("finished");
    }
  }

  /**
   * Executes all tracks for a scheduled keyframe.
   * @param {{keyframe:any,timeSeconds:number,index:number}} entry Scheduled keyframe entry.
   * @param {any} player Active player entity.
   * @returns {boolean}
   */
  processKeyframe(entry, player) {
    const keyframe = entry.keyframe || {};
    const origin = this.timeline.origin || { x: 0, y: 0, z: 0 };
    const context = {
      timeline: this.timeline,
      bindings: this.bindings,
      player,
      keyframe,
      time: entry.timeSeconds,
      callbacks: this.callbacks,
    };

    if (!shouldRunKeyframe(keyframe, context)) {
      return false;
    }

    if (typeof keyframe.onEnter === "function") {
      keyframe.onEnter(context);
    }

    runKeyframeNamedCallbacks(keyframe, context, this.logger);

    const tracks = resolveTrackData(keyframe);
    const trackState = resolveKeyframeCameraState(
      this,
      entry,
      tracks,
      keyframe,
    );
    applyResolvedKeyframeTracks(
      this,
      trackState,
      keyframe,
      player,
      origin,
      context,
    );
    this.lastProcessedKeyframeIndex = entry.index;
    finalizeKeyframeFlow(this, keyframe, context);
    return true;
  }

  /**
   * Applies interpolated camera transforms between neighboring keyframes.
   * @param {any} player Active player entity.
   * @returns {void}
   */
  applyStreamingFrame(player) {
    const pair = resolveStreamingPair(this);
    if (!pair) {
      return;
    }

    const { previous, next } = pair;

    const previousTracks = resolveTrackData(previous.keyframe || {});
    const nextTracks = resolveTrackData(next.keyframe || {});
    const previousCam = previousTracks.camera;
    const nextCam = nextTracks.camera;

    if (!previousCam || !nextCam) {
      return;
    }

    const durationTicks = next.timeTicks - previous.timeTicks;
    if (durationTicks <= 0) {
      return;
    }

    const easeType = resolveStreamingSegmentEaseType(this, previous, next);
    if (isCutEaseType(easeType)) {
      return;
    }

    const rawT = (this.currentTick - previous.timeTicks) / durationTicks;
    const easeFn = resolveEaseFunction(easeType);
    const t = easeFn(Math.min(1, Math.max(0, rawT)));

    const canStreamPose =
      !previousCam.rig &&
      !nextCam.rig &&
      !previousCam.lookAt &&
      !nextCam.lookAt &&
      !previousCam.blend &&
      !nextCam.blend;

    if (canStreamPose) {
      const baseRotation = getPreservedRotation(player);
      const activeFreeCamera = this.freeCameraBridge?.getActiveFreeCamera?.();
      const handoffFreeCamera =
        activeFreeCamera?.player?.id === player?.id
          ? activeFreeCamera
          : undefined;
      const previousOptions = resolveCameraSetOptions(previousCam, {
        bindings: this.bindings,
        player,
        origin: this.timeline?.origin,
        baseRotation,
      });
      const nextOptions = resolveCameraSetOptions(nextCam, {
        bindings: this.bindings,
        player,
        origin: this.timeline?.origin,
        baseRotation,
      });

      // If the keyframes use DirectionalOffset shorthand, and a free camera is
      // currently active, align the streamed locations to free-camera semantics.
      if (handoffFreeCamera) {
        if (previousOptions && previousCam) {
          applyStreamingFreeCameraLocation(
            previousCam,
            previousOptions,
            handoffFreeCamera,
            player,
          );
        }
        if (nextOptions && nextCam) {
          applyStreamingFreeCameraLocation(
            nextCam,
            nextOptions,
            handoffFreeCamera,
            player,
          );
        }
      }

      if (previousOptions?.location && nextOptions?.location) {
        const location = {
          x: lerpNumber(previousOptions.location.x, nextOptions.location.x, t),
          y: lerpNumber(previousOptions.location.y, nextOptions.location.y, t),
          z: lerpNumber(previousOptions.location.z, nextOptions.location.z, t),
        };

        let rotation;
        if (previousOptions.rotation && nextOptions.rotation) {
          rotation = {
            x: lerpNumber(
              previousOptions.rotation.x,
              nextOptions.rotation.x,
              t,
            ),
            y: lerpAngleDegrees(
              previousOptions.rotation.y,
              nextOptions.rotation.y,
              t,
            ),
          };
        }

        const preset = resolvePresetId(
          nextCam.preset,
          this.timeline.defaultCameraPreset,
        );
        const setOptions = rotation ? { location, rotation } : { location };

        try {
          player.camera?.setCamera(preset, setOptions);
        } catch (error) {
          logIgnoredError(
            "camera_system/camera_runtime:applyStreamingFrame",
            error,
          );
        }
      }
    }

    applyStreamingFov(player, previousCam, nextCam, t);
  }

  /**
   * Pauses timeline progression.
   * @param {string|undefined} pauseKey Optional pause token.
   * @returns {void}
   */
  pause(pauseKey) {
    this.isPaused = true;
    this.pauseKey = pauseKey ?? this.pauseKey;
  }

  /**
   * Resumes timeline progression if pause key matches.
   * @param {string|undefined} resumeKey Optional resume token.
   * @returns {void}
   */
  resume(resumeKey) {
    if (!this.isPaused) {
      return;
    }
    if (this.pauseKey && resumeKey && this.pauseKey !== resumeKey) {
      return;
    }
    this.isPaused = false;
    this.pauseKey = undefined;
  }

  /**
   * Finalizes runtime and restores player state.
   * @returns {void}
   */
  end(reason = "finished") {
    if (this.hasEnded) {
      return;
    }

    this.hasEnded = true;

    if (this.tickHandle) {
      system.clearRun(this.tickHandle);
      this.tickHandle = undefined;
    }

    const wasRunning = this.isRunning;
    this.isRunning = false;

    const player = this.resolvePlayer();
    if (player?.isValid) {
      cleanupActiveFreeCameraOnEnd(this, player);
      restorePlayerStateOnEnd(this, player);
    }

    try {
      this.onEnd?.({
        reason,
        wasRunning,
        timeline: this.timeline,
        bindings: this.bindings,
        player,
        runtime: this,
      });
    } catch (error) {
      logIgnoredError("camera_system/camera_runtime:end", error);
    }
  }

  /**
   * Stops runtime immediately.
   * @returns {void}
   */
  stop() {
    // Stop is expected to cleanup even if called mid-tick.
    this.end("stopped");
  }
}
