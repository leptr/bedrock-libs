// Developed by: Petar Mijailovic (leptr)
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

/**
 * Script-event bridge for cutscenes and free-camera controls.
 */

import { system, world } from "@minecraft/server";
import { SETTINGS } from "../game_settings.js";
import { CameraSystem } from "./camera_system.js";
import {
  CAMERA_FOLLOW_MODES,
  CAMERA_SCRIPT_EVENT_DEFAULTS,
  CAMERA_SCRIPT_EVENTS,
} from "./constants.js";
import { logIgnoredError } from "../utils/logger.js";

const FREE_CAMERA_COMMANDS = {
  START: "start",
  STOP: "stop",
  ZOOM: "zoom",
  SET_DISTANCE: "setdistance",
  PAUSE: "pause",
  RESUME: "resume",
  FOLLOW_MODE: "followmode",
  INPUT_LOCK: "inputlock",
  OFFSET: "offset",
};

const CAMERA_COMMANDS = {
  RESET: "reset",
  DEFAULT: "default",
  SET: "set",
  ENABLE: "enable",
  VANILLA: "vanilla",
};

// A function, so the namespace is read after the project has configured it.
const getCameraUsageLines = () => [
  `§eUsage:§r /scriptevent ${SETTINGS.general.namespace}:camera <command> ...`,
  "§7- reset|default§r -> reset to default camera",
  "§7- set|enable <cameraId> [easeSeconds] [easeType]§r -> activate a registered camera",
  "§7- vanilla <first_person|third_person|third_person_front> [easeSeconds] [easeType]§r -> switch to a vanilla camera",
];

function getNearestPlayer(targetEntity) {
  const players = world.getPlayers?.() || [];
  if (players.length === 0) {
    return undefined;
  }

  if (!targetEntity?.location) {
    return players[0];
  }

  let nearestPlayer;
  let nearestDistanceSquared = Number.POSITIVE_INFINITY;

  for (const player of players) {
    if (!player?.isValid || !player.location) {
      continue;
    }

    const dx = player.location.x - targetEntity.location.x;
    const dy = player.location.y - targetEntity.location.y;
    const dz = player.location.z - targetEntity.location.z;
    const distanceSquared = dx * dx + dy * dy + dz * dz;

    if (distanceSquared < nearestDistanceSquared) {
      nearestDistanceSquared = distanceSquared;
      nearestPlayer = player;
    }
  }

  return nearestPlayer || players[0];
}

function getEventBindings(sourceEntity) {
  const entity1 = sourceEntity?.isValid ? sourceEntity : undefined;
  const player1 =
    entity1?.typeId === "minecraft:player"
      ? entity1
      : getNearestPlayer(entity1);

  if (!player1) {
    return undefined;
  }

  return {
    player1,
    ...(entity1 ? { entity1 } : {}),
    ...(entity1 ? { sourceEntity: entity1 } : {}),
  };
}

function parseOptionalFloat(value, fallback = undefined) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getTransitionOverride(parts) {
  const [, , easeSecondsPart, easeType] = parts;
  const easeSeconds = parseOptionalFloat(easeSecondsPart);
  const transitionOverride = {
    ...(Number.isFinite(easeSeconds) ? { easeTimeSeconds: easeSeconds } : {}),
    ...(typeof easeType === "string" && easeType ? { easeType } : {}),
  };

  return Object.keys(transitionOverride).length > 0
    ? transitionOverride
    : undefined;
}

function sendCameraUsage(player) {
  try {
    for (const line of getCameraUsageLines()) {
      player.sendMessage(line);
    }
  } catch (error) {
    logIgnoredError(
      "camera_system/camera_script_events:sendCameraUsage",
      error,
    );
  }
}

function handleTimelineScriptEvent(id, message, player, bindings, eventIds) {
  const timelineId = message?.trim();
  if (!timelineId) {
    return true;
  }

  switch (id) {
    case eventIds.trigger: {
      if (!player) {
        return true;
      }

      CameraSystem.triggerCutscene(timelineId, {
        ...bindings,
      });
      return true;
    }
    case eventIds.pause: {
      CameraSystem.pauseCutscene(timelineId);
      return true;
    }
    case eventIds.resume: {
      CameraSystem.resumeCutscene(timelineId);
      return true;
    }
    default: {
      break;
    }
  }

  return false;
}

function handleRegisteredCameraEvent(player, bindings, registeredCamera) {
  if (!registeredCamera) {
    return false;
  }

  if (!player) {
    return true;
  }

  if (registeredCamera.timelineId) {
    CameraSystem.triggerCutscene(registeredCamera.timelineId, {
      ...bindings,
    });
    return true;
  }

  const activeCamera = CameraSystem.getActiveFreeCamera();
  if (!activeCamera) {
    if (registeredCamera.startIfMissing === false) {
      return true;
    }

    CameraSystem.startFreeCamera(player, registeredCamera.camera);
    return true;
  }

  activeCamera.transitionToConfig(
    registeredCamera.camera,
    registeredCamera.transition,
  );
  return true;
}

