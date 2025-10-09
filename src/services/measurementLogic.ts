import type { CameraParams, OnnxDepthMap, Point, DecodedDepthData, AppSettings } from '../types/common';
import { screenToWorldWithDepth } from './geometry';
import { pixelOffsetToVerticalAngle, degreesToRadians } from '../utils/cameraMath';

// Size of square kernel (odd number)
const DEFAULT_KERNEL_SIZE = 5 as 3 | 5 | 7;
const DEFAULT_USE_BILINEAR = true;
const DEFAULT_EDGE_REJECT_THRESHOLD = 0.35; // 0..1 normalized gradient magnitude

const SOBEL_X = [
  [-1, 0, 1],
  [-2, 0, 2],
  [-1, 0, 1],
] as const;

const SOBEL_Y = [
  [-1, -2, -1],
  [0, 0, 0],
  [1, 2, 1],
] as const;

const EPSILON = 1e-6;

function computeNormalizedSobelGradient(mapX: number, mapY: number, depthMap: OnnxDepthMap): number | null {
  const idx = mapY * depthMap.width + mapX;
  const center = depthMap.data[idx];
  if (!center || center <= 0 || !Number.isFinite(center)) {
    return null;
  }

  let gx = 0;
  let gy = 0;
  let validNeighbors = 0;
  let localMin = Number.POSITIVE_INFINITY;
  let localMax = Number.NEGATIVE_INFINITY;

  for (let ky = -1; ky <= 1; ky++) {
    const yy = mapY + ky;
    if (yy < 0 || yy >= depthMap.height) continue;

    for (let kx = -1; kx <= 1; kx++) {
      const xx = mapX + kx;
      if (xx < 0 || xx >= depthMap.width) continue;

      const neighbor = depthMap.data[yy * depthMap.width + xx];
      if (!neighbor || neighbor <= 0 || !Number.isFinite(neighbor)) continue;

      const weightX = SOBEL_X[ky + 1][kx + 1];
      const weightY = SOBEL_Y[ky + 1][kx + 1];
      gx += neighbor * weightX;
      gy += neighbor * weightY;
      validNeighbors++;

      if (neighbor < localMin) localMin = neighbor;
      if (neighbor > localMax) localMax = neighbor;
    }
  }

  if (validNeighbors < 3) {
    return null;
  }

  const magnitude = Math.sqrt(gx * gx + gy * gy);
  if (!Number.isFinite(magnitude)) {
    return null;
  }

  const normalization = Math.max(Math.abs(center), localMax - localMin, EPSILON);
  const normalized = magnitude / normalization;

  return Math.min(Math.max(normalized, 0), 1);
}

