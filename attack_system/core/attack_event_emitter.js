// Developed by: Petar Mijailovic (leptr)
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

/**
 * Publish-subscribe emitter for attack lifecycle events.
 */

import { logger } from "../../utils/logger.js";

export class AttackEventEmitter {
  /**
   * Event types supported by the system
   */
  static Events = {
    ATTACK_START: "attackStart",
    ATTACK_VALIDATE: "attackValidate",
    TARGET_FOUND: "targetFound",
    TARGET_FILTERED: "targetFiltered",
    BEFORE_DAMAGE: "beforeDamage",
    DAMAGE_APPLIED: "damageApplied",
    AFTER_DAMAGE: "afterDamage",
    KNOCKBACK_APPLIED: "knockbackApplied",
    EFFECT_APPLIED: "effectApplied",
    SOUND_PLAYED: "soundPlayed",
    PARTICLE_SPAWNED: "particleSpawned",
    ATTACK_CANCEL: "attackCancel",
    ATTACK_END: "attackEnd",
    ATTACK_ERROR: "attackError",
  };

  /**
   * Creates a new emitter with standard attack event subscriptions.
   * @returns {AttackEventEmitter} New emitter instance
   */
  static createWithDefaults() {
    const emitter = new AttackEventEmitter();

    emitter.subscribe(AttackEventEmitter.Events.ATTACK_ERROR, data => {
      logger.error(`Attack error: ${data.error?.message}`, data.error);
    });

    return emitter;
  }

  constructor() {
    this.listeners = {};
    this.eventHistory = [];
    this.maxHistorySize = 1000;
  }

  /**
   * Subscribes to an event with a callback function.
   * @param {string} eventType - The event to listen for
   * @param {Function} callback - The callback function
   * @returns {Function} Unsubscribe function
   */
  subscribe(eventType, callback) {
    this.listeners[eventType] ??= [];
    this.listeners[eventType].push(callback);

    return () => {
      const index = this.listeners[eventType].indexOf(callback);
      if (index !== -1) {
        this.listeners[eventType].splice(index, 1);
      }
    };
  }

  /**
   * Subscribes to an event and automatically unsubscribes after first trigger.
   * @param {string} eventType - The event to listen for
   * @param {Function} callback - The callback function
   */
  once(eventType, callback) {
    const unsubscribe = this.subscribe(eventType, data => {
      callback(data);
      unsubscribe();
    });

    return unsubscribe;
  }

  /**
   * Emits an event to all subscribed listeners.
   * @param {string} eventType - The event type
   * @param {Object} data - Event data to pass to listeners
   * @returns {Object} Result object with status and metadata
   */
  emit(eventType, data = {}) {
    const eventData = {
      type: eventType,
      timestamp: Date.now(),
      handled: false,
      prevented: false,
      data,
    };

    this.recordEvent(eventData);

    const callbacks = this.listeners[eventType] || [];
    for (const callback of callbacks) {
      try {
        callback(data);
      } catch (error) {
        logger.error(`Error in event listener for ${eventType}`, error);
        this.emit(AttackEventEmitter.Events.ATTACK_ERROR, {
          event: eventType,
          error,
        });
      }
    }

    eventData.handled = true;
    return eventData;
  }

  /**
   * Emits an event and waits for all listeners to complete (async).
   * @param {string} eventType - The event type
   * @param {Object} data - Event data
   * @returns {Promise<Object>} Promise that resolves with event result
   */
  async emitAsync(eventType, data = {}) {
    const eventData = {
      type: eventType,
      timestamp: Date.now(),
      handled: false,
      prevented: false,
      data,
    };

    this.recordEvent(eventData);

    // Snapshot the list: a once() listener unsubscribes synchronously, which
    // splices the live array, and map() would then skip the next listener.
    const callbacks = [...(this.listeners[eventType] || [])];
    const promises = callbacks.map(async callback => {
      try {
        return await callback(data);
      } catch (error) {
        logger.error(`Error in event listener for ${eventType}`, error);
        return this.emit(AttackEventEmitter.Events.ATTACK_ERROR, {
          event: eventType,
          error,
        });
      }
    });

    await Promise.all(promises);
    eventData.handled = true;
    return eventData;
  }

  /**
   * Prevents the default action for an event.
   * Used to cancel attack progression.
   * @param {string} eventType - The event to prevent
   */
  preventDefault(eventType) {
    this.emit(AttackEventEmitter.Events.ATTACK_CANCEL, {
      cancelledEvent: eventType,
    });
  }

  /**
   * Removes all listeners for an event type.
   * @param {string} eventType - The event to clear (or undefined for all)
   */
  removeAllListeners(eventType) {
    if (eventType) {
      delete this.listeners[eventType];
    } else {
      this.listeners = {};
    }
  }

  /**
   * Gets the number of listeners for an event.
   * @param {string} eventType - The event type
   * @returns {number} Number of listeners
   */
  listenerCount(eventType) {
    return (this.listeners[eventType] || []).length;
  }

  /**
   * Records event in history for debugging.
   * @private
   */
  recordEvent(eventData) {
    this.eventHistory.push(eventData);

    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }
  }

  /**
   * Gets the event history.
   * @param {number} limit - Maximum number of events to return
   * @returns {Object[]} Array of recent events
   */
  getEventHistory(limit = 50) {
    return this.eventHistory.slice(-limit);
  }

  /**
   * Clears the event history.
   */
  clearEventHistory() {
    this.eventHistory = [];
  }

  /**
   * Gets statistics about events.
   * @returns {Object} Event statistics
   */
  getStats() {
    const stats = {};

    for (const [eventType, callbacks] of Object.entries(this.listeners)) {
      stats[eventType] = callbacks.length;
    }

    return {
      listenerCounts: stats,
      totalListeners: Object.values(stats).reduce((a, b) => a + b, 0),
      historySize: this.eventHistory.length,
      maxHistorySize: this.maxHistorySize,
    };
  }
}

/** Shared attack-event emitter instance. */
export const globalAttackEmitter = new AttackEventEmitter();
