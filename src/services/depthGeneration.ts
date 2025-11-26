import type { CameraParams, OnnxDepthMap } from '../types/common';
import { cacheDepthMap, getCachedDepthMap } from './depth';
import { executeWithRateLimit, getRateLimitStatus } from './rateLimiter';
import {
  createModelInferenceError,
  createNetworkError
} from '../utils/errorUtils';

export async function blobToDataUrl(blob: Blob): Promise<string> {
  const mimeType = blob.type || 'application/octet-stream';

  if (typeof FileReader !== 'undefined') {
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (typeof result === 'string') {
          resolve(result);
        } else {
          reject(createModelInferenceError(
            'Failed to read blob as data URL - result is not a string',
            { resultType: typeof result }
          ));
        }
      };
      reader.onerror = () => {
        const error = reader.error ?? new Error('FileReader error');
        reject(createModelInferenceError(
          'Failed to read blob as data URL',
          { error: error instanceof Error ? error.message : String(error) }
        ));
      };
      reader.readAsDataURL(blob);
    });
  }

  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  if (typeof btoa !== 'function') {
    throw createModelInferenceError(
      'Base64 encoding is not supported in this environment',
      { environment: typeof window !== 'undefined' ? 'browser' : 'node' }
    );
  }

  const base64 = btoa(binary);
  return `data:${mimeType};base64,${base64}`;
}


export interface DepthGenerationDeps {
  fetchImage: (url: string) => Promise<Response>;
  getCachedDepthMap?: typeof getCachedDepthMap;
  cacheDepthMap?: typeof cacheDepthMap;
  invokeDepth: (base64DataUrl: string) => Promise<OnnxDepthMap | null>;
}

export interface DepthGenerationResult {
  depthMap: OnnxDepthMap;
  fromCache: boolean;
  rateLimitStatus?: {
    googleMaps?: ReturnType<typeof getRateLimitStatus>;
    depthGeneration?: ReturnType<typeof getRateLimitStatus>;
  };
}

export interface DepthGenerationOptions {
  imageWidth?: number;
  imageHeight?: number;
  quality?: 'low' | 'medium' | 'high';
  enableCache?: boolean;
  progressive?: boolean; // Start with low quality, upgrade if needed
  onProgress?: (progress: { stage: 'fetching' | 'processing' | 'complete'; quality?: 'low' | 'medium' | 'high' }) => void;
  viewportWidth?: number;
  viewportHeight?: number;
}

const QUALITY_SETTINGS = {
  low: { width: 320, height: 320 },
  medium: { width: 480, height: 480 },
  high: { width: 640, height: 640 }
};

const getDepthRateLimitStatus = () => ({
  googleMaps: getRateLimitStatus('google-maps'),
  depthGeneration: getRateLimitStatus('depth-generation')
});

