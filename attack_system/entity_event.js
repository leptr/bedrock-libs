// Developed by: Petar Mijailovic (leptr)
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

/**
 * Event bridge between Bedrock world events and the attack system.
 *
 * Each exported `on...` function handles one world event: it runs the
 * project's lifecycle hooks, then forwards the event to the handlers that
 * entity scripts registered with `registerEntityHandlers`.
 *
 * QUICK START
 * ```javascript
 * import { registerAttackSystemEvents } from "./bedrock-libs/attack_system/index.js";
 *
 * registerAttackSystemEvents();
 * ```
 *
 * A project that already subscribes to these events itself can skip
 * `registerAttackSystemEvents` and call the `on...` functions from its own
 * subscribers instead.
 */

import { EntityComponentTypes, system, world } from "@minecraft/server";
import { SETTINGS } from "../game_settings.js";
import { logger } from "../utils/logger.js";
import { getEntityScan } from "../toolkit/entity_scan_cache.js";
import {
  EntityRegistry,
  RegisteredOnEventIds,
} from "./core/entity_registry.js";
import {
  dispatchDataDrivenEvent,
  dispatchEntityEvent,
} from "./core/entity_dispatcher.js";
import {
  dispatchSpecialScriptEvent,
  EntitySpecificTickHandlers,
  getEntityInitializer,
  getEntityTickHandler,
  runLifecycleHooks,
  SpecialEntityHitHandlers,
  SpecialTickHandlers,
} from "./special_handler.js";
import {
  cacheTarget,
  clearTarget,
  handleEntityRotation,
  lockEntityRotation,
} from "./entity_attack.js";

/** @import { Entity } from "@minecraft/server" */

/** Extra data-driven event ids a project handles outside the entity registry. */
const extraDataDrivenEventIds = new Set();

const bridgeState = {
  /** @type {Set<string>|undefined} */
  builtInDataDrivenEventIds: undefined,
  isRegistered: false,
  isTicking: false,
};

/**
 * Mark a data-driven event id as handled, so `isHandledDataDrivenEventId`
 * lets it through to the `dataDrivenEntityTrigger` lifecycle hooks.
 * @param {string} eventId
 */
export function registerHandledDataDrivenEventId(eventId) {
  extraDataDrivenEventIds.add(eventId);
}

function getBuiltInDataDrivenEventIds() {
  if (!bridgeState.builtInDataDrivenEventIds) {
    const events = SETTINGS.entities.global_events;
    bridgeState.builtInDataDrivenEventIds = new Set([
      events.death,
      events.target_detected_v2,
      events.target_escaped_v2,
      events.despawn,
      events.choose_attack,
    ]);
  }
  return bridgeState.builtInDataDrivenEventIds;
}

/**
 * Whether anything on the dataDrivenEntityTrigger pipeline handles this
 * eventId. Pure JS, so the subscriber can skip reading the event's native
 * Entity handle for the (vast majority of) unhandled trigger events.
 * @param {string|undefined} eventId - The trigger event's id.
 * @returns {boolean}
 */
export function isHandledDataDrivenEventId(eventId) {
  return (
    RegisteredOnEventIds.has(eventId) ||
    getBuiltInDataDrivenEventIds().has(eventId) ||
    extraDataDrivenEventIds.has(eventId)
  );
}

/**
 * Tick every loaded entity whose type is in the entity registry.
 * Entities with an `onTick` handler get it called; the rest only have their
 * rotation kept in sync. Handlers from `registerEntityTickHandler` run last.
 * @returns {Promise<void>}
 */
export async function tickRegisteredEntities() {
  const registeredTypeIds = new Set([
    ...Object.keys(EntityRegistry),
    ...Object.keys(EntitySpecificTickHandlers),
  ]);
  if (registeredTypeIds.size === 0) {
    return;
  }

  // One scan per dimension per tick, shared with every other consumer.
  for (const entitiesByType of getEntityScan().values()) {
    for (const typeId of registeredTypeIds) {
      const entities = entitiesByType.get(typeId);
      if (!entities) {
        continue;
      }

      const handlers = EntityRegistry[typeId];
      const tickHandler = getEntityTickHandler(typeId);

      for (const entity of entities) {
        if (!entity?.isValid) {
          continue;
        }

        if (handlers?.onTick) {
          await dispatchEntityEvent("onTick", entity);
        } else if (handlers) {
          handleEntityRotation(entity);
        } else {
          // do nothing
        }

        tickHandler?.(entity);
      }
    }
  }
}

