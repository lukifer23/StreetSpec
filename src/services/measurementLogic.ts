import { CameraParams, OnnxDepthMap } from '../types/common';

// Size of square kernel (odd number)
const KERNEL_SIZE = 5; // 5×5 neighborhood

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
    // eslint-disable-next-line no-console
    console.log('[depth] samples', vals.length, 'median', depth);
  }
  return depth;
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

    // Scale viewport coordinates to depth map coordinates
    // Assuming viewport aspect ratio might differ from depth map
    const mapX = Math.round((pixelX / viewportWidth) * depthMap.width);
    const mapY = Math.round((pixelY / viewportHeight) * depthMap.height);

    // Clamp coordinates to be within map bounds
    const clampedX = Math.max(0, Math.min(depthMap.width - 1, mapX));
    const clampedY = Math.max(0, Math.min(depthMap.height - 1, mapY));

    const distance = getRobustDepthSample(clampedX, clampedY, depthMap, true);
    return distance;
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