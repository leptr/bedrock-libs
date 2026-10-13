// Developed by: Petar Mijailovic (leptr)
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

import { EquipmentSlot } from "@minecraft/server";
import { secondsToTicks } from "../utils/utils.js";
import { DirectionalOffset, rotationRelativeOffset } from "./toolkit.js";
import { BVector2 } from "../better_vectors/better_vectors.js";
import { logger } from "../utils/logger.js";
import { CAMERA_SHAKE_DEFAULTS } from "./effect_defaults.js";
import { applyTimedHitEffect } from "./timed_effect.js";
import { applyCustomEffect } from "./custom_effect.js";

/** @import { Entity } from "@minecraft/server" */

// Offsets the knockback resistance of each netherite armor piece worn.
const KB_MULTIPLIER_PER_NETHERITE_PIECE = 0.12;

/**
 * Applies knockback on the entity, scaling it with the netherite armor it is wearing to practically nullify its knockback resistance.
 * @param {Entity} entity
 * @param {{x: number, z: number}} planeKB
 * @param {number} verticalKB
 */
export function applyResistanceScaledKB(entity, planeKB, verticalKB) {
  if (!entity?.isValid) {
    return;
  }

  let kbMultiplier = 1;

  const inventory = entity.getComponent("minecraft:equippable");
  if (inventory) {
    const armorSlots = [
      EquipmentSlot.Head,
      EquipmentSlot.Chest,
      EquipmentSlot.Legs,
      EquipmentSlot.Feet,
    ];
    for (const slot of armorSlots) {
      const item = inventory.getEquipment(slot);
      if (item?.typeId?.startsWith("minecraft:netherite_")) {
        kbMultiplier += KB_MULTIPLIER_PER_NETHERITE_PIECE;
      }
    }
  }

  planeKB.x *= kbMultiplier;
  planeKB.z *= kbMultiplier;
  verticalKB *= kbMultiplier;

  entity.applyKnockback(planeKB, verticalKB);
}

/**
 * Unified registry for applying effects: sound, particle, entity effect,
 * camera shake and knockback. Used by the attack system and the camera system.
 *
 * Durations and timing windows are authored in seconds. An effect may define
 * `delay` or `startTime`, plus `endTime` and `interval`, to apply repeatedly.
 * Effects marked `isCustom` go to the handler from `setCustomEffectHandler`.
 */
