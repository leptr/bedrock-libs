// Developed by: leptr
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

import * as mc from "@minecraft/server";
import * as u from "./utils";
import { bVector3 } from "./better_vectors";

export const unstuckEntity = (player) => {
  let dim = player.dimension;
  let source = dim.getBlock(player.location);
  if (!source) return;
  if (source.isAir || source.typeId === "minecraft:water") return;

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

    if (iterations >= 10000) unstuck = true;
  }
};

export const findNearestAir = (block) => {
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
};
