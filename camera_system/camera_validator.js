// Developed by: Petar Mijailovic (leptr)
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

/**
 * Camera Timeline Validation
 * Basic schema validation to catch common mistakes early.
 */

import {
  CAMERA_DEFAULTS,
  CAMERA_EASE_MODES,
  CAMERA_VALIDATION_ERRORS,
} from "./constants.js";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Every key the runtime reads from a keyframe. A key outside this list is
 * ignored when the cutscene plays, which almost always means a typo.
 */
const KNOWN_KEYFRAME_KEYS = new Set([
  "camera",
  "subtitles",
  "entities",
  "entityGroups",
  "effects",
  "tracks",
  "conditions",
  "goto",
  "pause",
  "resumeKey",
  "startTimelines",
  "onEnter",
  "onExit",
  "runCallback",
  "runCallbacks",
  "commands",
  "runCommands",
  "ease",
  "easeType",
  "easeMode",
  "easeSec",
  "easeTimeSeconds",
  "fovEasingType",
]);

/** Keys the runtime reads from a keyframe's `tracks` object. */
const KNOWN_TRACK_KEYS = new Set([
  "camera",
  "subtitles",
  "entities",
  "effects",
  "audio",
  "groups",
]);

function pushUnknownKeyWarnings(warnings, object, knownKeys, fieldPrefix) {
  for (const key of Object.keys(object)) {
    if (!knownKeys.has(key)) {
      warnings.push({
        type: CAMERA_VALIDATION_ERRORS.UNKNOWN_KEY,
        field: `${fieldPrefix}.${key}`,
        message: `Unknown key "${key}" is ignored. Known keys: ${[...knownKeys].join(", ")}`,
      });
    }
  }
}

function normalizeKeyframeKey(key) {
  const num = Number(key);
  return Number.isFinite(num) ? num : Number.NaN;
}

