// Developed by: Petar Mijailovic (leptr)
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

/**
 * Camera Cutscene System
 * ======================
 *
 * This module provides a timeline-driven camera system for creating AAA-style
 * cutscenes in Minecraft Bedrock. The system is designed to make it easy to
 * author cutscenes with keyframes, camera easing, fades, and entity actions.
 *
 * KEY IDEAS
 * - A Timeline stores all data in a single object.
 * - Keyframes are stored as key-value pairs where the key is time in seconds.
 * - Each keyframe can drive camera state, entity actions, and callbacks.
 * - Keyframes describe the camera state at their exact timeline time.
 * - By default, each segment eases toward the next keyed state using that
 *   next keyframe's timing metadata (`toCurrent`).
 * - Input locks default to enabled for movement and camera.
 * - Use CAMERA_PRESETS and CAMERA_TEMPLATES for quick authoring.
 *
 * QUICK START
 * ```javascript
 * import { CameraSystem, CameraTimeline } from "./camera_system/camera_system.js";
 *
 * const introTimeline = CameraTimeline.fromObject({
 *   id: "intro",
 *   playerKey: "player1",
 *   defaultCameraPreset: "minecraft:free",
 *   easeMode: "toCurrent", // default: ease from this keyframe to the next keyed state
 *   lockInput: { movement: true, camera: true },
 *   clearOnEnd: true,
 *   keyframes: {
 *     0: {
 *       camera: {
 *         preset: "minecraft:free",
 *         setOptions: {
 *           location: { x: 12, y: 65, z: -8 },
 *           rotation: { x: 10, y: 45 },
 *         },
 *         easeType: "Linear",
 *       },
 *       entities: {
 *         entity1: {
 *           teleport: { location: { x: 10, y: 64, z: -5 } },
 *         },
 *       },
 *     },
 *     2.5: {
 *       camera: {
 *         preset: "minecraft:free",
 *         setOptions: {
 *           location: { x: 6, y: 66, z: -2 },
 *           rotation: { x: 5, y: 90 },
 *         },
 *         easeType: "InOutSine",
 *       },
 *       entities: {
 *         entity1: {
 *           playAnimation: {
 *             animation: "animation.my_mob.roar",
 *             options: { blendOutTime: 0.1 },
 *           },
 *         },
 *       },
 *     },
 *     3.0: {
 *       camera: {
 *         fade: {
 *           fadeColor: { red: 0, green: 0, blue: 0 },
 *           fadeTime: { fadeInTime: 0.3, holdTime: 0.3, fadeOutTime: 0.3 },
 *         },
 *       },
 *     },
 *   },
 * });
 *
 * CameraSystem.registerTimeline(introTimeline);
 *
 * // Later, when you want to play it:
 * CameraSystem.triggerCutscene(
 *   "intro",
 *   { player1: player, entity1: bossEntity },
 *   {
 *     callbacks: {
 *       canPlayIntro: ({ bindings }) => bindings.player1?.hasTag("cutscene_ok"),
 *     },
 *     mutedTracks: ["audio"],
 *     bindingsResolver: bindings => bindings.player1,
 *   },
 * );
 * ```
 *
 * SCRIPT EVENT TRIGGERS
 * - /scriptevent camera:cutscene intro_example
 * - /scriptevent camera:pause intro_example
 * - /scriptevent camera:resume intro_example
 *
 * CAMERA KEYFRAME DATA
 * - camera.preset: string (camera preset id)
 * - camera.setOptions: any Camera.setCamera setOptions (all camera features)
 * - camera.location: shorthand for setOptions.location
 * - camera.sourceKey: binding key used as the source entity for shorthand position/rotation resolution
 * - camera.position:
 *   - `{x,y,z}` shorthand for setOptions.location (world position)
 *   - OR `DirectionalOffset` (or compatible object) to resolve a world location relative to `camera.sourceKey` (falls back to the player)
 * - camera.rotation:
 *   - `{x,y}` shorthand for setOptions.rotation
 *   - OR `AngleOffset` to apply a delta rotation (theta=yaw, phi=pitch) relative to `camera.sourceKey` rotation (falls back to the current camera/player rotation)
 * - camera.rotate: `AngleOffset` delta applied on top of the resolved camera/source rotation
 * - camera.facingEntity / camera.facingLocation: shorthand facing options
 * - camera.setDefault: boolean (use setDefaultCamera instead of setCamera)
 * - camera.clear: boolean (clear camera when keyframe hits)
 * - camera.fov: CameraFovOptions
 * - camera.fade: CameraFadeOptions
 * - camera.shake: { intensity?, duration?, shakeType?, radius? }
 * - camera.shakes: [ { intensity?, duration?, shakeType?, radius? } ]
 * - camera.hud:
 *   - `false` -> reset all HUD elements hidden by earlier cutscene keyframes
 *   - `{ all: true }` -> hide all supported HUD elements
 *   - `{ all: false }` -> reset all HUD elements hidden by earlier cutscene keyframes
 *   - `{ Crosshair: true, Hotbar: true }` -> hide specific HUD elements by name
 *   - `{ Crosshair: false }` -> reset a specific HUD element previously hidden by the cutscene
 * - camera.preset + camera.setOptions -> Camera.setCamera()
 * - camera.setDefault + camera.preset -> Camera.setDefaultCamera()
 * - camera.clear -> Camera.clear()
 * - camera.easeType: EasingType or string name (e.g. "Linear", "InOutSine")
 * - camera.fovEasingType: optional easing override used only for `camera.fov`
 *   - if omitted, `camera.fov` uses the same easingType/easeTime semantics as camera pose
 * - camera.easeTimeSeconds: override auto duration
 * - subtitles:
 *   - `{ text: "Actionbar text" }` -> actionbar message
 *   - `{ translate: "texts.hf.some_line", with: [arg1, arg2] }` -> translated actionbar message
 *   - `{ title: { text: "Boss Incoming" } }` -> title field
 *   - `{ subtitle: { translate: "texts.hf.subtitle" } }` -> subtitle field
 *   - `{ actionbar: { clear: true } }` / `{ title: { clear: true } }` / `{ subtitle: { clear: true } }` -> clear just that field
 *   - `{ clearOtherFields: false, text: "...", title: { text: "..." }, subtitle: { text: "..." } }`
 *   - `clearOtherFields` defaults to `true`; when true, omitted subtitle fields are cleared by that keyframe
 *   - subtitle text persists between keyframes until a later subtitle keyframe overrides or clears it
 *   - an explicit empty subtitles block (`subtitles: {}`) clears all subtitle fields
 *
 * SUBTITLE EXAMPLES
 * ```javascript
 * // Example 1 - regular actionbar subtitles
 * subtitles: {
 *   text: "This is actionbar text!",
 * }
 *
 * // Example 2 - translated actionbar subtitles with optional formatting args
 * subtitles: {
 *   translate: "texts.hf.some_line",
 *   with: [variable1, variable2],
 * }
 *
 * // Example 3 - title text
 * subtitles: {
 *   title: {
 *     text: "This is title text!",
 *   },
 * }
 *
 * // Example 4 - actionbar + title + subtitle kept together
 * subtitles: {
 *   clearOtherFields: false,
 *   text: "This is actionbar text!",
 *   title: {
 *     text: "This is title text!",
 *   },
 *   subtitle: {
 *     text: "This is subtitle text!",
 *   },
 * }
 *
 * // Example 5 - clear only subtitle and keep title/actionbar
 * subtitles: {
 *   clearOtherFields: false,
 *   subtitle: {
 *     clear: true,
 *   },
 * }
 * ```
 *
 * ENTITY KEYFRAME DATA
 * - entities.<bindingKey>.teleport: { location, options }
 * - entities.<bindingKey>.safeTeleport: { location, findNearestAir?, alignGround?, options? }
 *   - `options.rotation` can be:
 *     - `{ x, y }` absolute Bedrock entity rotation
 *     - OR `{ sourceKey?, locationSource?, rotate?: AngleOffset, x?, y? }`
 *       to start from a bound entity/player rotation, apply a yaw/pitch delta,
 *       then optionally override x/y
 * - entities.<bindingKey>.playAnimation: { animation, options }
 * - entities.<bindingKey>.lookAt: { targetKey?, location? }
 * - entities.<bindingKey>.setProperty: { [id]: value }
 * - entities.<bindingKey>.triggerEvent: string or string[]
 * - entities.<bindingKey>.addTag: string or string[]
 * - entities.<bindingKey>.removeTag: string or string[]
 * - entities.<bindingKey>.lockMovement: boolean or { on?: string|boolean, off?: string|boolean }
 * - entities.<bindingKey>.soundEffects: SoundEffect or SoundEffect[]
 * - entities.<bindingKey>.particleEffects: ParticleEffect or ParticleEffect[]
 * - entities.<bindingKey>.entityEffects: EntityEffect or EntityEffect[]
 *   (use SoundEffect, ParticleEffect, EntityEffect from toolkit/toolkit.js;
 *   effect durations are in seconds)
 *   Effects can include: locationSource ("entity"|"camera"|"origin"|"world"),
 *   sourceKey, location, relative, delaySeconds
 * - onEnter: (context) => void  // optional keyframe callback
 * - onExit: (context) => void   // optional keyframe callback
 * - runCallback: string         // optional named callback (non-gating)
 * - runCallbacks: string[]      // optional named callbacks (non-gating)
 *   - Handlers are provided via `CameraSystem.triggerCutscene(..., { callbacks: { name: (context)=>void } })`.
 *
 * GLOBAL EFFECTS (not tied to a specific entity binding)
 * - effects.sourceKey: binding key to use as the source location (defaults to playerKey)
 * - effects.soundEffects: SoundEffect or SoundEffect[]
 * - effects.particleEffects: ParticleEffect or ParticleEffect[]
 * - effects.entityEffects: EntityEffect or EntityEffect[]
 *
 * CAMERA RIGS / LOOK-AT
 * - camera.rig: { type: "orbit"|"dolly"|"crane"|"pan"|"truck"|"handheld", targetKey?, targetLocation?, offset?, radius?, height?, angle?, lookAt?, lookAtWeight? }
 * - camera.lookAt: { targetKey?, location?, weight? }
 *   (can be combined with camera.rig to orbit one target while facing another)
 * - camera.fovRamp: { from, to, durationSeconds, easeType? }
 * - camera.blend: { fromPreset?, toPreset?, durationSeconds?, easeType?, fromSetOptions?, toSetOptions?, mode?, relativeLocation?, relativeTo?, sourceKey? }
 *
 * TRACKS / MARKERS / FLOW
 * - tracks.camera, tracks.subtitles, tracks.entities, tracks.effects, tracks.audio, tracks.groups
 * - entityGroups: [{ selector: { tags?, families?, typeIds? }, actions }]
 * - mutedTracks: ["camera", "subtitles", "entities", "effects", "audio"]
 * - markers: { name: seconds }
 * - goto: number | "markerName"
 * - pause: true | "pauseKey" (resume with CameraSystem.resumeCutscene)
 * - startTimelines: [{ id, bindings?, inheritBindings? }]
 * - conditions: { all?: Condition[], any?: Condition[], callback?: string }
 *   Condition types: entityValid, tag, score, property, callback
 * - `camera.fov` follows the same segment easing semantics as camera pose.
 *   `camera.fovEasingType` can override only the FOV easing type while keeping the same duration.
 *   Non-cut keyframes interpolate from the previous keyed state into this one;
 *   `CUT`, `STEP`, and `NONE` snap at the keyframe time.
 *
 * CAMERA EVENTS (timeline-level defaults)
 * - cameraEvents.entityMovement.on: event id used when lockMovement is true
 * - cameraEvents.entityMovement.off: event id used when lockMovement is false
 *
 * FREE CAMERA MODE
 * ================
 * A non-timeline camera mode that constantly follows the player with smooth interpolation.
 * Perfect for exploration, action gameplay, or smooth transitions to focus on other entities.
 *
 * QUICK START (Free Camera)
 * ```javascript
 * import { CameraSystem } from "./camera_system/camera_system.js";
 *
 * const player = world.getPlayers()[0];
 * const freeCamera = CameraSystem.startFreeCamera(player, {
 *   distance: 6,
 *   heightOffset: 0.5,
 *   sideOffset: 0,
 *   easeType: "OutCubic",
 *   easeTimeSeconds: 0.1,
 *   followMode: "centered", // or "player-rotated"
 *   disablePlayerInput: false,
 *   minDistance: 2,
 *   maxDistance: 20,
 * });
 *
 * // Pan to look at an entity over 0.5 seconds
 * const boss = ...; // some entity
 * freeCamera.panTo(boss, { easeTimeSeconds: 0.5, easeType: "OutCubic" });
 *
 * // Zoom out smoothly
 * freeCamera.zoom(2);
 *
 * // Stop free camera mode
 * CameraSystem.stopFreeCamera();
 * ```
 *
 * FREE CAMERA OPTIONS
 * - distance: Default distance from player (default: 6)
 * - heightOffset: Vertical offset from player eyes (default: 0.5)
 * - sideOffset: Lateral offset from player (default: 0)
 * - backOffset: Forward/backward offset for "player-rotated" mode (default: 0)
 * - directionalOffset: DirectionalOffset for combined height/side/front offsets
 * - position: alias for `directionalOffset`
 * - easeType: Easing type for transitions (default: "Linear")
 * - easeTimeSeconds: Duration of smooth transitions (default: 0.2)
 * - disablePlayerInput: Disable player camera input (default: false)
 * - followMode: "centered" (focus on player) or "player-rotated" (follow player look) (default: "centered")
 * - minDistance: Minimum zoom distance (default: 1)
 * - maxDistance: Maximum zoom distance (default: 30)
 * - preset: Camera preset to use (default: "minecraft:free")
 * - fov: Optional field of view override
 *
 * FOLLOW MODES
 * - "centered": Camera maintains focus on the player center, rotating around them
 * - "player-rotated": Camera follows the player's facing direction, maintaining relative offsets
 */

