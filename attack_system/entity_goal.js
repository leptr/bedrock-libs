// Developed by: Petar Mijailovic (leptr)
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

import { SETTINGS } from "../game_settings.js";
import { BVector3 } from "../better_vectors/better_vectors.js";
import { getTargetVector } from "../toolkit/toolkit.js";
import { secondsToTicks } from "../utils/utils.js";

/** @import { Entity } from "@minecraft/server" */

/**
 * @typedef {Object} GoalPickOptions
 * @property {boolean} [lookAtTarget] - Turn the entity towards the target when an attack is picked.
 * @property {boolean} [multipleAttackStates] - The entity spreads its attacks over two attack-type properties.
 */

/**
 * @typedef {Object} AttackRequirements
 * @property {number} minDistance - The distance, under which the attack will not trigger.
 * @property {number} maxDistance - The distance, beyond which the attack will not trigger.
 * @property {number} chance - The chance that the attack will trigger, a value of 0 to 1.
 * @property {boolean} checkCooldown - If isOnCooldown should be called on the entity to validate the attack.
 */

/**
 * Attack/goal picking behaviour for entities
 */
export const EntityGoals = {
  /**
   * Applies the general cooldown for an attack. During this cooldown, no other attack can be triggered.
   *
   * @param {Entity} entity
   * @param {Object} goal
   */
  applyGeneralCooldown(entity, goal) {
    const cooldown = secondsToTicks(goal.generalCooldown ?? 0);
    entity?.setDynamicProperty(
      `${SETTINGS.general.namespace}:general_cooldown`,
      cooldown,
    );
  },

  /**
   * Applies the cooldown for an attack. During this cooldown, that same attack cannot be triggered again.
   *
   * @param {Entity} entity
   * @param {Object} goal
   */
  applyCooldown(entity, goal) {
    const cooldown = secondsToTicks(goal.cooldown);
    if (!cooldown) {
      return;
    }
    EntityGoals.setCooldown(entity, goal, cooldown);
  },

  setCooldown(entity, goal, cooldown) {
    const id = goal.id;
    const property = `${SETTINGS.general.namespace}:cooldown_${id}`;
    entity?.setDynamicProperty(property, cooldown);
  },

  /**
   * Gets the goal's cooldown in ticks.
   */
  getCooldown(entity, goal) {
    const id = goal.id;
    const property = `${SETTINGS.general.namespace}:cooldown_${id}`;
    return entity?.getDynamicProperty(property);
  },

  /**
   * Ticks cooldowns down. Use in the entity tick function to make cooldowns work.
   *
   * @param {Entity} entity
   * @param {Record<string, Object>} goals
   */
  manageCooldowns(entity, goals) {
    // Manage general cooldown
    {
      const property = `${SETTINGS.general.namespace}:general_cooldown`;
      const cooldown = /** @type {number} */ (
        entity?.getDynamicProperty(property) ?? 0
      );
      if (cooldown > 0) {
        entity?.setDynamicProperty(property, cooldown - 1);
      }
    }
    // Manage attack cooldowns
    // goals is a table keyed by attack name, not an array
    for (const attack of Object.values(goals)) {
      if (!attack.cooldown) {
        continue;
      }

      const property = `${SETTINGS.general.namespace}:cooldown_${attack.id}`;
      const cooldown = /** @type {number} */ (
        entity?.getDynamicProperty(property) ?? 0
      );
      if (cooldown > 0) {
        entity?.setDynamicProperty(property, cooldown - 1);
      }
    }
  },

  /**
   * Returns true if the goal can be triggered.
   *
   * When `attackRequirements.anyOf` is used and the matching entry has an
   * `id`, that id is recorded and can be read back with `getTriggerReason`
   * to tell which of the alternative requirements caused the goal to fire.
   *
   * @param {Entity} entity
   * @param {Object} goal - An object with an 'id' and an 'attackRequirements' members
   * @param {Entity} target
   * @param {{ ignoreCooldowns?: boolean }} [options] - `ignoreCooldowns` skips the general and per-attack cooldown checks, for asking "is the entity in range for this goal" rather than "can it use it right now".
   * @returns {boolean}
   */
  canUseGoal(entity, goal, target, options = {}) {
    if (!target?.isValid) {
      return false;
    }

    const { attackRequirements } = goal;
    if (attackRequirements.anyOf) {
      for (const request of attackRequirements.anyOf) {
        if (
          EntityGoals.canUseGoalCheckRequirement(
            entity,
            goal,
            request,
            target,
            options,
          )
        ) {
          if (request.id !== undefined) {
            entity.setDynamicProperty(
              `${SETTINGS.general.namespace}:attack_trigger_reason`,
              request.id,
            );
          }
          return true;
        }
      }
      return false;
    }
    return EntityGoals.canUseGoalCheckRequirement(
      entity,
      goal,
      attackRequirements,
      target,
      options,
    );
  },

  /**
   * Reads back the `id` of the `anyOf` requirement that most recently caused
   * a goal to be selected via `canUseGoal`. `undefined` if the last goal
   * picked didn't use `anyOf`, or its matching entry had no `id`.
   *
   * @param {Entity} entity
   * @returns {string|undefined}
   */
  getTriggerReason(entity) {
    return /** @type {string|undefined} */ (
      entity?.getDynamicProperty(
        `${SETTINGS.general.namespace}:attack_trigger_reason`,
      )
    );
  },
  /**
   * Returns true if the goal can be triggered.
   *
   * @param {Entity} entity
   * @param {Object} goal - An object with an 'id' and an 'attackRequirements' members
   * @param {Object} attackRequirements
   * @param {Entity} target
   * @param {{ ignoreCooldowns?: boolean }} [options]
   * @returns {boolean}
   */
  canUseGoalCheckRequirement(
    entity,
    goal,
    attackRequirements,
    target,
    options = {},
  ) {
    const direction = getTargetVector(entity, target);

    if (
      attackRequirements.customCheck &&
      !attackRequirements.customCheck(entity, target)
    ) {
      return false;
    }

    const distance = direction.magnitude();

    if (attackRequirements.checkProperties) {
      for (const property of attackRequirements.checkProperties) {
        const propertyValue =
          (property.dynamic
            ? entity.getDynamicProperty(property.property)
            : entity.getProperty(property.property)) ?? 0;

        const passes = (() => {
          switch (property.operator) {
            case "==": {
              return propertyValue === property.test;
            }
            case "!=": {
              return propertyValue !== property.test;
            }
            case ">=": {
              return propertyValue >= property.test;
            }
            case ">": {
              return propertyValue > property.test;
            }
            case "<=": {
              return propertyValue <= property.test;
            }
            case "<": {
              return propertyValue < property.test;
            }
            default: {
              return propertyValue === property.test;
            }
          }
        })();

        if (!passes) {
          return false;
        }
      }
    }

    if (attackRequirements.requireLineOfSight) {
      const sourcePos = BVector3.from(entity.location);
      sourcePos.y += attackRequirements.lineOfSightEntityOffset ?? 1;
      const targetPos = BVector3.from(target.location);
      targetPos.y += attackRequirements.lineOfSightTargetOffset ?? 1;

      const delta = BVector3.subtract(targetPos, sourcePos);
      const rayDistance = delta.magnitude();

      const block = entity.dimension.getBlockFromRay(sourcePos, delta, {
        includePassableBlocks: false,
        includeLiquidBlocks: false,
        maxDistance: Math.ceil(rayDistance),
      });

      if (block?.block) {
        return false;
      }
    }

    const isOnGround = !attackRequirements.isOnGround || entity?.isOnGround;

    const isMoreThanMin =
      !attackRequirements.minDistance ||
      distance > attackRequirements.minDistance;
    const isLessThanMax =
      !attackRequirements.maxDistance ||
      distance < attackRequirements.maxDistance;
    const isPassesChance =
      !attackRequirements.chance || Math.random() < attackRequirements.chance;
    const isOnCooldown =
      attackRequirements.checkCooldown && !options.ignoreCooldowns
        ? EntityGoals.getCooldown(entity, goal) > 0
        : false;

    const onGeneralCooldown = options.ignoreCooldowns
      ? false
      : entity.getDynamicProperty(
          `${SETTINGS.general.namespace}:general_cooldown`,
        );

    return (
      isOnGround &&
      isMoreThanMin &&
      isLessThanMax &&
      isPassesChance &&
      !isOnCooldown &&
      !onGeneralCooldown
    );
  },

  /**
   * Run in ticking function while the state of the entity is 'none'. Iterates over the
   * goals and attempts to trigger those with an 'attackRequirements' object.
   *
   * @param {Entity} entity
   * @param {Record<string, Object>} goals
   * @param {Entity} target
   * @param {GoalPickOptions} options
   */
  pickGoal(entity, goals, target, options) {
    if (!target) {
      return;
    }

    const directionToTarget = getTargetVector(entity, target);

    const attack = Object.values(goals).find(
      goal =>
        goal.attackRequirements &&
        !goal.attackRequirements.disabled &&
        EntityGoals.canUseGoal(entity, goal, target),
    );
    if (attack === undefined) {
      return;
    }

    if (options.lookAtTarget) {
      const rot = directionToTarget.angles();
      entity.setProperty(
        SETTINGS.entities.global_properties.rotation,
        rot.theta,
      );
      entity.setRotation({ x: 0, y: rot.theta });
    }

    if (attack.setState) {
      entity.setProperty(
        SETTINGS.entities.global_properties.state,
        attack.setState,
      );
    }
    //
    else {
      if (options.multipleAttackStates) {
        EntityGoals.setAttackType(entity, attack);
      }
      //
      else {
        entity.setProperty(
          SETTINGS.entities.global_properties.attack_type,
          attack.id,
        );
      }
      entity.setProperty(
        SETTINGS.entities.global_properties.state,
        SETTINGS.entities.global_states.preparing_attack,
      );
    }

    EntityGoals.applyCooldown(entity, attack);
  },

  setAttackType(entity, attack) {
    // Enum entity properties can only hold 16 values, so an entity with more
    // attacks than that spreads them across two properties.

    // The property that is not used for this attack must be set to 'none'.
    // Only two attack-type properties are supported.

    const attackTypeProperty = attack.useSecondAttackProperty
      ? SETTINGS.entities.global_properties.attack_type2
      : SETTINGS.entities.global_properties.attack_type;

    const attackToSetToNone = attack.useSecondAttackProperty
      ? SETTINGS.entities.global_properties.attack_type
      : SETTINGS.entities.global_properties.attack_type2;

    entity.setProperty(attackTypeProperty, attack.id);
    entity.setProperty(attackToSetToNone, "none");
  },

  getMultiPropertyAttackType(entity) {
    const attackType1 = entity.getProperty(
      SETTINGS.entities.global_properties.attack_type,
    );
    if (attackType1 !== "none") {
      return attackType1;
    }
    return entity.getProperty(SETTINGS.entities.global_properties.attack_type2);
  },
};