/**
 * Handle script events routed through the attack system.
 * @param {{id:string, sourceEntity?: Entity}} event - Script-event payload.
 */
export async function entitiesOnScriptEventReceive(event) {
  const { id, sourceEntity } = event;

  switch (id) {
    case SETTINGS.script_events.clear_velocity: {
      sourceEntity?.clearVelocity();
      break;
    }
    case SETTINGS.script_events.tick_entity: {
      await dispatchEntityEvent("onTick", sourceEntity);
      break;
    }
    case SETTINGS.script_events.tick_projectile: {
      SpecialTickHandlers.projectiles?.(sourceEntity);
      break;
    }
    default: {
      dispatchSpecialScriptEvent(id, sourceEntity);
    }
  }
}

/**
 * Handle direct entity-hit events.
 * @param {{damagingEntity?: Entity, hitEntity?: Entity}} event - Hit payload.
 */
export function onEntityHitEntity(event) {
  if (runLifecycleHooks("entityHitEntity", event)) {
    return;
  }

  dispatchEntityEvent("onHitAsAttacker", event.damagingEntity, {
    damagingEntity: event.damagingEntity,
    hitEntity: event.hitEntity,
  });

  event.hitEntity?.setDynamicProperty(
    SETTINGS.entities.global_properties.last_hit_by_player,
    event.damagingEntity?.typeId === SETTINGS.general.player_id,
  );

  const hitHandler = EntityRegistry[event.hitEntity?.typeId];
  if (hitHandler?.onHit) {
    dispatchEntityEvent("onHit", event.hitEntity, event.damagingEntity);
  } else if (hitHandler?.onHitAsHit) {
    dispatchEntityEvent("onHitAsHit", event.hitEntity);
  } else {
    // do nothing
  }
}

/**
 * Handle player interaction events for registered entities.
 * @param {{target?: Entity, player?: import("@minecraft/server").Player}} event - Interaction payload.
 */
export function onPlayerInteractWithEntity(event) {
  if (!event?.target?.isValid || !event?.player?.isValid) {
    return;
  }

  void dispatchEntityEvent("onInteract", event.target, {
    player: event.player,
    event,
  });
}

/**
 * Handle data-driven entity trigger events.
 * The entity, event id and type id may be passed in by a subscriber that has
 * already read them; otherwise they are read from the event.
 * @param {{entity?: Entity, eventId?: string}} event - Data-driven trigger payload.
 * @param {Entity} [entity] - The event's entity.
 * @param {string} [eventId] - The event's id.
 * @param {string} [typeId] - The entity's type id.
 */
export function onDataDrivenEntityTrigger(
  event,
  entity = event?.entity,
  eventId = event?.eventId,
  typeId = entity?.typeId,
) {
  void dispatchDataDrivenEvent(event, entity, eventId, typeId);

  if (
    runLifecycleHooks("dataDrivenEntityTrigger", entity, eventId, typeId, event)
  ) {
    return;
  }

  if (!entity?.isValid) {
    return;
  }

  const events = SETTINGS.entities.global_events;
  const properties = SETTINGS.entities.global_properties;

  switch (eventId) {
    case events.death: {
      entity.clearVelocity();
      if (!entity.getProperty(properties.dead)) {
        entity.triggerEvent(events.movement_off);
        lockEntityRotation(entity);
        entity.clearVelocity();
      }

      dispatchEntityEvent("onDeath", entity);
      break;
    }
    case events.target_detected_v2: {
      cacheTarget(entity);
      break;
    }
    case events.target_escaped_v2: {
      clearTarget(entity);
      break;
    }
    case events.despawn: {
      handleEntityXPDrop(entity);
      break;
    }
    case events.choose_attack: {
      // Failsafe: an entity that chose no attack gets its movement back.
      system.runTimeout(() => {
        if (
          entity.isValid &&
          entity.getProperty(properties.state) ===
            SETTINGS.entities.global_states.none
        ) {
          entity.triggerEvent(events.movement_on);
        }
      }, SETTINGS.entities.timers.movement_failsafe);
      break;
    }
    default:
  }
}

/**
 * Handle projectile-hit-entity events.
 * @param {Object} event - Projectile-hit payload from Bedrock events.
 */
