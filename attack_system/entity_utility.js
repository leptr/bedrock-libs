// Developed by: Petar Mijailovic (leptr)
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

import {
  system,
  world,
  EntityComponentTypes,
  EquipmentSlot,
  Difficulty,
} from "@minecraft/server";
import { SETTINGS } from "../game_settings.js";
import { BVector3, HALF_CIRCLE } from "../better_vectors/better_vectors.js";
import { clamp } from "../utils/utils.js";
import { logIgnoredError } from "../utils/logger.js";

export { applyResistanceScaledKB } from "../toolkit/effect_registry.js";

/** @import { Entity } from "@minecraft/server" */

const vanillaShieldId = "minecraft:shield";

/**
 * Adds `amount` to a numeric dynamic property, treating an unset property as 0.
 * Pass `min`/`max` to clamp the result; either bound can be omitted.
 * @param {import('@minecraft/server').Entity} entity
 * @param {string} property
 * @param {number} amount
 * @param {{min?: number, max?: number}} [options]
 * @returns {number} The new value.
 */
export function incrementDynamicProperty(
  entity,
  property,
  amount,
  { min, max } = {},
) {
  const newValue = clamp(
    /** @type {number} */ (entity.getDynamicProperty(property) ?? 0) + amount,
    min ?? -Infinity,
    max ?? Infinity,
  );
  entity.setDynamicProperty(property, newValue);
  return newValue;
}

/** True when the column at (x, z) lies outside the knockup's cone. */
function isOutsideKnockupAngle(x, z, direction, angle) {
  const blockDirection = new BVector3(x, 0, z);
  blockDirection.normalize();
  const viewDirection = BVector3.from(direction);
  viewDirection.y = 0;
  viewDirection.normalize();

  const cos = BVector3.dotProduct(blockDirection, viewDirection);
  const angle2 = (Math.acos(cos) * HALF_CIRCLE) / Math.PI;

  return Math.abs(angle2) >= angle;
}

/** Spawns a block_jump on the ground under the column at (x, z), if any. */
function spawnBlockJump(dimension, center, x, z, distance) {
  const rayPos = BVector3.from(center);
  rayPos.x += x;
  rayPos.z += z;
  const block = dimension.getBlockFromRay(rayPos, BVector3.down(), {
    includeLiquidBlocks: false,
    includePassableBlocks: false,
  });
  if (block?.block) {
    const position = BVector3.from(block.block.location);
    position.y += 1;

    const blockJump = dimension.spawnEntity(
      SETTINGS.entities.block_jump.id,
      position,
    );

    blockJump.setProperty(
      SETTINGS.entities.block_jump.distance_property,
      distance,
    );
  }
}

export function doBlockKnockup(
  radius,
  angle,
  direction,
  center,
  dimension,
  chance,
) {
  for (let x = -radius; x <= radius; x++) {
    for (let z = -radius; z <= radius; z++) {
      const distance = Math.hypot(x, z);
      const isSkipped =
        Math.random() > chance ||
        distance > radius ||
        isOutsideKnockupAngle(x, z, direction, angle);
      if (!isSkipped) {
        spawnBlockJump(dimension, center, x, z, distance);
      }
    }
  }
}

const difficultyCache = { value: Difficulty.Easy, lastUpdateTick: 0 };

/**
 * Pick a value by world difficulty. Peaceful uses the easy value.
 * @template T
 * @param {T} easy
 * @param {T} normal
 * @param {T} hard
 * @returns {T}
 */
export function evalFromDifficulty(easy, normal, hard) {
  // Cache difficulty once per tick
  const currentTick = system.currentTick;
  if (difficultyCache.lastUpdateTick !== currentTick) {
    difficultyCache.lastUpdateTick = currentTick;
    difficultyCache.value = world.getDifficulty();
  }

  return {
    [Difficulty.Peaceful]: easy,
    [Difficulty.Easy]: easy,
    [Difficulty.Normal]: normal,
    [Difficulty.Hard]: hard,
  }[difficultyCache.value];
}

export function setDifficultyProperty(entity) {
  const worldDifficulty = world.getDifficulty();
  switch (worldDifficulty) {
    case "Peaceful":
    case "Easy": {
      entity.setProperty(
        SETTINGS.entities.global_properties.difficulty,
        "easy",
      );
      break;
    }
    case "Normal": {
      entity.setProperty(
        SETTINGS.entities.global_properties.difficulty,
        "normal",
      );
      break;
    }
    case "Hard": {
      entity.setProperty(
        SETTINGS.entities.global_properties.difficulty,
        "hard",
      );
      break;
    }
    default: {
      // Every Difficulty value is handled above
      break;
    }
  }
}

