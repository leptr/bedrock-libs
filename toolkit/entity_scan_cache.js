// Developed by: Petar Mijailovic (leptr)
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

import { system, world } from "@minecraft/server";
import {
  getScanDimensionsVersion,
  getScannedDimensionIds,
} from "./scan_dimension.js";
import { logIgnoredError } from "../utils/logger.js";

function getCurrentTick() {
  return system.currentTick;
}

/**
 * Per-tick entity scan cache.
 *
 * All per-tick consumers (the attack system's entity ticking and anything a
 * pack adds) share ONE unfiltered `dimension.getEntities()` call per
 * dimension per tick instead of issuing their own queries. The scan is a
 * snapshot taken on first access each tick; entities spawned later in the
 * same tick become visible on the next tick.
 */

const entityScan = {
  /** @type {import("@minecraft/server").Dimension[] | null} */
  dimensions: null,
  dimensionsVersion: -1,
  lastTick: -1,
  /** @type {Map<string, Map<string, import("@minecraft/server").Entity[]>>} */
  byDimension: new Map(),
};

/**
 * Resolve the dimension list; rebuilt only when the scanned-dimension
 * registry changes (a module registering a custom dimension).
 * @returns {import("@minecraft/server").Dimension[]}
 */
function getDimensions() {
  const version = getScanDimensionsVersion();
  if (entityScan.dimensions && entityScan.dimensionsVersion === version) {
    return entityScan.dimensions;
  }
  entityScan.dimensionsVersion = version;

  entityScan.dimensions = [];
  for (const dimensionId of getScannedDimensionIds()) {
    try {
      entityScan.dimensions.push(world.getDimension(dimensionId));
    } catch (error) {
      // dimension unavailable — skip
      logIgnoredError("toolkit/entity_scan_cache:getDimensions", error);
    }
  }

  return entityScan.dimensions;
}

/**
 * Re-scan all dimensions if the cached snapshot is from a previous tick.
 */
function refreshScan() {
  const currentTick = getCurrentTick();
  if (currentTick === entityScan.lastTick) {
    return;
  }
  entityScan.lastTick = currentTick;

  entityScan.byDimension = new Map();
  for (const dimension of getDimensions()) {
    /** @type {Map<string, import("@minecraft/server").Entity[]>} */
    const byType = new Map();

    let entities;
    try {
      entities = dimension.getEntities();
    } catch {
      entities = [];
    }

    for (const entity of entities) {
      const typeId = entity.typeId;
      const bucket = byType.get(typeId);
      if (bucket) {
        bucket.push(entity);
      } else {
        byType.set(typeId, [entity]);
      }
    }

    entityScan.byDimension.set(dimension.id, byType);
  }
}

/**
 * Get this tick's entity scan, refreshing it if stale.
 * @returns {Map<string, Map<string, import("@minecraft/server").Entity[]>>} dimension id → (typeId → entities)
 */
export function getEntityScan() {
  refreshScan();
  return entityScan.byDimension;
}

const playerScan = {
  lastTick: -1,
  /** @type {Array<{player: import("@minecraft/server").Player, id: string, dimensionId: string}>|null} */
  records: null,
  /** @type {Array<{player: import("@minecraft/server").Player, id: string, dimensionId: string, x: number, y: number, z: number}>} */
  positions: [],
};

/**
 * Drop the cached player/dimension records. Call whenever membership or a
 * player's dimension can have changed (spawn, leave, dimension change) — the
 * next getPlayerPositions() rebuilds them.
 */
export function invalidatePlayerPositions() {
  playerScan.records = null;
  playerScan.lastTick = -1;
}

/**
 * Rebuild the player/dimension records; only runs after invalidation.
 */
function buildPlayerRecords() {
  playerScan.records = [];
  for (const player of world.getAllPlayers()) {
    playerScan.records.push({
      player,
      id: player.id,
      dimensionId: player.dimension.id,
    });
  }
}

