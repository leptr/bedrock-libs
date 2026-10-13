// Developed by: Petar Mijailovic (leptr)
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

import { logger } from "../../utils/logger.js";

/**
 * Registry of entity event handlers keyed by entity type id.
 *
 * Entity scripts register their handler tables here so the event bridge can
 * dispatch lifecycle callbacks consistently.
 */
export const EntityRegistry = {};

/**
 * Every eventId any registered entity listens to via `onEvent`. Lets the
 * data-driven dispatcher skip unhandled events with a pure-JS Set lookup
 * before touching any native entity getter.
 */
export const RegisteredOnEventIds = new Set();

const registryLog = [];

/**
 * Register one or more handler tables for an entity id.
 * @param {string|string[]} entityId - Single entity ID or array of IDs
 * @param {Object} handlers - Event handlers object
 * @param {Function|Function[]} [handlers.onTick] - Called every tick
 * @param {Function|Function[]} [handlers.onSpawn] - Called on spawn
 * @param {Function|Function[]} [handlers.onDeath] - Called on death
 * @param {Function|Function[]} [handlers.onHit] - Called when hit
 * @param {Function|Function[]} [handlers.onHitAsHit] - Called when this entity is hit
 * @param {Function|Function[]} [handlers.onHitAsAttacker] - Called when this entity hits another
 * @param {Function|Function[]} [handlers.projectileHitEntity] - Called when projectile hits entity
 * @param {Function|Function[]} [handlers.projectileHitBlock] - Called when projectile hits block
 * @param {Function|Function[]} [handlers.onHitByProjectile] - Called when hit by projectile
 * @param {Function|Function[]} [handlers.onHealthChange] - Called when health changes
 * @param {Function|Function[]} [handlers.onInteract] - Called when a player interacts with this entity
 * @param {Object.<string, Function|Function[]>} [handlers.onEvent] - Custom event handlers
 * @param {Object} metadata - Optional metadata for validation
 *
 * @example
 * // Single handler
 * registerEntityHandlers("entity:id", {
 *   onTick: tickHandler
 * });
 *
 * @example
 * // Multiple handlers for same event
 * registerEntityHandlers("entity:id", {
 *   onTick: [tickHandler1, tickHandler2],
 *   onDeath: deathHandler
 * });
 */
export function registerEntityHandlers(entityId, handlers, metadata = {}) {
  const ids = Array.isArray(entityId) ? entityId : [entityId];

  for (const id of ids) {
    if (metadata.expectedHandlers) {
      for (const handlerName of metadata.expectedHandlers) {
        if (!Object.hasOwn(handlers, handlerName)) {
          logger.warn(
            `⚠️ [Registry Warning] Missing expected handler "${handlerName}" for entity "${id}"`,
          );
        }
      }
    }

    EntityRegistry[id] = handlers;
    if (handlers.onEvent) {
      for (const onEventId of Object.keys(handlers.onEvent)) {
        RegisteredOnEventIds.add(onEventId);
      }
    }
    registryLog.push({
      id,
      timestamp: Date.now(),
      handlers: Object.keys(handlers),
    });
  }
}

/**
 * Return registration statistics and the registration log.
 * @returns {{totalRegistrations:number, registeredEntities:string[], log:Array}}
 */
export function getRegistryStats() {
  return {
    totalRegistrations: Object.keys(EntityRegistry).length,
    registeredEntities: Object.keys(EntityRegistry),
    log: registryLog,
  };
}

/**
 * Validate that expected entities and handlers have been registered.
 * @param {Object<string, {handlers?: string[]}>} [expectedEntities={}] - Expected registry contents.
 * @returns {{total:number, registered:number, missing:string[], warnings:Array}}
 */
export function validateRegistry(expectedEntities = {}) {
  const stats = {
    total: Object.keys(expectedEntities).length,
    registered: 0,
    missing: [],
    warnings: [],
  };

  for (const [entityId, expected] of Object.entries(expectedEntities)) {
    if (Object.hasOwn(EntityRegistry, entityId)) {
      stats.registered++;

      if (expected.handlers) {
        for (const handler of expected.handlers) {
          if (!Object.hasOwn(EntityRegistry[entityId], handler)) {
            stats.warnings.push({
              entity: entityId,
              missingHandler: handler,
            });
          }
        }
      }
    } else {
      stats.missing.push(entityId);
    }
  }

  return stats;
}
