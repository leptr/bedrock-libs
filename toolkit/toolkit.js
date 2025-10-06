// Developed by: Petar Mijailovic (leptr)
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

import { world, Entity, Block, Player } from "@minecraft/server";
import { BVector3 } from "./better_vectors";

const waterBlockId = "minecraft:water";

/**
 *
 * @param {Entity} entity
 * @param {Boolean} onlyCheckUp
 */
export async function unstuckEntity(entity, onlyCheckUp) {
  const dim = entity.dimension;
  const source = dim.getBlock(entity.location);
  if (!source) {
    return false;
  }
  if (source.isAir || source.typeId === waterBlockId) {
    return false;
  }

  let unstuck = false;
  let iterations = 0;

  while (!unstuck) {
    iterations++;

    const up = dim.getBlock({
      x: source.x,
      y: source.y + iterations,
      z: source.z,
    });
    if (up?.isValid && (up?.isAir || up?.typeId === waterBlockId)) {
      entity.teleport(up);
      unstuck = true;
      break;
    }
    if (!onlyCheckUp) {
      const down = dim.getBlock({
        x: source.x,
        y: source.y - iterations,
        z: source.z,
      });
      if (down?.isValid && (down?.isAir || down?.typeId === waterBlockId)) {
        entity.teleport(down);
        unstuck = true;
        break;
      }
      const north = dim.getBlock({
        x: source.x,
        y: source.y,
        z: source.z - iterations,
      });
      if (north?.isValid && (north?.isAir || north?.typeId === waterBlockId)) {
        entity.teleport(north);
        unstuck = true;
        break;
      }
      const south = dim.getBlock({
        x: source.x,
        y: source.y,
        z: source.z + iterations,
      });
      if (south?.isValid && (south?.isAir || south?.typeId === waterBlockId)) {
        entity.teleport(south);
        unstuck = true;
        break;
      }
      const east = dim.getBlock({
        x: source.x + iterations,
        y: source.y,
        z: source.z,
      });
      if (east?.isValid && (east?.isAir || east?.typeId === waterBlockId)) {
        entity.teleport(east);
        unstuck = true;
        break;
      }
      const west = dim.getBlock({
        x: source.x - iterations,
        y: source.y,
        z: source.z,
      });
      if (west?.isValid && (west?.isAir || west?.typeId === waterBlockId)) {
        entity.teleport(west);
        unstuck = true;
        break;
      }
    }

    if (iterations >= 10000) {
      return false;
    }
  }
  return true;
}

/**
 *
 * @param {Block} block
 */
export function findNearestAir(block) {
  const dim = block.dimension;
  const source = block;

  let unstuck = false;
  let iterations = 0;

  let bl = block;

  while (!unstuck) {
    iterations++;

    const up = dim.getBlock({
      x: source.x,
      y: source.y + iterations,
      z: source.z,
    });
    if (up?.isValid && (up?.isAir || up?.typeId === waterBlockId)) {
      bl = up;
      unstuck = true;
      break;
    }
    const down = dim.getBlock({
      x: source.x,
      y: source.y - iterations,
      z: source.z,
    });
    if (down?.isValid && (down?.isAir || down?.typeId === waterBlockId)) {
      bl = down;
      unstuck = true;
      break;
    }
    const north = dim.getBlock({
      x: source.x,
      y: source.y,
      z: source.z - iterations,
    });
    if (north?.isValid && (north?.isAir || north?.typeId === waterBlockId)) {
      bl = north;
      unstuck = true;
      break;
    }
    const south = dim.getBlock({
      x: source.x,
      y: source.y,
      z: source.z + iterations,
    });
    if (south?.isValid && (south?.isAir || south?.typeId === waterBlockId)) {
      bl = south;
      unstuck = true;
      break;
    }
    const east = dim.getBlock({
      x: source.x + iterations,
      y: source.y,
      z: source.z,
    });
    if (east?.isValid && (east?.isAir || east?.typeId === waterBlockId)) {
      bl = east;
      unstuck = true;
      break;
    }
    const west = dim.getBlock({
      x: source.x - iterations,
      y: source.y,
      z: source.z,
    });
    if (west?.isValid && (west?.isAir || west?.typeId === waterBlockId)) {
      bl = west;
      unstuck = true;
      break;
    }

    if (iterations >= 10000) {
      unstuck = true;
    }
  }
}

