import { get, set, del, keys } from 'idb-keyval';
import { compress, decompress } from 'lz-string';
import type { OnnxDepthMap, CameraParams } from '../types/common';

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

    // If still high after GC, clear some cache
    const postGC = getMemoryUsage();
    if (postGC.percentage > GC_TRIGGER_THRESHOLD * 100) {
      console.log(`[memory] Memory still high after GC: ${postGC.percentage.toFixed(1)}%, clearing cache`);
      await clearDepthCache();
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
  sizeBytes: number;
}

// Cache configuration
const CACHE_VERSION = '1.1'; // Updated version for compression
const CACHE_PREFIX = `depth_cache_${CACHE_VERSION}_`;
const MAX_CACHE_SIZE = 100; // Increased cache size with compression
const MAX_MEMORY_MB = 200; // Maximum memory usage in MB
const COMPRESSION_THRESHOLD = 1024; // Compress data larger than 1KB
const MEMORY_CHECK_INTERVAL = 30000; // Check memory every 30 seconds
const GC_TRIGGER_THRESHOLD = 0.8; // Trigger garbage collection when memory usage exceeds 80%

const NUMERIC_PRECISION = 6;

function normalizeNumericParam(value: number | undefined | null): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return null;
  }

  return numericValue.toFixed(NUMERIC_PRECISION);
}

// Generate cache key from camera parameters
function generateCacheKey(params: CameraParams): string {
  if (!params.panoId) {
    return '';
  }

  const normalizedHeading = normalizeNumericParam(params.heading);
  const normalizedPitch = normalizeNumericParam(params.pitch);
  const normalizedFov = normalizeNumericParam(params.fov);

  if (!normalizedHeading || !normalizedPitch || !normalizedFov) {
    return '';
  }

  return `${CACHE_PREFIX}${params.panoId}_${normalizedHeading}_${normalizedPitch}_${normalizedFov}`;
}

// Compress depth data if needed
function compressDepthData(
  data: number[]
): { payload: number[] | string; isCompressed: boolean; sizeBytes: number } {
  const jsonString = JSON.stringify(data);
  if (jsonString.length > COMPRESSION_THRESHOLD) {
    const compressed = compress(jsonString);
    return {
      payload: compressed,
      isCompressed: true,
      sizeBytes: compressed.length
    };
  }
  return {
    payload: data,
    isCompressed: false,
    sizeBytes: data.length * 8 // Approximate bytes for Float64 array
  };
}

// Decompress depth data if needed
function decompressDepthData(data: number[] | string, isCompressed: boolean): number[] {
  if (isCompressed) {
    if (typeof data !== 'string') {
      throw new Error('Expected compressed payload to be a string');
    }
    const jsonString = decompress(data);
    if (!jsonString) {
      throw new Error('Failed to decompress cached data');
    }
    return JSON.parse(jsonString);
  }

  if (Array.isArray(data)) {
    return data;
  }

  // Fallback for legacy uncompressed string payloads
  return JSON.parse(data);
}