export const EffectRegistry = {
  effects: {
    sound: (entity, data) => EffectRegistry.applySoundEffect(entity, data),
    particle: (entity, data) =>
      EffectRegistry.applyParticleEffect(entity, data),
    entity: (entity, data) => EffectRegistry.applyEntityEffect(entity, data),
    cameraShake: (entity, data) =>
      EffectRegistry.applyCameraShakeEffect(entity, data),
    knockback: (entity, data) => EffectRegistry.applyKnockback(entity, data),
  },

  /**
   * Applies a single effect by type.
   * @param {String} effectType - The type of effect ('sound', 'particle', 'entity', 'cameraShake', 'knockback')
   * @param {Entity} entity - The entity to apply the effect to
   * @param {Object} effectData - The effect configuration data
   */
  apply(effectType, entity, effectData) {
    if (!entity?.isValid) {
      return false;
    }

    const handler = EffectRegistry.effects[effectType];
    if (!handler) {
      logger.warn(`Unknown effect type: ${effectType}`);
      return false;
    }

    try {
      handler(entity, effectData);
      return true;
    } catch (error) {
      logger.error(`Error applying ${effectType} effect`, error);
      return false;
    }
  },

  /**
   * Applies all effects from a configuration object.
   * @param {Entity} entity - The entity to receive effects
   * @param {Object} effectsConfig - Configuration object with effect types and data
   * @returns {Object} Summary of applied effects
   */
  applyAll(entity, effectsConfig) {
    if (!entity?.isValid || !effectsConfig) {
      return { applied: 0, failed: 0 };
    }

    let applied = 0;
    let failed = 0;

    for (const [effectType, data] of Object.entries(effectsConfig)) {
      if (data === undefined || data === null) {
        continue;
      }

      const success = EffectRegistry.apply(effectType, entity, data);
      if (success) {
        applied++;
      } else {
        failed++;
      }
    }

    return { applied, failed };
  },

  /**
   * Applies entity effects (status effects/potions).
   * @private
   */
  applyEntityEffect(entity, effects) {
    if (!Array.isArray(effects)) {
      effects = [effects];
    }

    for (const effect of effects) {
      if (!entity?.isValid || effect === undefined || effect === null) {
        continue;
      }

      try {
        applyTimedHitEffect(
          effect,
          () => {
            if (effect.isCustom) {
              applyCustomEffect(entity, effect);
            } else {
              entity.addEffect(effect.id, secondsToTicks(effect.duration), {
                amplifier: effect.amplifier,
                showParticles: effect.showParticles,
              });
            }
          },
          () => entity?.isValid,
        );
      } catch (error) {
        logger.error(`Error applying entity effect ${effect.id}`, error);
      }
    }
  },

  /**
   * Applies sound effects.
   * @private
   */
  applySoundEffect(entity, soundEffects) {
    if (!Array.isArray(soundEffects)) {
      soundEffects = [soundEffects];
    }

    for (const soundEffect of soundEffects) {
      if (
        !entity?.isValid ||
        soundEffect === undefined ||
        soundEffect === null
      ) {
        continue;
      }

      try {
        entity.dimension?.playSound(soundEffect.id, entity.location, {
          pitch: soundEffect.pitch ?? 1,
          volume: soundEffect.volume ?? 1,
        });
      } catch (error) {
        logger.error(`Error playing sound ${soundEffect.id}`, error);
      }
    }
  },

  /**
   * Applies particle effects.
   * @private
   */
  applyParticleEffect(entity, particleEffects) {
    if (!Array.isArray(particleEffects)) {
      particleEffects = [particleEffects];
    }

    for (const particleEffect of particleEffects) {
      if (
        !entity?.isValid ||
        particleEffect === undefined ||
        particleEffect === null
      ) {
        continue;
      }

      try {
        const loc =
          particleEffect.location ??
          rotationRelativeOffset(
            entity,
            particleEffect.offset ?? new DirectionalOffset(0, 0, 0),
          );

        entity.dimension?.spawnParticle(particleEffect.id, loc);
      } catch (error) {
        logger.error(`Error spawning particle ${particleEffect.id}`, error);
      }
    }
  },

  /**
   * Applies camera shake effect to nearby players.
   * @private
   */
  applyCameraShakeEffect(entity, cameraShakeEffect) {
    if (!entity?.isValid || !cameraShakeEffect) {
      return;
    }

    try {
      applyTimedHitEffect(
        cameraShakeEffect,
        () =>
          entity?.runCommand(
            `/camerashake add @a[r=${cameraShakeEffect.radius ?? CAMERA_SHAKE_DEFAULTS.radius}] ${
              cameraShakeEffect.intensity ?? CAMERA_SHAKE_DEFAULTS.intensity
            } ${cameraShakeEffect.duration ?? CAMERA_SHAKE_DEFAULTS.duration} ${
              cameraShakeEffect.shakeType ?? CAMERA_SHAKE_DEFAULTS.shakeType
            }`,
          ),
        () => entity?.isValid,
      );
    } catch (error) {
      logger.error("Error applying camera shake effect", error);
    }
  },

  /**
   * Applies knockback to a target entity.
   * @private
   */
  applyKnockback(source, targetWithKB) {
    if (!source?.isValid || !targetWithKB?.target?.isValid) {
      return;
    }

    try {
      const { target, knockbackOptions } = targetWithKB;

      if (!knockbackOptions) {
        return;
      }

      const horizontalStrength =
        knockbackOptions.horizontalStrength ?? knockbackOptions.strength ?? 0;
      const verticalStrength =
        knockbackOptions.verticalStrength ?? knockbackOptions.yStrength ?? 0.1;

      if (horizontalStrength === 0 && verticalStrength === 0) {
        return;
      }

      if (
        typeof horizontalStrength !== "number" ||
        Number.isNaN(horizontalStrength)
      ) {
        logger.warn("Invalid horizontal strength in knockback", {
          knockbackOptions,
        });
        return;
      }

      if (
        typeof verticalStrength !== "number" ||
        Number.isNaN(verticalStrength)
      ) {
        logger.warn("Invalid vertical strength in knockback", {
          knockbackOptions,
        });
        return;
      }

      applyTimedHitEffect(
        knockbackOptions,
        () => {
          const direction = EffectRegistry.calculateKnockbackDirection(
            source,
            target,
          );
          const force = {
            x: direction.x * horizontalStrength,
            y: verticalStrength,
            z: direction.z * horizontalStrength,
          };

          if (
            Number.isNaN(force.x) ||
            Number.isNaN(force.z) ||
            Number.isNaN(force.y)
          ) {
            logger.warn("Invalid knockback force calculated", {
              force,
              knockbackOptions,
              direction,
            });
            return;
          }

          if (knockbackOptions.scaleWithKR === true) {
            applyResistanceScaledKB(
              target,
              { x: force.x, z: force.z },
              force.y,
            );
          } else {
            target.applyKnockback({ x: force.x, z: force.z }, force.y);
          }
        },
        () => source?.isValid && target?.isValid,
      );
    } catch (error) {
      logger.error("Error applying knockback", error);
    }
  },

  /**
   * Calculates the knockback direction from source to target.
   * @private
   */
  calculateKnockbackDirection(source, target) {
    const sourceLocation = new BVector2(source.location.x, source.location.z);
    const targetLocation = new BVector2(target.location.x, target.location.z);
    const direction = BVector2.subtract(targetLocation, sourceLocation);
    const distance = direction.magnitude();

    if (distance === 0) {
      return { x: 0, z: 1 };
    }

    direction.normalize();

    return {
      x: direction.x,
      z: direction.y,
    };
  },

  /**
   * Registers a custom effect handler.
   * @param {String} effectType - The name of the custom effect
   * @param {Function} handler - The effect handler function
   */
  registerCustomEffect(effectType, handler) {
    EffectRegistry.effects[effectType] = handler;
    logger.info(`Registered custom effect: ${effectType}`);
  },

  /**
   * Unregisters a custom effect handler.
   * @param {String} effectType - The name of the effect to remove
   */
  unregisterCustomEffect(effectType) {
    delete EffectRegistry.effects[effectType];
    logger.info(`Unregistered effect: ${effectType}`);
  },

  /**
   * Gets the list of available effect types.
   * @returns {String[]} Array of available effect type names
   */
  getAvailableEffects() {
    return Object.keys(EffectRegistry.effects);
  },
};