import { EasingType, system, world, TicksPerSecond } from "@minecraft/server";
import {
  enablePlayerCamera,
  enablePlayerMovement,
  isPlayer,
  resolveAngleTheta,
  resolveDirectionalOffsetValue,
  toDirectionalOffset,
} from "../toolkit/toolkit.js";
import { SETTINGS } from "../game_settings.js";
import { logger, logIgnoredError } from "../utils/logger.js";
import { CameraCutsceneRuntime } from "./camera_runtime.js";
import { CameraTimeline } from "./camera_timeline.js";
import { CameraValidator } from "./camera_validator.js";

import { freeCameraManager } from "./camera_free.js";
import {
  getFreeCameraMimicConfigForVanilla,
  resolveVanillaCameraId,
  getVanillaCameraOverrideTag,
} from "./camera_vanilla.js";
import { CAMERA_EASE_TYPES } from "./constants.js";

/** @import { Entity, Player } from "@minecraft/server" */
/** @import { FreeCamera } from "./camera_free.js" */

/**
 * Normalizes transition aliases to canonical transition keys.
 * @param {Object|undefined} transition Transition configuration.
 * @returns {Object|undefined}
 */
function normalizeTransitionAliases(transition) {
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
 * Normalizes free-camera config aliases to canonical config keys.
 * @param {Object|undefined} cameraConfig Camera configuration.
 * @returns {Object|undefined}
 */
function normalizeFreeCameraConfigAliases(cameraConfig) {
  if (!cameraConfig || typeof cameraConfig !== "object") {
    return cameraConfig;
  }

  const normalized = { ...cameraConfig };

  const directionalOffset = toDirectionalOffset(
    normalized.directionalOffset ?? normalized.offset,
  );

  if (directionalOffset) {
    if (normalized.heightOffset === undefined) {
      normalized.heightOffset = resolveDirectionalOffsetValue(
        directionalOffset,
        "ground",
        0,
      );
    }
    if (normalized.sideOffset === undefined) {
      normalized.sideOffset = resolveDirectionalOffsetValue(
        directionalOffset,
        "side",
        0,
      );
    }
    if (normalized.backOffset === undefined) {
      normalized.backOffset = resolveDirectionalOffsetValue(
        directionalOffset,
        "front",
        0,
      );
    }
  }

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
    normalized.heightOffset === undefined &&
    normalized.height !== undefined
  ) {
    normalized.heightOffset = normalized.height;
  }

  if (normalized.backOffset === undefined && normalized.back !== undefined) {
    normalized.backOffset = normalized.back;
  }

  if (normalized.sideOffset === undefined && normalized.side !== undefined) {
    normalized.sideOffset = normalized.side;
  }

  if (
    normalized.cameraCollisionPadding === undefined &&
    normalized.clipPad !== undefined
  ) {
    normalized.cameraCollisionPadding = normalized.clipPad;
  }

  if (
    normalized.cameraCollisionStep === undefined &&
    normalized.clipStep !== undefined
  ) {
    normalized.cameraCollisionStep = normalized.clipStep;
  }

  if (
    normalized.minOrbitPitch === undefined &&
    normalized.minPitch !== undefined
  ) {
    normalized.minOrbitPitch = normalized.minPitch;
  }

  if (
    normalized.maxOrbitPitch === undefined &&
    normalized.maxPitch !== undefined
  ) {
    normalized.maxOrbitPitch = normalized.maxPitch;
  }

  if (normalized.focusTarget === undefined && normalized.focus !== undefined) {
    normalized.focusTarget = normalized.focus;
  }

  if (normalized.rig && typeof normalized.rig === "object") {
    const theta = resolveAngleTheta(normalized.rig.angleOffset);
    if (normalized.rig.angle === undefined && theta !== undefined) {
      normalized.rig = {
        ...normalized.rig,
        angle: theta,
      };
    }
  }

  return normalized;
}

