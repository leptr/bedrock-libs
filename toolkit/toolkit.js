// Developed by: Petar Mijailovic (leptr)
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

import * as mc from "@minecraft/server";
import * as u from "./utils";
import { bVector3 } from "./better_vectors";

export async function unstuckEntity(player, onlyCheckUp) {
  let dim = player.dimension;
  let source = dim.getBlock(player.location);
  if (!source) return false;
  if (source.isAir || source.typeId === "minecraft:water") return false;
  if (PassableBlocks.includes(source.typeId)) return false;

  let unstuck = false;
  let iterations = 0;

  while (!unstuck) {
    iterations++;

    let up = dim.getBlock({ x: source.x, y: source.y + iterations, z: source.z });
    if (up && up.isValid() && (up.isAir || up.typeId === "minecraft:water")) {
      player.teleport(up);
      unstuck = true;
      break;
    }
    if (!onlyCheckUp) {
      let down = dim.getBlock({ x: source.x, y: source.y - iterations, z: source.z });
      if (down && down.isValid() && (down.isAir || down.typeId === "minecraft:water")) {
        player.teleport(down);
        unstuck = true;
        break;
      }
      let north = dim.getBlock({ x: source.x, y: source.y, z: source.z - iterations });
      if (north && north.isValid() && (north.isAir || north.typeId === "minecraft:water")) {
        player.teleport(north);
        unstuck = true;
        break;
      }
      let south = dim.getBlock({ x: source.x, y: source.y, z: source.z + iterations });
      if (south && south.isValid() && (south.isAir || south.typeId === "minecraft:water")) {
        player.teleport(south);
        unstuck = true;
        break;
      }
      let east = dim.getBlock({ x: source.x + iterations, y: source.y, z: source.z });
      if (east && east.isValid() && (east.isAir || east.typeId === "minecraft:water")) {
        player.teleport(east);
        unstuck = true;
        break;
      }
      let west = dim.getBlock({ x: source.x - iterations, y: source.y, z: source.z });
      if (west && west.isValid() && (west.isAir || west.typeId === "minecraft:water")) {
        player.teleport(west);
        unstuck = true;
        break;
      }
    }

    if (iterations >= 10000) return false;
  }
  return true;
}

export function findNearestAir(block) {
  let dim = block.dimension;
  let source = block;

  let unstuck = false;
  let iterations = 0;

  let bl = block;

  while (!unstuck) {
    iterations++;

    let up = dim.getBlock({ x: source.x, y: source.y + iterations, z: source.z });
    if (up && up.isValid() && (up.isAir || up.typeId === "minecraft:water")) {
      bl = up;
      unstuck = true;
      break;
    }
    let down = dim.getBlock({ x: source.x, y: source.y - iterations, z: source.z });
    if (down && down.isValid() && (down.isAir || down.typeId === "minecraft:water")) {
      bl = down;
      unstuck = true;
      break;
    }
    let north = dim.getBlock({ x: source.x, y: source.y, z: source.z - iterations });
    if (north && north.isValid() && (north.isAir || north.typeId === "minecraft:water")) {
      bl = north;
      unstuck = true;
      break;
    }
    let south = dim.getBlock({ x: source.x, y: source.y, z: source.z + iterations });
    if (south && south.isValid() && (south.isAir || south.typeId === "minecraft:water")) {
      bl = south;
      unstuck = true;
      break;
    }
    let east = dim.getBlock({ x: source.x + iterations, y: source.y, z: source.z });
    if (east && east.isValid() && (east.isAir || east.typeId === "minecraft:water")) {
      bl = east;
      unstuck = true;
      break;
    }
    let west = dim.getBlock({ x: source.x - iterations, y: source.y, z: source.z });
    if (west && west.isValid() && (west.isAir || west.typeId === "minecraft:water")) {
      bl = west;
      unstuck = true;
      break;
    }

    if (iterations >= 10000) unstuck = true;
  }
}

export function disablePlayerMovement(player) {
  player.runCommand("/inputpermission set @s movement disabled");
}

export function enablePlayerMovement(player) {
  player.runCommand("/inputpermission set @s movement enabled");
}

export function disablePlayerCamera(player) {
  player.runCommand("/inputpermission set @s camera disabled");
}

export function enablePlayerCamera(player) {
  player.runCommand("/inputpermission set @s camera enabled");
}

export function getAllDimensions(filter, sourceId) {
  let result = [];
  for (const dimension of [
    mc.world.getDimension("overworld"),
    mc.world.getDimension("nether"),
    mc.world.getDimension("the_end"),
  ]) {
    let entityFilter = filter;

    dimension.getEntities(entityFilter).forEach((entity) => {
      if (sourceId === undefined || entity.id !== sourceId) {
        result.push(entity);
      }
    });
  }
  return result;
}

export function getNearestPlayer(source, radius, checkForBlocks) {
  const player = source.dimension.getEntities({
    type: "minecraft:player",
    location: source.location,
    maxDistance: radius,
    closest: 1,
  })[0];

  if (player && player.isValid()) {
    if (!checkForBlocks) return player;
    else {
      const sPos = source.getHeadLocation();
      const tPos = entity.location;
      const dir = bVector3.subtract(sPos, tPos);

      const dist = Math.round(bVector3.distance(sPos, tPos));

      if (
        dimension.getBlockFromRay(sPos, dir, {
          maxDistance: dist,
          includePassableBlocks: false,
          includeLiquidBlocks: false,
        }) === undefined
      )
        return player;
    }
    return undefined;
  }
}