// Check if depth map is cached
export async function getCachedDepthMap(params: CameraParams): Promise<OnnxDepthMap | null> {
  try {
    const cacheKey = generateCacheKey(params);
    if (!cacheKey) return null;

    const cached = (await get(cacheKey)) as CachedDepthMap | undefined;
    if (cached && cached.data && cached.width && cached.height) {
      console.log('[cache] Hit for key:', cacheKey);

      // Decompress data if needed
      let data: number[];
      try {
        data = decompressDepthData(cached.data, cached.compressed);
      } catch (error) {
        console.warn('[cache] Failed to decompress cached data, removing:', error);
        await del(cacheKey);
        return null;
      }

      // Update last used timestamp
      cached.lastUsed = Date.now();
      const compressedData = compressDepthData(data);
      const toStore = {
        ...cached,
        data: compressedData.payload,
        compressed: compressedData.isCompressed,
        sizeBytes: compressedData.sizeBytes
      };
      await set(cacheKey, toStore);

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

// Cache depth map
export async function cacheDepthMap(params: CameraParams, depthMap: OnnxDepthMap): Promise<void> {
  try {
    const cacheKey = generateCacheKey(params);
    if (!cacheKey) return;

    // Compress data if beneficial
    const { payload, isCompressed, sizeBytes } = compressDepthData(depthMap.data);

    const toStore: CachedDepthMap = {
      data: payload,
      width: depthMap.width,
      height: depthMap.height,
      transform: depthMap.transform,
      lastUsed: Date.now(),
      compressed: isCompressed,
      sizeBytes
    };

    await set(cacheKey, toStore);
    console.log('[cache] Stored depth map for key:', cacheKey, isCompressed ? '(compressed)' : '(raw)', `~${(sizeBytes / 1024).toFixed(1)}KB`);

    // Implement LRU by limiting cache size and memory usage
    await enforceCacheSizeLimit();

    // Check memory usage after caching
    await checkMemoryUsage();
  } catch (error) {
    console.warn('[cache] Error writing to cache:', error);
  }
}

// Enforce cache size limit using LRU strategy and memory limits
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
          sizeBytes: item?.sizeBytes ?? 0
        };
      })
    );

    // Sort by last used (LRU)
    cacheEntries.sort((a, b) => a.lastUsed - b.lastUsed);

    // Calculate total memory usage
    const totalMemoryBytes = cacheEntries.reduce((sum, entry) => sum + entry.sizeBytes, 0);
    const totalMemoryMB = totalMemoryBytes / (1024 * 1024);

    // Remove entries to stay under limits
    const keysToRemove: string[] = [];

    // First, enforce memory limit
    if (totalMemoryMB > MAX_MEMORY_MB) {
      let currentMemory = totalMemoryBytes;
      for (const entry of cacheEntries) {
        if (currentMemory <= MAX_MEMORY_MB * 1024 * 1024) break;
        keysToRemove.push(entry.key);
        currentMemory -= entry.sizeBytes;
      }
    }
    // Then, enforce count limit (keeping most recently used)
    else if (cacheKeys.length > MAX_CACHE_SIZE) {
      const excessCount = cacheKeys.length - MAX_CACHE_SIZE;
      keysToRemove.push(...cacheEntries.slice(0, excessCount).map(entry => entry.key));
    }

    if (keysToRemove.length > 0) {
      await Promise.all(keysToRemove.map(key => del(key)));
      console.log('[cache] Removed', keysToRemove.length, 'entries (memory:', totalMemoryMB.toFixed(1), 'MB, count:', cacheKeys.length, ')');
    }
  } catch (error) {
    console.warn('[cache] Error enforcing cache size limit:', error);
  }
}

// Clear all cached depth maps
export async function clearDepthCache(): Promise<void> {
  try {
    const allKeys = await keys();
    const cacheKeys = allKeys.filter(key => 
      typeof key === 'string' && key.startsWith(CACHE_PREFIX)
    ) as string[];
    
    await Promise.all(cacheKeys.map(key => del(key)));
    console.log('[cache] Cleared', cacheKeys.length, 'cached depth maps');
  } catch (error) {
    console.warn('[cache] Error clearing cache:', error);
  }
}

// Get cache statistics
export async function getCacheStats(): Promise<{ count: number; size: number; compressedCount: number }> {
  try {
    const allKeys = await keys();
    const cacheKeys = allKeys.filter(key =>
      typeof key === 'string' && key.startsWith(CACHE_PREFIX)
    ) as string[];

    let totalSize = 0;
    let compressedCount = 0;

    for (const key of cacheKeys) {
      const cached = (await get(key)) as CachedDepthMap | undefined;
      if (cached) {
        totalSize += cached.sizeBytes;
        if (cached.compressed) {
          compressedCount++;
        }
      }
    }

    return {
      count: cacheKeys.length,
      size: totalSize,
      compressedCount
    };
  } catch (error) {
    console.warn('[cache] Error getting cache stats:', error);
    return { count: 0, size: 0, compressedCount: 0 };
  }
}
