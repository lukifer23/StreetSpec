import { CameraParams, OnnxDepthMap } from '../types/common';

// Size of square kernel (odd number)
const KERNEL_SIZE = 5; // 5×5 neighborhood

const USE_BILINEAR = true;

// Gather a neighbourhood of depth values around (x,y) and return a robust estimate (median)
function getRobustDepthSample(
  mapX: number,
  mapY: number,
  depthMap: OnnxDepthMap,
  debug = false,
): number | null {
  const half = Math.floor(KERNEL_SIZE / 2);
  const vals: number[] = [];

  for (let dy = -half; dy <= half; dy++) {
    const yy = mapY + dy;
    if (yy < 0 || yy >= depthMap.height) continue;
    for (let dx = -half; dx <= half; dx++) {
      const xx = mapX + dx;
      if (xx < 0 || xx >= depthMap.width) continue;
      const idx = yy * depthMap.width + xx;
      const v = depthMap.data[idx];
      if (v && v > 0 && Number.isFinite(v)) vals.push(v);
    }
  }

  if (vals.length === 0) return null;
  // median
  vals.sort((a, b) => a - b);
  const mid = Math.floor(vals.length / 2);
  const depth = vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
  if (debug) {
    console.log('[depth] samples', vals.length, 'median', depth);
  }
  return depth;
}

// Bilinear interpolation for sub-pixel depth sampling
function getBilinearDepthSample(
  mapX: number,
  mapY: number,
  depthMap: OnnxDepthMap
): number | null {
  const x0 = Math.floor(mapX);
  const y0 = Math.floor(mapY);
  const x1 = Math.min(x0 + 1, depthMap.width - 1);
  const y1 = Math.min(y0 + 1, depthMap.height - 1);
  const dx = mapX - x0;
  const dy = mapY - y0;

  const i00 = y0 * depthMap.width + x0;
  const i10 = y0 * depthMap.width + x1;
  const i01 = y1 * depthMap.width + x0;
  const i11 = y1 * depthMap.width + x1;

  const v00 = depthMap.data[i00];
  const v10 = depthMap.data[i10];
  const v01 = depthMap.data[i01];
  const v11 = depthMap.data[i11];
  if ([v00, v10, v01, v11].some(v => !v || !Number.isFinite(v))) return null;

  const v0 = v00 * (1 - dx) + v10 * dx;
  const v1 = v01 * (1 - dx) + v11 * dx;
  return v0 * (1 - dy) + v1 * dy;
}

/**
 * Estimates the distance from the camera to a point corresponding to a pixel click
 * using the provided ONNX depth map.
 * 
 * @param pixelX The horizontal pixel coordinate (from left of viewport).
 * @param pixelY The vertical pixel coordinate (from top of viewport).
 * @param viewportWidth The total width of the viewport in pixels.
 * @param viewportHeight The total height of the viewport in pixels.
 * @param cameraParams Current camera parameters (used for logging).
 * @param depthMap The ONNX depth map object ({ data, width, height }).
 * @returns An estimated distance in meters, or null if unavailable.
 */
export function estimateDistanceToPoint(
    pixelX: number,
    pixelY: number,
    viewportWidth: number,
    viewportHeight: number,
    cameraParams: CameraParams | null,
    depthMap: OnnxDepthMap | null
): number | null {
    if (!depthMap || !depthMap.data || !depthMap.width || !depthMap.height) {
        return null;
    }
    if (!cameraParams) {
        return null;
    }

    // Map viewport coordinates through any resize/crop transform used before inference
    let mappedX: number;
    let mappedY: number;
    if (depthMap.transform) {
        const { scaleX, scaleY, offsetX, offsetY, resizedWidth, resizedHeight } = depthMap.transform;
        const x = pixelX * scaleX + offsetX;
        const y = pixelY * scaleY + offsetY;
        mappedX = (x / resizedWidth) * depthMap.width;
        mappedY = (y / resizedHeight) * depthMap.height;
    } else {
        mappedX = (pixelX / viewportWidth) * depthMap.width;
        mappedY = (pixelY / viewportHeight) * depthMap.height;
    }

    // Clamp for robustness but keep fractional part for bilinear sampling
    mappedX = Math.max(0, Math.min(depthMap.width - 1, mappedX));
    mappedY = Math.max(0, Math.min(depthMap.height - 1, mappedY));

    if (USE_BILINEAR) {
        const depth = getBilinearDepthSample(mappedX, mappedY, depthMap);
        if (depth !== null) return depth;
    }

    const clampedX = Math.round(mappedX);
    const clampedY = Math.round(mappedY);
    return getRobustDepthSample(clampedX, clampedY, depthMap, true);
}

/**
 * Estimates the height of an object based on pixel clicks and camera parameters.
 * 
 * @param basePixelY Vertical pixel coordinate of the object's base.
 * @param topPixelY Vertical pixel coordinate of the object's top.
 * @param viewportHeight Total height of the viewport in pixels.
 * @param cameraParams Current camera parameters (fov, pitch).
 * @param distanceToBase Estimated distance from camera to the object's base (in meters).
 * @returns Estimated height in meters, or null if calculation is not possible.
 */
export function calculateEstimatedHeight(
    basePixelY: number,
    topPixelY: number,
    viewportHeight: number,
    cameraParams: CameraParams | null,
    distanceToBase: number | null
): number | null {
    if (!cameraParams?.fov || cameraParams.pitch === undefined || distanceToBase === null) {
        return null;
    }

    // Simple linear FOV assumption (more accurate would use tan)
    const verticalFovRadians = (cameraParams.fov * Math.PI) / 180;
    
    // Calculate angle for each pixel relative to the center (pitch angle)
    const centerPixelY = viewportHeight / 2;
    const effectivePitch = (cameraParams.pitch - (cameraParams.calibrationPitchOffsetDeg ?? 0));
    const pitchRadians = (effectivePitch * Math.PI) / 180;

    // Angle relative to horizon for base and top points
    // Note: Positive angle is downwards from horizon in this calculation
    const angleToBase = pitchRadians + ((basePixelY - centerPixelY) / viewportHeight) * verticalFovRadians;
    const angleToTop = pitchRadians + ((topPixelY - centerPixelY) / viewportHeight) * verticalFovRadians;

    // Use tangent to find height relative to camera horizon plane
    const heightAtBase = distanceToBase * Math.tan(angleToBase);
    const heightAtTop = distanceToBase * Math.tan(angleToTop);

    // Estimated height is the difference
    const estimatedHeight = Math.abs(heightAtBase - heightAtTop);

    return estimatedHeight;
} 