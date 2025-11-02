import type { CameraParams } from '../types/common';
import { generateDepthMap, createDepthMapFetcher, type DepthGenerationDeps } from './depthGeneration';
import { getCachedDepthMap, cacheDepthMap } from './depth';
import { getRateLimitStatus } from './rateLimiter';

/**
 * Depth map prefetching service for predictive loading
 * Improves perceived performance by pre-generating depth maps for likely next panoramas
 */

interface PrefetchOptions {
  maxConcurrent?: number;
  enableCache?: boolean;
  quality?: 'low' | 'medium' | 'high';
}

interface PrefetchTask {
  panoId: string;
  cameraParams: CameraParams;
  promise: Promise<void>;
  status: 'pending' | 'complete' | 'failed';
}

class DepthPrefetchService {
  private activeTasks: Map<string, PrefetchTask> = new Map();
  private readonly maxConcurrent: number = 2; // Conservative to avoid overwhelming system
  private apiKey: string = '';
  private deps: DepthGenerationDeps | null = null;
  private lastPrefetchTimestamp = 0;
  private readonly prefetchCooldownMs = 3000;

  /**
   * Initialize the prefetch service
   */
  init(apiKey: string) {
    this.apiKey = apiKey;
    this.deps = {
      fetchImage: createDepthMapFetcher(),
      getCachedDepthMap,
      cacheDepthMap,
      invokeDepth: async (base64data: string) => {
        if (!window.electronAPI?.invoke) {
          throw new Error('Electron IPC not available');
        }
        return await window.electronAPI.invoke('infer-depth', base64data);
      }
    };
  }

