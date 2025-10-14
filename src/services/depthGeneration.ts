import type { CameraParams, OnnxDepthMap } from '../types/common';
import { cacheDepthMap, getCachedDepthMap } from './depth';
import { executeWithRateLimit } from './rateLimiter';

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
          reject(new Error('Failed to read blob as data URL.'));
        }
      };
      reader.onerror = () => reject(reader.error ?? new Error('FileReader error.'));
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
    throw new Error('Base64 encoding is not supported in this environment.');
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
}

export interface DepthGenerationOptions {
  imageWidth?: number;
  imageHeight?: number;
  quality?: 'low' | 'medium' | 'high';
  enableCache?: boolean;
}

const QUALITY_SETTINGS = {
  low: { width: 320, height: 320 },
  medium: { width: 480, height: 480 },
  high: { width: 640, height: 640 }
};

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
      return { depthMap: cached, fromCache: true };
    }
  }

  // Determine image dimensions based on quality setting
  const quality = options.quality || 'high';
  const dimensions = QUALITY_SETTINGS[quality];
  const imgWidth = options.imageWidth || dimensions.width;
  const imgHeight = options.imageHeight || dimensions.height;

  const apiUrl = `https://maps.googleapis.com/maps/api/streetview?` +
    `size=${imgWidth}x${imgHeight}&` +
    (cameraParams.panoId
      ? `pano=${cameraParams.panoId}&`
      : `location=${cameraParams.lat},${cameraParams.lng}&`) +
    `heading=${cameraParams.heading ?? 0}&` +
    `pitch=${cameraParams.pitch ?? 0}&` +
    `fov=${cameraParams.fov ?? 90}&` +
    `key=${apiKey}`;

  const response = await deps.fetchImage(apiUrl);

  if (!response.ok) {
    throw new Error(`Static API request failed: ${response.status} ${response.statusText}`);
  }

  const imageBlob = await response.blob();
  const base64data = await blobToDataUrl(imageBlob);

  const result = await deps.invokeDepth(base64data);

  if (!result?.data || !result?.width || !result?.height) {
    throw new Error('Main process failed to return valid depth map data.');
  }

  // Only cache if enabled and quality is not explicitly set to avoid cache fragmentation
  if (options.enableCache !== false) {
    await setCache(cameraParams, result);
  }

  return { depthMap: result, fromCache: false };
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
  const concurrency = options.concurrency || 3; // Process up to 3 at a time
  const results: DepthGenerationResult[] = [];

  // Process in batches to avoid overwhelming the system
  for (let i = 0; i < cameraParamsList.length; i += concurrency) {
    const batch = cameraParamsList.slice(i, i + concurrency);

    const batchPromises = batch.map(async (cameraParams) => {
      try {
        return await generateDepthMap(cameraParams, apiKey, deps, options);
      } catch (error) {
        console.warn(`Failed to generate depth map for pano ${cameraParams.panoId}:`, error);
        return null;
      }
    });

    const batchResults = await Promise.allSettled(batchPromises);
    const successfulResults = batchResults
      .filter((result): result is PromiseFulfilledResult<DepthGenerationResult> =>
        result.status === 'fulfilled' && result.value !== null
      )
      .map(result => result.value);

    results.push(...successfulResults);

    // Small delay between batches to prevent overwhelming
    if (i + concurrency < cameraParamsList.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  return results;
}