/**
 * Normalizes camera registration definitions for timeline or free-camera usage.
 * @param {Object|undefined} definition Raw camera definition.
 * @returns {Object|undefined}
 */
function normalizeCameraDefinition(definition) {
  if (!definition || typeof definition !== "object") {
    return undefined;
  }

  const eventId =
    definition.eventId ||
    definition.event ||
    definition.scriptEvent ||
    undefined;
  const isTimelineDefinition =
    definition.timeline ||
    (definition.keyframes && typeof definition.keyframes === "object");

  if (isTimelineDefinition) {
    const timelineConfig = definition.timeline || {
      id:
        definition.id ||
        definition.cutsceneId ||
        definition.timelineId ||
        (eventId ? eventId.replaceAll(":", "_") : undefined),
      playerKey: definition.playerKey || "player1",
      defaultCameraPreset:
        definition.defaultCameraPreset || definition.defaultPreset,
      easeMode: definition.easeMode || definition.ease,
      lockInput: definition.lockInput || definition.inputLock,
      clearOnEnd:
        typeof definition.clearOnEnd === "boolean"
          ? definition.clearOnEnd
          : typeof definition.clearCameraOnEnd === "boolean"
            ? definition.clearCameraOnEnd
            : false,
      cameraEvents: definition.cameraEvents,
      markers: definition.markers,
      stopExisting: definition.stopExisting,
      keyframes: definition.keyframes || definition.frames,
    };

    if (!timelineConfig.id || !timelineConfig.keyframes) {
      return undefined;
    }

    return {
      eventId,
      timeline: timelineConfig,
      startIfMissing:
        typeof definition.startIfMissing === "boolean"
          ? definition.startIfMissing
          : typeof definition.autoStart === "boolean"
            ? definition.autoStart
            : true,
    };
  }

  const camera =
    definition.camera ||
    definition.config ||
    definition.cameraConfig ||
    undefined;
  if (!camera || typeof camera !== "object") {
    return undefined;
  }

  return {
    eventId,
    camera: normalizeFreeCameraConfigAliases(camera),
    transition:
      definition.transition && typeof definition.transition === "object"
        ? normalizeTransitionAliases(definition.transition)
        : definition.trans && typeof definition.trans === "object"
          ? normalizeTransitionAliases(definition.trans)
          : undefined,
    startIfMissing:
      typeof definition.startIfMissing === "boolean"
        ? definition.startIfMissing
        : typeof definition.autoStart === "boolean"
          ? definition.autoStart
          : true,
  };
}

