// Developed by: Petar Mijailovic (leptr)
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

/**
 * Bridge between the libraries and a project's custom effect system.
 *
 * Effects marked `isCustom` are not vanilla status effects, so the libraries
 * cannot apply them themselves. A project that has custom effects registers
 * one handler here, and every `isCustom` effect is passed to it.
 *
 * ```javascript
 * setCustomEffectHandler((entity, effect) => {
 *   myEffects.addEffect(entity, effect.id, effect.duration, effect.amplifier);
 * });
 * ```
 */

import { logger } from "../utils/logger.js";

/** @import { Entity } from "@minecraft/server" */
/** @import { EntityEffect } from "./toolkit.js" */

const customEffectState = {
  /** @type {((entity: Entity, effect: EntityEffect) => void)|undefined} */
  handler: undefined,
  hasWarned: false,
};

/**
 * Register the function that applies `isCustom` effects.
 * @param {((entity: Entity, effect: EntityEffect) => void)|undefined} handler
 */
export function setCustomEffectHandler(handler) {
  if (handler !== undefined && typeof handler !== "function") {
    throw new TypeError("setCustomEffectHandler: handler must be a function.");
  }
  customEffectState.handler = handler;
}

/**
 * Apply a custom effect through the registered handler.
 * @param {Entity} entity
 * @param {EntityEffect} effect
 * @returns {boolean} False when no handler is registered.
 */
export function applyCustomEffect(entity, effect) {
  if (!customEffectState.handler) {
    if (!customEffectState.hasWarned) {
      customEffectState.hasWarned = true;
      logger.warn(
        `Custom effect "${effect?.id}" skipped: no handler registered. Call setCustomEffectHandler() at startup.`,
      );
    }
    return false;
  }

  customEffectState.handler(entity, effect);
  return true;
}
