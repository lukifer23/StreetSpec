import { get, set, del, keys } from 'idb-keyval';
import { compress, decompress, compressToUTF16, decompressFromUTF16 } from 'lz-string';
import type { OnnxDepthMap, CameraParams } from '../types/common';
import {
  createStorageError,
  errorToAppError
} from '../utils/errorUtils';
import { UnifiedCache } from '../utils/cacheManager';
import { cacheRegistry } from '../utils/cacheManager';

// Memory monitoring utilities
interface MemoryStats {
  used: number;
  total: number;
  percentage: number;
}

function getMemoryUsage(): MemoryStats {
  if (typeof performance !== 'undefined' && (performance as any).memory) {
    const { usedJSHeapSize, totalJSHeapSize } = (performance as any).memory;
    return {
      used: usedJSHeapSize / (1024 * 1024), // Convert to MB
      total: totalJSHeapSize / (1024 * 1024),
      percentage: (usedJSHeapSize / totalJSHeapSize) * 100
    };
  }
  return { used: 0, total: 0, percentage: 0 };
}

function triggerGarbageCollection(): void {
  if (typeof global !== 'undefined' && global.gc) {
    global.gc();
  }
}

// Monitor memory usage and trigger cleanup if needed
let lastMemoryCheck = 0;

async function checkMemoryUsage(): Promise<void> {
  const now = Date.now();
  if (now - lastMemoryCheck < MEMORY_CHECK_INTERVAL) {
    return;
  }
  lastMemoryCheck = now;

  const memory = getMemoryUsage();
  if (memory.percentage > GC_TRIGGER_THRESHOLD * 100) {
    console.log(`[memory] High memory usage: ${memory.percentage.toFixed(1)}%, triggering cleanup`);
    triggerGarbageCollection();

    // If still high after GC, clear expired predictive cache first, then full cache if needed
    const postGC = getMemoryUsage();
    if (postGC.percentage > GC_TRIGGER_THRESHOLD * 100) {
      console.log(`[memory] Memory still high after GC: ${postGC.percentage.toFixed(1)}%, clearing expired predictive cache`);
      const expiredCount = await clearExpiredPredictiveCache();
      
      // Check again after clearing expired entries
      const afterExpired = getMemoryUsage();
      if (afterExpired.percentage > GC_TRIGGER_THRESHOLD * 100) {
        console.log(`[memory] Memory still high: ${afterExpired.percentage.toFixed(1)}%, clearing full cache`);
        await clearDepthCache();
      } else if (expiredCount > 0) {
        console.log(`[memory] Cleared ${expiredCount} expired entries, memory now at ${afterExpired.percentage.toFixed(1)}%`);
      }
    }
  }
}

interface CachedDepthMap {
  width: number;
  height: number;
  data: number[] | string;
  transform?: OnnxDepthMap['transform'];
  lastUsed: number;
  compressed: boolean;
  compressionFormat?: 'standard' | 'utf16'; // Track compression format
  sizeBytes: number;
  compressionRatio?: number; // Track compression efficiency
  isPredictive?: boolean; // Mark predictive cache entries
  predictiveTTL?: number; // TTL for predictive entries
}

// Cache configuration
const CACHE_VERSION = '1.3'; // Updated version for optimized compression and predictive caching
const CACHE_PREFIX = `depth_cache_${CACHE_VERSION}_`;
const MAX_CACHE_SIZE = 150; // Increased cache size with better compression
const MAX_MEMORY_MB = 300; // Maximum memory usage in MB (increased with better compression)
const COMPRESSION_THRESHOLD = 512; // Compress data larger than 512 bytes (lowered for better space efficiency)
const MEMORY_CHECK_INTERVAL = 30000; // Check memory every 30 seconds
const GC_TRIGGER_THRESHOLD = 0.8; // Trigger garbage collection when memory usage exceeds 80%
const PREDICTIVE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes TTL for predictive cache entries

const NUMERIC_PRECISION = 6;

// Register unified cache for depth maps
const depthCacheRegistry = new UnifiedCache<CachedDepthMap>({
  name: 'depth-maps',
  maxSize: MAX_CACHE_SIZE,
  maxMemoryBytes: MAX_MEMORY_MB * 1024 * 1024,
  ttl: 0, // No TTL by default (LRU handles eviction)
  evictionStrategy: 'lru'
});

cacheRegistry.register('depth-maps', depthCacheRegistry);