class CameraSystemRegistry {
  /**
   * Creates in-memory registries for timelines and camera definitions.
   */
  constructor() {
    this.timelines = new Map();
    this.active = new Map();
    this.cameras = new Map();
    this.cameraEvents = new Map();
  }

  /**
   * Registers a timeline by id.
   * @param {import("./camera_timeline.js").CameraTimeline} timeline Timeline instance.
   * @returns {void}
   */
  registerTimeline(timeline) {
    if (!timeline || !timeline.id) {
      return;
    }
    this.timelines.set(timeline.id, timeline);
  }

  /**
   * Fetches a registered timeline.
   * @param {string} id Timeline id.
   * @returns {import("./camera_timeline.js").CameraTimeline|undefined}
   */
  getTimeline(id) {
    return this.timelines.get(id);
  }

  /**
   * Stops and removes active runtime for a timeline id.
   * @param {string} id Timeline id.
   * @returns {void}
   */
  stopTimeline(id) {
    const runtime = this.active.get(id);
    if (runtime) {
      runtime.stop();
      this.active.delete(id);
    }
  }

  /**
   * Stores active runtime reference by timeline id.
   * @param {string} id Timeline id.
   * @param {import("./camera_runtime.js").CameraCutsceneRuntime} runtime Runtime instance.
   * @returns {void}
   */
  setActive(id, runtime) {
    this.active.set(id, runtime);
  }

  /**
   * Registers a camera definition and optional event mapping.
   * @param {string} id Camera id.
   * @param {Object} cameraDefinition Normalized camera definition.
   * @returns {void}
   */
  registerCamera(id, cameraDefinition) {
    if (!id || !cameraDefinition) {
      return;
    }

    this.cameras.set(id, cameraDefinition);
    if (cameraDefinition.eventId) {
      this.cameraEvents.set(cameraDefinition.eventId, id);
    }
  }

  /**
   * Fetches a registered camera by id.
   * @param {string} id Camera id.
   * @returns {Object|undefined}
   */
  getCamera(id) {
    return this.cameras.get(id);
  }

  /**
   * Fetches a registered camera by script event id.
   * @param {string} eventId Script event id.
   * @returns {Object|undefined}
   */
  getCameraByEventId(eventId) {
    const id = this.cameraEvents.get(eventId);
    return id ? this.cameras.get(id) : undefined;
  }
}

const registry = new CameraSystemRegistry();

const cutsceneQueueByPlayerId = new Map();

let nextQueueEntryId = 1;

function getPlayerQueueKey(player) {
  return player?.id || player?.name || undefined;
}

function getQueuedCutscenes(player) {
  const key = getPlayerQueueKey(player);
  if (!key) {
    return undefined;
  }

  let queue = cutsceneQueueByPlayerId.get(key);
  if (!queue) {
    queue = [];
    cutsceneQueueByPlayerId.set(key, queue);
  }
  return queue;
}

function getCutsceneActivePlayerTag() {
  const tag = SETTINGS?.cutscenes?.tags?.active_player;
  return typeof tag === "string" && tag.length > 0 ? tag : undefined;
}

function playerHasTag(player, tag) {
  if (!isPlayer(player) || !tag) {
    return false;
  }

  try {
    return Boolean(player.hasTag(tag));
  } catch {
    return false;
  }
}

function removePlayerTag(player, tag) {
  if (!isPlayer(player) || !tag) {
    return;
  }

  try {
    if (player.hasTag(tag)) {
      player.removeTag(tag);
    }
  } catch (error) {
    logIgnoredError("camera_system/camera_system:removePlayerTag", error);
  }
}

function findActiveCutscenesForPlayerId(playerId) {
  if (typeof playerId !== "string" || playerId.length === 0) {
    return [];
  }

  const matches = [];
  for (const [timelineId, runtime] of registry.active.entries()) {
    if (!runtime) {
      continue;
    }

    const runtimePlayer = runtime.resolvePlayer?.();
    if (runtimePlayer?.id === playerId) {
      matches.push({ timelineId, runtime });
      continue;
    }

    const boundPlayer = runtime.bindings?.[runtime.timeline?.playerKey];
    if (boundPlayer?.id === playerId) {
      matches.push({ timelineId, runtime });
    }
  }

  return matches;
}

function findActiveCutsceneForPlayer(player) {
  if (!isPlayer(player)) {
    return undefined;
  }

  for (const [timelineId, runtime] of registry.active.entries()) {
    if (!runtime?.isRunning) {
      continue;
    }

    const runtimePlayer = runtime.resolvePlayer?.();
    if (runtimePlayer?.id === player.id) {
      return { timelineId, runtime };
    }
  }

  return undefined;
}