/** Validation and normalization helpers for camera timeline definitions. */
export const CameraValidator = {
  validateTimeline(config) {
    const errors = [];
    const warnings = [];

    if (!isPlainObject(config)) {
      return {
        valid: false,
        errors: [
          {
            type: CAMERA_VALIDATION_ERRORS.MALFORMED_OBJECT,
            message: "Timeline configuration must be an object",
          },
        ],
        warnings: [],
      };
    }

    if (!config.id || typeof config.id !== "string") {
      errors.push({
        type: CAMERA_VALIDATION_ERRORS.MISSING_REQUIRED,
        field: "id",
        message: "Timeline id is required and must be a string",
      });
    }

    if (isPlainObject(config.keyframes)) {
      const hasMovementDefaults =
        Boolean(config.cameraEvents?.entityMovement?.on) ||
        Boolean(config.cameraEvents?.entityMovement?.off);
      const timeKeyCounts = new Map();

      for (const [key, value] of Object.entries(config.keyframes)) {
        const seconds = normalizeKeyframeKey(key);
        if (!isNumber(seconds) || seconds < 0) {
          errors.push({
            type: CAMERA_VALIDATION_ERRORS.INVALID_TYPE,
            field: `keyframes.${key}`,
            message: "Keyframe keys must be non-negative numbers in seconds",
          });
          continue;
        }

        if (!isPlainObject(value)) {
          errors.push({
            type: CAMERA_VALIDATION_ERRORS.INVALID_TYPE,
            field: `keyframes.${key}`,
            message: "Keyframe value must be an object",
          });
          continue;
        }

        pushUnknownKeyWarnings(
          warnings,
          value,
          KNOWN_KEYFRAME_KEYS,
          `keyframes.${key}`,
        );
        if (isPlainObject(value.tracks)) {
          pushUnknownKeyWarnings(
            warnings,
            value.tracks,
            KNOWN_TRACK_KEYS,
            `keyframes.${key}.tracks`,
          );
        }

        const seenCount = (timeKeyCounts.get(seconds) || 0) + 1;
        timeKeyCounts.set(seconds, seenCount);
        if (seenCount > 1) {
          warnings.push({
            field: `keyframes.${key}`,
            message: "Multiple keyframes share the same time value",
          });
        }

        const hasCamera = Boolean(value.camera);
        const hasSubtitles = Boolean(value.subtitles);
        const hasEntities = Boolean(value.entities);
        const hasCallbacks =
          typeof value.onEnter === "function" ||
          typeof value.onExit === "function" ||
          (typeof value.runCallback === "string" && value.runCallback.trim()) ||
          (Array.isArray(value.runCallbacks) &&
            value.runCallbacks.some(v => typeof v === "string" && v.trim()));

        // Tracks, effects, entity groups, commands and flow control
        // (goto, pause, startTimelines) also count as content.
        const hasOtherContent = [
          "tracks",
          "effects",
          "entityGroups",
          "commands",
          "runCommands",
          "goto",
          "pause",
          "startTimelines",
        ].some(contentKey => value[contentKey] !== undefined);

        if (
          !hasCamera &&
          !hasSubtitles &&
          !hasEntities &&
          !hasCallbacks &&
          !hasOtherContent
        ) {
          warnings.push({
            field: `keyframes.${key}`,
            message: "Keyframe has nothing in it that the runtime would run",
          });
        }

        if (hasEntities) {
          for (const [bindingKey, actions] of Object.entries(value.entities)) {
            if (!actions || typeof actions !== "object") {
              continue;
            }

            if (
              (actions.lockMovement === true ||
                actions.lockMovement === false) &&
              !hasMovementDefaults
            ) {
              warnings.push({
                field: `keyframes.${key}.entities.${bindingKey}.lockMovement`,
                message:
                  "lockMovement uses boolean but cameraEvents.entityMovement defaults are not set",
              });
            }
          }
        }
      }
    } else {
      errors.push({
        type: CAMERA_VALIDATION_ERRORS.MISSING_REQUIRED,
        field: "keyframes",
        message: "Timeline keyframes must be an object keyed by seconds",
      });
    }

    if (
      config.easeMode &&
      !Object.values(CAMERA_EASE_MODES).includes(config.easeMode)
    ) {
      errors.push({
        type: CAMERA_VALIDATION_ERRORS.INVALID_ENUM,
        field: "easeMode",
        message: `easeMode must be one of: ${Object.values(CAMERA_EASE_MODES).join(", ")}`,
      });
    }

    if (config.origin !== undefined && !isPlainObject(config.origin)) {
      errors.push({
        type: CAMERA_VALIDATION_ERRORS.INVALID_TYPE,
        field: "origin",
        message: "origin must be an object with x/y/z",
      });
    }

    if (config.markers !== undefined && !isPlainObject(config.markers)) {
      errors.push({
        type: CAMERA_VALIDATION_ERRORS.INVALID_TYPE,
        field: "markers",
        message: "markers must be an object keyed by marker names",
      });
    }

    if (
      config.mutedTracks !== undefined &&
      !Array.isArray(config.mutedTracks)
    ) {
      errors.push({
        type: CAMERA_VALIDATION_ERRORS.INVALID_TYPE,
        field: "mutedTracks",
        message: "mutedTracks must be an array of track names",
      });
    }

    if (config.cameraEvents !== undefined) {
      if (!isPlainObject(config.cameraEvents)) {
        errors.push({
          type: CAMERA_VALIDATION_ERRORS.INVALID_TYPE,
          field: "cameraEvents",
          message: "cameraEvents must be an object",
        });
      } else if (
        config.cameraEvents.entityMovement !== undefined &&
        !isPlainObject(config.cameraEvents.entityMovement)
      ) {
        errors.push({
          type: CAMERA_VALIDATION_ERRORS.INVALID_TYPE,
          field: "cameraEvents.entityMovement",
          message: "cameraEvents.entityMovement must be an object",
        });
      } else if (config.cameraEvents.entityMovement) {
        const { on, off } = config.cameraEvents.entityMovement;

        if (on !== undefined && typeof on !== "string") {
          errors.push({
            type: CAMERA_VALIDATION_ERRORS.INVALID_TYPE,
            field: "cameraEvents.entityMovement.on",
            message: "cameraEvents.entityMovement.on must be a string",
          });
        }

        if (off !== undefined && typeof off !== "string") {
          errors.push({
            type: CAMERA_VALIDATION_ERRORS.INVALID_TYPE,
            field: "cameraEvents.entityMovement.off",
            message: "cameraEvents.entityMovement.off must be a string",
          });
        }
      } else {
        // do nothing
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  },

  normalizeTimeline(config) {
    const { streaming: _ignoredStreaming, ...timelineConfig } = config || {};
    const normalized = {
      ...CAMERA_DEFAULTS,
      ...timelineConfig,
      easeMode: timelineConfig?.easeMode ?? CAMERA_DEFAULTS.easeMode,
      cameraEvents: {
        ...CAMERA_DEFAULTS.cameraEvents,
        ...timelineConfig?.cameraEvents,
      },
      origin: timelineConfig?.origin || CAMERA_DEFAULTS.origin,
      markers: timelineConfig?.markers || CAMERA_DEFAULTS.markers,
      mutedTracks: timelineConfig?.mutedTracks || CAMERA_DEFAULTS.mutedTracks,
      lockInput: {
        ...CAMERA_DEFAULTS.lockInput,
        ...timelineConfig?.lockInput,
      },
    };

    return normalized;
  },
};