function handleFreeCameraCommand(command, parts, player) {
  switch (command) {
    case FREE_CAMERA_COMMANDS.START: {
      if (!player) {
        return;
      }

      const distance = parseOptionalFloat(
        parts[1],
        CAMERA_SCRIPT_EVENT_DEFAULTS.freeCameraDistance,
      );
      const heightOffset = parseOptionalFloat(
        parts[2],
        CAMERA_SCRIPT_EVENT_DEFAULTS.freeCameraHeightOffset,
      );
      CameraSystem.startFreeCamera(player, {
        distance,
        heightOffset,
      });
      return;
    }
    case FREE_CAMERA_COMMANDS.STOP: {
      CameraSystem.stopFreeCamera();
      return;
    }
    case FREE_CAMERA_COMMANDS.ZOOM: {
      const delta = parseOptionalFloat(
        parts[1],
        CAMERA_SCRIPT_EVENT_DEFAULTS.freeCameraZoomDelta,
      );
      CameraSystem.zoomFreeCamera(delta);
      return;
    }
    case FREE_CAMERA_COMMANDS.SET_DISTANCE: {
      const distance = parseOptionalFloat(
        parts[1],
        CAMERA_SCRIPT_EVENT_DEFAULTS.freeCameraDistance,
      );
      CameraSystem.setFreeCameraDistance(distance);
      return;
    }
    case FREE_CAMERA_COMMANDS.PAUSE: {
      CameraSystem.pauseFreeCamera();
      return;
    }
    case FREE_CAMERA_COMMANDS.RESUME: {
      CameraSystem.resumeFreeCamera();
      return;
    }
    case FREE_CAMERA_COMMANDS.FOLLOW_MODE: {
      const mode = parts[1] || CAMERA_FOLLOW_MODES.CENTERED;
      CameraSystem.setFreeCameraFollowMode(mode);
      return;
    }
    case FREE_CAMERA_COMMANDS.INPUT_LOCK: {
      const locked = parts[1]?.toLowerCase() === "true";
      CameraSystem.setFreeCameraInputLocked(locked);
      return;
    }
    case FREE_CAMERA_COMMANDS.OFFSET: {
      const [, backPart, upPart, sidePart] = parts;
      const back = parseOptionalFloat(backPart);
      const up = parseOptionalFloat(upPart);
      const side = parseOptionalFloat(sidePart);
      CameraSystem.updateFreeCameraOffset(back, up, side);
      break;
    }
    default:
  }
}

function handleFreeCameraScriptEvent(id, message, player) {
  if (id !== `${SETTINGS.general.namespace}:camera_freecam`) {
    return false;
  }

  const parts = message?.trim().split(/\s+/u) || [];
  handleFreeCameraCommand(parts[0], parts, player);
  return true;
}

function handleCameraCommand(command, parts, player, bindings) {
  if (!player) {
    return;
  }

  if (
    command === CAMERA_COMMANDS.RESET ||
    command === CAMERA_COMMANDS.DEFAULT
  ) {
    CameraSystem.resetToDefaultCamera(player);
    return;
  }

  const transitionOverride = getTransitionOverride(parts);
  if (command === CAMERA_COMMANDS.SET || command === CAMERA_COMMANDS.ENABLE) {
    const cameraId = parts[1];
    if (!cameraId) {
      return;
    }

    CameraSystem.activateCameraById(
      player,
      cameraId,
      bindings,
      transitionOverride,
    );
    return;
  }

  if (command === CAMERA_COMMANDS.VANILLA) {
    const vanillaMode = parts[1];
    if (!vanillaMode) {
      return;
    }

    CameraSystem.transitionToVanillaCamera(
      player,
      vanillaMode,
      transitionOverride,
    );
  }
}

function handleCameraScriptEvent(id, message, player, bindings) {
  if (id !== `${SETTINGS.general.namespace}:camera`) {
    return false;
  }

  if (!player) {
    return true;
  }

  const trimmed = typeof message === "string" ? message.trim() : "";
  if (!trimmed) {
    sendCameraUsage(player);
    return true;
  }

  const parts = trimmed.split(/\s+/u) || [];
  handleCameraCommand(parts[0], parts, player, bindings);
  return true;
}

function handleScriptEventReceive(event, eventIds) {
  const { id, message, sourceEntity } = event;
  const bindings = getEventBindings(sourceEntity);
  const player = bindings?.player1;

  if (handleTimelineScriptEvent(id, message, player, bindings, eventIds)) {
    return;
  }

  const registeredCamera = CameraSystem.getCameraByEventId?.(id);
  if (handleRegisteredCameraEvent(player, bindings, registeredCamera)) {
    return;
  }

  if (handleFreeCameraScriptEvent(id, message, player)) {
    return;
  }

  if (handleCameraScriptEvent(id, message, player, bindings)) {
    // do nothing
  }
}

/**
 * Register `/scriptevent` handlers for the camera system.
 *
 * Default command:
 * - `/scriptevent camera:cutscene <timelineId>`
 *
 * This also supports a few utility namespaces:
 * - `${SETTINGS.general.namespace}:camera_freecam ...`
 * - `${SETTINGS.general.namespace}:camera ...`
 *
 * Script events are optional; if the API is missing, this does nothing.
 *
 * @param {{ trigger: string, pause: string, resume: string }} [eventIds]
 */
export function registerCameraScriptEvents(eventIds = CAMERA_SCRIPT_EVENTS) {
  try {
    if (!system.afterEvents?.scriptEventReceive?.subscribe) {
      return;
    }

    system.afterEvents.scriptEventReceive.subscribe(event => {
      handleScriptEventReceive(event, eventIds);
    });
  } catch (error) {
    logIgnoredError(
      "camera_system/camera_script_events:registerCameraScriptEvents",
      error,
    );
  }
}