// Gather a neighbourhood of depth values around (x,y) and return a robust estimate (median)
function getRobustDepthSample(
  mapX: number,
  mapY: number,
  depthMap: OnnxDepthMap,
  kernelSize: 3 | 5 | 7,
  edgeRejectThreshold = DEFAULT_EDGE_REJECT_THRESHOLD,
  debug = false,
): number | null {
  const half = Math.floor(kernelSize / 2);
  const filteredVals: number[] = [];
  const fallbackVals: number[] = [];
  const gradients: number[] = [];

  const threshold = Math.max(0, Math.min(1, edgeRejectThreshold));

  for (let dy = -half; dy <= half; dy++) {
    const yy = mapY + dy;
    if (yy < 0 || yy >= depthMap.height) continue;
    for (let dx = -half; dx <= half; dx++) {
      const xx = mapX + dx;
      if (xx < 0 || xx >= depthMap.width) continue;
      const idx = yy * depthMap.width + xx;
      const v = depthMap.data[idx];
      if (v && v > 0 && Number.isFinite(v)) {
        const grad = computeNormalizedSobelGradient(xx, yy, depthMap);
        if (grad !== null) {
          gradients.push(grad);
        }
        if (grad === null || grad <= threshold) {
          filteredVals.push(v);
        } else {
          fallbackVals.push(v);
        }
      }
    }
  }

  const totalSamples = filteredVals.length + fallbackVals.length;
  if (totalSamples === 0) return null;

  const workingValues = filteredVals.length > 0 ? filteredVals : fallbackVals;
  const sorted = [...workingValues].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const depth = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  if (debug) {
    const source = filteredVals.length > 0 ? 'filtered' : 'fallback';
    const gradStats = gradients.length
      ? {
          min: Math.min(...gradients),
          max: Math.max(...gradients),
          mean: gradients.reduce((sum, g) => sum + g, 0) / gradients.length,
        }
      : null;
    console.log(
      '[depth] samples',
      workingValues.length,
      '/',
      totalSamples,
      'source',
      source,
      'threshold',
      threshold.toFixed(2),
      'median',
      depth,
      gradStats
        ? `grad[min=${gradStats.min.toFixed(3)} max=${gradStats.max.toFixed(3)} mean=${gradStats.mean.toFixed(3)}]`
        : 'grad[none]',
    );
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
  const neighbors = [
    { value: depthMap.data[i00], weight: (1 - dx) * (1 - dy) },
    { value: depthMap.data[i10], weight: dx * (1 - dy) },
    { value: depthMap.data[i01], weight: (1 - dx) * dy },
    { value: depthMap.data[i11], weight: dx * dy },
  ];

  const valid = neighbors.filter(n => n.value && n.value > 0 && Number.isFinite(n.value));
  if (valid.length === 0) return null;
  if (valid.length < 2) {
    const vals = valid.map(n => n.value).sort((a, b) => a - b);
    const mid = Math.floor(vals.length / 2);
    return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
  }

  let totalWeight = 0;
  let weightedSum = 0;
  for (const n of valid) {
    totalWeight += n.weight;
    weightedSum += n.value * n.weight;
  }

  if (totalWeight === 0) {
    const vals = valid.map(n => n.value).sort((a, b) => a - b);
    const mid = Math.floor(vals.length / 2);
    return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
  }

  return weightedSum / totalWeight;
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
    depthMap: OnnxDepthMap | null,
    settings?: Pick<AppSettings,'depthKernelSize'|'depthUseBilinear'|'depthEdgeRejectThreshold'>
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

    const useBilinear = settings?.depthUseBilinear ?? DEFAULT_USE_BILINEAR;
    const kernelSize = settings?.depthKernelSize ?? DEFAULT_KERNEL_SIZE;
    const edgeRejectThreshold = Math.max(
        0,
        Math.min(1, settings?.depthEdgeRejectThreshold ?? DEFAULT_EDGE_REJECT_THRESHOLD),
    );
    if (useBilinear) {
        const depth = getBilinearDepthSample(mappedX, mappedY, depthMap);
        if (depth !== null) return depth;
    }

    const clampedX = Math.round(mappedX);
    const clampedY = Math.round(mappedY);
    return getRobustDepthSample(clampedX, clampedY, depthMap, kernelSize, edgeRejectThreshold, true);
}

/**
 * Estimates the height of an object based on pixel clicks and camera parameters.
 *
 * @param basePoint Screen coordinates of the object's base.
 * @param topPoint Screen coordinates of the object's top.
 * @param viewportWidth Total width of the viewport in pixels.
 * @param viewportHeight Total height of the viewport in pixels.
 * @param cameraParams Current camera parameters (vertical FOV, pitch).
 * @param depthData Street View depth data for the current panorama.
 * @param distanceToBase Estimated distance from camera to the object's base (meters) for fallback.
 * @returns Estimated height in meters, or null if calculation is not possible.
 */
export function calculateEstimatedHeight(
    basePoint: Point,
    topPoint: Point,
    viewportWidth: number,
    viewportHeight: number,
    cameraParams: CameraParams | null,
    depthData: DecodedDepthData | null,
    distanceToBase: number | null,
): number | null {
    if (!cameraParams || viewportWidth <= 0 || viewportHeight <= 0) {
        return null;
    }

    // First try using depth planes to directly obtain world coordinates
    if (depthData) {
        const baseWorld = screenToWorldWithDepth(basePoint, cameraParams, viewportWidth, viewportHeight, depthData);
        const topWorld = screenToWorldWithDepth(topPoint, cameraParams, viewportWidth, viewportHeight, depthData);
        if (baseWorld && topWorld) {
            return topWorld.y - baseWorld.y;
        }
    }

    // Fallback to angle-based estimation if depth lookup fails
    if (!cameraParams.vFov || cameraParams.pitch === undefined || distanceToBase === null || distanceToBase <= 0) {
        return null;
    }

    const effectivePitchDeg = (cameraParams.pitch - (cameraParams.calibrationPitchOffsetDeg ?? 0));
    const angleToBaseDeg = effectivePitchDeg + pixelOffsetToVerticalAngle(basePoint.y, viewportHeight, cameraParams.vFov);
    const angleToTopDeg = effectivePitchDeg + pixelOffsetToVerticalAngle(topPoint.y, viewportHeight, cameraParams.vFov);

    const angleToBase = degreesToRadians(angleToBaseDeg);
    const angleToTop = degreesToRadians(angleToTopDeg);

    // Harden against near-vertical angles
    const EPS = 1e-3;
    const HORIZON_EPS = 5e-3;
    if (Math.abs(angleToBase) > Math.PI/2 - EPS || Math.abs(angleToTop) > Math.PI/2 - EPS) {
        return null;
    }
    if (Math.abs(angleToBase) < HORIZON_EPS || Math.abs(angleToTop) < HORIZON_EPS) {
        return null;
    }
    const heightAtBase = distanceToBase * Math.tan(angleToBase);
    const heightAtTop = distanceToBase * Math.tan(angleToTop);
    return heightAtBase - heightAtTop;
}