/**
 * Enhanced cache key generation using UnifiedCache key generation
 * Provides consistent key normalization and prevents collisions
 */
export interface DepthCacheKeyOptions {
  width?: number;
  height?: number;
  quality?: string;
}

function generateCacheKey(
  params: CameraParams,
  transform?: OnnxDepthMap['transform'],
  cacheOptions: DepthCacheKeyOptions = {}
): string {
  if (!params.panoId) {
    return '';
  }

  // Use UnifiedCache key generation for consistency
  const cacheParams: Record<string, unknown> = {
    panoId: params.panoId,
    heading: params.heading ?? 0,
    pitch: params.pitch ?? 0,
    fov: params.fov ?? 90,
    vFov: params.vFov ?? 90,
    zoom: params.zoom ?? 1,
    calibrationOffset: params.calibrationPitchOffsetDeg ?? 0
  };

  if (cacheOptions.width || cacheOptions.height) {
    cacheParams.dimensions = {
      width: cacheOptions.width,
      height: cacheOptions.height
    };
  }

  if (cacheOptions.quality) {
    cacheParams.quality = cacheOptions.quality;
  }

  // Add transform signature if available
  if (transform) {
    cacheParams.transform = {
      originalWidth: transform.originalWidth,
      originalHeight: transform.originalHeight,
      resizedWidth: transform.resizedWidth,
      resizedHeight: transform.resizedHeight,
      scaleX: transform.scaleX,
      scaleY: transform.scaleY,
      offsetX: transform.offsetX,
      offsetY: transform.offsetY
    };
  }

  // Generate normalized key using UnifiedCache method
  const normalizedKey = UnifiedCache.generateKey(CACHE_PREFIX, cacheParams, NUMERIC_PRECISION);
  
  // Validate key was generated successfully
  if (!normalizedKey || normalizedKey === CACHE_PREFIX) {
    console.warn('[cache] Failed to generate cache key');
    return '';
  }

  return normalizedKey;
}

/**
 * Enhanced compression with adaptive algorithm selection
 * Uses UTF16 compression for better compression ratios on large datasets
 */
function compressDepthData(
  data: number[]
): { payload: number[] | string; isCompressed: boolean; sizeBytes: number; compressionRatio: number } {
  const jsonString = JSON.stringify(data);
  const originalSize = jsonString.length * 2; // UTF-16 estimate
  
  if (jsonString.length > COMPRESSION_THRESHOLD) {
    // Try UTF16 compression first (better for large datasets)
    const utf16Compressed = compressToUTF16(jsonString);
    const utf16Size = utf16Compressed.length * 2;
    
    // Fallback to standard compression for smaller datasets
    const standardCompressed = compress(jsonString);
    const standardSize = standardCompressed.length;
    
    // Choose better compression method
    if (utf16Size < standardSize && jsonString.length > 10000) {
      // UTF16 is better for large datasets
      const compressionRatio = utf16Size / originalSize;
      return {
        payload: utf16Compressed,
        isCompressed: true,
        sizeBytes: utf16Size,
        compressionRatio
      };
    } else {
      // Standard compression for smaller or when it's better
      const compressionRatio = standardSize / originalSize;
      return {
        payload: standardCompressed,
        isCompressed: true,
        sizeBytes: standardSize,
        compressionRatio
      };
    }
  }
  
  return {
    payload: data,
    isCompressed: false,
    sizeBytes: data.length * 8, // Approximate bytes for Float64 array
    compressionRatio: 1.0
  };
}

/**
 * Enhanced decompression with support for multiple compression formats
 */
function decompressDepthData(
  data: number[] | string, 
  isCompressed: boolean,
  compressionFormat?: 'standard' | 'utf16'
): number[] {
  if (isCompressed) {
    if (typeof data !== 'string') {
      throw createStorageError(
        'STORAGE_LOAD_FAILED',
        'Expected compressed payload to be a string',
        { dataType: typeof data }
      );
    }
    
    let jsonString: string | null = null;
    
    // Try UTF16 decompression first if format is unknown or explicitly UTF16
    if (!compressionFormat || compressionFormat === 'utf16') {
      try {
        jsonString = decompressFromUTF16(data);
      } catch {
        // Fall back to standard decompression
      }
    }
    
    // Fallback to standard decompression
    if (!jsonString) {
      jsonString = decompress(data);
    }
    
    if (!jsonString) {
      throw createStorageError(
        'STORAGE_CORRUPTED',
        'Failed to decompress cached data',
        { dataLength: data.length }
      );
    }
    
    try {
      return JSON.parse(jsonString);
    } catch (parseError) {
      throw createStorageError(
        'STORAGE_CORRUPTED',
        'Failed to parse decompressed cached data',
        { parseError: errorToAppError(parseError).message }
      );
    }
  }

  if (Array.isArray(data)) {
    return data;
  }

  // Fallback for legacy uncompressed string payloads
  return JSON.parse(data as string);
}

