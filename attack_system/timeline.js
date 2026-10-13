// Developed by: Petar Mijailovic (leptr)
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

import { TicksPerSecond } from "@minecraft/server";
import { SETTINGS } from "../game_settings.js";

/**
 * Represents a keyframe mapping entry in the timeline.
 */
export class TimelineEntry {
  /**
   * Creates a server-to-client animation keyframe mapping.
   *
   * @param {number} attackKf - The server time keyframe.
   * @param {number} animKf - The animation time keyframe.
   */
  constructor(attackKf, animKf) {
    this.attack_kf = attackKf;
    this.anim_kf = animKf;
  }

  /**
   * Builds an entry from named keyframes, so timeline tables label each value.
   * Keys match the instance fields, so from(entry) copies an entry.
   *
   * @param {{ attack_kf: number, anim_kf: number }} keyframes
   * @returns {TimelineEntry}
   */
  static from({ attack_kf: attackKf, anim_kf: animKf }) {
    return new TimelineEntry(attackKf, animKf);
  }
}

/**
 * Samples the required attack KF from the timeline, given its corresponding animation KF.
 *
 * @param {number} value
 * @param {Array<TimelineEntry>} timeline
 * @param {'anim_kf' | 'attack_kf'} inputKey
 * @param {'anim_kf' | 'attack_kf'} outputKey
 * @returns {number} The interpolated or boundary attack_kf value.
 */
function evalLinear(value, timeline, inputKey, outputKey) {
  if (!timeline || timeline.length === 0) {
    return 0;
  }

  if (value <= timeline[0][inputKey]) {
    return timeline[0][outputKey];
  }
  if (value >= timeline.at(-1)[inputKey]) {
    return timeline.at(-1)[outputKey];
  }

  for (let index = 0; index < timeline.length - 1; index++) {
    const previous = timeline[index];
    const next = timeline[index + 1];

    if (value >= previous[inputKey] && value <= next[inputKey]) {
      const range = next[inputKey] - previous[inputKey];
      if (range === 0) {
        return previous[outputKey];
      }

      const t = (value - previous[inputKey]) / range;
      return previous[outputKey] + t * (next[outputKey] - previous[outputKey]);
    }
  }

  return timeline[0][outputKey];
}

/**
 * Samples the required attack KF from the timeline, given its corresponding animation KF.
 *
 * @param {number} animKf
 * @param {Array<TimelineEntry>} timeline
 * @returns {number} The interpolated or boundary attack_kf value.
 */
export const evalServerFromClient = (animKf, timeline) =>
  evalLinear(animKf, timeline, "anim_kf", "attack_kf");

/**
 * Samples the stretched anim KF from the timeline, given its corresponding attack KF.
 *
 * @param {number} attackKf
 * @param {Array<TimelineEntry>} timeline
 * @returns {number} The interpolated or boundary anim_kf value.
 */
export const evalClientFromServer = (attackKf, timeline) =>
  evalLinear(attackKf, timeline, "attack_kf", "anim_kf");

/**
 * Manages the anim_time property on the passed timeline.
 *
 * @param {import('@minecraft/server').Entity} entity
 * @param {Array<TimelineEntry>} timeline
 */
export function tickTimeline(entity, timeline) {
  if (!timeline || !entity?.isValid) {
    return;
  }

  const elapsedTicks = /** @type {number} */ (
    entity.getDynamicProperty(
      `${SETTINGS.general.namespace}:elapsed_anim_ticks`,
    ) ?? 0
  );
  const elapsedSeconds = elapsedTicks / TicksPerSecond;

  const elapsedAnimationSeconds = evalClientFromServer(
    elapsedSeconds,
    timeline,
  );

  entity.setProperty(
    `${SETTINGS.general.namespace}:anim_time`,
    elapsedAnimationSeconds,
  );
  entity.setDynamicProperty(
    `${SETTINGS.general.namespace}:elapsed_anim_ticks`,
    elapsedTicks + 1,
  );
}

/**
 * Nullifies the entity's timeline properties.
 *
 * @param {import('@minecraft/server').Entity} entity
 */
export function clearTimeline(entity) {
  entity.setProperty(`${SETTINGS.general.namespace}:anim_time`, 0);
  entity.setDynamicProperty(
    `${SETTINGS.general.namespace}:elapsed_anim_ticks`,
    0,
  );
}
