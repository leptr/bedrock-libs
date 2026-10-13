// Developed by: Petar Mijailovic (leptr)
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

import { SETTINGS } from "../../game_settings.js";
import { clamp } from "../../utils/utils.js";
import { CameraSystem } from "../camera_system.js";

const CAMERA_KEY = "gameplay_third_person";
const CAMERA_ID_FALLBACK = "hf_sm:gameplay_third_person";
const TICKS_PER_SECOND = 20;
const SWING_ENTRY_MAX_EASE_SECONDS = 0.06;

const getCameraEntry = () => SETTINGS?.cameras?.[CAMERA_KEY];
const isGameplayCameraEnabled = () =>
  SETTINGS?.gameplay?.cameras?.enable_gameplay_third_person_camera !== false;

const getDynamicSettings = () => {
  const dynamic = getCameraEntry()?.dynamic || {};
  return {
    swingZoomMinDistance: dynamic.swing_zoom_min_distance ?? 6.2,
    swingZoomMaxDistance: dynamic.swing_zoom_max_distance ?? 9.0,
    swingSpeedForMaxZoom: dynamic.swing_speed_for_max_zoom ?? 34,
    swingZoomEaseSeconds: dynamic.swing_zoom_ease_seconds ?? 0.12,
    jumpZoomDistance: dynamic.jump_zoom_distance ?? 3.25,
    jumpZoomHeightOffset: dynamic.jump_zoom_height_offset ?? 1.12,
    jumpZoomBackOffset: dynamic.jump_zoom_back_offset ?? -1.05,
    jumpZoomSeconds: dynamic.jump_zoom_seconds ?? 1.4,
    jumpZoomEaseSeconds: dynamic.jump_zoom_ease_seconds ?? 0.09,
    jumpDetectionMinVerticalSpeed:
      dynamic.jump_detection_min_vertical_speed ?? 0.08,
    normalRestoreEaseSeconds: dynamic.normal_restore_ease_seconds ?? 0.2,
  };
};

const buildBaseConfig = () => {
  const camera = getCameraEntry()?.config?.camera || {};
  return {
    preset: camera.preset ?? "minecraft:free",
    distance: camera.distance ?? 4.2,
    heightOffset: camera.heightOffset ?? 1.18,
    backOffset: camera.backOffset ?? -1.35,
    sideOffset: camera.sideOffset ?? 0,
    followMode: camera.followMode ?? "player-rotated",
    focusTarget:
      typeof camera.focusTarget === "boolean" ? camera.focusTarget : false,
    useHeadLocationForPosition:
      typeof camera.useHeadLocationForPosition === "boolean"
        ? camera.useHeadLocationForPosition
        : true,
    followLeadSeconds: camera.followLeadSeconds ?? 0,
    followSmoothTimeSeconds: camera.followSmoothTimeSeconds ?? 0,
    followVerticalSmoothTimeSeconds:
      camera.followVerticalSmoothTimeSeconds ?? 0,
    rotationSmoothTimeSeconds: camera.rotationSmoothTimeSeconds ?? 0,
    lookAtSmoothTimeSeconds: camera.lookAtSmoothTimeSeconds ?? 0,
    easeType: camera.easeType ?? "Linear",
    easeTimeSeconds: camera.easeTimeSeconds ?? 0,
    disablePlayerInput:
      typeof camera.disablePlayerInput === "boolean"
        ? camera.disablePlayerInput
        : false,
    minDistance: camera.minDistance ?? 2.5,
    maxDistance: camera.maxDistance ?? 10.5,
  };
};

const gameplayCameraStates = new Map();

const getPlayerState = playerId => {
  let state = gameplayCameraStates.get(playerId);
  if (!state) {
    state = {
      lastMode: undefined,
      jumpZoomUntilTick: 0,
      wasOnGround: undefined,
    };
    gameplayCameraStates.set(playerId, state);
  }
  return state;
};

const resolveTargetProfile = (player, pd, tick, isOnGround, verticalSpeed) => {
  const baseConfig = buildBaseConfig();
  const dynamic = getDynamicSettings();
  const state = getPlayerState(player.id);

  const previousGround =
    typeof state.wasOnGround === "boolean" ? state.wasOnGround : isOnGround;

  if (
    !pd.is_swinging &&
    previousGround &&
    !isOnGround &&
    verticalSpeed > dynamic.jumpDetectionMinVerticalSpeed
  ) {
    state.jumpZoomUntilTick =
      tick +
      Math.max(0, Math.round(dynamic.jumpZoomSeconds * TICKS_PER_SECOND));
  }

  state.wasOnGround = isOnGround;

  if (pd.is_swinging) {
    const swingEaseSeconds = Math.min(
      dynamic.swingZoomEaseSeconds,
      SWING_ENTRY_MAX_EASE_SECONDS,
    );

    return {
      mode: "swing",
      config: {
        ...baseConfig,
        distance: clamp(
          dynamic.swingZoomMinDistance,
          baseConfig.minDistance,
          baseConfig.maxDistance,
        ),
        easeTimeSeconds: swingEaseSeconds,
      },
      transition: {
        easeType: baseConfig.easeType,
        easeTimeSeconds: swingEaseSeconds,
      },
    };
  }

  if (tick <= state.jumpZoomUntilTick) {
    return {
      mode: "jump",
      config: {
        ...baseConfig,
        distance: clamp(
          dynamic.jumpZoomDistance,
          baseConfig.minDistance,
          baseConfig.maxDistance,
        ),
        heightOffset: dynamic.jumpZoomHeightOffset,
        backOffset: dynamic.jumpZoomBackOffset,
        easeTimeSeconds: dynamic.jumpZoomEaseSeconds,
      },
      transition: {
        easeType: baseConfig.easeType,
        easeTimeSeconds: dynamic.jumpZoomEaseSeconds,
      },
    };
  }

  return {
    mode: "normal",
    config: {
      ...baseConfig,
      easeTimeSeconds: dynamic.normalRestoreEaseSeconds,
    },
    transition: {
      easeType: baseConfig.easeType,
      easeTimeSeconds: dynamic.normalRestoreEaseSeconds,
    },
  };
};

export const initializeGameplayCamera = () => {
  if (!isGameplayCameraEnabled()) {
    return;
  }

  const cameraEntry = getCameraEntry();
  const cameraId = cameraEntry?.id || CAMERA_ID_FALLBACK;
  CameraSystem.setDefaultPlayerCamera(cameraId);
};

export const updateGameplayCamera = (
  player,
  pd,
  tick,
  isOnGround,
  verticalSpeed,
) => {
  if (!player?.isValid || !pd) return;

  if (!isGameplayCameraEnabled()) {
    return;
  }

  if (CameraSystem.isPlayerInActiveTimeline(player)) {
    const state = getPlayerState(player.id);
    state.wasOnGround = isOnGround;
    return;
  }

  const activeCamera = CameraSystem.getActiveFreeCamera();
  if (!activeCamera || activeCamera.player?.id !== player.id) {
    CameraSystem.applyDefaultPlayerCamera(player);
    const state = getPlayerState(player.id);
    state.wasOnGround = isOnGround;
    return;
  }

  const state = getPlayerState(player.id);
  const profile = resolveTargetProfile(
    player,
    pd,
    tick,
    isOnGround,
    verticalSpeed,
  );

  const shouldUpdateMode = profile.mode !== state.lastMode;
  if (!shouldUpdateMode) return;

  activeCamera.transitionToConfig(profile.config, profile.transition);
  state.lastMode = profile.mode;
};