/**
 * Get cached depth map with request deduplication and enhanced caching
 */
export async function getCachedDepthMap(
  params: CameraParams,
  transform?: OnnxDepthMap['transform'],
  cacheOptions: DepthCacheKeyOptions = {}
): Promise<OnnxDepthMap | null> {
  try {
    const cacheKey = generateCacheKey(params, transform, cacheOptions);
    if (!cacheKey) return null;

    // Check unified cache first (in-memory)
    const unifiedCacheEntry = depthCacheRegistry.get(cacheKey);
    if (unifiedCacheEntry) {
      // Check if predictive entry has expired
      if (unifiedCacheEntry.isPredictive && unifiedCacheEntry.predictiveTTL) {
        if (Date.now() > unifiedCacheEntry.predictiveTTL) {
          depthCacheRegistry.delete(cacheKey);
          await del(cacheKey);
        } else {
          console.log('[cache] Hit (in-memory) for key:', cacheKey);
          // Update last used
          unifiedCacheEntry.lastUsed = Date.now();
          const data = decompressDepthData(unifiedCacheEntry.data, unifiedCacheEntry.compressed, unifiedCacheEntry.compressionFormat);
          return {
            data,
            width: unifiedCacheEntry.width,
            height: unifiedCacheEntry.height,
            transform: unifiedCacheEntry.transform
          };
        }
      } else {
        console.log('[cache] Hit (in-memory) for key:', cacheKey);
        unifiedCacheEntry.lastUsed = Date.now();
        const data = decompressDepthData(unifiedCacheEntry.data, unifiedCacheEntry.compressed, unifiedCacheEntry.compressionFormat);
        return {
          data,
          width: unifiedCacheEntry.width,
          height: unifiedCacheEntry.height,
          transform: unifiedCacheEntry.transform
        };
      }
    }

    // Check IndexedDB cache
    const cached = (await get(cacheKey)) as CachedDepthMap | undefined;
    if (cached && cached.data && cached.width && cached.height) {
      // Check if predictive entry expired
      if (cached.isPredictive && cached.predictiveTTL && Date.now() > cached.predictiveTTL) {
        await del(cacheKey);
        return null;
      }

      console.log('[cache] Hit (IndexedDB) for key:', cacheKey);

      // Decompress data if needed
      let data: number[];
      try {
        data = decompressDepthData(cached.data, cached.compressed, cached.compressionFormat);
      } catch (error) {
        console.warn('[cache] Failed to decompress cached data, removing:', error);
        await del(cacheKey);
        depthCacheRegistry.delete(cacheKey);
        return null;
      }

      // Update last used timestamp and recompress with latest format
      cached.lastUsed = Date.now();
      const compressedData = compressDepthData(data);
      const toStore: CachedDepthMap = {
        ...cached,
        data: compressedData.payload,
        compressed: compressedData.isCompressed,
        compressionFormat: compressedData.isCompressed ? (compressedData.sizeBytes < 50000 ? 'standard' : 'utf16') : undefined,
        sizeBytes: compressedData.sizeBytes,
        compressionRatio: compressedData.compressionRatio
      };
      await set(cacheKey, toStore);
      
      // Update unified cache
      depthCacheRegistry.set(cacheKey, toStore);

      return {
        data,
        width: cached.width,
        height: cached.height,
        transform: cached.transform
      };
    }

    return null;
  } catch (error) {
    console.warn('[cache] Error reading from cache:', error);
    return null;
  }
}

/**
 * Cache depth map with enhanced compression and dual-layer caching
 */
