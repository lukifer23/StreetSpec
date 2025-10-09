import type { CameraParams, OnnxDepthMap } from '../types/common';
import { cacheDepthMap, getCachedDepthMap } from './depth';
import { executeWithRateLimit } from './rateLimiter';

export async function blobToDataUrl(blob: Blob): Promise<string> {
  // Convert blob to base64 data URL for ONNX inference
  const arrayBuffer = await blob.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const base64 = buffer.toString('base64');
  const mimeType = blob.type || 'application/octet-stream';
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

export async function generateDepthMap(
  cameraParams: CameraParams,
  apiKey: string,
  deps: DepthGenerationDeps,
): Promise<DepthGenerationResult> {
  const getCache = deps.getCachedDepthMap ?? getCachedDepthMap;
  const setCache = deps.cacheDepthMap ?? cacheDepthMap;

  const cached = await getCache(cameraParams);
  if (cached) {
    return { depthMap: cached, fromCache: true };
  }

  const imgWidth = 640;
  const imgHeight = 640;

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

  await setCache(cameraParams, result);

  return { depthMap: result, fromCache: false };
}

export function createDepthMapFetcher() {
  return (url: string) => executeWithRateLimit('google-maps', () => fetch(url), { timeout: 15000 });
}