  private getConcurrencyBudget(maxConcurrent: number): number {
    const defaultBudget = Math.max(1, maxConcurrent);
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number') {
        const halfOfCores = Math.max(1, Math.floor(navigator.hardwareConcurrency / 2));
        return Math.max(1, Math.min(maxConcurrent, halfOfCores));
      }
    } catch (error) {
      console.warn('[DepthPrefetch] Failed to read hardware concurrency:', error);
    }
    return defaultBudget;
  }

  /**
   * Prefetch depth maps for adjacent panoramas
   * @param currentPanoId Current panorama ID
   * @param adjacentPanoIds List of adjacent panorama IDs (e.g. from Street View links)
   * @param cameraParams Base camera parameters (heading/pitch will be adjusted per pano)
   * @param options Prefetch options
   */
  async prefetchAdjacent(
    currentPanoId: string,
    adjacentPanoIds: string[],
    cameraParams: CameraParams,
    options: PrefetchOptions = {}
  ): Promise<void> {
    if (!this.deps || !this.apiKey) {
      console.warn('[DepthPrefetch] Service not initialized');
      return;
    }

    const { maxConcurrent = this.maxConcurrent, enableCache = true, quality = 'medium' } = options;

    const concurrencyBudget = this.getConcurrencyBudget(maxConcurrent);
    const availableSlots = Math.max(0, concurrencyBudget - this.activeTasks.size);

    if (availableSlots <= 0) {
      console.log('[DepthPrefetch] Skipping prefetch - no available concurrency budget');
      return;
    }

    const now = Date.now();
    if (now - this.lastPrefetchTimestamp < this.prefetchCooldownMs) {
      console.log('[DepthPrefetch] Skipping prefetch - cooldown active');
      return;
    }

    const rateStatus = getRateLimitStatus('google-maps');
    if (rateStatus) {
      const atCapacity = rateStatus.circuitOpen || rateStatus.requests >= rateStatus.maxRequests;
      if (atCapacity) {
        console.log('[DepthPrefetch] Skipping prefetch - rate limiter at capacity');
        return;
      }
    }

    // Filter out panos that are already being prefetched or current pano
    const panosToPrefetch = adjacentPanoIds
      .filter(id => id !== currentPanoId && !this.activeTasks.has(id))
      .slice(0, availableSlots); // Limit to available concurrency slots

    if (panosToPrefetch.length === 0) {
      return;
    }

    this.lastPrefetchTimestamp = now;

    console.log(`[DepthPrefetch] Prefetching ${panosToPrefetch.length} adjacent panos`);

    // Start prefetch tasks
    for (const panoId of panosToPrefetch) {
      this.startPrefetchTask(panoId, cameraParams, { enableCache, quality });
      // Opportunistically request Street View depth planes for panoId (renderer->main IPC)
      try {
        if (window.electronAPI?.invoke) {
          // fire-and-forget, renderer will not use response directly
          window.electronAPI.invoke('fetch-depth-data', { panoId }).catch(() => {});
        }
      } catch {
        // ignore prefetch plane errors
      }
    }
  }

  /**
   * Start a single prefetch task
   */
  private startPrefetchTask(
    panoId: string,
    baseCameraParams: CameraParams,
    options: { enableCache: boolean; quality: 'low' | 'medium' | 'high' }
  ): void {
    if (!this.deps) return;

    const taskCameraParams: CameraParams = {
      ...baseCameraParams,
      panoId,
      // Use default heading/pitch since we don't know exact view direction yet
      heading: baseCameraParams.heading ?? 0,
      pitch: baseCameraParams.pitch ?? 0
    };

    const task: PrefetchTask = {
      panoId,
      cameraParams: taskCameraParams,
      status: 'pending',
      promise: this.executePrefetch(panoId, taskCameraParams, options)
    };

    this.activeTasks.set(panoId, task);

    // Cleanup after completion
    task.promise.finally(() => {
      setTimeout(() => {
        this.activeTasks.delete(panoId);
      }, 5000); // Keep task reference for 5 seconds to avoid duplicate prefetches
    });
  }

  /**
   * Execute the actual prefetch operation
   */
  private async executePrefetch(
    panoId: string,
    cameraParams: CameraParams,
    options: { enableCache: boolean; quality: 'low' | 'medium' | 'high' }
  ): Promise<void> {
    if (!this.deps) return;

    try {
      // Check if already cached
      if (options.enableCache) {
        const cached = await getCachedDepthMap(cameraParams);
        if (cached) {
          console.log(`[DepthPrefetch] ${panoId} already cached, skipping`);
          const task = this.activeTasks.get(panoId);
          if (task) task.status = 'complete';
          return;
        }
      }

      // Generate depth map in background
      console.log(`[DepthPrefetch] Starting prefetch for ${panoId}`);
      await generateDepthMap(cameraParams, this.apiKey, this.deps, {
        enableCache: options.enableCache,
        quality: options.quality
      });

      const task = this.activeTasks.get(panoId);
      if (task) task.status = 'complete';
      console.log(`[DepthPrefetch] Completed prefetch for ${panoId}`);
    } catch (error) {
      // Silent failure for prefetches - don't disrupt user experience
      console.warn(`[DepthPrefetch] Failed to prefetch ${panoId}:`, error);
      const task = this.activeTasks.get(panoId);
      if (task) task.status = 'failed';
    }
  }

  /**
   * Warm cache by prefetching common panoramas or panoramas from a route
   */
  async warmCache(
    panoIds: string[],
    cameraParams: CameraParams,
    options: PrefetchOptions & { priority?: 'high' | 'medium' | 'low' } = {}
  ): Promise<void> {
    if (!this.deps || !this.apiKey) {
      console.warn('[DepthPrefetch] Service not initialized');
      return;
    }

    const { maxConcurrent = this.maxConcurrent, enableCache = true, quality = 'medium', priority = 'medium' } = options;
    
    // Prioritize based on priority level
    const priorityPanoIds = priority === 'high' 
      ? panoIds.slice(0, Math.min(5, panoIds.length))
      : panoIds;

    // Check cache first
    const uncachedPanos: string[] = [];
    for (const panoId of priorityPanoIds) {
      if (this.activeTasks.has(panoId)) continue;
      
      const checkParams: CameraParams = { ...cameraParams, panoId };
      const cached = await getCachedDepthMap(checkParams);
      if (!cached) {
        uncachedPanos.push(panoId);
      }
    }

    if (uncachedPanos.length === 0) {
      console.log('[DepthPrefetch] Cache warm - all panoramas already cached');
      return;
    }

    console.log(`[DepthPrefetch] Warming cache for ${uncachedPanos.length} panoramas`);
    
    // Process in batches with adaptive concurrency
    const concurrencyBudget = this.getConcurrencyBudget(maxConcurrent);
    for (let i = 0; i < uncachedPanos.length; i += concurrencyBudget) {
      const batch = uncachedPanos.slice(i, i + concurrencyBudget);
      await Promise.allSettled(
        batch.map(panoId => 
          this.startPrefetchTask(panoId, cameraParams, { enableCache, quality }).promise
        )
      );
      
      // Small delay between batches to avoid overwhelming the system
      if (i + concurrencyBudget < uncachedPanos.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
  }

  /**
   * Cancel all active prefetch tasks
   */
  cancelAll(): void {
    console.log('[DepthPrefetch] Cancelling all active prefetch tasks');
    this.activeTasks.clear();
  }

  /**
   * Get status of active prefetch tasks
   */
  getStatus(): {
    active: number;
    pending: number;
    complete: number;
    failed: number;
  } {
    const tasks = Array.from(this.activeTasks.values());
    return {
      active: tasks.length,
      pending: tasks.filter(t => t.status === 'pending').length,
      complete: tasks.filter(t => t.status === 'complete').length,
      failed: tasks.filter(t => t.status === 'failed').length
    };
  }
}

// Export singleton instance
export const depthPrefetchService = new DepthPrefetchService();

// Export helper function for easy use
export async function prefetchAdjacentDepthMaps(
  currentPanoId: string,
  adjacentPanoIds: string[],
  cameraParams: CameraParams,
  apiKey: string,
  options?: PrefetchOptions
): Promise<void> {
  depthPrefetchService.init(apiKey);
  await depthPrefetchService.prefetchAdjacent(currentPanoId, adjacentPanoIds, cameraParams, options);
}

