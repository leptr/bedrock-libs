// Developed by: Petar Mijailovic (leptr)
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

import { SETTINGS } from "../../game_settings.js";
import {
  handleEntityRotation,
  initializeEntityRotationOnSpawn,
} from "../entity_attack.js";
import { logger, logIgnoredError } from "../../utils/logger.js";
import { EntityRegistry, RegisteredOnEventIds } from "./entity_registry.js";
import { AttackLogger } from "./attack_logger.js";

const ATTACK_COOLDOWN_STEP = 0.05;
const COOLDOWN_PRECISION_SCALE = 1000;

/**
 * Invoke a handler or handler list with the provided arguments.
 * @private
 */
async function callHandler(handler, ...handlerArguments) {
  if (!handler) {
    return;
  }

  if (Array.isArray(handler)) {
    for (const handlerFunction of handler) {
      if (typeof handlerFunction === "function") {
        await handlerFunction(...handlerArguments);
      }
    }
  } else if (typeof handler === "function") {
    await handler(...handlerArguments);
  } else {
    // do nothing
  }
}

function tickEntityAttackCooldown(entity) {
  if (!entity?.isValid) {
    return;
  }

  const pauseProperty =
    SETTINGS.entities.global_dynamic_properties.attack_cooldown_paused;
  if (pauseProperty && entity.getDynamicProperty?.(pauseProperty)) {
    return;
  }

  const cooldownProperty = SETTINGS.entities.global_properties.cooldown_ticks;
  const currentCooldown = Number(entity.getProperty?.(cooldownProperty));

  if (!Number.isFinite(currentCooldown) || currentCooldown <= 0) {
    return;
  }

  const nextCooldown = Math.max(
    0,
    Math.round(
      (currentCooldown - ATTACK_COOLDOWN_STEP) * COOLDOWN_PRECISION_SCALE,
    ) / COOLDOWN_PRECISION_SCALE,
  );

  try {
    entity.setProperty(cooldownProperty, nextCooldown);
  } catch (error) {
    logIgnoredError(
      "attack_system/core/entity_dispatcher:tickEntityAttackCooldown",
      error,
    );
  }
}

/**
 * Dispatch a lifecycle event through the entity registry.
 * @param {string} eventType - Registered event name.
 * @param {Object} entityOrEvent - Entity instance or event object containing an entity.
 * @param {Object} [additionalData] - Additional payload passed to matching handlers.
 */
export async function dispatchEntityEvent(
  eventType,
  entityOrEvent,
  additionalData = undefined,
) {
  const entity =
    entityOrEvent?.entity && !entityOrEvent?.typeId
      ? entityOrEvent.entity
      : entityOrEvent;

  if (!entity?.typeId) {
    return;
  }

  const handler = EntityRegistry[entity.typeId];
  if (!handler) {
    return;
  }

  switch (eventType) {
    case "onTick": {
      handleEntityRotation(entity);
      tickEntityAttackCooldown(entity);
      // Force the entity to not move when dead
      if (entity?.getProperty(SETTINGS.entities.global_properties.dead)) {
        entity.clearVelocity();
        if (!entity.isInWater) {
          entity.applyImpulse({
            x: 0,
            y: -0.3,
            z: 0,
          });
        }
      }
      await callHandler(handler.onTick, entity);
      break;
    }
    case "onSpawn": {
      initializeEntityRotationOnSpawn(entity);
      await callHandler(handler.onSpawn, entity);
      break;
    }
    case "onDeath": {
      await callHandler(handler.onDeath, entity);
      break;
    }
    case "onHit": {
      await callHandler(handler.onHit, entity, additionalData);
      break;
    }
    case "onHitAsHit": {
      await callHandler(handler.onHitAsHit, entity);
      break;
    }
    case "onHitAsAttacker": {
      await callHandler(
        handler.onHitAsAttacker,
        entity,
        additionalData?.hitEntity,
      );
      break;
    }
    case "projectileHitEntity": {
      await callHandler(
        handler.projectileHitEntity,
        additionalData || entityOrEvent,
      );
      break;
    }
    case "projectileHitBlock": {
      await callHandler(
        handler.projectileHitBlock,
        additionalData || entityOrEvent,
      );
      break;
    }
    case "onHitByProjectile": {
      await callHandler(
        handler.onHitByProjectile,
        additionalData || entityOrEvent,
      );
      break;
    }
    case "onHealthChange": {
      await callHandler(handler.onHealthChange, entity, additionalData);
      break;
    }
    case "onInteract": {
      await callHandler(
        handler.onInteract,
        entity,
        additionalData?.player,
        additionalData,
      );
      break;
    }
    default:
    // do nothing
  }
}

/**
 * Dispatch a data-driven event through an entity's registered `onEvent` handlers.
 * The caller passes the already-read entity and eventId so this hot path does
 * not re-read them through the event's native getters. Deliberately not async:
 * the unmatched-event fast path must not allocate a promise, and it bails via
 * the pure-JS RegisteredOnEventIds lookup before any native getter is touched.
 * @param {Object} event - Data-driven entity trigger event.
 * @param {import("@minecraft/server").Entity} entity - The event's entity, hoisted by the caller.
 * @param {string} eventId - The event's id, hoisted by the caller.
 * @param {string|undefined} typeId - The entity's type id, hoisted by the caller.
 */
export function dispatchDataDrivenEvent(event, entity, eventId, typeId) {
  if (!entity || !eventId || !RegisteredOnEventIds.has(eventId)) {
    return undefined;
  }

  const eventHandler = EntityRegistry[typeId]?.onEvent?.[eventId];
  if (!eventHandler) {
    return undefined;
  }

  if (!entity.isValid) {
    return undefined;
  }

  return invokeDataDrivenHandler(eventHandler, event, typeId, eventId);
}

/**
 * Run a matched data-driven handler; kept separate so the async/promise
 * machinery only kicks in when a handler actually exists.
 * @param {Function|Function[]} eventHandler - The registered handler(s).
 * @param {Object} event - Data-driven entity trigger event.
 * @param {string} typeId - The entity's type id.
 * @param {string} eventId - The event's id.
 */
async function invokeDataDrivenHandler(eventHandler, event, typeId, eventId) {
  try {
    await callHandler(eventHandler, event);
  } catch (error) {
    // Silently fail in production to prevent crashes
    const { functionName, lineInfo } = AttackLogger.extractStackInfo(error);
    const location = lineInfo ? ` at ${functionName} (${lineInfo})` : "";
    logger.warn(
      `Error dispatching data-driven event "${eventId}" for entity ${typeId}${location}:`,
      error,
    );
  }
}

/**
 * Dispatch the same event to a collection of entities.
 * @param {string} eventType - Registered event name.
 * @param {Iterable<Object>} entities - Entities to dispatch to.
 * @param {Object} [additionalData] - Additional payload passed to matching handlers.
 */
export async function dispatchEntityEventBatch(
  eventType,
  entities,
  additionalData = undefined,
) {
  for (const entity of entities) {
    await dispatchEntityEvent(eventType, entity, additionalData);
  }
}