export function onProjectileHitEntity(event) {
  const projectile = event?.projectile;
  if (!projectile?.isValid) {
    return;
  }

  const hitEntity = event.getEntityHit?.()?.entity;
  if (hitEntity?.isValid) {
    try {
      // Projectiles do not hit other projectiles.
      if (
        hitEntity.hasTag(SETTINGS.entities.global_tags.projectile_entity) ||
        hitEntity.getComponent(EntityComponentTypes.Projectile)
      ) {
        return;
      }
    } catch {
      return;
    }
  }

  dispatchEntityEvent("projectileHitEntity", projectile, event);

  if (hitEntity?.isValid && hitEntity.typeId) {
    dispatchEntityEvent("onHitByProjectile", hitEntity, event);
  }

  const hitEntityTypeId = hitEntity?.isValid ? hitEntity.typeId : undefined;
  SpecialEntityHitHandlers[hitEntityTypeId]?.(event);

  runLifecycleHooks("projectileHitEntity", event);
}

/**
 * Handle projectile-hit-block events.
 * @param {Object} event - Projectile-hit payload from Bedrock events.
 */
export function onProjectileHitBlock(event) {
  dispatchEntityEvent("projectileHitBlock", event?.projectile, event);

  let hitBlockId;
  try {
    hitBlockId =
      event?.getBlockHit?.()?.block?.typeId ?? event?.hitBlock?.typeId;
  } catch {
    hitBlockId = undefined;
  }
  SpecialEntityHitHandlers[hitBlockId]?.(event);

  runLifecycleHooks("projectileHitBlock", event);
}

/**
 * Reconcile custom entity state when an entity loads into the world.
 * Only entities from the project's namespace are touched.
 * @param {{entity?: Entity}} event - Entity-load payload.
 */
export function onEntityLoad(event) {
  const entity = event?.entity;
  const typeId = entity?.typeId;

  if (!typeId?.startsWith(`${SETTINGS.general.namespace}:`)) {
    return;
  }

  if (runLifecycleHooks("entityLoad", entity, typeId, event)) {
    return;
  }

  // An entity removed while its chunk loads still fires entityLoad.
  if (!entity.isValid) {
    return;
  }

  resetEntityOnLoad(entity);

  const spawnedPositionProperty =
    SETTINGS.entities.global_dynamic_properties.spawned_position;
  if (!entity.getDynamicProperty(spawnedPositionProperty)) {
    entity.setDynamicProperty(
      spawnedPositionProperty,
      JSON.stringify(entity.location),
    );
  }
}

/**
 * Forward health-change events to registered entity handlers.
 * @param {{hurtEntity?: Entity}} event - Health-change payload.
 */
export function onEntityHealthChange(event) {
  if (event?.hurtEntity?.typeId) {
    dispatchEntityEvent("onHealthChange", event.hurtEntity, event);
  }
}

/**
 * Handle entity-spawn events for registered attack-system entities.
 * @param {{entity?: Entity}} event - Entity-spawn payload.
 */
export function onEntitySpawn(event) {
  const entity = event?.entity;
  try {
    const typeId = entity?.typeId;

    if (runLifecycleHooks("entitySpawn", entity, typeId, event)) {
      return;
    }

    getEntityInitializer(typeId)?.(entity);
    dispatchEntityEvent("onSpawn", entity);
  } catch (error) {
    logger.warn("Error handling entity spawn", error);
  }
}

/**
 * Handle entity-removal events.
 * @param {{removedEntityId?: string}} event - Entity-removal payload.
 */
export function onEntityRemove(event) {
  runLifecycleHooks("entityRemove", event);
}

/**
 * Handle the before-heal event. The attack system has no default behaviour
 * here; hooks can cancel the heal by setting `event.cancel = true`.
 * @param {Object} event - Entity-heal payload.
 */
export function onEntityHealBefore(event) {
  runLifecycleHooks("entityHealBefore", event);
}

/**
 * Spawn XP orbs for a custom entity when it was last damaged by a player.
 * The amount is read from `SETTINGS.entities.<name>.xp_reward`.
 * @param {Entity} entity - Entity being removed or despawned.
 */
