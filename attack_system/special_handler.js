// Developed by: Petar Mijailovic (leptr)
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

/**
 * Supplemental handler registries used by the attack event bridge.
 *
 * The entity registry covers handlers that belong to one entity type. These
 * registries cover everything else a project needs to plug into the event
 * bridge: script events, shared tick handlers, hit handlers keyed by a block
 * or entity id, and lifecycle hooks that run for every entity.
 *
 * All registries start empty. A project fills them at startup.
 */

/** @import { Entity } from "@minecraft/server" */

/** Script-event handlers addressed directly by script-event id. */
export const SpecialScriptEventHandlers = {};

/**
 * Named tick handlers consumed by the attack event bridge.
 * `projectiles` runs for the `tick_projectile` script event.
 */
export const SpecialTickHandlers = {};

/** Projectile hit handlers keyed by the hit entity or block type id. */
export const SpecialEntityHitHandlers = {};

/** Entity initialization hooks keyed by entity type id. */
export const SpecialInitializers = {};

/** Per-entity tick handlers keyed by entity type id. */
export const EntitySpecificTickHandlers = {};

/**
 * Lifecycle hooks that run for every entity, before the default handling.
 * A hook that returns `true` marks the event as handled and stops the default
 * handling for that event.
 */
export const LifecycleHooks = {
  /** `(entity, typeId, event) => boolean|void` */
  entityLoad: [],
  /** `(entity, typeId, event) => boolean|void` */
  entitySpawn: [],
  /** `(event) => void` */
  entityRemove: [],
  /** `(event) => boolean|void` */
  entityHitEntity: [],
  /** `(entity, eventId, typeId, event) => boolean|void` */
  dataDrivenEntityTrigger: [],
  /** `(event) => boolean|void` */
  projectileHitEntity: [],
  /** `(event) => boolean|void` */
  projectileHitBlock: [],
  /** `(event) => void` — set `event.cancel = true` to stop the heal. */
  entityHealBefore: [],
};

function assertHandler(handler, registryName) {
  if (typeof handler !== "function") {
    throw new TypeError(`${registryName}: handler must be a function.`);
  }
}

/**
 * Register a handler for a script-event id.
 * @param {string} scriptEventId
 * @param {(sourceEntity: Entity) => void} handler
 */
export function registerSpecialScriptEventHandler(scriptEventId, handler) {
  assertHandler(handler, "registerSpecialScriptEventHandler");
  SpecialScriptEventHandlers[scriptEventId] = handler;
}

/**
 * Register a named tick handler.
 * @param {string} name
 * @param {Function} handler
 */
export function registerSpecialTickHandler(name, handler) {
  assertHandler(handler, "registerSpecialTickHandler");
  SpecialTickHandlers[name] = handler;
}

/**
 * Register a projectile hit handler for an entity or block type id.
 * @param {string} typeId
 * @param {(event: Object) => void} handler
 */
export function registerSpecialEntityHitHandler(typeId, handler) {
  assertHandler(handler, "registerSpecialEntityHitHandler");
  SpecialEntityHitHandlers[typeId] = handler;
}

/**
 * Register an initializer for an entity type id.
 * @param {string} entityTypeId
 * @param {(entity: Entity) => void} handler
 */
export function registerSpecialInitializer(entityTypeId, handler) {
  assertHandler(handler, "registerSpecialInitializer");
  SpecialInitializers[entityTypeId] = handler;
}

/**
 * Register a tick handler for one entity type id.
 * @param {string} entityTypeId
 * @param {(entity: Entity) => void} handler
 */
export function registerEntityTickHandler(entityTypeId, handler) {
  assertHandler(handler, "registerEntityTickHandler");
  EntitySpecificTickHandlers[entityTypeId] = handler;
}

/**
 * Register a lifecycle hook.
 * @param {keyof typeof LifecycleHooks} name
 * @param {Function} handler
 */
export function registerLifecycleHook(name, handler) {
  if (!Object.hasOwn(LifecycleHooks, name)) {
    throw new TypeError(`registerLifecycleHook: unknown hook "${name}".`);
  }
  assertHandler(handler, "registerLifecycleHook");
  LifecycleHooks[name].push(handler);
}

/**
 * Run every hook registered under `name`.
 * @param {keyof typeof LifecycleHooks} name
 * @param {...any} hookArguments
 * @returns {boolean} True when a hook reported the event as handled.
 */
export function runLifecycleHooks(name, ...hookArguments) {
  for (const hook of LifecycleHooks[name]) {
    if (hook(...hookArguments) === true) {
      return true;
    }
  }
  return false;
}

/**
 * Dispatch a script event through the supplemental script-event registry.
 * @param {string} scriptEventId - Script-event identifier to resolve.
 * @param {Entity} sourceEntity - Source entity passed to the handler.
 */
export function dispatchSpecialScriptEvent(scriptEventId, sourceEntity) {
  const handler = SpecialScriptEventHandlers[scriptEventId];
  if (handler) {
    handler(sourceEntity);
  }
}

/**
 * Dispatch a hit through the supplemental hit-handler registry.
 * @param {string} entityTypeId - Entity or block type id used as the handler key.
 * @param {Entity} hittingEntity - Entity that caused the hit.
 * @param {Entity} hitEntity - Entity that received the hit.
 */
export function dispatchSpecialEntityHit(
  entityTypeId,
  hittingEntity,
  hitEntity,
) {
  const handler = SpecialEntityHitHandlers[entityTypeId];
  if (handler) {
    handler(hittingEntity, hitEntity);
  }
}

/**
 * Resolve an entity-specific tick handler.
 * @param {string} entityTypeId - Entity type id to look up.
 * @returns {Function|undefined}
 */
export function getEntityTickHandler(entityTypeId) {
  return EntitySpecificTickHandlers[entityTypeId];
}

/**
 * Resolve an entity-specific initializer.
 * @param {string} entityTypeId - Entity type id to look up.
 * @returns {Function|undefined}
 */
export function getEntityInitializer(entityTypeId) {
  return SpecialInitializers[entityTypeId];
}