export async function generateDepthMap(
  cameraParams: CameraParams,
  apiKey: string,
  deps: DepthGenerationDeps,
  options: DepthGenerationOptions = {}
): Promise<DepthGenerationResult> {
  const getCache = deps.getCachedDepthMap ?? getCachedDepthMap;
  const setCache = deps.cacheDepthMap ?? cacheDepthMap;

  // Use cache if enabled (default behavior)
  if (options.enableCache !== false) {
    const cached = await getCache(cameraParams);
    if (cached) {
      return { depthMap: cached, fromCache: true, rateLimitStatus: getDepthRateLimitStatus() };
    }
  }

  // Progressive loading: start with lower quality if requested
  const targetQuality = options.quality || 'high';
  let currentQuality: 'low' | 'medium' | 'high' = targetQuality;
  
  if (options.progressive && targetQuality !== 'low') {
    // Start with medium quality for faster initial load
    currentQuality = targetQuality === 'high' ? 'medium' : 'low';
    options.onProgress?.({ stage: 'fetching', quality: currentQuality });
  } else {
    options.onProgress?.({ stage: 'fetching', quality: currentQuality });
  }

  // Generate initial depth map
  let result: OnnxDepthMap | null = null;
  let attempts = 0;
  const maxAttempts = options.progressive && targetQuality === 'high' ? 2 : 1;

  while (attempts < maxAttempts && (!result || (options.progressive && currentQuality !== targetQuality))) {
    const dimensions = QUALITY_SETTINGS[currentQuality];
    const imgWidth = options.imageWidth || dimensions.width;
    const imgHeight = options.imageHeight || dimensions.height;

    const rawFov = cameraParams.fov ?? 90;
    const clampedFov = Math.min(Math.max(rawFov, 1), 120);

    if (clampedFov !== rawFov) {
      console.warn(`[DepthGeneration] Clamping FOV from ${rawFov} to ${clampedFov}`);
    }

    const apiUrl = `https://maps.googleapis.com/maps/api/streetview?` +
      `size=${imgWidth}x${imgHeight}&` +
      (cameraParams.panoId
        ? `pano=${cameraParams.panoId}&`
        : `location=${cameraParams.lat},${cameraParams.lng}&`) +
      `heading=${cameraParams.heading ?? 0}&` +
      `pitch=${cameraParams.pitch ?? 0}&` +
      `fov=${clampedFov}&` +
      `key=${apiKey}`;

    try {
      options.onProgress?.({ stage: 'fetching', quality: currentQuality });
      const response = await executeWithRateLimit('google-maps', () => deps.fetchImage(apiUrl), {
        timeout: 15000
      });

      if (!response.ok) {
        throw createNetworkError(
          `Static API request failed: ${response.status} ${response.statusText}`,
          { status: response.status, statusText: response.statusText, url: apiUrl }
        );
      }

      const imageBlob = await response.blob();
      const base64data = await blobToDataUrl(imageBlob);

      options.onProgress?.({ stage: 'processing', quality: currentQuality });
      const inferenceResult = await executeWithRateLimit('depth-generation', () => deps.invokeDepth(base64data), {
        timeout: 60000
      });

      if (!inferenceResult?.data || !inferenceResult?.width || !inferenceResult?.height) {
        throw createModelInferenceError(
          'Main process failed to return valid depth map data',
          { inferenceResult }
        );
      }

      const baseTransform = inferenceResult.transform ?? {
        originalWidth: options.imageWidth || dimensions.width,
        originalHeight: options.imageHeight || dimensions.height,
        resizedWidth: inferenceResult.width,
        resizedHeight: inferenceResult.height,
        scaleX: inferenceResult.width / (options.imageWidth || dimensions.width),
        scaleY: inferenceResult.height / (options.imageHeight || dimensions.height),
        offsetX: 0,
        offsetY: 0
      };

      const transform = {
        ...baseTransform,
        originalWidth: options.viewportWidth || baseTransform.originalWidth,
        originalHeight: options.viewportHeight || baseTransform.originalHeight,
        resizedWidth: baseTransform.resizedWidth ?? inferenceResult.width,
        resizedHeight: baseTransform.resizedHeight ?? inferenceResult.height,
        scaleX:
          baseTransform.scaleX ??
          ((baseTransform.resizedWidth ?? inferenceResult.width) /
            (options.viewportWidth || baseTransform.originalWidth)),
        scaleY:
          baseTransform.scaleY ??
          ((baseTransform.resizedHeight ?? inferenceResult.height) /
            (options.viewportHeight || baseTransform.originalHeight)),
        offsetX: baseTransform.offsetX ?? 0,
        offsetY: baseTransform.offsetY ?? 0
      } as OnnxDepthMap['transform'];

      result = { ...inferenceResult, transform };

      // If progressive and we got a lower quality result, upgrade to target quality
      if (options.progressive && currentQuality !== targetQuality && attempts === 0) {
        // Cache the lower quality result for quick access
        if (options.enableCache !== false) {
          await setCache(cameraParams, result);
        }
        
        // Upgrade to target quality
        currentQuality = targetQuality;
        attempts++;
        // Continue loop to generate high quality version
      } else {
        // Done - cache final result
        if (options.enableCache !== false) {
          await setCache(cameraParams, result);
        }
        break;
      }
    } catch (error) {
      // If progressive loading fails on upgrade, return lower quality result
      if (options.progressive && result && attempts > 0) {
        console.warn('[DepthGeneration] Progressive upgrade failed, using lower quality result:', error);
        break;
      }
      if (error && typeof error === 'object') {
        (error as { rateLimitStatus?: ReturnType<typeof getDepthRateLimitStatus> }).rateLimitStatus = getDepthRateLimitStatus();
      }
      throw error;
    }
  }

  if (!result) {
    throw createModelInferenceError(
      'Failed to generate depth map',
      { cameraParams, quality: targetQuality }
    );
  }

  options.onProgress?.({ stage: 'complete', quality: currentQuality });
  return { depthMap: result, fromCache: false, rateLimitStatus: getDepthRateLimitStatus() };
}