export function handleEntityXPDrop(entity) {
  if (!entity?.isValid) {
    return;
  }

  const [namespace, name] = entity.typeId.split(":");
  const xpReward = SETTINGS.entities[name]?.xp_reward;

  const wasLastHitByPlayer = entity.getDynamicProperty(
    SETTINGS.entities.global_properties.last_hit_by_player,
  );

  if (
    wasLastHitByPlayer &&
    namespace === SETTINGS.general.namespace &&
    xpReward
  ) {
    for (let index = 0; index < xpReward; index++) {
      entity.dimension.spawnEntity("minecraft:xp_orb", entity.location);
    }
  }
}

/**
 * An entity that unloaded in the middle of an attack comes back with its
 * state property reset by the engine but its movement still disabled. Put it
 * back into its idle state.
 * @param {Entity} entity
 */
function resetEntityOnLoad(entity) {
  const properties = SETTINGS.entities.global_properties;
  const events = SETTINGS.entities.global_events;

  let currentState;
  try {
    currentState = entity.getProperty(properties.state);
  } catch {
    return;
  }

  if (currentState === undefined) {
    return;
  }

  const defaultState = entity.resetProperty(properties.state);

  if (currentState === defaultState) {
    entity.triggerEvent(events.attack_end);
    entity.triggerEvent(events.movement_on);
    entity.triggerEvent(events.vulnerable);
  }
}

/**
 * Display selected entity properties on nearby players' action bars.
 * @param {Entity} entity - Entity whose properties should be displayed.
 * @param {string[]} properties - Property names without the namespace prefix.
 */
export function monitorProperties(entity, properties) {
  let text = ``;
  for (const property of properties) {
    const propertyId = `${SETTINGS.general.namespace}:${property}`;
    text += `${property}: ${entity.getProperty(propertyId)}\n`;
  }

  const players = entity.dimension.getPlayers({
    location: entity.location,
    maxDistance: SETTINGS.general.chunk_size,
  });
  for (const player of players) {
    player.onScreenDisplay.setActionBar(text);
  }
}

/**
 * Subscribe the attack system to every world event it needs and start the
 * per-tick entity update. Call it once at startup.
 *
 * @param {Object} [options]
 * @param {boolean} [options.shouldTickEntities=true] Run `tickRegisteredEntities` every tick.
 *   Turn it off when the pack drives ticking through the `tick_entity` script event instead.
 */
export function registerAttackSystemEvents({ shouldTickEntities = true } = {}) {
  if (bridgeState.isRegistered) {
    logger.warn("registerAttackSystemEvents called more than once; ignored.");
    return;
  }
  bridgeState.isRegistered = true;

  const { afterEvents, beforeEvents } = world;

  system.afterEvents.scriptEventReceive.subscribe(event => {
    void entitiesOnScriptEventReceive(event);
  });
  afterEvents.entityLoad.subscribe(onEntityLoad);
  afterEvents.entitySpawn.subscribe(onEntitySpawn);
  afterEvents.entityRemove.subscribe(onEntityRemove);
  afterEvents.entityHitEntity.subscribe(onEntityHitEntity);
  afterEvents.entityHurt.subscribe(onEntityHealthChange);
  afterEvents.projectileHitEntity.subscribe(onProjectileHitEntity);
  afterEvents.projectileHitBlock.subscribe(onProjectileHitBlock);
  afterEvents.playerInteractWithEntity.subscribe(onPlayerInteractWithEntity);
  afterEvents.dataDrivenEntityTrigger.subscribe(event => {
    const eventId = event.eventId;
    if (!isHandledDataDrivenEventId(eventId)) {
      return;
    }
    const entity = event.entity;
    onDataDrivenEntityTrigger(event, entity, eventId, entity?.typeId);
  });
  // entityHeal is not available in every API version.
  beforeEvents.entityHeal?.subscribe(onEntityHealBefore);

  if (!shouldTickEntities) {
    return;
  }

  system.runInterval(() => {
    // Skip a tick rather than overlap when the previous one is still awaiting.
    if (bridgeState.isTicking) {
      return;
    }
    bridgeState.isTicking = true;
    tickRegisteredEntities()
      .catch(error => {
        logger.error(`[attack_system] tick failed: ${error?.stack || error}`);
      })
      .finally(() => {
        bridgeState.isTicking = false;
      });
  });
}

/** Re-export the entity registration helper for pack startup code. */
export { registerEntityHandlers } from "./core/entity_registry.js";