/**
 * Get every player's dimension id and location, read once per tick.
 * Lets per-block / per-event consumers do pure-JS distance and containment
 * checks instead of native getPlayers queries. Steady-state cost is one
 * location read per player per tick — membership and dimension ids are only
 * re-read after invalidatePlayerPositions().
 * @returns {Array<{player: import("@minecraft/server").Player, id: string, dimensionId: string, x: number, y: number, z: number}>}
 */
export function getPlayerPositions() {
  const currentTick = getCurrentTick();
  if (currentTick === playerScan.lastTick) {
    return playerScan.positions;
  }
  playerScan.lastTick = currentTick;

  if (!playerScan.records) {
    buildPlayerRecords();
  }

  playerScan.positions = [];
  for (const record of playerScan.records) {
    let location;
    try {
      location = record.player.location;
    } catch {
      continue;
    }

    playerScan.positions.push({
      player: record.player,
      id: record.id,
      dimensionId: record.dimensionId,
      x: location.x,
      y: location.y,
      z: location.z,
    });
  }

  return playerScan.positions;
}

/**
 * Closest player in the entity's dimension within a squared radius, from this
 * tick's player positions.
 * @param {import("@minecraft/server").Entity} entity
 * @param {number} radiusSq - Squared search radius in blocks.
 * @returns {import("@minecraft/server").Player | undefined}
 */
export function findNearestPlayerTo(entity, radiusSq) {
  let dimensionId;
  let location;
  try {
    dimensionId = entity.dimension.id;
    location = entity.location;
  } catch {
    return undefined;
  }
  let nearest;
  let nearestDistanceSq = radiusSq;
  for (const position of getPlayerPositions()) {
    if (position.dimensionId !== dimensionId) {
      continue;
    }
    const dx = position.x - location.x;
    const dy = position.y - location.y;
    const dz = position.z - location.z;
    const distanceSq = dx * dx + dy * dy + dz * dz;
    if (distanceSq <= nearestDistanceSq) {
      nearest = position.player;
      nearestDistanceSq = distanceSq;
    }
  }
  return nearest;
}

// Whether the entity is on the player's view ray within maxDistance blocks.
function isPlayerLookingAt(player, entity, maxDistance) {
  try {
    return player
      .getEntitiesFromViewDirection({ maxDistance })
      .some(hit => hit.entity.id === entity.id);
  } catch {
    return false;
  }
}

/**
 * Closest player in the entity's dimension within a squared radius whose view
 * ray hits the entity, or the closest player there when none does. For
 * data-driven interact events, which carry no player; the view ray is only
 * cast for players inside the radius.
 * @param {import("@minecraft/server").Entity} entity
 * @param {number} radiusSq - Squared search radius in blocks.
 * @returns {import("@minecraft/server").Player | undefined}
 */
export function findPlayerLookingAt(entity, radiusSq) {
  let dimensionId;
  let location;
  try {
    dimensionId = entity.dimension.id;
    location = entity.location;
  } catch {
    return undefined;
  }
  const maxDistance = Math.sqrt(radiusSq);
  let nearest;
  let nearestDistanceSq = radiusSq;
  for (const position of getPlayerPositions()) {
    if (position.dimensionId !== dimensionId) {
      continue;
    }
    const dx = position.x - location.x;
    const dy = position.y - location.y;
    const dz = position.z - location.z;
    const distanceSq = dx * dx + dy * dy + dz * dz;
    if (
      distanceSq <= nearestDistanceSq &&
      isPlayerLookingAt(position.player, entity, maxDistance)
    ) {
      nearest = position.player;
      nearestDistanceSq = distanceSq;
    }
  }
  return nearest ?? findNearestPlayerTo(entity, radiusSq);
}

/**
 * Get all entities of a type across all dimensions from this tick's scan.
 * @param {string} typeId - Entity type id to look up.
 * @returns {import("@minecraft/server").Entity[]}
 */
export function getEntitiesOfType(typeId) {
  refreshScan();

  const result = [];
  for (const byType of entityScan.byDimension.values()) {
    const bucket = byType.get(typeId);
    if (bucket) {
      result.push(...bucket);
    }
  }

  return result;
}
