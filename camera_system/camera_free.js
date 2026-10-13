// Developed by: Petar Mijailovic (leptr)
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

/**
 * Free Camera System
 * A non-timeline camera mode that constantly follows the player with customizable offsets,
 * easing, and smooth transitions to pan toward entities or locations.
 */

import { system, TicksPerSecond } from "@minecraft/server";
import {
  disablePlayerCamera,
  enablePlayerCamera,
  isPlayer,
  resolveDirectionalOffsetValue,
  toDirectionalOffset,
  tryGetBlockFromRay,
} from "../toolkit/toolkit.js";
import { BVector2, BVector3 } from "../better_vectors/better_vectors.js";
import {
  CAMERA_EASE_TYPES,
  CAMERA_FOLLOW_MODES,
  CAMERA_FOLLOW_MODE_PRESERVATION_TYPES,
  CAMERA_PRESET_IDS,
  TARGET_POINT_MODES,
} from "./constants.js";
import { logIgnoredError } from "../utils/logger.js";

/** @import { Entity, Player, Vector2, Vector3 } from "@minecraft/server" */

const POSITION_RAY_DISTANCE_EPSILON = 0.0001;
const FORWARD_LOOK_DISTANCE = 16;

/**
 * Returns whether a value is a finite number.
 * @param {unknown} value
 * @returns {boolean}
 */