export function breakBlocks(entity, data, context) {
  const { width, height } = data;

  const breakContext = context ?? data.evaluateContext?.(entity, {});

  let brokenBlocks = 0;
  for (let x = -width / 2; x < width / 2; x++) {
    for (let z = -width / 2; z < width / 2; z++) {
      const startY = data.centerY ? -height / 2 : 0;
      const endY = data.centerY ? height / 2 : height;
      for (let y = startY; y < endY; y++) {
        const pos = BVector3.from(entity.location);
        pos.x += x;
        pos.y += y;
        pos.z += z;

        brokenBlocks += Number(
          breakBlock(pos, entity.dimension, data, breakContext),
        );
      }
    }
  }

  return brokenBlocks;
}

export function breakBlock(location, dimension, data, breakContext) {
  try {
    const block = dimension.getBlock(location);

    const canBreak = data.breakable?.has(block?.typeId) ?? true;
    const cantBreak = data.unbreakable?.has(block?.typeId) ?? false;
    const passesCustomCheck =
      data.customCheck?.(breakContext, {}, block) ?? true;

    if (
      block &&
      canBreak &&
      !cantBreak &&
      block.typeId !== "minecraft:air" &&
      passesCustomCheck
    ) {
      // no other way to break blocks with scripts apparently
      dimension.runCommand(
        `/setblock ${location.x} ${location.y} ${location.z} minecraft:air destroy`,
      );

      return true;
    }
  } catch (error) {
    // Unreadable or unloaded blocks, or a failed setblock, count as unbroken.
    logIgnoredError("attack_system/entity_utility:breakBlock", error);
  }

  return false;
}

export function tryBreakShield(entity) {
  if (!entity.isSneaking) {
    return false;
  }

  const equippable = entity?.getComponent(EntityComponentTypes.Equippable);

  if (!equippable) {
    return false;
  }

  if (
    equippable.getEquipment(EquipmentSlot.Mainhand)?.typeId === vanillaShieldId
  ) {
    breakShield(equippable, EquipmentSlot.Mainhand, entity);
    return true;
  }

  if (
    equippable.getEquipment(EquipmentSlot.Offhand)?.typeId === vanillaShieldId
  ) {
    breakShield(equippable, EquipmentSlot.Offhand, entity);
    return true;
  }

  return false;
}

export function tryDamageShield(entity, damage) {
  if (!entity.isSneaking) {
    return false;
  }

  const equippable = entity?.getComponent(EntityComponentTypes.Equippable);

  if (!equippable) {
    return false;
  }

  return (
    damageShield(equippable, EquipmentSlot.Offhand, damage, entity) ||
    damageShield(equippable, EquipmentSlot.Mainhand, damage, entity)
  );
}

function isItemShield(typeId) {
  return SETTINGS.attack_system.shield_item_ids.includes(typeId);
}

function damageShield(equippable, slot, damage, entity) {
  const item = equippable.getEquipment(slot);
  if (isItemShield(item?.typeId)) {
    const newShield = item.clone();
    const durability = newShield.getComponent("minecraft:durability");
    if (!durability) {
      return false;
    }
    durability.damage = Math.min(
      durability.damage + damage,
      durability.maxDurability,
    );
    entity.dimension.playSound("item.shield.block", entity.location, {
      pitch: 1,
      volume: 1,
    });
    if (durability.damage === durability.maxDurability) {
      equippable.setEquipment(slot);
      entity.dimension.playSound("mob.zombie.woodbreak", entity.location, {
        pitch: 1,
        volume: 1,
      });
    } else {
      equippable.setEquipment(slot, newShield);
    }
    return true;
  }
  return false;
}

function breakShield(equippable, slot, entity) {
  equippable.setEquipment(slot);

  entity.dimension.playSound("item.shield.block", entity.location, {
    pitch: 1,
    volume: 1,
  });
  entity.dimension.playSound("mob.zombie.woodbreak", entity.location, {
    pitch: 1,
    volume: 1,
  });
}

export function isBlockingWithShield(entity) {
  const equippable = entity?.getComponent(EntityComponentTypes.Equippable);

  if (!equippable) {
    return false;
  }

  const isHoldingShield =
    isItemShield(equippable.getEquipment(EquipmentSlot.Mainhand)?.typeId) ||
    isItemShield(equippable.getEquipment(EquipmentSlot.Offhand)?.typeId);

  return isHoldingShield && entity.isSneaking;
}

export function getOwner(entity) {
  const ownerId = entity.getDynamicProperty(
    SETTINGS.entities.global_properties.owner_id,
  );
  if (!ownerId) {
    return undefined;
  }
  const owner = world.getEntity(ownerId);
  if (!owner?.isValid) {
    return undefined;
  }
  return owner;
}

export function setOwner(entity, owner) {
  if (owner?.isValid) {
    entity.setDynamicProperty(
      SETTINGS.entities.global_properties.owner_id,
      owner.id,
    );
  }
}
