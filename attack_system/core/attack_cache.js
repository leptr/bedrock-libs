// Developed by: Petar Mijailovic (leptr)
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

/** @import { Entity } from "@minecraft/server" */
/**
 * Shared caching primitives for attack calculations and target lookups.
 */
const DEFAULT_ATTACK_CACHE_SIZE = 500;
const DAMAGE_CACHE_SIZE = 200;
const TARGET_CACHE_SIZE = 300;
const DAMAGE_CACHE_TTL_MS = 5000;
const TARGET_CACHE_TTL_MS = 1000;

/**
 * Generic cache used by attack-system helpers.
 */
export class AttackCache {
  /**
   * Generates a cache key from data parameters.
   * @private
   */
  static generateKey(...parameters) {
    return JSON.stringify(parameters);
  }

  constructor(maxSize = DEFAULT_ATTACK_CACHE_SIZE) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  /**
   * Gets a value from cache or computes and stores it.
   * @param {string} key - The cache key (or params to generate key)
   * @param {Function} computeFunction - Function to compute value if not cached
   * @param {number} [ttl] - Time-to-live in milliseconds
   * @returns {any} The cached or computed value
   */
  getOrCompute(key, computeFunction, ttl = undefined) {
    const actualKey =
      typeof key === "string" ? key : AttackCache.generateKey(key);

    if (this.cache.has(actualKey)) {
      const entry = this.cache.get(actualKey);

      if (ttl && entry.timestamp + ttl < Date.now()) {
        this.cache.delete(actualKey);
        this.misses++;
      } else {
        this.hits++;
        return entry.value;
      }
    }

    const value = computeFunction();

    this.set(actualKey, value, ttl);
    this.misses++;

    return value;
  }

  /**
   * Sets a value in the cache.
   * @param {string} key - The cache key
   * @param {any} value - The value to cache
   * @param {number} ttl - Time-to-live in milliseconds
   */
  set(key, value, ttl = undefined) {
    if (this.cache.size >= this.maxSize) {
      this.evictOldest();
    }

    this.cache.set(key, {
      value,
      ttl,
      timestamp: Date.now(),
    });
  }

  /**
   * Gets a value from cache.
   * @param {string} key - The cache key
   * @returns {any|undefined} The cached value or undefined if not found
   */
  get(key) {
    const entry = this.cache.get(key);

    if (!entry) {
      return undefined;
    }

    if (entry.ttl && entry.timestamp + entry.ttl < Date.now()) {
      this.cache.delete(key);
      return undefined;
    }

    this.hits++;
    return entry.value;
  }

  /**
   * Checks if a key exists in cache.
   * @param {string} key - The cache key
   * @returns {boolean}
   */
  has(key) {
    return this.cache.has(key);
  }

  /**
   * Removes a value from cache.
   * @param {string} key - The cache key
   * @returns {boolean} Whether the key was deleted
   */
  delete(key) {
    return this.cache.delete(key);
  }

  /**
   * Clears all cached values.
   */
  clear() {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  /**
   * Removes expired entries from cache.
   */
  prune() {
    const now = Date.now();
    let pruned = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (!(entry.ttl && entry.timestamp + entry.ttl < now)) {
        continue;
      }

      this.cache.delete(key);
      pruned++;
    }

    return pruned;
  }

  /**
   * Evicts the oldest entry from the cache.
   * @private
   */
  evictOldest() {
    let oldestKey;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.timestamp >= oldestTime) {
        continue;
      }

      oldestTime = entry.timestamp;
      oldestKey = key;
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.evictions++;
    }
  }

  /**
   * Gets cache statistics.
   * @returns {Object} Statistics object
   */
  getStats() {
    const total = this.hits + this.misses;
    const hitRate = total > 0 ? ((this.hits / total) * 100).toFixed(2) : 0;

    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: `${hitRate}%`,
      size: this.cache.size,
      maxSize: this.maxSize,
      evictions: this.evictions,
      total,
    };
  }

  /**
   * Gets the current cache size.
   * @returns {number}
   */
  getSize() {
    return this.cache.size;
  }

  /**
   * Gets all keys in cache.
   * @returns {string[]}
   */
  getKeys() {
    return [...this.cache.keys()];
  }
}

/** Shared general-purpose attack cache instance. */
export const globalAttackCache = new AttackCache(DEFAULT_ATTACK_CACHE_SIZE);

/** Cache specialization for repeated damage calculations. */
export class DamageCache extends AttackCache {
  constructor() {
    super(DAMAGE_CACHE_SIZE);
  }

  /**
   * Gets cached damage for a target.
   * @param {Entity} target - The target entity
   * @param {number} baseDamage - The base damage value
   * @param {Function} calculateFunction - Function to calculate damage if not cached
   * @returns {number} The calculated or cached damage
   */
  getDamage(target, baseDamage, calculateFunction) {
    const key = `dmg_${target.id}_${baseDamage}`;
    return this.getOrCompute(key, calculateFunction, DAMAGE_CACHE_TTL_MS);
  }

  /**
   * Invalidates damage cache for a specific target.
   * @param {Entity|string} target - The target entity or entity ID
   */
  invalidateTarget(target) {
    const targetId = typeof target === "string" ? target : target.id;
    const keysToDelete = [];

    for (const key of this.getKeys()) {
      if (key.includes(`dmg_${targetId}`)) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.delete(key);
    }
  }
}

/** Cache specialization for repeated target searches. */
export class TargetCache extends AttackCache {
  constructor() {
    super(TARGET_CACHE_SIZE);
  }

  /**
   * Gets cached targets for an attack.
   * @param {Entity} attacker - The attacking entity
   * @param {Object} attackOptions - Attack configuration
   * @param {Function} findFunction - Function to find targets if not cached
   * @returns {Entity[]} The found targets
   */
  getTargets(attacker, attackOptions, findFunction) {
    const key = `targets_${attacker.id}_${attackOptions.pattern}_${attackOptions.range}`;
    return this.getOrCompute(key, findFunction, TARGET_CACHE_TTL_MS);
  }

  /**
   * Invalidates target cache for a specific attacker.
   * @param {Entity|string} attacker - The attacking entity or entity ID
   */
  invalidateAttacker(attacker) {
    const attackerId = typeof attacker === "string" ? attacker : attacker.id;
    const keysToDelete = [];

    for (const key of this.getKeys()) {
      if (key.includes(`targets_${attackerId}`)) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.delete(key);
    }
  }
}

/** Shared damage-cache instance. */
export const globalDamageCache = new DamageCache();

/** Shared target-cache instance. */
export const globalTargetCache = new TargetCache();