function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Clamps a number between min and max.
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
  if (!isNumber(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

/**
 * Linearly interpolates numeric values.
 * @param {number} a
 * @param {number} b
 * @param {number} t
 * @returns {number}
 */
function lerpNumber(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Wraps degrees into [-180, 180).
 * @param {number} degrees
 * @returns {number}
 */
function wrapAngleDegrees(degrees) {
  const value = ((((degrees + 180) % 360) + 360) % 360) - 180;
  return value === -180 ? 180 : value;
}

/**
 * Interpolates angles in degrees, taking the shortest path.
 * @param {number} a
 * @param {number} b
 * @param {number} t
 * @returns {number}
 */
function lerpAngleDegrees(a, b, t) {
  const delta = wrapAngleDegrees((b ?? 0) - (a ?? 0));
  return (a ?? 0) + delta * t;
}

/**
 * Returns an equivalent angle (offset by +/-360 multiples) that is closest to
 * the reference. This prevents visible snaps when crossing the +/-180 boundary.
 * @param {number} reference
 * @param {number} angle
 * @returns {number}
 */
function unwrapAngleDegreesNear(reference, angle) {
  if (!isNumber(reference) || !isNumber(angle)) {
    return angle;
  }

  const delta = wrapAngleDegrees(angle - reference);
  return reference + delta;
}

/**
 * Normalizes any vector-like value into an {x,y,z} object.
 * @param {any} value
 * @param {{x:number,y:number,z:number}} fallback
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
 * Linearly interpolates vector values.
 * @param {{x:number,y:number,z:number}} a
 * @param {{x:number,y:number,z:number}} b
 * @param {number} t
 * @returns {{x:number,y:number,z:number}}
 */
function lerpVec(a, b, t) {
  const start = toVector3(a, { x: 0, y: 0, z: 0 });
  const end = toVector3(b, start);
  return {
    x: lerpNumber(start.x, end.x, t),
    y: lerpNumber(start.y, end.y, t),
    z: lerpNumber(start.z, end.z, t),
  };
}

/**
 * Converts a smooth time constant (seconds) into a per-tick lerp factor.
 * @param {number} smoothTimeSeconds
 * @returns {number}
 */
function smoothingFactor(smoothTimeSeconds) {
  if (!isNumber(smoothTimeSeconds) || smoothTimeSeconds <= 0) {
    return 1;
  }
  const dt = 1 / TicksPerSecond;
  const t = 1 - Math.exp(-dt / smoothTimeSeconds);
  return clamp(t, 0, 1);
}

function subtractVec(a, b) {
  return BVector3.subtract(BVector3.from(a), BVector3.from(b)).toVector3();
}

function addVec(a, b) {
  return BVector3.add(BVector3.from(a), BVector3.from(b)).toVector3();
}

function scaleVec(v, s) {
  const vec = BVector3.from(v);
  vec.multiply(s);
  return vec.toVector3();
}

function lengthVec(v) {
  return BVector3.from(v).magnitude();
}

function normalizeVec(v) {
  const vec = BVector3.from(v);
  if (vec.magnitude() <= 0.000_001) {
    return { x: 0, y: 0, z: 0 };
  }
  vec.setMagnitude(1);
  return vec.toVector3();
}

function blockPosFromVec(v) {
  return {
    x: Math.floor(v.x),
    y: Math.floor(v.y),
    z: Math.floor(v.z),
  };
}

function sameBlockPos(a, b) {
  return a && b && a.x === b.x && a.y === b.y && a.z === b.z;
}

function resolveEaseFunction(easeType) {
  if (
    easeType === CAMERA_EASE_TYPES.CUT ||
    (typeof easeType === "string" &&
      ["cut", "step"].includes(easeType.trim().toLowerCase()))
  ) {
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

function isInstantEase(easeType, easeTimeSeconds) {
  const isCutType =
    easeType === CAMERA_EASE_TYPES.CUT ||
    (typeof easeType === "string" &&
      ["cut", "step", "none"].includes(easeType.trim().toLowerCase()));
  const isZeroTime =
    typeof easeTimeSeconds === "number" &&
    Number.isFinite(easeTimeSeconds) &&
    easeTimeSeconds <= 0;
  return isCutType || isZeroTime;
}

function calculateAimDirection(from, to, playerRotation) {
  const delta2 = new BVector2(to.x - from.x, to.z - from.z);
  return Math.atan2(delta2.x, delta2.y);
}

function calculateRotation(from, to) {
  const delta = BVector3.subtract(BVector3.from(to), BVector3.from(from));
  const yaw = (-Math.atan2(delta.x, delta.z) * 180) / Math.PI;
  const horizontal = new BVector2(delta.x, delta.z);
  const distance = horizontal.magnitude() || 0.0001;
  const pitch = (-Math.atan2(delta.y, distance) * 180) / Math.PI;
  return { x: pitch, y: yaw };
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

function resolveEntityFocusPoint(entity, mode) {
  if (!entity || typeof entity !== "object" || !entity.location) {
    return entity;
  }

  const raw = entity.location;
  if (mode === TARGET_POINT_MODES.RAW_LOCATION) {
    return raw;
  }

  let head = entity.getHeadLocation?.();
  if (!head) {
    try {
      const collisionBox = entity.getComponent?.("minecraft:collision_box");
      const height = collisionBox?.height;
      if (typeof height === "number" && Number.isFinite(height)) {
        head = { x: raw.x, y: raw.y + height, z: raw.z };
      }
    } catch (error) {
      logIgnoredError(
        "camera_system/camera_free:resolveEntityFocusPoint",
        error,
      );
    }
  }
  if (mode === TARGET_POINT_MODES.HEAD_LOCATION) {
    return head || raw;
  }

  if (!head) {
    return raw;
  }

  try {
    return BVector3.divide(
      BVector3.add(BVector3.from(raw), BVector3.from(head)),
      2,
    ).toVector3();
  } catch {
    return raw;
  }
}

function forwardVectorFromRotation(rotation) {
  const yaw = (-rotation.y * Math.PI) / 180;
  const pitch = (rotation.x * Math.PI) / 180;
  const cosPitch = Math.cos(pitch);
  return {
    x: Math.sin(yaw) * cosPitch,
    y: -Math.sin(pitch),
    z: Math.cos(yaw) * cosPitch,
  };
}

function sanitizeRotation(rotation) {
  if (!rotation || typeof rotation !== "object") {
    return { x: 0, y: 0 };
  }

  return {
    x: typeof rotation.x === "number" ? rotation.x : 0,
    y: typeof rotation.y === "number" ? rotation.y : 0,
  };
}

const PTR_ROTATION_PROPERTY_ID = "ptr:rotation";

function resolvePlayerYawFromProperty(player, fallbackYaw) {
  if (!player || typeof player.getProperty !== "function") {
    return fallbackYaw;
  }

  try {
    const yaw = player.getProperty(PTR_ROTATION_PROPERTY_ID);
    return isNumber(yaw) ? yaw : fallbackYaw;
  } catch {
    return fallbackYaw;
  }
}

function getPlayerRotationForCamera(player) {
  const rot = sanitizeRotation(player?.getRotation?.());
  return {
    x: rot.x,
    y: resolvePlayerYawFromProperty(player, rot.y),
  };
}

/**
 * Runtime free-camera controller used by cutscenes and manual camera tools.
 */
export class FreeCamera {
  /**
   * @param {Object} config Configuration
   * @param {Player} config.player The player entity
   * @param {number} [config.distance] Default distance from player (default: 6)
   * @param {number} [config.heightOffset] Vertical offset from player eyes (default: 0.5)
   * @param {number} [config.sideOffset] Lateral offset from player (default: 0)
   * @param {number} [config.backOffset] Forward/backward offset (applies to "player-rotated" mode)
   * @param {string} [config.easeType] Easing type (default: "Linear")
   * @param {number} [config.easeTimeSeconds] Transition duration (default: 0.2)
   * @param {boolean} [config.disablePlayerInput] Disable player camera input (default: false)
   * @param {boolean} [config.forceCameraInputLocked] External override: if true, always disables player camera input.
   * @param {string} [config.followMode] "centered" or "player-rotated" (default: "centered")
   * @param {number} [config.minDistance] Minimum distance when zooming (default: 1)
   * @param {number} [config.maxDistance] Maximum distance when zooming (default: 30)
   * @param {string} [config.preset] Camera preset to use (default: "minecraft:free")
   * @param {number} [config.fov] Field of view (default: undefined)
   * @param {Object} [config.directionalOffset] DirectionalOffset (or compatible object) supplying height, side and back offsets when those are not given directly
   * @param {Object} [config.offset] Alias of `directionalOffset`
   * @param {number} [config.height] Alias of `heightOffset`
   * @param {number} [config.side] Alias of `sideOffset`
   * @param {number} [config.back] Alias of `backOffset`
   * @param {number} [config.followSmoothTimeSeconds] Smoothing time for following the player's position (default: 0.1)
   * @param {number} [config.followVerticalSmoothTimeSeconds] Smoothing time for following the player's height (default: 0.18)
   * @param {number} [config.followLeadSeconds] How far ahead of the player's movement the camera aims, in seconds (default: 0.06)
   * @param {number} [config.rotationSmoothTimeSeconds] Smoothing time for camera rotation (default: 0.1)
   * @param {number} [config.lookAtSmoothTimeSeconds] Smoothing time for the look-at point (default: same as rotationSmoothTimeSeconds)
   * @param {boolean} [config.avoidBlockClipping] Pull the camera in when a block is in the way (default: true)
   * @param {number} [config.cameraCollisionPadding] Distance kept from blocks when avoiding clipping, at least 0.05 (default: 0.25)
   * @param {number} [config.cameraCollisionStep] Step size of the clipping check, between 0.1 and 1 (default: 0.2)
   * @param {boolean} [config.focusTarget] Keep the camera facing its focus point (default: true)
   * @param {string} [config.targetPointMode] Which point of the target to look at, see TARGET_POINT_MODES
   * @param {boolean} [config.useHeadLocationForPosition] Measure offsets from the player's head instead of their feet (default: false)
   * @param {boolean} [config.useHeadAnchor] Alias of `useHeadLocationForPosition`
   * @param {number} [config.minOrbitPitch] Lowest orbit pitch in degrees, between -89 and 89 (default: -65)
   * @param {number} [config.maxOrbitPitch] Highest orbit pitch in degrees, between -89 and 89 (default: 65)
   * @param {number} [config.forceInstantTicks] Number of ticks after start during which the camera snaps instead of easing (default: 0)
   * @param {boolean} [config.alignYawToVelocity] Follow the player's movement direction instead of their look direction (default: false)
   * @param {number} [config.velocityYawMinSpeed] Horizontal speed below which the look direction is used again (default: 0)
   */
  constructor(config = /** @type {any} */ ({})) {
    if (!isPlayer(config.player)) {
      throw new Error("FreeCamera requires a valid player entity");
    }

    this.player = config.player;
    const directionalOffset = toDirectionalOffset(
      config.directionalOffset ?? config.offset,
    );

    this.distance = Math.max(0, config.distance ?? 6);
    this.heightOffset =
      config.heightOffset ??
      config.height ??
      (directionalOffset
        ? resolveDirectionalOffsetValue(directionalOffset, "ground", 0.5)
        : 0.5);
    this.sideOffset =
      config.sideOffset ??
      config.side ??
      (directionalOffset
        ? resolveDirectionalOffsetValue(directionalOffset, "side", 0)
        : 0);
    this.backOffset =
      config.backOffset ??
      config.back ??
      (directionalOffset
        ? resolveDirectionalOffsetValue(directionalOffset, "front", 0)
        : 0);
    this.easeType = config.easeType ?? CAMERA_EASE_TYPES.LINEAR;
    this.easeTimeSeconds = Math.max(0, config.easeTimeSeconds ?? 0.2);
    this.disablePlayerInput = config.disablePlayerInput ?? false;
    this.forceCameraInputLocked = config.forceCameraInputLocked ?? false;
    this.followMode = config.followMode ?? CAMERA_FOLLOW_MODES.CENTERED;
    this.minDistance = Math.max(0, config.minDistance ?? 1);
    this.maxDistance = Math.max(this.minDistance, config.maxDistance ?? 30);
    this.preset = config.preset ?? CAMERA_PRESET_IDS.FREE;
    this.fov = config.fov;

    this.followSmoothTimeSeconds = Math.max(
      0,
      config.followSmoothTimeSeconds ?? 0.1,
    );
    this.rotationSmoothTimeSeconds = Math.max(
      0,
      config.rotationSmoothTimeSeconds ?? 0.1,
    );
    this.lookAtSmoothTimeSeconds = Math.max(
      0,
      config.lookAtSmoothTimeSeconds ?? this.rotationSmoothTimeSeconds,
    );
    this.followVerticalSmoothTimeSeconds = Math.max(
      0,
      config.followVerticalSmoothTimeSeconds ?? 0.18,
    );
    this.followLeadSeconds = Math.max(0, config.followLeadSeconds ?? 0.06);
    this.avoidBlockClipping = config.avoidBlockClipping ?? true;
    this.cameraCollisionPadding = Math.max(
      0.05,
      config.cameraCollisionPadding ?? 0.25,
    );
    this.cameraCollisionStep = clamp(config.cameraCollisionStep ?? 0.2, 0.1, 1);
    this.focusTarget = config.focusTarget ?? true;
    this._lastFocusTarget = this.focusTarget;
    this.targetPointMode = resolveTargetPointMode(config.targetPointMode);
    this.useHeadLocationForPosition =
      config.useHeadLocationForPosition ?? config.useHeadAnchor ?? false;
    this.minOrbitPitch = clamp(config.minOrbitPitch ?? -65, -89, 89);
    this.maxOrbitPitch = clamp(config.maxOrbitPitch ?? 65, -89, 89);
    // When on, the camera yaw follows the direction the player is moving in
    // instead of the direction they are looking in.
    this.alignYawToVelocity = config.alignYawToVelocity ?? false;
    this.velocityYawMinSpeed = config.velocityYawMinSpeed ?? 0;

    this.isActive = false;
    this.isPaused = false;
    this.tickHandle = undefined;

    this.currentDistance = this.distance;
    this.targetDistance = this.distance;
    this.targetEntity = undefined;
    this.targetLocation = undefined;
    this.panStartTick = 0;
    this.panDurationTicks = 0;
    this.panEaseFn = undefined;

    this.transitionStartPos = undefined;
    this.transitionStartRot = undefined;
    this.transitionTick = 0;
    this.configTransition = undefined;
    this.currentLocation = undefined;
    this.currentRotation = undefined;
    this.currentLookAtPoint = undefined;
    this.currentOrbitYaw = undefined;
    this.currentOrbitPitch = undefined;
    this.currentFollowOrigin = undefined;
    this.lastAppliedFov = undefined;
    this.frozenPlayerPosition = undefined;
    this.frozenPlayerRotation = undefined;

    this.rotationOffsetPitch = 0;
    this.rotationOffsetYaw = 0;

    this.originalInputState = undefined;

    this.forceInstantTicks =
      typeof config.forceInstantTicks === "number" &&
      Number.isFinite(config.forceInstantTicks)
        ? Math.max(0, Math.floor(config.forceInstantTicks))
        : 0;
  }

  /**
   * Start the free camera mode
   */
  start() {
    if (this.isActive || !this.player || !this.player.isValid) {
      return;
    }

    this.isActive = true;
    this.isPaused = false;

    this.originalInputState = {
      disablePlayerInput: this.disablePlayerInput,
    };

    this.applyCameraInputLock();

    try {
      this.tick();
    } catch (error) {
      logIgnoredError("camera_system/camera_free:start", error);
    }

    this.tickHandle = system.runInterval(() => {
      if (!this.isActive || !this.player || !this.player.isValid) {
        this.stop();
        return;
      }

      if (!this.isPaused) {
        this.tick();
      }
    }, 1);
  }

  /**
   * Stop the free camera mode
   */
  stop(options = {}) {
    if (!this.isActive) {
      return;
    }

    const clearCamera = options?.clearCamera !== false;
    const restoreInput = options?.restoreInput !== false;

    this.isActive = false;

    if (this.tickHandle !== undefined) {
      system.clearRun(this.tickHandle);
      this.tickHandle = undefined;
    }

    if (this.player && this.player.isValid) {
      if (
        restoreInput &&
        this.disablePlayerInput &&
        !this.forceCameraInputLocked
      ) {
        enablePlayerCamera(this.player);
      }
      if (clearCamera) {
        this.player.camera.clear();
      }
    }

    this.targetEntity = undefined;
    this.targetLocation = undefined;
  }

  /**
   * Pause the free camera (stops updates but keeps it active)
   */
  pause() {
    this.isPaused = true;
  }

  /**
   * Resume the free camera
   */
  resume() {
    this.isPaused = false;
  }

  /**
   * Pan camera to focus on an entity or location with smooth transition
   * @param {Entity|Object} targetOrLocation Entity or {x, y, z} location
   * @param {Object} [options] Transition options
   * @param {number} [options.easeTimeSeconds] Override ease time for this pan
   * @param {string} [options.easeType] Override ease type for this pan
   * @param {number} [options.distance] Look distance (default: current distance)
   */
  panTo(targetOrLocation, options = {}) {
    if (!this.isActive) {
      return;
    }

    const easeTime = options.easeTimeSeconds ?? this.easeTimeSeconds;
    const easeType = options.easeType ?? this.easeType;
    const distance = options.distance ?? this.currentDistance;

    this.panDurationTicks = Math.max(1, Math.round(easeTime * TicksPerSecond));
    this.panStartTick = 0;
    this.panEaseFn = resolveEaseFunction(easeType);

    if (targetOrLocation && targetOrLocation.location) {
      this.targetEntity = targetOrLocation;
      this.targetLocation = undefined;
    } else if (targetOrLocation && typeof targetOrLocation === "object") {
      this.targetEntity = undefined;
      this.targetLocation = toVector3(targetOrLocation, { x: 0, y: 0, z: 0 });
    } else {
      // do nothing
    }

    this.transitionStartPos = this.player.location;
    this.transitionStartRot = this.player.getRotation?.() || { x: 0, y: 0 };
    this.transitionTick = 0;
    this.targetDistance = distance;
  }

  /**
   * Cancel current pan and return to normal following
   */
  cancelPan() {
    this.targetEntity = undefined;
    this.targetLocation = undefined;
    this.panStartTick = 0;
    this.panDurationTicks = 0;
    this.panEaseFn = undefined;
  }

  /**
   * Zoom the camera (adjust distance)
   * @param {number} delta Distance change (positive = zoom out, negative = zoom in)
   */
  zoom(delta) {
    this.currentDistance = Math.max(
      this.minDistance,
      Math.min(this.maxDistance, this.currentDistance + delta),
    );
    this.targetDistance = this.currentDistance;
  }

  /**
   * Set the target distance directly
   * @param {number} distance New distance
   */
  setDistance(distance) {
    this.currentDistance = Math.max(
      this.minDistance,
      Math.min(this.maxDistance, distance),
    );
    this.targetDistance = this.currentDistance;
  }

  /**
   * Smoothly transition to a new camera configuration.
   * @param {Object} targetConfig New camera config
   * @param {Object} [transition] Transition options
   * @param {string} [transition.easeType] Easing type for transition
   * @param {number} [transition.easeTimeSeconds] Transition duration in seconds
   * @param {string} [transition.followModePreservationType] Which follow mode to keep during the transition, see CAMERA_FOLLOW_MODE_PRESERVATION_TYPES
   * @param {boolean} [transition.preserveKeyframeFollowMode] Older form of `followModePreservationType`: true keeps the current follow mode
   * @param {Object} [transition.rotate] AngleOffset (or compatible object) to rotate the camera by during the transition
   */
  transitionToConfig(targetConfig = {}, transition = {}) {
    if (!this.isActive) {
      return;
    }

    const followModePreservationType =
      transition.followModePreservationType ||
      (transition.preserveKeyframeFollowMode === true
        ? CAMERA_FOLLOW_MODE_PRESERVATION_TYPES.CURRENT
        : CAMERA_FOLLOW_MODE_PRESERVATION_TYPES.NEXT);
    const preserveCurrentFollowMode =
      followModePreservationType ===
      CAMERA_FOLLOW_MODE_PRESERVATION_TYPES.CURRENT;

    const nextFollowMode =
      typeof targetConfig.followMode === "string"
        ? targetConfig.followMode
        : this.followMode;

    if (
      !preserveCurrentFollowMode &&
      nextFollowMode === CAMERA_FOLLOW_MODES.NONE &&
      this.followMode !== CAMERA_FOLLOW_MODES.NONE
    ) {
      this.frozenPlayerPosition = this.player?.location
        ? { ...this.player.location }
        : this.frozenPlayerPosition;
      const rotation = getPlayerRotationForCamera(this.player);
      this.frozenPlayerRotation = rotation;
      this.currentOrbitPitch = rotation.x;
      this.currentOrbitYaw = rotation.y;
    }

    if (
      !preserveCurrentFollowMode &&
      typeof targetConfig.followMode === "string"
    ) {
      this.setFollowMode(targetConfig.followMode);
    }

    if (
      !preserveCurrentFollowMode &&
      typeof targetConfig.focusTarget === "boolean"
    ) {
      this.focusTarget = targetConfig.focusTarget;
    }

    if (targetConfig.targetPointMode !== undefined) {
      this.targetPointMode = resolveTargetPointMode(
        targetConfig.targetPointMode,
      );
    }

    const easeType =
      transition.easeType ?? targetConfig.easeType ?? this.easeType;
    const easeTimeSeconds =
      transition.easeTimeSeconds ??
      targetConfig.easeTimeSeconds ??
      this.easeTimeSeconds;

    const rotateCandidate = transition.rotate ?? targetConfig.rotate;
    const rotateTheta =
      rotateCandidate && typeof rotateCandidate.getTheta === "function"
        ? rotateCandidate.getTheta()
        : rotateCandidate && typeof rotateCandidate.theta === "number"
          ? rotateCandidate.theta
          : 0;
    const rotatePhi =
      rotateCandidate && typeof rotateCandidate.getPhi === "function"
        ? rotateCandidate.getPhi()
        : rotateCandidate && typeof rotateCandidate.phi === "number"
          ? rotateCandidate.phi
          : 0;
    const durationTicks = Math.max(
      1,
      Math.round(Math.max(0, easeTimeSeconds) * TicksPerSecond),
    );

    const nextMin =
      typeof targetConfig.minDistance === "number"
        ? Math.max(0, targetConfig.minDistance)
        : this.minDistance;
    const nextMax =
      typeof targetConfig.maxDistance === "number"
        ? Math.max(nextMin, targetConfig.maxDistance)
        : this.maxDistance;

    const targetDistance =
      typeof targetConfig.distance === "number"
        ? Math.max(nextMin, Math.min(nextMax, targetConfig.distance))
        : this.currentDistance;
    const targetHeight =
      typeof targetConfig.heightOffset === "number"
        ? targetConfig.heightOffset
        : this.heightOffset;
    const targetSide =
      typeof targetConfig.sideOffset === "number"
        ? targetConfig.sideOffset
        : this.sideOffset;
    const targetBack =
      typeof targetConfig.backOffset === "number"
        ? targetConfig.backOffset
        : this.backOffset;
    const targetFov =
      typeof targetConfig.fov === "number" ? targetConfig.fov : this.fov;

    if (isInstantEase(easeType, easeTimeSeconds)) {
      this.minDistance = nextMin;
      this.maxDistance = nextMax;

      this.currentDistance = targetDistance;
      this.targetDistance = targetDistance;
      this.heightOffset = targetHeight;
      this.sideOffset = targetSide;
      this.backOffset = targetBack;
      this.fov = targetFov;

      if (isNumber(rotatePhi)) {
        this.rotationOffsetPitch = (this.rotationOffsetPitch ?? 0) + rotatePhi;
      }
      if (isNumber(rotateTheta)) {
        this.rotationOffsetYaw = (this.rotationOffsetYaw ?? 0) + rotateTheta;
      }

      this.rotationOffsetYaw = wrapAngleDegrees(this.rotationOffsetYaw ?? 0);

      if (typeof targetConfig.minOrbitPitch === "number") {
        this.minOrbitPitch = clamp(targetConfig.minOrbitPitch, -89, 89);
      }
      if (typeof targetConfig.maxOrbitPitch === "number") {
        this.maxOrbitPitch = clamp(targetConfig.maxOrbitPitch, -89, 89);
      }
      if (typeof targetConfig.disablePlayerInput === "boolean") {
        this.disablePlayerInput = targetConfig.disablePlayerInput;
        this.applyCameraInputLock();
      }
      if (typeof targetConfig.preset === "string") {
        this.preset = targetConfig.preset;
      }
      if (typeof targetConfig.easeType === "string") {
        this.easeType = targetConfig.easeType;
      }
      if (typeof targetConfig.easeTimeSeconds === "number") {
        this.easeTimeSeconds = Math.max(0, targetConfig.easeTimeSeconds);
      }
      if (typeof targetConfig.followSmoothTimeSeconds === "number") {
        this.followSmoothTimeSeconds = Math.max(
          0,
          targetConfig.followSmoothTimeSeconds,
        );
      }
      if (typeof targetConfig.followVerticalSmoothTimeSeconds === "number") {
        this.followVerticalSmoothTimeSeconds = Math.max(
          0,
          targetConfig.followVerticalSmoothTimeSeconds,
        );
      }
      if (typeof targetConfig.rotationSmoothTimeSeconds === "number") {
        this.rotationSmoothTimeSeconds = Math.max(
          0,
          targetConfig.rotationSmoothTimeSeconds,
        );
      }
      if (typeof targetConfig.lookAtSmoothTimeSeconds === "number") {
        this.lookAtSmoothTimeSeconds = Math.max(
          0,
          targetConfig.lookAtSmoothTimeSeconds,
        );
      }
      if (typeof targetConfig.followLeadSeconds === "number") {
        this.followLeadSeconds = Math.max(0, targetConfig.followLeadSeconds);
      }
      if (typeof targetConfig.avoidBlockClipping === "boolean") {
        this.avoidBlockClipping = targetConfig.avoidBlockClipping;
      }
      if (typeof targetConfig.cameraCollisionPadding === "number") {
        this.cameraCollisionPadding = Math.max(
          0.05,
          targetConfig.cameraCollisionPadding,
        );
      }
      if (typeof targetConfig.cameraCollisionStep === "number") {
        this.cameraCollisionStep = clamp(
          targetConfig.cameraCollisionStep,
          0.1,
          1,
        );
      }
      if (typeof targetConfig.useHeadLocationForPosition === "boolean") {
        this.useHeadLocationForPosition =
          targetConfig.useHeadLocationForPosition;
      }

      this.configTransition = undefined;
      this.forceInstantTicks = Math.max(1, this.forceInstantTicks || 0);

      return;
    }

    this.configTransition = {
      tick: 0,
      durationTicks,
      easeFn: resolveEaseFunction(easeType),
      nativeEaseType: easeType,
      nativeEaseTimeSeconds: Math.max(0, easeTimeSeconds),
      start: {
        distance: this.currentDistance,
        heightOffset: this.heightOffset,
        sideOffset: this.sideOffset,
        backOffset: this.backOffset,
        fov: this.fov,
        rotationOffsetPitch: this.rotationOffsetPitch ?? 0,
        rotationOffsetYaw: this.rotationOffsetYaw ?? 0,
      },
      target: {
        distance: targetDistance,
        heightOffset: targetHeight,
        sideOffset: targetSide,
        backOffset: targetBack,
        fov: targetFov,
        rotationOffsetPitch:
          (this.rotationOffsetPitch ?? 0) +
          (isNumber(rotatePhi) ? rotatePhi : 0),
        rotationOffsetYaw:
          (this.rotationOffsetYaw ?? 0) +
          (isNumber(rotateTheta) ? rotateTheta : 0),
      },
      pending: {
        minDistance: nextMin,
        maxDistance: nextMax,
        minOrbitPitch: targetConfig.minOrbitPitch,
        maxOrbitPitch: targetConfig.maxOrbitPitch,
        followMode: targetConfig.followMode,
        focusTarget: targetConfig.focusTarget,
        targetPointMode: targetConfig.targetPointMode,
        disablePlayerInput: targetConfig.disablePlayerInput,
        preset: targetConfig.preset,
        easeType: targetConfig.easeType,
        easeTimeSeconds: targetConfig.easeTimeSeconds,
        followSmoothTimeSeconds: targetConfig.followSmoothTimeSeconds,
        followVerticalSmoothTimeSeconds:
          targetConfig.followVerticalSmoothTimeSeconds,
        rotationSmoothTimeSeconds: targetConfig.rotationSmoothTimeSeconds,
        lookAtSmoothTimeSeconds: targetConfig.lookAtSmoothTimeSeconds,
        followLeadSeconds: targetConfig.followLeadSeconds,
        avoidBlockClipping: targetConfig.avoidBlockClipping,
        cameraCollisionPadding: targetConfig.cameraCollisionPadding,
        cameraCollisionStep: targetConfig.cameraCollisionStep,
        useHeadLocationForPosition: targetConfig.useHeadLocationForPosition,
      },
    };
  }
  /**
   * Update offsets dynamically
   * @param {number} [back] Back offset
   * @param {number} [up] Height offset
   * @param {number} [side] Side offset
   */
  updateOffset(back, up, side) {
    if (typeof back === "number") {
      this.backOffset = back;
    }
    if (typeof up === "number") {
      this.heightOffset = up;
    }
    if (typeof side === "number") {
      this.sideOffset = side;
    }
  }

  /**
   * Set follow mode: "centered" keeps focus on player center, "player-rotated" follows player's facing direction
   * @param {string} mode Follow mode
   */
  setFollowMode(mode) {
    if (
      mode === CAMERA_FOLLOW_MODES.NONE ||
      mode === CAMERA_FOLLOW_MODES.CENTERED ||
      mode === CAMERA_FOLLOW_MODES.PLAYER_ROTATED
    ) {
      if (this.followMode !== mode && mode === CAMERA_FOLLOW_MODES.NONE) {
        this.frozenPlayerPosition = this.player?.location
          ? { ...this.player.location }
          : undefined;
        const rotation = getPlayerRotationForCamera(this.player);
        this.frozenPlayerRotation = rotation;
        this.currentOrbitPitch = rotation.x;
        this.currentOrbitYaw = rotation.y;
      }

      if (mode !== CAMERA_FOLLOW_MODES.NONE) {
        this.frozenPlayerPosition = undefined;
        this.frozenPlayerRotation = undefined;
      }

      this.followMode = mode;
    }
  }

  /**
   * Enable/disable player camera input
   * @param {boolean} disabled
   */
  setInputLocked(disabled) {
    if (this.disablePlayerInput === disabled) {
      return;
    }

    this.disablePlayerInput = disabled;
    this.applyCameraInputLock();
  }

  /**
   * External override: force player camera input locked regardless of config.
   * Intended for cutscenes that want strict camera locking.
   * @param {boolean} locked
   */
  setForcedCameraInputLocked(locked) {
    const next = locked === true;
    if (this.forceCameraInputLocked === next) {
      return;
    }

    this.forceCameraInputLocked = next;
    this.applyCameraInputLock();
  }

  applyCameraInputLock() {
    if (!this.player || !this.player.isValid) {
      return;
    }

    if (this.forceCameraInputLocked || this.disablePlayerInput) {
      disablePlayerCamera(this.player);
    } else {
      enablePlayerCamera(this.player);
    }
  }

  /**
   * Get current camera position
   * @returns {Vector3} Camera position
   */
  getCameraPosition(playerPosOverride) {
    if (!this.player || !this.player.isValid) {
      return { x: 0, y: 0, z: 0 };
    }

    let playerPos = playerPosOverride || this.player.location;
    if (this.useHeadLocationForPosition) {
      const head = this.player.getHeadLocation?.();
      playerPos = head || {
        x: playerPos.x,
        y: playerPos.y + 1.62,
        z: playerPos.z,
      };
    }
    const playerRot = getPlayerRotationForCamera(this.player);
    const orbitYaw =
      typeof this.currentOrbitYaw === "number"
        ? this.currentOrbitYaw
        : playerRot.y;
    const orbitPitch =
      typeof this.currentOrbitPitch === "number"
        ? this.currentOrbitPitch
        : playerRot.x;
    const orbitRotation = { x: orbitPitch, y: orbitYaw };

    let focusPoint = playerPos;
    if (this.targetEntity && this.targetEntity.isValid) {
      focusPoint = resolveEntityFocusPoint(
        this.targetEntity,
        this.targetPointMode,
      );
    } else if (this.targetLocation) {
      focusPoint = this.targetLocation;
    } else {
      // do nothing
    }

    return this._calculateCameraPosition(playerPos, focusPoint, orbitRotation);
  }

  /**
   * Internal: Calculate camera position based on follow mode
   * @param {Vector3} playerPos Player position
   * @param {Vector3} focusPoint Focus point (player or target entity)
   * @param {Vector2} playerRot Player rotation with smoothed yaw (x=pitch, y=yaw)
   */
  _calculateCameraPosition(playerPos, focusPoint, playerRot) {
    const distance = this.currentDistance;
    const height = this.heightOffset;
    const side = this.sideOffset;
    const back = this.backOffset;

    if (this.followMode === CAMERA_FOLLOW_MODES.NONE) {
      const anchorPos = this.frozenPlayerPosition || playerPos;
      const anchorRot = this.frozenPlayerRotation || playerRot;
      const yaw = (-anchorRot.y * Math.PI) / 180;
      const pitch = (anchorRot.x * Math.PI) / 180;
      const cosPitch = Math.cos(pitch);
      const forward = {
        x: Math.sin(yaw) * cosPitch,
        y: -Math.sin(pitch),
        z: Math.cos(yaw) * cosPitch,
      };
      const right = { x: -Math.cos(yaw), y: 0, z: Math.sin(yaw) };

      return {
        x:
          anchorPos.x -
          forward.x * distance +
          right.x * side +
          forward.x * back,
        y:
          anchorPos.y -
          forward.y * distance +
          right.y * side +
          forward.y * back +
          height,
        z:
          anchorPos.z -
          forward.z * distance +
          right.z * side +
          forward.z * back,
      };
    }

    if (this.followMode === CAMERA_FOLLOW_MODES.CENTERED) {
      const direction = calculateAimDirection(playerPos, focusPoint, playerRot);
      const offsetAngle = direction;

      const cameraX =
        focusPoint.x +
        Math.sin(offsetAngle) * distance +
        Math.cos(offsetAngle) * side;
      const cameraY = focusPoint.y + height;
      const cameraZ =
        focusPoint.z +
        Math.cos(offsetAngle) * distance -
        Math.sin(offsetAngle) * side;

      return { x: cameraX, y: cameraY, z: cameraZ };
    }
    const yaw = (-playerRot.y * Math.PI) / 180;
    const pitch = (playerRot.x * Math.PI) / 180;
    const cosPitch = Math.cos(pitch);
    const forward = {
      x: Math.sin(yaw) * cosPitch,
      y: -Math.sin(pitch),
      z: Math.cos(yaw) * cosPitch,
    };
    const right = { x: -Math.cos(yaw), y: 0, z: Math.sin(yaw) };

    const cameraX =
      playerPos.x - forward.x * distance + right.x * side + forward.x * back;
    const cameraY =
      playerPos.y -
      forward.y * distance +
      right.y * side +
      forward.y * back +
      height;
    const cameraZ =
      playerPos.z - forward.z * distance + right.z * side + forward.z * back;

    return { x: cameraX, y: cameraY, z: cameraZ };
  }

  shouldUseBlockClippingAvoidance() {
    if (!this.avoidBlockClipping) {
      return false;
    }

    // Only for player-stuck follow cameras.
    if (this.targetLocation) {
      return false;
    }
    if (this.targetEntity && this.targetEntity !== this.player) {
      return false;
    }

    return true;
  }

  isBlockingCameraBlock(block) {
    if (!block) {
      return false;
    }

    const isAir =
      block.isAir === true ||
      block.typeId === "minecraft:air" ||
      block.typeId === "minecraft:cave_air" ||
      block.typeId === "minecraft:void_air";
    if (isAir) {
      return false;
    }

    const isLiquid =
      block.isLiquid === true ||
      block.typeId === "minecraft:water" ||
      block.typeId === "minecraft:flowing_water" ||
      block.typeId === "minecraft:lava" ||
      block.typeId === "minecraft:flowing_lava";
    if (isLiquid) {
      return false;
    }

    const nonBlockingPlants = new Set([
      "minecraft:short_grass",
      "minecraft:tall_grass",
      "minecraft:fern",
      "minecraft:large_fern",
      "minecraft:dead_bush",
      "minecraft:seagrass",
      "minecraft:tall_seagrass",
    ]);
    if (nonBlockingPlants.has(block.typeId)) {
      return false;
    }

    if (typeof block.isSolid === "boolean") {
      return block.isSolid;
    }

    const typeId = block.typeId || "";
    if (!typeId || typeId.endsWith("_air")) {
      return false;
    }

    return true;
  }

  getCollisionSafeCameraPosition(origin, desired) {
    if (
      !this.player ||
      !this.player.isValid ||
      !this.shouldUseBlockClippingAvoidance()
    ) {
      return desired;
    }

    const dimension = this.player.dimension;
    if (!dimension) {
      return desired;
    }

    const ray = subtractVec(desired, origin);
    const rayDistance = lengthVec(ray);
    if (rayDistance <= POSITION_RAY_DISTANCE_EPSILON) {
      return desired;
    }

    const rayDir = normalizeVec(ray);
    const rayStartOffset = Math.min(0.6, Math.max(0.15, rayDistance * 0.25));
    if (rayDistance <= rayStartOffset + 0.05) {
      return desired;
    }

    const rayStart = addVec(origin, scaleVec(rayDir, rayStartOffset));
    const segmentDistance = rayDistance - rayStartOffset;
    const originBlockPos = blockPosFromVec(origin);
    const minHitDistance = Math.max(0.35, this.cameraCollisionPadding + 0.02);
    const maxHitDistance = rayDistance - 0.01;

    const hit = tryGetBlockFromRay(
      dimension,
      rayStart,
      rayDir,
      segmentDistance,
    );

    if (hit?.block && isNumber(hit.distance)) {
      const hitDistanceFromOrigin = rayStartOffset + hit.distance;
      const hitBlockPos = hit.block.location
        ? blockPosFromVec(hit.block.location)
        : undefined;
      if (
        this.isBlockingCameraBlock(hit.block) &&
        hitDistanceFromOrigin > minHitDistance &&
        hitDistanceFromOrigin < maxHitDistance &&
        !sameBlockPos(hitBlockPos, originBlockPos)
      ) {
        const safeDistance = Math.max(
          0.1,
          hitDistanceFromOrigin - this.cameraCollisionPadding,
        );
        return addVec(origin, scaleVec(rayDir, safeDistance));
      }
    }

    const step = this.cameraCollisionStep;
    const steps = Math.max(1, Math.ceil(segmentDistance / step));

    for (let index = 1; index <= steps; index++) {
      const segmentT = (index / steps) * segmentDistance;
      const t = rayStartOffset + segmentT;
      if (t <= minHitDistance || t >= maxHitDistance) {
        continue;
      }

      const point = addVec(origin, scaleVec(rayDir, t));
      const blockPos = blockPosFromVec(point);
      if (sameBlockPos(blockPos, originBlockPos)) {
        continue;
      }

      let block;
      try {
        block = dimension.getBlock(blockPos);
      } catch {
        block = undefined;
      }

      if (this.isBlockingCameraBlock(block)) {
        const safeDistance = Math.max(0.1, t - this.cameraCollisionPadding);
        return addVec(origin, scaleVec(rayDir, safeDistance));
      }
    }

    return desired;
  }

  getVelocityAlignedYawDegrees(playerYaw) {
    if (!this.alignYawToVelocity) {
      return playerYaw;
    }

    const velocity = this.player?.getVelocity?.();
    if (!velocity) {
      return playerYaw;
    }

    const speedHorizontal = Math.hypot(velocity.x, velocity.z);
    if (speedHorizontal < this.velocityYawMinSpeed) {
      return playerYaw;
    }

    return (Math.atan2(velocity.x, velocity.z) * 180) / Math.PI;
  }

  /**
   * Main update loop - called each tick
   */
  tick() {
    if (!this.player || !this.player.isValid) {
      this.stop();
      return;
    }

    if (this.panEaseFn && this.panStartTick < this.panDurationTicks) {
      this.panStartTick += 1;
    }

    if (this.configTransition) {
      const transition = this.configTransition;
      transition.tick += 1;
      const rawT = transition.tick / transition.durationTicks;
      const t = transition.easeFn(Math.min(1, Math.max(0, rawT)));

      this.currentDistance = lerpNumber(
        transition.start.distance,
        transition.target.distance,
        t,
      );
      this.heightOffset = lerpNumber(
        transition.start.heightOffset,
        transition.target.heightOffset,
        t,
      );
      this.sideOffset = lerpNumber(
        transition.start.sideOffset,
        transition.target.sideOffset,
        t,
      );
      this.backOffset = lerpNumber(
        transition.start.backOffset,
        transition.target.backOffset,
        t,
      );

      this.rotationOffsetPitch = lerpNumber(
        transition.start.rotationOffsetPitch ?? 0,
        transition.target.rotationOffsetPitch ?? 0,
        t,
      );
      this.rotationOffsetYaw = lerpNumber(
        transition.start.rotationOffsetYaw ?? 0,
        transition.target.rotationOffsetYaw ?? 0,
        t,
      );
      if (
        typeof transition.start.fov === "number" &&
        typeof transition.target.fov === "number"
      ) {
        this.fov = lerpNumber(transition.start.fov, transition.target.fov, t);
      }

      if (rawT >= 1) {
        this.minDistance = transition.pending.minDistance;
        this.maxDistance = transition.pending.maxDistance;
        if (typeof transition.pending.minOrbitPitch === "number") {
          this.minOrbitPitch = clamp(transition.pending.minOrbitPitch, -89, 89);
        }
        if (typeof transition.pending.maxOrbitPitch === "number") {
          this.maxOrbitPitch = clamp(transition.pending.maxOrbitPitch, -89, 89);
        }
        if (typeof transition.pending.followMode === "string") {
          this.setFollowMode(transition.pending.followMode);
        }
        if (typeof transition.pending.focusTarget === "boolean") {
          this.focusTarget = transition.pending.focusTarget;
        }
        if (transition.pending.targetPointMode !== undefined) {
          this.targetPointMode = resolveTargetPointMode(
            transition.pending.targetPointMode,
          );
        }
        if (this.minOrbitPitch > this.maxOrbitPitch) {
          const mid = (this.minOrbitPitch + this.maxOrbitPitch) / 2;
          this.minOrbitPitch = mid;
          this.maxOrbitPitch = mid;
        }
        if (typeof transition.pending.disablePlayerInput === "boolean") {
          this.setInputLocked(transition.pending.disablePlayerInput);
        }
        if (typeof transition.pending.preset === "string") {
          this.preset = transition.pending.preset;
        }
        if (typeof transition.pending.easeType === "string") {
          this.easeType = transition.pending.easeType;
        }
        if (typeof transition.pending.easeTimeSeconds === "number") {
          this.easeTimeSeconds = Math.max(
            0,
            transition.pending.easeTimeSeconds,
          );
        }
        if (typeof transition.pending.followSmoothTimeSeconds === "number") {
          this.followSmoothTimeSeconds = Math.max(
            0,
            transition.pending.followSmoothTimeSeconds,
          );
        }
        if (
          typeof transition.pending.followVerticalSmoothTimeSeconds === "number"
        ) {
          this.followVerticalSmoothTimeSeconds = Math.max(
            0,
            transition.pending.followVerticalSmoothTimeSeconds,
          );
        }
        if (typeof transition.pending.rotationSmoothTimeSeconds === "number") {
          this.rotationSmoothTimeSeconds = Math.max(
            0,
            transition.pending.rotationSmoothTimeSeconds,
          );
        }
        if (typeof transition.pending.lookAtSmoothTimeSeconds === "number") {
          this.lookAtSmoothTimeSeconds = Math.max(
            0,
            transition.pending.lookAtSmoothTimeSeconds,
          );
        }
        if (typeof transition.pending.followLeadSeconds === "number") {
          this.followLeadSeconds = Math.max(
            0,
            transition.pending.followLeadSeconds,
          );
        }
        if (typeof transition.pending.avoidBlockClipping === "boolean") {
          this.avoidBlockClipping = transition.pending.avoidBlockClipping;
        }
        if (typeof transition.pending.cameraCollisionPadding === "number") {
          this.cameraCollisionPadding = Math.max(
            0.05,
            transition.pending.cameraCollisionPadding,
          );
        }
        if (typeof transition.pending.cameraCollisionStep === "number") {
          this.cameraCollisionStep = clamp(
            transition.pending.cameraCollisionStep,
            0.1,
            1,
          );
        }
        if (
          typeof transition.pending.useHeadLocationForPosition === "boolean"
        ) {
          this.useHeadLocationForPosition =
            transition.pending.useHeadLocationForPosition;
        }
        this.applyCameraInputLock();

        this._rotateBaseRotation = undefined;

        this.targetDistance = this.currentDistance;
        this.configTransition = undefined;
      }
    }

    const zoomEaseFn = resolveEaseFunction(CAMERA_EASE_TYPES.OUT_CUBIC);
    const zoomProgress = Math.min(
      1,
      this.panStartTick / Math.max(1, this.panDurationTicks),
    );
    const zoomedDistance = lerpNumber(
      this.currentDistance,
      this.targetDistance,
      zoomEaseFn(Math.min(1, zoomProgress * 2)),
    );
    this.currentDistance = zoomedDistance;

    const playerRot = getPlayerRotationForCamera(this.player);

    const previousFocusTarget = this._lastFocusTarget === true;

    if (this.followMode === CAMERA_FOLLOW_MODES.NONE) {
      if (typeof this.currentOrbitYaw !== "number") {
        this.currentOrbitYaw = playerRot.y;
      }
      if (typeof this.currentOrbitPitch !== "number") {
        this.currentOrbitPitch = clamp(
          playerRot.x,
          this.minOrbitPitch,
          this.maxOrbitPitch,
        );
      }
    } else {
      this.frozenPlayerPosition = undefined;
      this.frozenPlayerRotation = undefined;
      if (this.focusTarget) {
        const targetOrbitPitch = clamp(
          playerRot.x,
          this.minOrbitPitch,
          this.maxOrbitPitch,
        );

        if (previousFocusTarget) {
          this.currentOrbitYaw = playerRot.y;
          this.currentOrbitPitch = targetOrbitPitch;
        } else {
          const orbitT = smoothingFactor(this.rotationSmoothTimeSeconds);
          this.currentOrbitYaw =
            typeof this.currentOrbitYaw === "number"
              ? lerpAngleDegrees(this.currentOrbitYaw, playerRot.y, orbitT)
              : playerRot.y;

          this.currentOrbitPitch =
            typeof this.currentOrbitPitch === "number"
              ? lerpNumber(this.currentOrbitPitch, targetOrbitPitch, orbitT)
              : targetOrbitPitch;
        }
      }
    }

    this._lastFocusTarget = this.focusTarget;

    const cameraPos = this.getCameraPosition(this.player.location);

    const hasTargetEntity = this.targetEntity && this.targetEntity.isValid;
    const hasTargetLocation = Boolean(this.targetLocation);

    const mode = resolveTargetPointMode(this.targetPointMode);
    let lookAtPoint;

    if (hasTargetEntity) {
      lookAtPoint = resolveEntityFocusPoint(this.targetEntity, mode);
    } else if (hasTargetLocation) {
      lookAtPoint = this.targetLocation;
    } else if (this.focusTarget) {
      lookAtPoint = resolveEntityFocusPoint(this.player, mode);
    } else {
      const forwardRotation = {
        x:
          typeof this.currentOrbitPitch === "number"
            ? this.currentOrbitPitch
            : playerRot.x,
        y:
          typeof this.currentOrbitYaw === "number"
            ? this.currentOrbitYaw
            : playerRot.y,
      };
      const forward = forwardVectorFromRotation(forwardRotation);
      const forwardDistance = FORWARD_LOOK_DISTANCE;
      lookAtPoint = {
        x: cameraPos.x + forward.x * forwardDistance,
        y: cameraPos.y + forward.y * forwardDistance,
        z: cameraPos.z + forward.z * forwardDistance,
      };
    }

    if (!lookAtPoint) {
      lookAtPoint = this.player.getHeadLocation?.() || {
        x: this.player.location.x,
        y: this.player.location.y + 1.62,
        z: this.player.location.z,
      };
    }

    const followOrigin =
      this.followMode === CAMERA_FOLLOW_MODES.NONE && this.frozenPlayerPosition
        ? {
            x: this.frozenPlayerPosition.x,
            y: this.frozenPlayerPosition.y + 1.62,
            z: this.frozenPlayerPosition.z,
          }
        : this.player.getHeadLocation?.() || {
            x: this.player.location.x,
            y: this.player.location.y + 1.62,
            z: this.player.location.z,
          };
    const safeCameraPos = this.getCollisionSafeCameraPosition(
      followOrigin,
      cameraPos,
    );

    const hasAnimatedRotationOffset =
      Boolean(this.configTransition) &&
      ((this.configTransition.start?.rotationOffsetPitch ?? 0) !==
        (this.configTransition.target?.rotationOffsetPitch ?? 0) ||
        (this.configTransition.start?.rotationOffsetYaw ?? 0) !==
          (this.configTransition.target?.rotationOffsetYaw ?? 0));

    const bypassSmoothing = (this.forceInstantTicks ?? 0) > 0;
    const useNativeEasing =
      !bypassSmoothing &&
      !this.configTransition &&
      !hasAnimatedRotationOffset &&
      (this.easeTimeSeconds ?? 0) > 0;

    if (bypassSmoothing || useNativeEasing) {
      this.currentLocation = safeCameraPos;
      this.currentLookAtPoint = lookAtPoint;
    } else {
      if (this.currentLocation) {
        const followT = smoothingFactor(this.followSmoothTimeSeconds);
        this.currentLocation = {
          x: lerpNumber(this.currentLocation.x, safeCameraPos.x, followT),
          y: lerpNumber(
            this.currentLocation.y,
            safeCameraPos.y,
            smoothingFactor(this.followVerticalSmoothTimeSeconds),
          ),
          z: lerpNumber(this.currentLocation.z, safeCameraPos.z, followT),
        };
      } else {
        this.currentLocation = safeCameraPos;
      }

      if (!this.currentLookAtPoint) {
        this.currentLookAtPoint = lookAtPoint;
      }
      const lookAtT = smoothingFactor(this.lookAtSmoothTimeSeconds);
      this.currentLookAtPoint = lerpVec(
        this.currentLookAtPoint,
        lookAtPoint,
        lookAtT,
      );
    }

    const baseRotation = calculateRotation(
      this.currentLocation,
      this.currentLookAtPoint,
    );

    const rawTargetYaw = (baseRotation?.y ?? 0) + (this.rotationOffsetYaw ?? 0);
    const stabilizedYaw = this.currentRotation
      ? unwrapAngleDegreesNear(this.currentRotation.y, rawTargetYaw)
      : rawTargetYaw;

    const targetRotation = {
      x: (baseRotation?.x ?? 0) + (this.rotationOffsetPitch ?? 0),
      y: stabilizedYaw,
    };

    if (!this.currentRotation) {
      this.currentRotation = targetRotation;
    }

    if (bypassSmoothing || useNativeEasing || hasAnimatedRotationOffset) {
      this.currentRotation = targetRotation;
    } else {
      const rotationT = smoothingFactor(this.rotationSmoothTimeSeconds);
      this.currentRotation = {
        x: lerpNumber(this.currentRotation.x, targetRotation.x, rotationT),
        y: lerpAngleDegrees(
          this.currentRotation.y,
          targetRotation.y,
          rotationT,
        ),
      };
    }

    if (typeof this.fov === "number" && this.fov !== this.lastAppliedFov) {
      try {
        this.player.camera.setFov({ fov: this.fov });
        this.lastAppliedFov = this.fov;
      } catch (error) {
        logIgnoredError("camera_system/camera_free:tick", error);
      }
    }

    try {
      const transitionEaseTimeSeconds =
        !bypassSmoothing && this.configTransition
          ? Math.min(
              1 / TicksPerSecond,
              Math.max(0, this.configTransition.nativeEaseTimeSeconds ?? 0),
            )
          : 0;

      const nativeEaseTimeSeconds = bypassSmoothing
        ? 0
        : useNativeEasing
          ? Math.max(0, this.easeTimeSeconds ?? 0)
          : transitionEaseTimeSeconds;

      const nativeEaseType = useNativeEasing
        ? this.easeType || CAMERA_EASE_TYPES.LINEAR
        : this.configTransition?.nativeEaseType ||
          this.easeType ||
          CAMERA_EASE_TYPES.LINEAR;

      this.player.camera.setCamera(this.preset, {
        location: this.currentLocation,
        rotation: this.currentRotation,
        ...(nativeEaseTimeSeconds > 0
          ? {
              easeOptions: {
                easeType: nativeEaseType,
                easeTime: nativeEaseTimeSeconds,
              },
            }
          : {}),
      });

      if ((this.forceInstantTicks ?? 0) > 0) {
        this.forceInstantTicks = Math.max(0, (this.forceInstantTicks ?? 0) - 1);
      }
    } catch (error) {
      logIgnoredError("camera_system/camera_free:tick", error);
    }
  }
}

/**
 * Global free camera registry
 */
class FreeCameraManager {
  constructor() {}

  start(player, config) {
    if (this.activeCamera) {
      this.activeCamera.stop({ clearCamera: false, restoreInput: false });
    }

    this.activeCamera = new FreeCamera({ ...config, player });
    this.activeCamera.start();
    return this.activeCamera;
  }

  stop(options = {}) {
    if (this.activeCamera) {
      this.activeCamera.stop(options);
      this.activeCamera = undefined;
    }
  }

  getActive() {
    return this.activeCamera;
  }

  pauseActive() {
    if (this.activeCamera) {
      this.activeCamera.pause();
    }
  }

  resumeActive() {
    if (this.activeCamera) {
      this.activeCamera.resume();
    }
  }
  activeCamera = undefined;
}

/** Shared free-camera manager instance used by the camera system facade. */
export const freeCameraManager = new FreeCameraManager();