export function createDepthMapFetcher() {
  return (url: string) => executeWithRateLimit('google-maps', () => fetch(url), { timeout: 15000 });
}

// Batch depth map generation for multiple camera positions
export async function generateBatchDepthMaps(
  cameraParamsList: CameraParams[],
  apiKey: string,
  deps: DepthGenerationDeps,
  options: DepthGenerationOptions & { concurrency?: number } = {}
): Promise<DepthGenerationResult[]> {
  // Adaptive concurrency based on available resources
  const getConcurrency = (): number => {
    if (options.concurrency) {
      return options.concurrency;
    }
    // Check if we're in a worker or main thread with limited resources
    if (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) {
      // Use 1/4 of available cores, minimum 2, maximum 4
      return Math.max(2, Math.min(4, Math.floor(navigator.hardwareConcurrency / 4)));
    }
    return 3; // Default fallback
  };

  const concurrency = getConcurrency();
  const results: DepthGenerationResult[] = [];
  const errors: Array<{ panoId?: string; error: unknown }> = [];

  // Pre-check cache for all params to avoid unnecessary processing
  const getCache = deps.getCachedDepthMap ?? getCachedDepthMap;
  const cacheChecks = await Promise.allSettled(
    cameraParamsList.map(async (params) => {
      if (options.enableCache !== false) {
        const cached = await getCache(params);
        if (cached) {
          return {
            params,
            cached: true,
            result: { depthMap: cached, fromCache: true, rateLimitStatus: getDepthRateLimitStatus() }
          };
        }
      }
      return { params, cached: false };
    })
  );

  // Separate cached and uncached items
  const cachedResults: DepthGenerationResult[] = [];
  const uncachedParams: CameraParams[] = [];

  cacheChecks.forEach((check, index) => {
    if (check.status === 'fulfilled' && check.value.cached) {
      cachedResults.push(check.value.result);
    } else {
      uncachedParams.push(cameraParamsList[index]!);
    }
  });

  results.push(...cachedResults);

  // Process uncached items in batches with progress tracking

  for (let i = 0; i < uncachedParams.length; i += concurrency) {
    const batch = uncachedParams.slice(i, i + concurrency);
    
    // Selective quality: use lower quality for batch processing unless explicitly requested
    const batchOptions: DepthGenerationOptions = {
      ...options,
      quality: options.quality || 'medium', // Default to medium for batch
      progressive: options.progressive ?? false,
      onProgress: options.onProgress ? (progress) => {
        // Report progress with batch context
        options.onProgress?.({
          ...progress,
          // Could add batch metadata here if needed
        });
      } : undefined
    };

    const batchPromises = batch.map(async (cameraParams) => {
      try {
        return await generateDepthMap(cameraParams, apiKey, deps, batchOptions);
      } catch (error) {
        errors.push({ panoId: cameraParams.panoId, error });
        console.error(`[batch] Failed to generate depth map for pano ${cameraParams.panoId}:`, error);
        return null;
      }
    });
    
    const batchResults = await Promise.allSettled(batchPromises);
    const successfulResults = batchResults
      .filter((result): result is PromiseFulfilledResult<DepthGenerationResult | null> => 
        result.status === 'fulfilled' && result.value !== null
      )
      .map(result => result.value!);
    
    results.push(...successfulResults);

    // Adaptive delay between batches: shorter if success rate is high
    if (i + concurrency < uncachedParams.length) {
      const successRate = successfulResults.length / batch.length;
      const delay = successRate > 0.8 ? 50 : successRate > 0.5 ? 100 : 200; // Faster if mostly successful
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  if (errors.length > 0) {
    console.warn(`[batch] Completed with ${errors.length} error(s) out of ${cameraParamsList.length} total`);
  }

  return results;
}