/**
 *
 * @param {Player} player
 */
export function disablePlayerMovement(player) {
  player.runCommand("/inputpermission set @s movement disabled");
}

/**
 *
 * @param {Player} player
 */
export function enablePlayerMovement(player) {
  player.runCommand("/inputpermission set @s movement enabled");
}

/**
 *
 * @param {Player} player
 */
export function disablePlayerCamera(player) {
  player.runCommand("/inputpermission set @s camera disabled");
}

/**
 *
 * @param {Player} player
 */
export function enablePlayerCamera(player) {
  player.runCommand("/inputpermission set @s camera enabled");
}

/**
 *
 * @param {Object} filter
 * @param {String} sourceId
 */
export function getAllDimensions(filter, sourceId) {
  const result = [];
  for (const dimension of [
    world.getDimension("overworld"),
    world.getDimension("nether"),
    world.getDimension("the_end"),
  ]) {
    const entityFilter = filter;

    dimension.getEntities(entityFilter).forEach(entity => {
      if (sourceId === undefined || entity.id !== sourceId) {
        result.push(entity);
      }
    });
  }
  return result;
}

/**
 *
 * @param {Entity} source
 * @param {Number} radius
 * @param {Boolean} checkForBlocks
 */
export function getNearestPlayer(source, radius, checkForBlocks) {
  const player = source.dimension.getEntities({
    type: "minecraft:player",
    location: source.location,
    maxDistance: radius,
    closest: 1,
  })[0];

  if (player?.isValid) {
    if (!checkForBlocks) {
      return player;
    } else {
      const sPos = BVector3.from(source.getHeadLocation());
      const tPos = BVector3.from(player.location);
      const dir = BVector3.subtract(sPos, tPos);

      const dist = Math.round(BVector3.distance(sPos, tPos));

      if (
        source.dimension.getBlockFromRay(sPos, dir, {
          maxDistance: dist,
          includePassableBlocks: false,
          includeLiquidBlocks: false,
        }) === undefined
      ) {
        return player;
      }
    }
    return undefined;
  }
  return undefined;
}

export class AngleOffset {
  /**
   *
   * @param {Number} theta
   * @param {Number} phi
   */
  constructor(theta = 0, phi = 0) {
    this.theta = theta; // Equivalent of Y rotation
    this.phi = phi; // Equivalent of X rotation
  }
}

export class DirectionOffset {
  /**
   *
   * @param {Number} ground
   * @param {Number} side
   * @param {Number} front
   */
  constructor(ground = 0, side = 0, front = 0) {
    this.ground = ground; // Positive value moves it up, negative down
    this.side = side; // Positive value moves it to the right, negative to the left
    this.front = front; // Positive value moves it forward, negative backwards
  }
}

/**
 *
 * @param {Entity} source
 * @param {BVector3} offset
 */
export function rotationRelativeOffset(entity, offset) {
  const location = BVector3.from(entity.location);
  location.y += offset.ground;
  const force = BVector3.from(entity.getViewDirection());
  force.setMagnitude(offset.front);
  const upVector = BVector3.add(new BVector3(0, 1, 0), force);
  const sideVector = BVector3.crossProduct(force, upVector);
  sideVector.setMagnitude(offset.side);

  location.add(force);
  location.add(sideVector);

  return location;
}

/**
 *
 * @param {Entity} fromEntity
 * @param {Entity} toEntity
 */
export function getDirection(fromEntity, toEntity) {
  const floc = BVector3.from(fromEntity?.location);
  const sloc = BVector3.from(toEntity?.location);
  const dir = BVector3.subtract(sloc, floc);
  return dir;
}
