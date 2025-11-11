/**
 * Unified cache management system
 * Provides consistent key generation, eviction strategies, and statistics across all caches
 */

export interface CacheConfig {
  maxSize: number;
  ttl?: number; // Time to live in milliseconds
  evictionStrategy: 'lru' | 'fifo' | 'lfu'; // Least Recently Used, First In First Out, Least Frequently Used
  name: string;
}

export interface CacheEntry<T> {
  value: T;
  timestamp: number;
  accessCount: number;
  lastAccessed: number;
  sizeBytes?: number;
}

export interface CacheStats {
  name: string;
  size: number;
  maxSize: number;
  hitCount: number;
  missCount: number;
  evictionCount: number;
  totalSizeBytes: number;
  hitRate: number;
}

/**
 * Unified cache manager with consistent eviction and statistics
 */
export class UnifiedCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private hitCount = 0;
  private missCount = 0;
  private evictionCount = 0;
  private config: CacheConfig;

  constructor(config: CacheConfig) {
    this.config = config;
  }

  /**
   * Generate normalized cache key from parameters
   */
  static generateKey(prefix: string, params: Record<string, unknown>, precision = 6): string {
    const normalized: Record<string, string> = {};
    
    for (const [key, value] of Object.entries(params)) {
      if (value === null || value === undefined) {
        normalized[key] = 'null';
      } else if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
          normalized[key] = 'inf';
        } else {
          // Round to specified precision to prevent floating-point collisions
          const rounded = Math.round(value * Math.pow(10, precision)) / Math.pow(10, precision);
          normalized[key] = rounded.toString();
        }
      } else if (typeof value === 'boolean') {
        normalized[key] = value ? 'true' : 'false';
      } else if (typeof value === 'string') {
        normalized[key] = value;
      } else if (Array.isArray(value)) {
        normalized[key] = JSON.stringify(value);
      } else if (typeof value === 'object') {
        // Handle nested objects (like Point, Vector3)
        if ('x' in value && 'y' in value) {
          const point = value as { x: number; y: number; z?: number };
          normalized[key] = `${normalizeNumber(point.x, precision)}_${normalizeNumber(point.y, precision)}${point.z !== undefined ? `_${normalizeNumber(point.z, precision)}` : ''}`;
        } else {
          normalized[key] = JSON.stringify(value);
        }
      } else {
        normalized[key] = String(value);
      }
    }

    const keyString = Object.entries(normalized)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${v}`)
      .join('|');

    return `${prefix}_${keyString}`;
  }

  /**
   * Normalize number for cache key
   */
  private static normalizeNumber(value: number, precision: number): string {
    if (!Number.isFinite(value)) {
      return 'inf';
    }
    const rounded = Math.round(value * Math.pow(10, precision)) / Math.pow(10, precision);
    return rounded.toString();
  }

  /**
   * Get value from cache
   */
  get(key: string): T | null {
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.missCount++;
      return null;
    }

    // Check TTL
    if (this.config.ttl && Date.now() - entry.timestamp > this.config.ttl) {
      this.cache.delete(key);
      this.missCount++;
      return null;
    }

    // Update access metadata
    entry.lastAccessed = Date.now();
    entry.accessCount++;
    this.hitCount++;
    
    return entry.value;
  }

  /**
   * Set value in cache
   */
  set(key: string, value: T, sizeBytes?: number): void {
    // Check if we need to evict
    if (this.cache.size >= this.config.maxSize && !this.cache.has(key)) {
      this.evict();
    }

    const entry: CacheEntry<T> = {
      value,
      timestamp: Date.now(),
      accessCount: 1,
      lastAccessed: Date.now(),
      sizeBytes
    };

    this.cache.set(key, entry);
  }

  /**
   * Delete entry from cache
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.cache.clear();
    this.hitCount = 0;
    this.missCount = 0;
    this.evictionCount = 0;
  }

  /**
   * Evict entries based on configured strategy
   */
  private evict(): void {
    if (this.cache.size === 0) return;

    let keyToEvict: string | null = null;

    switch (this.config.evictionStrategy) {
      case 'lru': {
        // Evict least recently accessed
        let oldestAccess = Infinity;
        for (const [key, entry] of this.cache.entries()) {
          if (entry.lastAccessed < oldestAccess) {
            oldestAccess = entry.lastAccessed;
            keyToEvict = key;
          }
        }
        break;
      }
      case 'fifo': {
        // Evict oldest entry (by timestamp)
        let oldestTimestamp = Infinity;
        for (const [key, entry] of this.cache.entries()) {
          if (entry.timestamp < oldestTimestamp) {
            oldestTimestamp = entry.timestamp;
            keyToEvict = key;
          }
        }
        break;
      }
      case 'lfu': {
        // Evict least frequently used
        let minAccessCount = Infinity;
        for (const [key, entry] of this.cache.entries()) {
          if (entry.accessCount < minAccessCount) {
            minAccessCount = entry.accessCount;
            keyToEvict = key;
          }
        }
        break;
      }
    }

    if (keyToEvict) {
      this.cache.delete(keyToEvict);
      this.evictionCount++;
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const totalRequests = this.hitCount + this.missCount;
    const hitRate = totalRequests > 0 ? this.hitCount / totalRequests : 0;
    
    const totalSizeBytes = Array.from(this.cache.values()).reduce(
      (sum, entry) => sum + (entry.sizeBytes ?? 0),
      0
    );

    return {
      name: this.config.name,
      size: this.cache.size,
      maxSize: this.config.maxSize,
      hitCount: this.hitCount,
      missCount: this.missCount,
      evictionCount: this.evictionCount,
      totalSizeBytes,
      hitRate
    };
  }

  /**
   * Get all cache keys
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Get cache size
   */
  size(): number {
    return this.cache.size;
  }
}

/**
 * Helper function to normalize number for cache keys
 */
function normalizeNumber(value: number, precision: number): string {
  if (!Number.isFinite(value)) {
    return 'inf';
  }
  const rounded = Math.round(value * Math.pow(10, precision)) / Math.pow(10, precision);
  return rounded.toString();
}

/**
 * Global cache registry for statistics and management
 */
class CacheRegistry {
  private caches = new Map<string, UnifiedCache<unknown>>();

  register<T>(name: string, cache: UnifiedCache<T>): void {
    this.caches.set(name, cache as UnifiedCache<unknown>);
  }

  unregister(name: string): void {
    this.caches.delete(name);
  }

  getAllStats(): CacheStats[] {
    return Array.from(this.caches.values()).map(cache => cache.getStats());
  }

  getStats(name: string): CacheStats | null {
    const cache = this.caches.get(name);
    return cache ? cache.getStats() : null;
  }

  clearAll(): void {
    for (const cache of this.caches.values()) {
      cache.clear();
    }
  }

  getTotalMemoryUsage(): number {
    return this.getAllStats().reduce((sum, stats) => sum + stats.totalSizeBytes, 0);
  }
}

export const cacheRegistry = new CacheRegistry();