export async function cacheDepthMap(
  params: CameraParams,
  depthMap: OnnxDepthMap,
  options: { isPredictive?: boolean; ttl?: number } & DepthCacheKeyOptions = {}
): Promise<void> {
  try {
    const cacheKey = generateCacheKey(params, depthMap.transform, options);
    if (!cacheKey) return;

    // Compress data with enhanced algorithm
    const compressionResult = compressDepthData(depthMap.data);
    const compressionFormat = compressionResult.isCompressed 
      ? (compressionResult.sizeBytes < 50000 ? 'standard' : 'utf16')
      : undefined;

    const now = Date.now();
    const toStore: CachedDepthMap = {
      data: compressionResult.payload,
      width: depthMap.width,
      height: depthMap.height,
      transform: depthMap.transform,
      lastUsed: now,
      compressed: compressionResult.isCompressed,
      compressionFormat,
      sizeBytes: compressionResult.sizeBytes,
      compressionRatio: compressionResult.compressionRatio,
      isPredictive: options?.isPredictive ?? false,
      predictiveTTL: options?.isPredictive && options?.ttl ? now + options.ttl : undefined
    };

    // Store in both IndexedDB and unified cache
    await set(cacheKey, toStore);
    depthCacheRegistry.set(cacheKey, toStore);
    
    const compressionInfo = compressionResult.isCompressed 
      ? `(compressed ${compressionFormat}, ratio: ${(compressionResult.compressionRatio * 100).toFixed(1)}%)`
      : '(raw)';
    console.log('[cache] Stored depth map for key:', cacheKey, compressionInfo, `~${(compressionResult.sizeBytes / 1024).toFixed(1)}KB`);

    // Implement LRU by limiting cache size and memory usage
    await enforceCacheSizeLimit();

    // Check memory usage after caching
    await checkMemoryUsage();
  } catch (error) {
    console.warn('[cache] Error writing to cache:', error);
  }
}

/**
 * Enhanced cache size enforcement with predictive cache prioritization
 * Predictive entries are evicted first, then LRU entries
 */
async function enforceCacheSizeLimit(): Promise<void> {
  try {
    const allKeys = await keys();
    const cacheKeys = allKeys.filter(key =>
      typeof key === 'string' && key.startsWith(CACHE_PREFIX)
    ) as string[];

    if (cacheKeys.length === 0) return;

    // Get all cache entries with metadata
    const cacheEntries = await Promise.all(
      cacheKeys.map(async key => {
        const item = (await get(key)) as CachedDepthMap | undefined;
        return {
          key,
          lastUsed: item?.lastUsed ?? 0,
          sizeBytes: item?.sizeBytes ?? 0,
          isPredictive: item?.isPredictive ?? false,
          expired: item?.predictiveTTL ? Date.now() > item.predictiveTTL : false
        };
      })
    );

    // Remove expired predictive entries first
    const expiredKeys = cacheEntries.filter(e => e.expired).map(e => e.key);
    if (expiredKeys.length > 0) {
      await Promise.all(expiredKeys.map(key => {
        depthCacheRegistry.delete(key);
        return del(key);
      }));
      console.log('[cache] Removed', expiredKeys.length, 'expired predictive entries');
    }

    // Filter out expired entries
    const validEntries = cacheEntries.filter(e => !e.expired);

    // Sort: predictive entries first (by lastUsed), then regular entries (by lastUsed)
    validEntries.sort((a, b) => {
      if (a.isPredictive !== b.isPredictive) {
        return a.isPredictive ? -1 : 1; // Predictive entries first
      }
      return a.lastUsed - b.lastUsed; // Then by LRU
    });

    // Calculate total memory usage
    const totalMemoryBytes = validEntries.reduce((sum, entry) => sum + entry.sizeBytes, 0);
    const totalMemoryMB = totalMemoryBytes / (1024 * 1024);

    // Remove entries to stay under limits
    const keysToRemove: string[] = [];

    // First, enforce memory limit (remove from least recently used, prioritizing predictive)
    if (totalMemoryMB > MAX_MEMORY_MB) {
      let currentMemory = totalMemoryBytes;
      for (const entry of validEntries) {
        if (currentMemory <= MAX_MEMORY_MB * 1024 * 1024) break;
        keysToRemove.push(entry.key);
        currentMemory -= entry.sizeBytes;
      }
    }
    // Then, enforce count limit (keeping most recently used)
    else if (validEntries.length > MAX_CACHE_SIZE) {
      const excessCount = validEntries.length - MAX_CACHE_SIZE;
      keysToRemove.push(...validEntries.slice(0, excessCount).map(entry => entry.key));
    }

    if (keysToRemove.length > 0) {
      await Promise.all(keysToRemove.map(key => {
        depthCacheRegistry.delete(key);
        return del(key);
      }));
      console.log('[cache] Removed', keysToRemove.length, 'entries (memory:', totalMemoryMB.toFixed(1), 'MB, count:', validEntries.length, ')');
    }
  } catch (error) {
    console.warn('[cache] Error enforcing cache size limit:', error);
  }
}

