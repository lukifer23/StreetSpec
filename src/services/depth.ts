import { get, set, del, keys } from 'idb-keyval';
import { compress, decompress } from 'lz-string';
import type { OnnxDepthMap, CameraParams } from '../types/common';

interface CachedDepthMap extends OnnxDepthMap {
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
function compressDepthData(data: number[]): { compressed: string; isCompressed: boolean } {
  const jsonString = JSON.stringify(data);
  if (jsonString.length > COMPRESSION_THRESHOLD) {
    const compressed = compress(jsonString);
    return { compressed, isCompressed: true };
  }
  return { compressed: jsonString, isCompressed: false };
}

// Decompress depth data if needed
function decompressDepthData(data: string, isCompressed: boolean): number[] {
  const jsonString = isCompressed ? decompress(data) : data;
  if (!jsonString) {
    throw new Error('Failed to decompress cached data');
  }
  return JSON.parse(jsonString);
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
        if (cached.compressed) {
          data = decompressDepthData(cached.data as any, cached.compressed);
        } else {
          data = cached.data;
        }
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
        data: compressedData.compressed,
        compressed: compressedData.isCompressed,
        sizeBytes: compressedData.compressed.length
      };
      await set(cacheKey, toStore);

      return {
        data,
        width: cached.width,
        height: cached.height
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
    const { compressed, isCompressed } = compressDepthData(depthMap.data);
    const sizeBytes = compressed.length;

    const toStore: CachedDepthMap = {
      data: isCompressed ? compressed : depthMap.data,
      width: depthMap.width,
      height: depthMap.height,
      lastUsed: Date.now(),
      compressed: isCompressed,
      sizeBytes
    };

    await set(cacheKey, toStore);
    console.log('[cache] Stored depth map for key:', cacheKey, isCompressed ? '(compressed)' : '(uncompressed)', `~${(sizeBytes / 1024).toFixed(1)}KB`);

    // Implement LRU by limiting cache size and memory usage
    await enforceCacheSizeLimit();
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
