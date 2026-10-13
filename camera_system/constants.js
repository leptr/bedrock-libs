// Developed by: Petar Mijailovic (leptr)
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

/**
 * Camera System Constants
 * Shared defaults and enums for the cutscene system.
 */

/** Timeline ease-duration computation mode. */
export const CAMERA_EASE_MODES = {
  /** Ease duration uses time gap from this keyframe to the next. */
  TO_NEXT: "toNext",

  /** Ease duration uses time gap from previous keyframe to this one. */
  TO_CURRENT: "toCurrent",
};

/** Supported ease types for camera transitions. */
export const CAMERA_EASE_TYPES = {
  /** Backward-compatible alias for `Cut`. */
  NONE: "Cut",
  CUT: "Cut",
  LINEAR: "Linear",
  IN_SINE: "InSine",
  OUT_SINE: "OutSine",
  IN_OUT_SINE: "InOutSine",
  IN_QUAD: "InQuad",
  OUT_QUAD: "OutQuad",
  IN_OUT_QUAD: "InOutQuad",
  IN_CUBIC: "InCubic",
  OUT_CUBIC: "OutCubic",
  IN_OUT_CUBIC: "InOutCubic",
};

/** Built-in camera preset ids used by this system. */
export const CAMERA_PRESET_IDS = {
  FREE: "minecraft:free",
};

/** Look-at / focus point selection modes. */
export const TARGET_POINT_MODES = {
  RAW_LOCATION: "raw_location",
  MIDDLE_POINT: "middle_point",
  HEAD_LOCATION: "head_location",
};

/** Free-camera follow behavior modes. */
export const CAMERA_FOLLOW_MODES = {
  NONE: "none",
  CENTERED: "centered",
  PLAYER_ROTATED: "player-rotated",
};

/** How follow-mode preservation should behave across transitions. */
export const CAMERA_FOLLOW_MODE_PRESERVATION_TYPES = {
  CURRENT: "CURRENT",
  NEXT: "NEXT",
};

/** Supported camera rig types. */
export const CAMERA_RIG_TYPES = {
  ORBIT: "orbit",
};

/** Supported camera shot types. */
export const CAMERA_SHOT_TYPES = {
  FREE: "free",
};

/** Location resolution sources for relative/global coordinate support. */
export const CAMERA_LOCATION_SOURCES = {
  WORLD: "world",
  ENTITY: "entity",
  ORIGIN: "origin",
  CAMERA: "camera",
};

/** Blend mode identifiers (used by `camera.blend`). */
export const CAMERA_BLEND_MODES = {
  RELATIVE: "relative",
};

/** Supported camera shake types. */
export const CAMERA_SHAKE_TYPES = {
  POSITIONAL: "positional",
  ROTATIONAL: "rotational",
};

/** Validation error codes emitted by `CameraValidator`. */
export const CAMERA_VALIDATION_ERRORS = {
  MISSING_REQUIRED: "MISSING_REQUIRED",
  INVALID_TYPE: "INVALID_TYPE",
  OUT_OF_RANGE: "OUT_OF_RANGE",
  INVALID_ENUM: "INVALID_ENUM",
  MALFORMED_OBJECT: "MALFORMED_OBJECT",
  /** Warning only: a key the runtime does not read. */
  UNKNOWN_KEY: "UNKNOWN_KEY",
};

/** Default values used when normalizing timelines/cameras. */
export const CAMERA_DEFAULTS = {
  playerKey: "player1",
  defaultCameraPreset: CAMERA_PRESET_IDS.FREE,
  easeMode: CAMERA_EASE_MODES.TO_CURRENT,
  stopExisting: true,
  clearOnEnd: true,
  cameraEvents: {
    entityMovement: {},
  },
  origin: { x: 0, y: 0, z: 0 },
  markers: {},
  mutedTracks: [],
  lockInput: {
    movement: true,
    camera: true,
  },
};

/** Default `/scriptevent` ids for cutscene trigger/pause/resume. */
export const CAMERA_SCRIPT_EVENTS = {
  trigger: "camera:cutscene",
  pause: "camera:pause",
  resume: "camera:resume",
};

/** Shared script-event defaults used by free-camera commands. */
export const CAMERA_SCRIPT_EVENT_DEFAULTS = {
  freeCameraDistance: 6,
  freeCameraHeightOffset: 0.5,
  freeCameraZoomDelta: 0,
};

/** Shared camera shake defaults. Defined in the toolkit so other systems can use them. */
export { CAMERA_SHAKE_DEFAULTS } from "../toolkit/effect_defaults.js";

/** Blend threshold used when selecting non-numeric preset fields. */
export const CAMERA_BLEND_THRESHOLD = 0.5;
