import { get, set, del, keys } from 'idb-keyval';
import { OnnxDepthMap, CameraParams } from '../types/common';

interface CachedDepthMap extends OnnxDepthMap {
  lastUsed: number;
}

// Cache configuration
const CACHE_VERSION = '1.0';
const CACHE_PREFIX = `depth_cache_${CACHE_VERSION}_`;
const MAX_CACHE_SIZE = 50; // Maximum number of cached depth maps

// Generate cache key from camera parameters
function generateCacheKey(params: CameraParams): string {
  if (!params.panoId || !params.heading || !params.pitch || !params.fov) {
    return '';
  }
  
  return `${CACHE_PREFIX}${params.panoId}_${params.heading}_${params.pitch}_${params.fov}`;
}

// Check if depth map is cached
export async function getCachedDepthMap(params: CameraParams): Promise<OnnxDepthMap | null> {
  try {
    const cacheKey = generateCacheKey(params);
    if (!cacheKey) return null;
    
    const cached = (await get(cacheKey)) as CachedDepthMap | undefined;
    if (cached && cached.data && cached.width && cached.height) {
      console.log('[cache] Hit for key:', cacheKey);
      cached.lastUsed = Date.now();
      await set(cacheKey, cached);
      return cached;
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

    const toStore: CachedDepthMap = {
      data: depthMap.data,
      width: depthMap.width,
      height: depthMap.height,
      lastUsed: Date.now()
    };
    await set(cacheKey, toStore);
    console.log('[cache] Stored depth map for key:', cacheKey);
    
    // Implement LRU by limiting cache size
    await enforceCacheSizeLimit();
  } catch (error) {
    console.warn('[cache] Error writing to cache:', error);
  }
}

// Enforce cache size limit using LRU strategy
async function enforceCacheSizeLimit(): Promise<void> {
  try {
    const allKeys = await keys();
    const cacheKeys = allKeys.filter(key =>
      typeof key === 'string' && key.startsWith(CACHE_PREFIX)
    ) as string[];

    if (cacheKeys.length > MAX_CACHE_SIZE) {
      const cacheEntries = await Promise.all(
        cacheKeys.map(async key => {
          const item = (await get(key)) as CachedDepthMap | undefined;
          return { key, lastUsed: item?.lastUsed ?? 0 };
        })
      );

      cacheEntries.sort((a, b) => a.lastUsed - b.lastUsed);

      const keysToRemove = cacheEntries
        .slice(0, cacheEntries.length - MAX_CACHE_SIZE)
        .map(entry => entry.key);

      await Promise.all(keysToRemove.map(key => del(key)));
      console.log('[cache] Removed', keysToRemove.length, 'old entries');
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
export async function getCacheStats(): Promise<{ count: number; size: number }> {
  try {
    const allKeys = await keys();
    const cacheKeys = allKeys.filter(key => 
      typeof key === 'string' && key.startsWith(CACHE_PREFIX)
    ) as string[];
    
    let totalSize = 0;
    for (const key of cacheKeys) {
      const cached = await get(key);
      if (cached && cached.data) {
        totalSize += cached.data.length * 4; // Float32 = 4 bytes
      }
    }
    
    return {
      count: cacheKeys.length,
      size: totalSize
    };
  } catch (error) {
    console.warn('[cache] Error getting cache stats:', error);
    return { count: 0, size: 0 };
  }
}