function tryStartNextQueuedCutscene(cameraSystem, player) {
  if (!isPlayer(player)) {
    return false;
  }

  if (cameraSystem.isPlayerInActiveTimeline(player)) {
    return false;
  }

  const queue = getQueuedCutscenes(player);
  if (!queue || queue.length === 0) {
    return false;
  }

  const next = queue.shift();
  if (!next) {
    return false;
  }

  system.run(() => {
    cameraSystem.triggerCutscene(next.timelineId, next.bindings, next.options);
  });

  return true;
}

/**
 * Main camera API singleton.
 *
 * Most projects only need:
 * - `CameraSystem.registerTimeline(...)` / `CameraSystem.createTimeline(...)`
 * - `CameraSystem.triggerCutscene(...)`
 * - `CameraSystem.registerCameras(...)` + `CameraSystem.activateCameraById(...)`
 * - `CameraSystem.startFreeCamera(...)` / `CameraSystem.stopFreeCamera()`
 */
export const CameraSystem = {
  defaultPlayerCameraId: undefined,
  defaultCameraWatchdogRunId: undefined,

  /** Logger used by the camera system. Replace it to redirect its messages. */
  logger,

  /**
   * Registers a timeline for later playback.
   * @param {CameraTimeline} timeline
   */
  registerTimeline(timeline) {
    registry.registerTimeline(timeline);
  },

  /**
   * Creates and registers a timeline from a raw object.
   * @param {Object} config Timeline configuration
   * @returns {CameraTimeline}
   */
  createTimeline(config) {
    const validation = CameraValidator.validateTimeline(config);
    if (!validation.valid) {
      this.logger.error("CAMERA", "Timeline validation failed", validation);
      return undefined;
    }

    const timeline = CameraTimeline.fromObject(config);
    registry.registerTimeline(timeline);
    return timeline;
  },

  /**
   * Starts a cutscene by timeline id.
   * @param {string} timelineId
   * @param {Object} bindings Entity bindings (entity1, player1, etc)
   */
  triggerCutscene(timelineId, bindings, options = {}) {
    const timeline = registry.getTimeline(timelineId);
    if (!timeline) {
      this.logger.warn("CAMERA", "Timeline not found", { timelineId });
      return undefined;
    }

    const cutscenePlayer = bindings?.[timeline.playerKey];
    const activeFreeCamera = freeCameraManager.getActive();
    if (
      cutscenePlayer?.isValid &&
      activeFreeCamera?.player?.id === cutscenePlayer.id
    ) {
      freeCameraManager.stop({ clearCamera: false, restoreInput: false });
    }

    if (timeline.stopExisting) {
      registry.stopTimeline(timelineId);
    }

    let runtime;
    const internalOnEnd = payload => {
      // Remove naturally-finished runtimes from the registry.
      if (registry.active.get(timelineId) === runtime) {
        registry.active.delete(timelineId);
      }

      // Allow consumer hooks.
      try {
        if (typeof options.onEnd === "function") {
          options.onEnd(payload);
        }
      } catch (error) {
        this.logger?.error?.("CAMERA", "Cutscene onEnd callback failed", {
          timelineId,
          error,
        });
      }

      // Auto-advance queue (if any) for the associated player.
      const endedPlayer = payload?.player || runtime?.resolvePlayer?.();
      if (endedPlayer?.isValid) {
        tryStartNextQueuedCutscene(this, endedPlayer);
      }
    };

    runtime = new CameraCutsceneRuntime(timeline, bindings, this.logger, {
      callbacks: options.callbacks,
      mutedTracks: options.mutedTracks,
      bindingsResolver: options.bindingsResolver,
      freeCameraBridge: {
        getRegisteredCamera: id => registry.getCamera(id),
        getActiveFreeCamera: () => freeCameraManager.getActive(),
        startFreeCamera: (playerEntity, config) =>
          freeCameraManager.start(playerEntity, config),
        stopFreeCamera: options => freeCameraManager.stop(options),
      },
      onCameraCleared: playerEntity => {
        // Cutscene cleanup should restore the default camera instantly.
        this.applyDefaultPlayerCamera(playerEntity, { forceCut: true });
      },
      onEnd: internalOnEnd,
      triggerTimeline: (id, nextBindings, callbacks) =>
        this.triggerCutscene(id, nextBindings, {
          ...options,
          callbacks,
        }),
    });
    registry.setActive(timelineId, runtime);
    runtime.start();
    return runtime;
  },

  /**
   * Queue a cutscene for the bound player. If the player isn't in a cutscene,
   * the cutscene starts immediately (next tick). Otherwise it starts as soon
   * as their current cutscene ends.
   *
   * @param {string} timelineId
   * @param {Object} bindings
   * @param {Object} [options]
   * @returns {{id:string,timelineId:string}|undefined}
   */
  queueCutscene(timelineId, bindings, options = {}) {
    const timeline = registry.getTimeline(timelineId);
    if (!timeline) {
      this.logger.warn("CAMERA", "Timeline not found", { timelineId });
      return undefined;
    }

    let player = bindings?.[timeline.playerKey];
    if (!isPlayer(player) && typeof options.bindingsResolver === "function") {
      try {
        player = options.bindingsResolver(bindings);
      } catch (error) {
        logIgnoredError("camera_system/camera_system:queueCutscene", error);
      }
      if (player) {
        bindings[timeline.playerKey] = player;
      }
    }

    if (!isPlayer(player)) {
      this.logger.warn(
        "CAMERA",
        "queueCutscene requires a valid player binding",
        {
          timelineId,
          playerKey: timeline.playerKey,
        },
      );
      return undefined;
    }

    const queue = getQueuedCutscenes(player);
    if (!queue) {
      return undefined;
    }

    const entryId = `q${nextQueueEntryId++}`;
    queue.push({
      id: entryId,
      timelineId,
      bindings,
      options,
    });

    tryStartNextQueuedCutscene(this, player);

    return { id: entryId, timelineId };
  },

  /**
   * Clears any queued cutscenes for a player.
   * @param {any} player
   * @returns {number} Number of entries removed.
   */
  clearCutsceneQueue(player) {
    const key = getPlayerQueueKey(player);
    if (!key) {
      return 0;
    }
    const existing = cutsceneQueueByPlayerId.get(key);
    const count = Array.isArray(existing) ? existing.length : 0;
    cutsceneQueueByPlayerId.set(key, []);
    return count;
  },

  /**
   * Returns the currently running cutscene timeline id for a player, if any.
   * @param {any} player
   * @returns {string|undefined}
   */
  getPlayerCurrentCutscene(player) {
    return findActiveCutsceneForPlayer(player)?.timelineId;
  },

  /**
   * Returns current camera state for a player.
   * - `type: "cutscene"` -> timeline cutscene is running
   * - `type: "free_camera"` -> free camera mode is active for that player
   * - `type: "vanilla"` -> vanilla camera preset is active via this system
   * - `type: "none"` -> nothing managed by this system is active
   *
   * @param {any} player
   * @returns {{type:"cutscene",timelineId:string,paused?:boolean}|{type:"free_camera"}|{type:"vanilla"}|{type:"none"}}
   */
  getPlayerCurrentCamera(player) {
    const active = findActiveCutsceneForPlayer(player);
    if (active) {
      return {
        type: "cutscene",
        timelineId: active.timelineId,
        paused: Boolean(active.runtime?.isPaused),
      };
    }

    if (isPlayer(player) && player.hasTag(getVanillaCameraOverrideTag())) {
      return { type: "vanilla" };
    }

    const activeFreeCamera = freeCameraManager.getActive();
    if (
      activeFreeCamera?.player?.id &&
      player?.id &&
      activeFreeCamera.player.id === player.id
    ) {
      return { type: "free_camera" };
    }

    return { type: "none" };
  },

  /**
   * Stops a running cutscene by id.
   * @param {string} timelineId
   */
  stopCutscene(timelineId) {
    registry.stopTimeline(timelineId);
  },

  /**
   * Returns true if the player is currently being driven by any active cutscene timeline.
   *
   * @param {Player} player
   * @returns {boolean}
   */
  isPlayerInActiveTimeline(player) {
    if (!isPlayer(player)) {
      return false;
    }

    for (const runtime of registry.active.values()) {
      if (!runtime?.isRunning) {
        continue;
      }

      const runtimePlayer = runtime.resolvePlayer?.();
      if (runtimePlayer?.id === player.id) {
        return true;
      }
    }

    return false;
  },

  /**
   * Apply the configured default player camera to a single player.
   *
   * This does nothing if:
   * - `defaultPlayerCameraId` is unset
   * - the player has the vanilla override tag (see `getVanillaCameraOverrideTag`)
   *
   * @param {Player} player
   * @param {{ forceCut?: boolean }} [options]
   * @returns {import("./camera_runtime.js").CameraCutsceneRuntime | import("./camera_free.js").FreeCamera | undefined}
   */
  applyDefaultPlayerCamera(player, options = {}) {
    if (!isPlayer(player) || !this.defaultPlayerCameraId) {
      return undefined;
    }

    if (player.hasTag(getVanillaCameraOverrideTag())) {
      return undefined;
    }

    const defaultCamera = registry.getCamera(this.defaultPlayerCameraId);
    if (!defaultCamera) {
      return undefined;
    }

    const forceCut = options?.forceCut === true;
    const transitionOverride = forceCut
      ? { easeType: CAMERA_EASE_TYPES.CUT, easeTimeSeconds: 0 }
      : undefined;

    if (defaultCamera.timelineId) {
      return this.triggerCutscene(defaultCamera.timelineId, {
        player1: player,
      });
    }

    const activeFreeCamera = freeCameraManager.getActive();
    if (activeFreeCamera && activeFreeCamera.player?.id === player.id) {
      activeFreeCamera.transitionToConfig(
        defaultCamera.camera,
        transitionOverride || defaultCamera.transition,
      );
      return activeFreeCamera;
    }

    if (!forceCut) {
      return freeCameraManager.start(player, defaultCamera.camera);
    }

    return freeCameraManager.start(player, {
      ...defaultCamera.camera,
      forceInstantTicks: 1,
    });
  },

  /**
   * Start a watchdog that re-applies the default player camera periodically.
   * Helps keep players on the desired camera when they're not in a cutscene/freecam.
   */
  ensureDefaultPlayerCameraWatchdog() {
    if (this.defaultCameraWatchdogRunId !== undefined) {
      return;
    }

    this.defaultCameraWatchdogRunId = system.runInterval(() => {
      if (!this.defaultPlayerCameraId) {
        return;
      }

      let players;
      try {
        players = world.getPlayers();
      } catch {
        return;
      }

      for (const player of players) {
        if (!isPlayer(player)) {
          continue;
        }

        if (player.hasTag(getVanillaCameraOverrideTag())) {
          continue;
        }

        if (this.isPlayerInActiveTimeline(player)) {
          continue;
        }

        const activeFreeCamera = freeCameraManager.getActive();
        if (activeFreeCamera && activeFreeCamera.player?.id === player.id) {
          continue;
        }

        this.applyDefaultPlayerCamera(player);
      }
    }, 20);
  },

  /**
   * Apply the default player camera to all currently loaded players.
   * @returns {boolean} False if player enumeration fails.
   */
  applyDefaultPlayerCameraToAllPlayers() {
    let players;
    try {
      players = world.getPlayers();
    } catch {
      return false;
    }

    for (const player of players) {
      this.applyDefaultPlayerCamera(player);
    }

    return true;
  },

  /**
   * Set which registered camera id should be considered the default player camera.
   * Starts/stops the watchdog as needed and attempts to apply immediately.
   *
   * @param {string|undefined} cameraId
   */
  setDefaultPlayerCamera(cameraId) {
    this.defaultPlayerCameraId = cameraId;

    if (!cameraId) {
      if (this.defaultCameraWatchdogRunId !== undefined) {
        system.clearRun(this.defaultCameraWatchdogRunId);
        this.defaultCameraWatchdogRunId = undefined;
      }
      return;
    }

    this.ensureDefaultPlayerCameraWatchdog();

    if (!this.applyDefaultPlayerCameraToAllPlayers()) {
      system.run(() => {
        this.applyDefaultPlayerCameraToAllPlayers();
      });
    }
  },

  /**
   * Pause a running cutscene timeline.
   * @param {string} timelineId
   * @param {string|boolean} [pauseKey] Optional pause key (used for nested pauses).
   */
  pauseCutscene(timelineId, pauseKey) {
    const runtime = registry.active.get(timelineId);
    runtime?.pause(pauseKey);
  },

  /**
   * Resume a paused cutscene timeline.
   * @param {string} timelineId
   * @param {string|boolean} [resumeKey] Optional resume key (used for nested pauses).
   */
  resumeCutscene(timelineId, resumeKey) {
    const runtime = registry.active.get(timelineId);
    runtime?.resume(resumeKey);
  },

  /**
   * Export a human-friendly summary of a timeline.
   * Useful for debugging.
   *
   * @param {string} timelineId
   * @returns {any}
   */
  exportSummary(timelineId) {
    const timeline = registry.getTimeline(timelineId);
    return timeline?.toSummary?.();
  },

  /**
   * Normalize a camera definition for registration.
   * @param {Object} definition Camera registration definition
   * @returns {Object|undefined}
   */
  registerCamera(definition) {
    return normalizeCameraDefinition(definition);
  },

  /**
   * Register a batch of cameras by id.
   * @param {Object} camerasById Object map of id -> camera definition
   */
  registerCameras(camerasById) {
    if (!camerasById || typeof camerasById !== "object") {
      return;
    }

    for (const [id, definition] of Object.entries(camerasById)) {
      const normalized = normalizeCameraDefinition(definition);
      if (!normalized) {
        continue;
      }

      if (normalized.timeline) {
        this.createTimeline(normalized.timeline);
        registry.registerCamera(id, {
          eventId: normalized.eventId,
          timelineId: normalized.timeline.id,
          startIfMissing: normalized.startIfMissing,
        });
        continue;
      }

      registry.registerCamera(id, normalized);
    }
  },

  /**
   * Fetch a registered camera by id.
   * @param {string} id Camera id
   * @returns {Object|undefined}
   */
  getRegisteredCamera(id) {
    return registry.getCamera(id);
  },

  /**
   * Fetch a registered camera by its script event id.
   * @param {string} eventId Script event id
   * @returns {Object|undefined}
   */
  getCameraByEventId(eventId) {
    return registry.getCameraByEventId(eventId);
  },

  /**
   * Seamlessly transitions to a vanilla camera preset.
   * The system first eases into a free-camera config that mimics the vanilla preset,
   * then swaps (cuts) to the real vanilla preset so players regain normal
   * perspective switching (first/third person toggles).
   *
   * @param {Player} player Player entity.
   * @param {string} vanillaIdOrAlias e.g. `minecraft:first_person` or `first_person`.
   * @param {{easeType?:string,easeTimeSeconds?:number}} [transition]
   */
  transitionToVanillaCamera(player, vanillaIdOrAlias, transition = {}) {
    if (!isPlayer(player)) {
      return undefined;
    }

    const vanillaPresetId = resolveVanillaCameraId(vanillaIdOrAlias);
    if (!vanillaPresetId) {
      return undefined;
    }

    try {
      if (!player.hasTag(getVanillaCameraOverrideTag())) {
        player.addTag(getVanillaCameraOverrideTag());
      }
    } catch (error) {
      logIgnoredError(
        "camera_system/camera_system:transitionToVanillaCamera",
        error,
      );
    }

    const mimicConfig = getFreeCameraMimicConfigForVanilla(vanillaPresetId);
    const easeType = transition.easeType ?? mimicConfig.easeType;
    const easeTimeSeconds =
      transition.easeTimeSeconds ?? mimicConfig.easeTimeSeconds ?? 0;

    if (!(typeof easeTimeSeconds === "number") || easeTimeSeconds <= 0) {
      try {
        player.camera.setCamera(vanillaPresetId);
      } catch (error) {
        logIgnoredError(
          "camera_system/camera_system:transitionToVanillaCamera",
          error,
        );
      }
      return true;
    }

    const activeFreeCamera = freeCameraManager.getActive();
    const isPlayerFreeCam =
      activeFreeCamera && activeFreeCamera.player?.id === player.id;

    if (isPlayerFreeCam) {
      activeFreeCamera.transitionToConfig(mimicConfig, {
        ...transition,
        easeType,
        easeTimeSeconds,
      });
    } else {
      freeCameraManager.start(player, {
        ...mimicConfig,
        easeType,
        easeTimeSeconds,
      });
    }

    const swapTicks = Math.max(0, Math.round(easeTimeSeconds * TicksPerSecond));
    system.runTimeout(() => {
      if (!isPlayer(player)) {
        return;
      }

      const stillActive = freeCameraManager.getActive();
      if (!stillActive || stillActive.player?.id !== player.id) {
        return;
      }

      try {
        // The API typings list no ease-only option shape. It is tried first
        // because it cuts instantly where accepted; the catch covers the rest.
        const easeOnlyOptions = /** @type {any} */ ({
          easeOptions: {
            easeType: EasingType.Linear,
            easeTime: 0,
          },
        });
        player.camera.setCamera(vanillaPresetId, easeOnlyOptions);
      } catch {
        try {
          player.camera.setCamera(vanillaPresetId);
        } catch (error) {
          logIgnoredError(
            "camera_system/camera_system:transitionToVanillaCamera",
            error,
          );
        }
      }

      freeCameraManager.stop({ clearCamera: false });
    }, swapTicks);

    return true;
  },

  /**
   * Activates a registered camera by its id (not event id).
   * Supports vanilla aliases via transitionToVanillaCamera().
   *
   * @param {Player} player Player entity.
   * @param {string} cameraId Registered camera id.
   * @param {Record<string, any>} [bindings] Optional camera bindings.
   * @param {{easeType?:string,easeTimeSeconds?:number}} [transitionOverride]
   */
  activateCameraById(player, cameraId, bindings, transitionOverride) {
    if (!isPlayer(player)) {
      return undefined;
    }

    const vanillaPresetId = resolveVanillaCameraId(cameraId);
    if (vanillaPresetId) {
      return this.transitionToVanillaCamera(
        player,
        vanillaPresetId,
        transitionOverride,
      );
    }

    try {
      if (player.hasTag(getVanillaCameraOverrideTag())) {
        player.removeTag(getVanillaCameraOverrideTag());
      }
    } catch (error) {
      logIgnoredError("camera_system/camera_system:activateCameraById", error);
    }

    const registeredCamera = registry.getCamera(cameraId);
    if (!registeredCamera) {
      return undefined;
    }

    if (registeredCamera.timelineId) {
      return this.triggerCutscene(registeredCamera.timelineId, {
        ...(bindings && typeof bindings === "object" ? bindings : {}),
        player1: player,
      });
    }

    const activeFreeCamera = freeCameraManager.getActive();
    const isPlayerFreeCam =
      activeFreeCamera && activeFreeCamera.player?.id === player.id;

    if (!isPlayerFreeCam) {
      return freeCameraManager.start(player, registeredCamera.camera);
    }

    const effectiveTransition = {
      ...registeredCamera.transition,
      ...(transitionOverride && typeof transitionOverride === "object"
        ? transitionOverride
        : {}),
    };

    activeFreeCamera.transitionToConfig(
      registeredCamera.camera,
      effectiveTransition,
    );
    return activeFreeCamera;
  },

  /**
   * Resets the player's camera back to the configured default player camera.
   * Clears any vanilla override tag and stops the active free camera for this player.
   *
   * @param {Player} player Player entity.
   */
  resetToDefaultCamera(player) {
    if (!isPlayer(player)) {
      return false;
    }

    try {
      if (player.hasTag(getVanillaCameraOverrideTag())) {
        player.removeTag(getVanillaCameraOverrideTag());
      }
    } catch (error) {
      logIgnoredError(
        "camera_system/camera_system:resetToDefaultCamera",
        error,
      );
    }

    const active = freeCameraManager.getActive();
    if (active && active.player?.id === player.id) {
      freeCameraManager.stop({ clearCamera: true });
    }

    const applied = this.applyDefaultPlayerCamera(player);
    if (applied !== undefined) {
      return true;
    }

    try {
      player.camera.clear();
    } catch (error) {
      logIgnoredError(
        "camera_system/camera_system:resetToDefaultCamera",
        error,
      );
    }
    return true;
  },

  /**
   * Recovers a player left stranded in cutscene state after reconnect/reload.
   * @param {Player} player Player entity.
   * @returns {boolean}
   */
  recoverPlayerFromInterruptedCutscene(player) {
    if (!isPlayer(player)) {
      return false;
    }

    const cutsceneTag = getCutsceneActivePlayerTag();
    if (!playerHasTag(player, cutsceneTag)) {
      return false;
    }

    for (const { timelineId } of findActiveCutscenesForPlayerId(player.id)) {
      registry.stopTimeline(timelineId);
    }

    this.clearCutsceneQueue(player);

    const activeFreeCamera = freeCameraManager.getActive();
    if (activeFreeCamera?.player?.id === player.id) {
      freeCameraManager.stop({ clearCamera: true, restoreInput: false });
    }

    try {
      player.onScreenDisplay?.resetHudElementsVisibility?.();
    } catch (error) {
      logIgnoredError(
        "camera_system/camera_system:recoverPlayerFromInterruptedCutscene",
        error,
      );
    }

    try {
      enablePlayerMovement(player);
    } catch (error) {
      logIgnoredError(
        "camera_system/camera_system:recoverPlayerFromInterruptedCutscene",
        error,
      );
    }

    try {
      enablePlayerCamera(player);
    } catch (error) {
      logIgnoredError(
        "camera_system/camera_system:recoverPlayerFromInterruptedCutscene",
        error,
      );
    }

    this.resetToDefaultCamera(player);
    removePlayerTag(player, cutsceneTag);
    return true;
  },

  /**
   * Start free camera mode (non-timeline camera that follows player)
   * @param {Entity} player The player entity to follow
   * @param {Object} [config] Configuration options
   * @returns {FreeCamera}
   */
  startFreeCamera(player, config = {}) {
    return freeCameraManager.start(player, config);
  },

  /**
   * Stop the active free camera mode
   */
  stopFreeCamera(options = {}) {
    const active = freeCameraManager.getActive();
    const player = active?.player;
    freeCameraManager.stop(options);

    if (isPlayer(player) && options?.clearCamera !== false) {
      this.applyDefaultPlayerCamera(player);
    }
  },

  /**
   * Get the active free camera instance
   * @returns {FreeCamera|null}
   */
  getActiveFreeCamera() {
    return freeCameraManager.getActive();
  },

  /**
   * Pause the active free camera
   */
  pauseFreeCamera() {
    freeCameraManager.pauseActive();
  },

  /**
   * Resume the active free camera
   */
  resumeFreeCamera() {
    freeCameraManager.resumeActive();
  },

  /**
   * Pan the active free camera to focus on an entity or location
   * @param {Entity|Object} targetOrLocation Entity or {x, y, z} location
   * @param {Object} [options] Pan options (easeTimeSeconds, easeType, distance)
   */
  panFreeCamera(targetOrLocation, options = {}) {
    freeCameraManager.getActive()?.panTo(targetOrLocation, options);
  },

  /**
   * Cancel current pan on the active free camera
   */
  cancelFreeCameraPan() {
    freeCameraManager.getActive()?.cancelPan();
  },

  /**
   * Zoom the active free camera (adjust distance)
   * @param {number} delta Distance change (positive = zoom out, negative = zoom in)
   */
  zoomFreeCamera(delta) {
    freeCameraManager.getActive()?.zoom(delta);
  },

  /**
   * Set the active free camera distance directly
   * @param {number} distance New distance
   */
  setFreeCameraDistance(distance) {
    freeCameraManager.getActive()?.setDistance(distance);
  },

  /**
   * Update offsets on the active free camera
   * @param {number} [back] Back offset
   * @param {number} [up] Height offset
   * @param {number} [side] Side offset
   */
  updateFreeCameraOffset(back, up, side) {
    freeCameraManager.getActive()?.updateOffset(back, up, side);
  },

  /**
   * Set follow mode on the active free camera
   * @param {string} mode "centered" or "player-rotated"
   */
  setFreeCameraFollowMode(mode) {
    freeCameraManager.getActive()?.setFollowMode(mode);
  },

  /**
   * Lock/unlock player camera input on the active free camera
   * @param {boolean} locked
   */
  setFreeCameraInputLocked(locked) {
    freeCameraManager.getActive()?.setInputLocked(locked);
  },
};

export { CameraTimeline } from "./camera_timeline.js";
export { CameraValidator } from "./camera_validator.js";
export { CAMERA_PRESETS } from "./camera_presets.js";
export { CAMERA_TEMPLATES } from "./camera_templates.js";
export { FreeCamera } from "./camera_free.js";
