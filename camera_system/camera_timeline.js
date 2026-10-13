// Developed by: Petar Mijailovic (leptr)
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

/**
 * Runtime-friendly timeline model used by the camera system.
 */

import { CameraValidator } from "./camera_validator.js";
import { logger } from "../utils/logger.js";

/** @import { CameraKeyframe } from "./types.js" */

/**
 * Camera timeline definition with normalized keyframe accessors.
 */
export class CameraTimeline {
  /**
   * @param {Object} config Timeline configuration
   * @param {string} config.id Timeline id
   * @param {Record<string, CameraKeyframe>} config.keyframes Keyframes keyed by seconds (number or numeric string). See `CameraKeyframe` in ./types.js.
   * @param {string} [config.playerKey] Binding key for the player camera target
   * @param {string} [config.defaultCameraPreset] Default camera preset if keyframes omit it
   * @param {string} [config.easeMode] "toNext" or "toCurrent" easing duration mode
   * @param {Object} [config.lockInput] Player input locks for cutscene
   * @param {Object} [config.cameraEvents] Default event ids for entity locks
   * @param {Object} [config.origin] Optional world origin for relative locations
   * @param {Object} [config.markers] Named markers to jump/loop within timeline
   * @param {Array} [config.mutedTracks] Track names to mute by default
   * @param {boolean} [config.stopExisting] Stop existing cutscene on same timeline id
   * @param {boolean} [config.clearOnEnd] Clear camera on cutscene end
   */
  constructor(config) {
    const validation = CameraValidator.validateTimeline(config);
    if (!validation.valid) {
      /** @type {Error & {details?: unknown}} */
      const error = new Error("Invalid camera timeline configuration");
      error.details = validation.errors;
      throw error;
    }

    for (const warning of validation.warnings) {
      logger.warn(
        `[camera] Timeline "${config.id}" ${warning.field}: ${warning.message}`,
      );
    }

    const normalized = CameraValidator.normalizeTimeline(config);

    this.id = normalized.id;
    this.playerKey = normalized.playerKey;
    this.defaultCameraPreset = normalized.defaultCameraPreset;
    this.easeMode = normalized.easeMode;
    this.lockInput = normalized.lockInput;
    this.cameraEvents = normalized.cameraEvents;
    this.origin = normalized.origin;
    this.markers = normalized.markers;
    this.mutedTracks = normalized.mutedTracks;
    this.stopExisting = normalized.stopExisting;
    this.clearOnEnd = normalized.clearOnEnd;
    this.keyframes = normalized.keyframes;
  }

  /**
   * Create a timeline instance from a plain object.
   * @param {Object} config - Timeline configuration.
   * @returns {CameraTimeline}
   */
  static fromObject(config) {
    return new CameraTimeline(config);
  }

  /**
   * Add or replace a keyframe entry.
   * @param {number|string} timeSeconds - Keyframe time in seconds.
   * @param {Object} data - Keyframe payload.
   */
  addKeyframe(timeSeconds, data) {
    const timeKey = String(timeSeconds);
    this.keyframes[timeKey] = data;
  }

  /**
   * Return keyframes sorted by ascending time.
   * @returns {{time:number, data:Object}[]}
   */
  getOrderedKeyframes() {
    const entries = Object.entries(this.keyframes || {})
      .map(([key, data]) => ({
        time: Number(key),
        data,
      }))
      .filter(entry => Number.isFinite(entry.time))
      .sort((a, b) => a.time - b.time);

    return entries;
  }

  /**
   * Return the duration of the timeline in seconds.
   * @returns {number}
   */
  getDurationSeconds() {
    const ordered = this.getOrderedKeyframes();
    if (ordered.length === 0) {
      return 0;
    }
    return ordered.at(-1).time;
  }

  /**
   * Build a short summary string for debugging or logging.
   * @returns {string}
   */
  toSummary() {
    const ordered = this.getOrderedKeyframes();
    const bindingKeys = new Set();

    for (const entry of ordered) {
      const entities = entry.data?.entities;
      if (entities) {
        for (const key of Object.keys(entities)) {
          bindingKeys.add(key);
        }
      }
    }

    return [
      `Timeline: ${this.id}`,
      `Duration: ${this.getDurationSeconds()}s`,
      `Keyframes: ${ordered.length}`,
      `Bindings: ${[...bindingKeys].sort().join(", ") || "none"}`,
    ].join("\n");
  }
}
