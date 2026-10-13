// Developed by: Petar Mijailovic (leptr)
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

import { SETTINGS } from "../../game_settings.js";
import { ATTACK_DIRECTIONS } from "../constants.js";
import {
  DirectionalOffset,
  getAttackReferenceYaw,
  getTargetVector,
  rotationRelativeOffset,
} from "../../toolkit/toolkit.js";
import {
  BVector2,
  BVector3,
  FULL_CIRCLE,
  HALF_CIRCLE,
} from "../../better_vectors/better_vectors.js";
import { logger } from "../../utils/logger.js";

/** @import { Entity } from "@minecraft/server" */

const KNOCKBACK_EXCLUDED_ENTITIES = [
  "minecraft:item",
  "minecraft:arrow",
  "minecraft:thrown_trident",
  "minecraft:xp_bottle",
  "minecraft:snowball",
  "minecraft:ender_pearl",
  "minecraft:eye_of_ender_signal",
  "minecraft:egg",
  "minecraft:fishing_hook",
];

/**
 * Unified target finding system for all attack patterns.
 * Consolidates cone, area, ring, and line attack targeting into one configurable interface.
 */
export const TargetFinder = {
  /**
   * Finds targets for an attack based on the specified damage type pattern.
   * @param {Entity} entity - The entity performing the attack
   * @param {Object} attack - The attack object with attackOptions
   * @param {Object} attackData - Additional attack data (excludes, location, etc)
   * @returns {Entity[]} Array of target entities
   */
  findTargets(entity, attack, attackData) {
    if (!TargetFinder.isValidAttacker(entity)) {
      return [];
    }

    const pattern = attack?.attackOptions?.pattern ?? "area";
    const strategy = TargetFinder.getStrategy(pattern);

    if (!strategy) {
      logger.warn(`Unknown pattern: ${pattern}`);
      return [];
    }

    return strategy(entity, attack, attackData);
  },

  /**
   * Gets the appropriate targeting strategy based on attack pattern.
   * @param {String} pattern - The type of damage pattern ('cone', 'area', 'ring', 'line')
   * @returns {Function|null} The targeting strategy function
   */
  getStrategy(pattern) {
    return {
      cone: TargetFinder.findConeTargets,
      area: TargetFinder.findAreaTargets,
      ring: TargetFinder.findRingTargets,
      arc: TargetFinder.findArcTargets,
      line: TargetFinder.findLineTargets,
    }[pattern];
  },

  /**
   * Finds targets in a cone pattern in front of the attacker.
   * @private
   */
  findConeTargets(entity, attack, attackData) {
    const entities = TargetFinder.getBaseEntities(entity, attack, attackData);
    const targets = [];

    for (const t of entities) {
      if (!t?.isValid) {
        continue;
      }

      const angleOffset =
        attack?.attackOptions?.damageAngleOffset?.getTheta?.() ?? 0;
      const entityRotation = getAttackReferenceYaw(entity) + angleOffset;
      const targetVector = getTargetVector(entity, t);
      const targetAngle = targetVector.angles().theta;

      const diff = Math.abs(entityRotation - targetAngle) % FULL_CIRCLE;
      const angleDifference = diff > HALF_CIRCLE ? FULL_CIRCLE - diff : diff;

      if (
        angleDifference <= attack.attackOptions.angle &&
        TargetFinder.isTargetInRange(entity, t, attack, attackData)
      ) {
        targets.push(t);
      }
    }

    return targets;
  },

  /**
   * Finds targets in a circular area around a point.
   * @private
   */
  findAreaTargets(entity, attack, attackData) {
    let targets = TargetFinder.getBaseEntities(entity, attack, attackData);

    targets = targets.filter(
      t =>
        t?.location &&
        TargetFinder.isTargetInRange(entity, t, attack, attackData),
    );

    return targets;
  },

  /**
   * Finds targets in a ring pattern at a specific range.
   * @private
   */
  findRingTargets(entity, attack, attackData) {
    const entities = TargetFinder.getBaseEntities(entity, attack, attackData);
    const targets = [];
    const minRange = attack?.attackOptions?.minRange ?? 0;
    const maxRange = attack?.attackOptions?.range ?? 10;
    const attackLocation = BVector3.from(
      TargetFinder.getAttackLocation(entity, attack, attackData),
    );
    const horizontalOrigin = new BVector2(attackLocation.x, attackLocation.z);

    for (const t of entities) {
      if (!t?.isValid) {
        continue;
      }

      const targetLocation = BVector3.from(t.location);
      const horizontalTarget = new BVector2(targetLocation.x, targetLocation.z);
      const distance = horizontalTarget.distance(horizontalOrigin);

      if (
        distance >= minRange &&
        distance <= maxRange &&
        TargetFinder.isTargetInRange(entity, t, attack, attackData)
      ) {
        targets.push(t);
      }
    }

    return targets;
  },

  /**
   * Finds targets in a filled arc sector pattern.
   * @private
   */
  findArcTargets(entity, attack, attackData) {
    const entities = TargetFinder.getBaseEntities(entity, attack, attackData);
    const targets = [];

    for (const target of entities) {
      if (!target?.isValid) {
        continue;
      }

      if (
        TargetFinder.isTargetInRange(entity, target, attack, attackData) &&
        TargetFinder.isInArcPattern(entity, target, attack)
      ) {
        targets.push(target);
      }
    }

    return targets;
  },

  /**
   * Finds targets in a line extending from the attacker.
   * @private
   */
  findLineTargets(entity, attack, attackData) {
    const entities = TargetFinder.getBaseEntities(entity, attack, attackData);
    const targets = [];
    const lineWidth = attack?.attackOptions?.lineWidth ?? 1;

    for (const t of entities) {
      if (!t?.isValid) {
        continue;
      }

      if (
        TargetFinder.isInLinePattern(entity, t, attackData, lineWidth) &&
        TargetFinder.isTargetInRange(entity, t, attack, attackData)
      ) {
        targets.push(t);
      }
    }

    return targets;
  },

  /**
   * Checks if a target is within the attack's horizontal and vertical range.
   * @private
   */
  isTargetInRange(entity, target, attack, attackData) {
    const location = BVector3.from(
      TargetFinder.getAttackLocation(entity, attack, attackData),
    );
    const verticalRange = TargetFinder.resolveVerticalRange(
      attack?.attackOptions?.verticalRange,
      2,
    );
    const targetLocation = BVector3.from(target.location);
    const horizontalOrigin = new BVector2(location.x, location.z);
    const horizontalTarget = new BVector2(targetLocation.x, targetLocation.z);

    const horizontalDistance = horizontalTarget.distance(horizontalOrigin);

    if (horizontalDistance > attack.attackOptions.range) {
      return false;
    }

    const dy = BVector3.subtract(
      targetLocation,
      BVector3.from(entity.location),
    ).y;
    const cancelVerticalNegative =
      attack?.attackOptions?.cancelVerticalNegative ?? false;

    if (cancelVerticalNegative) {
      return dy >= 0 && dy <= verticalRange;
    }

    return Math.abs(dy) <= verticalRange;
  },

  /**
   * Checks if a target is in a line pattern extending from the attacker.
   * @private
   */
  isInLinePattern(entity, target, attackData, lineWidth) {
    const fromPos = new BVector2(entity.location.x, entity.location.z);
    const toPos = new BVector2(target.location.x, target.location.z);
    const direction = TargetFinder.getHorizontalDirectionVector(
      entity,
      attackData,
    );
    const targetOffset = BVector2.subtract(toPos, fromPos);
    const dotProduct = targetOffset.dotProduct(direction);
    const projection = direction.copy();
    projection.multiply(dotProduct);
    const perpendicularOffset = BVector2.subtract(targetOffset, projection);
    const perpDistribution = perpendicularOffset.magnitude();

    return perpDistribution <= lineWidth && dotProduct > 0;
  },

  isInArcPattern(entity, target, attack) {
    const configuredSweep = Number(attack?.attackOptions?.angle ?? FULL_CIRCLE);
    const minimumSweep = Number(attack?.attackOptions?.minSweep ?? 0);

    if (!Number.isFinite(configuredSweep)) {
      return true;
    }

    const startAngle = TargetFinder.normalizeAngle(
      getAttackReferenceYaw(entity) +
        (attack?.attackOptions?.damageAngleOffset?.getTheta?.() ?? 0) +
        Number(attack?.attackOptions?.startAngle ?? 0),
    );
    const targetAngle = TargetFinder.normalizeAngle(
      getTargetVector(entity, target).angles().theta,
    );
    const arcDirection =
      attack?.attackOptions?.arcDirection ?? ATTACK_DIRECTIONS.CLOCKWISE;
    const sweep =
      arcDirection === ATTACK_DIRECTIONS.COUNTER_CLOCKWISE
        ? TargetFinder.counterClockwiseAngleDistance(startAngle, targetAngle)
        : TargetFinder.clockwiseAngleDistance(startAngle, targetAngle);

    return TargetFinder.isSweepWithinBand(sweep, minimumSweep, configuredSweep);
  },

  isSweepWithinBand(sweep, minimumSweep, maximumSweep) {
    const lowerBound = Math.max(0, Number(minimumSweep) || 0);
    const upperBound = Math.max(lowerBound, Number(maximumSweep) || 0);
    const bandWidth = upperBound - lowerBound;

    if (bandWidth <= 0) {
      return false;
    }

    if (bandWidth >= FULL_CIRCLE) {
      return true;
    }

    const normalizedLowerBound = TargetFinder.normalizeAngle(lowerBound);
    const normalizedSweep = TargetFinder.normalizeAngle(sweep);
    const sweepFromLowerBound = TargetFinder.normalizeAngle(
      normalizedSweep - normalizedLowerBound,
    );

    return sweepFromLowerBound > 0 && sweepFromLowerBound <= bandWidth;
  },

  normalizeAngle(angle) {
    return ((angle % FULL_CIRCLE) + FULL_CIRCLE) % FULL_CIRCLE;
  },

  clockwiseAngleDistance(startAngle, endAngle) {
    return TargetFinder.normalizeAngle(endAngle - startAngle);
  },

  counterClockwiseAngleDistance(startAngle, endAngle) {
    return TargetFinder.normalizeAngle(startAngle - endAngle);
  },

  getHorizontalDirectionVector(entity, attackData) {
    const direction = new BVector2(
      attackData?.direction?.x ?? 0,
      attackData?.direction?.z ?? 0,
    );

    if (direction.magnitude() > 0) {
      direction.normalize();
      return direction;
    }

    const yaw = getAttackReferenceYaw(entity);
    return new BVector2(
      Math.sin((yaw * Math.PI) / HALF_CIRCLE),
      Math.cos((yaw * Math.PI) / HALF_CIRCLE),
    );
  },

  /**
   * Gets the base list of entities to filter for the attack.
   * @private
   */
  getBaseEntities(entity, attack, attackData) {
    if (!TargetFinder.isValidAttacker(entity)) {
      return [];
    }

    const { excludedNames, excludedTags, excludedFamilies, excludedTypes } =
      TargetFinder.buildExclusionLists(entity, attackData);

    const location = TargetFinder.getAttackLocation(entity, attack, attackData);
    const searchDistance = TargetFinder.getSearchMaxDistance(
      attack.attackOptions.range,
      TargetFinder.resolveVerticalRange(
        attack?.attackOptions?.verticalRange,
        2,
      ),
    );

    return (
      entity?.dimension?.getEntities({
        location,
        excludeNames: excludedNames,
        excludeTags: excludedTags,
        excludeFamilies: ["inanimate", ...excludedFamilies],
        excludeTypes: [
          entity?.typeId,
          ...KNOCKBACK_EXCLUDED_ENTITIES,
          ...excludedTypes,
        ],
        maxDistance: searchDistance,
      }) ?? []
    );
  },

  /**
   * Builds the exclusion lists for entity filtering.
   * @private
   */
  buildExclusionLists(entity, attackData) {
    const excludedNames = [...(attackData.excludeNames ?? [])];
    const excludedTags = [...(attackData.excludeTags ?? [])];
    const excludedFamilies = [...(attackData.excludeFamilies ?? [])];
    const excludedTypes = [
      ...(attackData.excludeTypes ?? []),
      "minecraft:item",
    ];

    const tameable = entity?.getComponent(
      SETTINGS.entities.components.tameable.id,
    );
    if (tameable?.isTamed) {
      const ownerName = tameable.tamedToPlayer?.name;
      if (ownerName) {
        excludedNames.push(ownerName);
      }
    }

    return {
      excludedNames,
      excludedTags,
      excludedFamilies,
      excludedTypes,
    };
  },

  /**
   * Gets the location where the attack originates from.
   * @private
   */
  getAttackLocation(entity, attack, attackData) {
    if (attackData?.location !== undefined) {
      return attackData.location;
    }

    return rotationRelativeOffset(
      entity,
      attack?.attackOptions?.damageOffset ??
        new DirectionalOffset(0, 0, 0, true),
    );
  },

  /**
   * Calculates the maximum distance to search for targets.
   * @private
   */
  getSearchMaxDistance(range, verticalRange) {
    const resolvedRange = Number(range);
    const resolvedVertical = Number(verticalRange);

    if (!Number.isFinite(resolvedRange) || !Number.isFinite(resolvedVertical)) {
      return 0;
    }

    return new BVector2(resolvedRange, resolvedVertical).magnitude();
  },

  /**
   * Validates and resolves a vertical range value.
   * @private
   */
  resolveVerticalRange(value, fallback) {
    const resolved = Number(value ?? fallback);
    return Number.isFinite(resolved) ? Math.max(0, resolved) : 0;
  },

  /**
   * Validates that the attacker is a valid entity.
   * @private
   */
  isValidAttacker(entity) {
    return entity?.isValid && typeof entity?.getRotation === "function";
  },
};
