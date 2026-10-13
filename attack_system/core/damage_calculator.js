// Developed by: Petar Mijailovic (leptr)
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

/**
 * Damage-resolution helpers used by attack execution.
 */

import { logger } from "../../utils/logger.js";

/** @import { Entity } from "@minecraft/server" */

const DEFAULT_CRIT_MULTIPLIER = 1.5;
const ARMOR_DIVISOR = 25;
const ARMOR_REDUCTION_CAP = 0.8;
const MINIMUM_ARMOR_REDUCED_DAMAGE = 0.5;

/** Damage calculation API used by attack execution and validation helpers. */
export const DamageCalculator = {
  /**
   * Calculates the final damage value for an attack.
   * @param {Object} context - Attack context containing damage info and modifiers
   * @returns {number} The final calculated damage value
   */
  calculate(context) {
    let damage = DamageCalculator.resolveDamageValue(
      context.baseDamage ?? context.damage,
    );

    if (
      context.damageModifier &&
      typeof context.damageModifier === "function"
    ) {
      const modifiedValue = context.damageModifier(context);
      damage = DamageCalculator.resolveDamageValue(modifiedValue);
    }

    if (context.target?.getComponent && context.applyArmorReduction !== false) {
      damage = DamageCalculator.reduceForArmor(damage, context.target);
    }

    if (context.shouldCrit || context.isCriticalHit) {
      damage = DamageCalculator.applyCritMultiplier(
        damage,
        context.critMultiplier ?? DEFAULT_CRIT_MULTIPLIER,
      );
    }

    if (context.resistanceModifier && context.resistanceModifier < 1) {
      damage = Math.ceil(damage * context.resistanceModifier);
    }

    return Math.max(0, damage);
  },

  /**
   * Resolves a damage value that can be a single number or a range.
   * @param {number | [number, number]} damage - The damage value or range
   * @returns {number} The resolved damage value
   */
  resolveDamageValue(damage) {
    if (Array.isArray(damage)) {
      const min = Number(damage[0]);
      const max = Number(damage[1]);

      if (!Number.isFinite(min) || !Number.isFinite(max)) {
        return 0;
      }

      const low = Math.min(min, max);
      const high = Math.max(min, max);
      return DamageCalculator.randomInt(low, high);
    }

    const value = Number(damage);
    return Number.isFinite(value) ? value : 0;
  },

  /**
   * Calculates armor reduction to damage.
   * Uses a simplified formula based on armor type and durability.
   * @private
   */
  reduceForArmor(damage, target) {
    try {
      const armorComponent = target.getComponent("armor");
      if (!armorComponent) {
        return damage;
      }

      const armorValue = armorComponent.value ?? 0;
      const reductionPercentage =
        (armorValue / ARMOR_DIVISOR) * ARMOR_REDUCTION_CAP;
      const reduction = damage * reductionPercentage;

      return Math.max(MINIMUM_ARMOR_REDUCED_DAMAGE, damage - reduction);
    } catch (error) {
      logger.warn(`Error calculating armor reduction: ${error}`);
      return damage;
    }
  },

  /**
   * Applies critical hit multiplier to damage.
   * @private
   */
  applyCritMultiplier(damage, multiplier) {
    return Math.ceil(damage * multiplier);
  },

  /**
   * Generates a random integer between min and max (inclusive).
   * @private
   */
  randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  },

  /**
   * Validates if a damage value is acceptable.
   * @param {number} damage - The damage value to validate
   * @returns {boolean} Whether the damage is valid and applicable
   */
  isValidDamage(damage) {
    return Number.isFinite(damage) && damage > 0;
  },

  /**
   * Calculates effective damage considering both armor and resistance.
   * @param {Entity} target - The target entity
   * @param {number} baseDamage - The base damage to apply
   * @param {Object} [options] - Additional damage options
   * @returns {number} The effective damage after all reductions
   */
  calculateEffectiveDamage(target, baseDamage, options = {}) {
    let damage = baseDamage;

    if (options.includeArmorReduction !== false) {
      damage = DamageCalculator.reduceForArmor(damage, target);
    }

    if (options.difficultyMultiplier) {
      damage *= options.difficultyMultiplier;
    }

    if (options.resistanceType && target.getDynamicProperty) {
      const resistance = /** @type {number} */ (
        target.getDynamicProperty(`resistance:${options.resistanceType}`) ?? 1
      );
      damage *= resistance;
    }

    return Math.max(options.minimumDamage ?? 0, damage);
  },

  /**
   * Creates a damage context from attack parameters.
   * @param {Object} parameters - Parameters for damage calculation
   * @returns {Object} A context object configured for damage calculation
   */
  createContext(parameters) {
    return {
      damage: parameters.damage ?? 0,
      baseDamage: parameters.baseDamage ?? parameters.damage ?? 0,
      damageModifier: parameters.damageModifier,
      target: parameters.target,
      shouldCrit: parameters.shouldCrit ?? false,
      critMultiplier: parameters.critMultiplier ?? DEFAULT_CRIT_MULTIPLIER,
      resistanceModifier: parameters.resistanceModifier ?? 1,
      applyArmorReduction: parameters.applyArmorReduction !== false,
      difficultyMultiplier: parameters.difficultyMultiplier ?? 1,
      minimumDamage: parameters.minimumDamage ?? 0,
      ...parameters,
    };
  },

  /**
   * Gets damage statistics for debugging/logging.
   * @param {Object} context - The attack context
   * @returns {Object} Damage statistics
   */
  getStats(context) {
    return {
      baseDamage: context.baseDamage ?? context.damage,
      modifiedDamage: context.modifiedDamage,
      finalDamage: context.finalDamage,
      isCritical: context.shouldCrit ?? false,
      hadArmorReduction: context.armorReduced ?? false,
    };
  },
};