/**
 * Clear all cached depth maps (both IndexedDB and unified cache)
 */
export async function clearDepthCache(): Promise<void> {
  try {
    const allKeys = await keys();
    const cacheKeys = allKeys.filter(key => 
      typeof key === 'string' && key.startsWith(CACHE_PREFIX)
    ) as string[];
    
    // Clear from both IndexedDB and unified cache
    await Promise.all(cacheKeys.map(key => {
      depthCacheRegistry.delete(key);
      return del(key);
    }));
    
    console.log('[cache] Cleared', cacheKeys.length, 'cached depth maps');
  } catch (error) {
    console.warn('[cache] Error clearing cache:', error);
  }
}

/**
 * Enhanced cache statistics with compression metrics
 */
export async function getCacheStats(): Promise<{
  count: number;
  size: number;
  compressedCount: number;
  predictiveCount: number;
  avgCompressionRatio: number;
  memoryStats: ReturnType<typeof depthCacheRegistry.getStats>;
}> {
  try {
    const allKeys = await keys();
    const cacheKeys = allKeys.filter(key =>
      typeof key === 'string' && key.startsWith(CACHE_PREFIX)
    ) as string[];

    let totalSize = 0;
    let compressedCount = 0;
    let predictiveCount = 0;
    let totalCompressionRatio = 0;
    let compressionRatioCount = 0;

    for (const key of cacheKeys) {
      const cached = (await get(key)) as CachedDepthMap | undefined;
      if (cached) {
        totalSize += cached.sizeBytes;
        if (cached.compressed) {
          compressedCount++;
        }
        if (cached.isPredictive) {
          predictiveCount++;
        }
        if (cached.compressionRatio !== undefined) {
          totalCompressionRatio += cached.compressionRatio;
          compressionRatioCount++;
        }
      }
    }

    const unifiedStats = depthCacheRegistry.getStats();

    return {
      count: cacheKeys.length,
      size: totalSize,
      compressedCount,
      predictiveCount,
      avgCompressionRatio: compressionRatioCount > 0 ? totalCompressionRatio / compressionRatioCount : 1.0,
      memoryStats: unifiedStats
    };
  } catch (error) {
    console.warn('[cache] Error getting cache stats:', error);
    return {
      count: 0,
      size: 0,
      compressedCount: 0,
      predictiveCount: 0,
      avgCompressionRatio: 1.0,
      memoryStats: depthCacheRegistry.getStats()
    };
  }
}

/**
 * Prefetch and cache depth map for future use (predictive caching)
 */
export async function prefetchDepthMap(
  params: CameraParams,
  depthMap: OnnxDepthMap,
  ttl: number = PREDICTIVE_CACHE_TTL
): Promise<void> {
  await cacheDepthMap(params, depthMap, {
    isPredictive: true,
    ttl,
    width: depthMap.width,
    height: depthMap.height
  });
}

/**
 * Clear expired predictive cache entries
 */
export async function clearExpiredPredictiveCache(): Promise<number> {
  try {
    const allKeys = await keys();
    const cacheKeys = allKeys.filter(key =>
      typeof key === 'string' && key.startsWith(CACHE_PREFIX)
    ) as string[];

    const now = Date.now();
    const expiredKeys: string[] = [];

    for (const key of cacheKeys) {
      const cached = (await get(key)) as CachedDepthMap | undefined;
      if (cached?.isPredictive && cached.predictiveTTL && now > cached.predictiveTTL) {
        expiredKeys.push(key);
      }
    }

    if (expiredKeys.length > 0) {
      await Promise.all(expiredKeys.map(key => {
        depthCacheRegistry.delete(key);
        return del(key);
      }));
      console.log('[cache] Cleared', expiredKeys.length, 'expired predictive cache entries');
    }

    return expiredKeys.length;
  } catch (error) {
    console.warn('[cache] Error clearing expired predictive cache:', error);
    return 0;
  }
}
