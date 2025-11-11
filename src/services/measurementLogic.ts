import type { CameraParams, OnnxDepthMap, Point, DecodedDepthData, AppSettings } from '../types/common';
import { screenToWorldWithDepth, screenToWorld, estimateGroundPlaneIntersection } from './geometry';
import { pixelOffsetToVerticalAngle, degreesToRadians } from '../utils/cameraMath';

// Size of square kernel (odd number)
const DEFAULT_KERNEL_SIZE = 5 as 3 | 5 | 7 | 9;
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

      const sobelIndex = (ky + 1) as 0 | 1 | 2;
      const weightX = SOBEL_X[sobelIndex][(kx + 1) as 0 | 1 | 2];
      const weightY = SOBEL_Y[sobelIndex][(kx + 1) as 0 | 1 | 2];
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

// Multi-scale depth sampling with confidence weighting
interface DepthSample {
  value: number;
  confidence: number;
  scale: number;
}

function getMultiScaleDepthSamples(
  mapX: number,
  mapY: number,
  depthMap: OnnxDepthMap,
  scales: number[] = [1.0, 0.5, 2.0],
  baseKernelSize: 3 | 5 | 7 | 9 = DEFAULT_KERNEL_SIZE,
  edgeRejectThreshold = DEFAULT_EDGE_REJECT_THRESHOLD
): DepthSample[] {
  const samples: DepthSample[] = [];

  for (const scale of scales) {
    const scaledKernelSize = Math.max(3, Math.min(9, Math.round(baseKernelSize * scale))) as 3 | 5 | 7 | 9;
    const half = Math.floor(scaledKernelSize / 2);
    const weightedSamples: Array<{ value: number; weight: number }> = [];
    const threshold = Math.max(0, Math.min(1, edgeRejectThreshold));

    for (let dy = -half; dy <= half; dy++) {
      const yy = Math.round(mapY + dy / scale);
      if (yy < 0 || yy >= depthMap.height) continue;
      for (let dx = -half; dx <= half; dx++) {
        const xx = Math.round(mapX + dx / scale);
        if (xx < 0 || xx >= depthMap.width) continue;
        const idx = yy * depthMap.width + xx;
        const v = depthMap.data[idx];
        if (v && v > 0 && Number.isFinite(v)) {
          const grad = computeNormalizedSobelGradient(xx, yy, depthMap);
          // Weight decreases with distance from center and gradient magnitude
          const distFromCenter = Math.hypot(dx, dy) / half;
          const distanceWeight = Math.max(0, 1 - distFromCenter);
          const edgeWeight = grad === null || grad <= threshold ? 1.0 : Math.max(0.1, 1 - grad / threshold);
          const weight = distanceWeight * edgeWeight;
          weightedSamples.push({ value: v, weight });
        }
      }
    }

    if (weightedSamples.length > 0) {
      // Weighted median
      weightedSamples.sort((a, b) => a.value - b.value);
      let totalWeight = weightedSamples.reduce((sum, s) => sum + s.weight, 0);
      let cumulativeWeight = 0;
      let medianValue = weightedSamples[0]!.value;

      for (const sample of weightedSamples) {
        cumulativeWeight += sample.weight;
        if (cumulativeWeight >= totalWeight / 2) {
          medianValue = sample.value;
          break;
        }
      }

      // Confidence based on sample count and consistency
      const values = weightedSamples.map(s => s.value);
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
      const stdDev = Math.sqrt(variance);
      const cv = mean > 0 ? stdDev / mean : Infinity;
      const consistency = Math.max(0.1, Math.min(1.0, 1.0 / (1.0 + cv * 3)));
      const countConfidence = Math.min(1.0, weightedSamples.length / (scaledKernelSize * scaledKernelSize));
      const confidence = consistency * countConfidence * (1.0 / Math.sqrt(scale)); // Prefer base scale

      samples.push({ value: medianValue, confidence, scale });
    }
  }

  return samples;
}

// Gather a neighbourhood of depth values around (x,y) and return a robust estimate (median)
function getRobustDepthSample(
  mapX: number,
  mapY: number,
  depthMap: OnnxDepthMap,
  kernelSize: 3 | 5 | 7 | 9,
  edgeRejectThreshold = DEFAULT_EDGE_REJECT_THRESHOLD
): number | null {
  // Use multi-scale sampling and fuse results
  const multiScaleSamples = getMultiScaleDepthSamples(mapX, mapY, depthMap, [1.0, 0.75, 1.5], kernelSize, edgeRejectThreshold);
  
  if (multiScaleSamples.length === 0) {
    // Fallback to original single-scale method
    const half = Math.floor(kernelSize / 2);
    const filteredVals: number[] = [];
    const fallbackVals: number[] = [];

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
    return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  }

  // Fuse multi-scale samples using confidence-weighted average
  let totalWeight = 0;
  let weightedSum = 0;
  for (const sample of multiScaleSamples) {
    const weight = sample.confidence;
    totalWeight += weight;
    weightedSum += sample.value * weight;
  }

  if (totalWeight > 0) {
    return weightedSum / totalWeight;
  }

  return null;
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
    const vals = valid.map(n => n.value!).sort((a, b) => a - b);
    const mid = Math.floor(vals.length / 2);
    return vals.length % 2 ? vals[mid]! : (vals[mid - 1]! + vals[mid]!) / 2;
  }

  let totalWeight = 0;
  let weightedSum = 0;
  for (const n of valid) {
    totalWeight += n.weight;
    weightedSum += n.value! * n.weight;
  }

  if (totalWeight === 0) {
    const vals = valid.map(n => n.value!).sort((a, b) => a - b);
    const mid = Math.floor(vals.length / 2);
    return vals.length % 2 ? vals[mid]! : (vals[mid - 1]! + vals[mid]!) / 2;
  }

  return weightedSum / totalWeight;
}

/**
 * Applies bilateral filter to depth map for noise reduction while preserving edges
 */
function applyBilateralFilter(
  centerX: number,
  centerY: number,
  depthMap: OnnxDepthMap,
  kernelSize: number = 5,
  spatialSigma: number = 1.0,
  depthSigma: number = 0.1
): number | null {
  const half = Math.floor(kernelSize / 2);
  const cx = Math.round(centerX);
  const cy = Math.round(centerY);
  
  if (cx < 0 || cx >= depthMap.width || cy < 0 || cy >= depthMap.height) {
    return null;
  }

  const centerIdx = cy * depthMap.width + cx;
  const centerDepth = depthMap.data[centerIdx];
  if (!centerDepth || centerDepth <= 0 || !Number.isFinite(centerDepth)) {
    return null;
  }

  let weightSum = 0;
  let weightedSum = 0;

  for (let dy = -half; dy <= half; dy++) {
    const yy = cy + dy;
    if (yy < 0 || yy >= depthMap.height) continue;
    for (let dx = -half; dx <= half; dx++) {
      const xx = cx + dx;
      if (xx < 0 || xx >= depthMap.width) continue;
      const idx = yy * depthMap.width + xx;
      const depth = depthMap.data[idx];
      if (!depth || depth <= 0 || !Number.isFinite(depth)) continue;

      // Spatial weight (Gaussian based on pixel distance)
      const spatialDist = Math.hypot(dx, dy);
      const spatialWeight = Math.exp(-(spatialDist * spatialDist) / (2 * spatialSigma * spatialSigma));

      // Depth weight (Gaussian based on depth difference)
      const depthDiff = Math.abs(depth - centerDepth) / centerDepth;
      const depthWeight = Math.exp(-(depthDiff * depthDiff) / (2 * depthSigma * depthSigma));

      const weight = spatialWeight * depthWeight;
      weightSum += weight;
      weightedSum += depth * weight;
    }
  }

  if (weightSum > 0) {
    return weightedSum / weightSum;
  }

  return centerDepth;
}

/**
 * Estimates the distance from the camera to a point corresponding to a pixel click
 * using the provided ONNX depth map with multi-scale fusion and refinement.
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

    // Validate inputs
    if (!Number.isFinite(pixelX) || !Number.isFinite(pixelY) || 
        !Number.isFinite(viewportWidth) || !Number.isFinite(viewportHeight) ||
        viewportWidth <= 0 || viewportHeight <= 0) {
        return null;
    }

    // Map viewport coordinates through any resize/crop transform used before inference
    let mappedX: number;
    let mappedY: number;
    if (depthMap.transform) {
        const { scaleX, scaleY, offsetX, offsetY, resizedWidth, resizedHeight } = depthMap.transform;
        if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || 
            !Number.isFinite(resizedWidth) || !Number.isFinite(resizedHeight) ||
            resizedWidth <= 0 || resizedHeight <= 0) {
            return null;
        }
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
    const kernelSize = (settings?.depthKernelSize ?? DEFAULT_KERNEL_SIZE) as 3 | 5 | 7 | 9;
    const edgeRejectThreshold = Math.max(
        0,
        Math.min(1, settings?.depthEdgeRejectThreshold ?? DEFAULT_EDGE_REJECT_THRESHOLD),
    );

    // Try bilinear first if enabled
    if (useBilinear) {
        const bilinearDepth = getBilinearDepthSample(mappedX, mappedY, depthMap);
        if (bilinearDepth !== null && Number.isFinite(bilinearDepth) && bilinearDepth > 0) {
            // Apply bilateral filter refinement
            const refined = applyBilateralFilter(mappedX, mappedY, depthMap, 5, 1.0, 0.1);
            if (refined !== null && Number.isFinite(refined) && refined > 0) {
                // Blend original and refined (70% refined, 30% original)
                return refined * 0.7 + bilinearDepth * 0.3;
            }
            return bilinearDepth;
        }
    }

    // Use robust multi-scale sampling
    const clampedX = Math.round(mappedX);
    const clampedY = Math.round(mappedY);
    const robustDepth = getRobustDepthSample(clampedX, clampedY, depthMap, kernelSize, edgeRejectThreshold);
    
    if (robustDepth !== null && Number.isFinite(robustDepth) && robustDepth > 0) {
        // Apply bilateral filter refinement
        const refined = applyBilateralFilter(mappedX, mappedY, depthMap, kernelSize, 1.0, 0.1);
        if (refined !== null && Number.isFinite(refined) && refined > 0) {
            // Blend robust and refined (60% refined, 40% robust)
            return refined * 0.6 + robustDepth * 0.4;
        }
        return robustDepth;
    }

    return null;
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

/**
 * Enhanced gradient analysis for depth confidence
 * Analyzes depth gradients in multiple directions and scales
 */
export interface GradientAnalysis {
  normalizedGradient: number;
  edgeStrength: number;
  depthConsistency: number;
  neighborhoodVariance: number;
  isValid: boolean;
}

/**
 * Compute comprehensive gradient analysis for depth confidence
 */
export function analyzeDepthGradients(
  mapX: number,
  mapY: number,
  depthMap: OnnxDepthMap,
  kernelSize: number = 5
): GradientAnalysis {
  const { width, height, data } = depthMap;
  
  // Validate coordinates
  if (mapX < 0 || mapX >= width || mapY < 0 || mapY >= height) {
    return {
      normalizedGradient: 1.0,
      edgeStrength: 1.0,
      depthConsistency: 0.0,
      neighborhoodVariance: Infinity,
      isValid: false
    };
  }

  const half = Math.floor(kernelSize / 2);
  const samples: number[] = [];
  let centerDepth: number | null = null;

  // Collect neighborhood samples
  for (let dy = -half; dy <= half; dy++) {
    const yy = Math.round(mapY + dy);
    if (yy < 0 || yy >= height) continue;
    for (let dx = -half; dx <= half; dx++) {
      const xx = Math.round(mapX + dx);
      if (xx < 0 || xx >= width) continue;
      const idx = yy * width + xx;
      const depth = data[idx];
      if (depth && depth > 0 && Number.isFinite(depth)) {
        samples.push(depth);
        if (dx === 0 && dy === 0) {
          centerDepth = depth;
        }
      }
    }
  }

  if (samples.length === 0 || centerDepth === null) {
    return {
      normalizedGradient: 1.0,
      edgeStrength: 1.0,
      depthConsistency: 0.0,
      neighborhoodVariance: Infinity,
      isValid: false
    };
  }

  // Calculate Sobel gradients (horizontal and vertical)
  let gx = 0;
  let gy = 0;
  const sobelKernel = [
    [-1, 0, 1],
    [-2, 0, 2],
    [-1, 0, 1]
  ];

  for (let dy = -1; dy <= 1; dy++) {
    const yy = Math.round(mapY + dy);
    if (yy < 0 || yy >= height) continue;
    for (let dx = -1; dx <= 1; dx++) {
      const xx = Math.round(mapX + dx);
      if (xx < 0 || xx >= width) continue;
      const idx = yy * width + xx;
      const depth = data[idx];
      if (depth && depth > 0 && Number.isFinite(depth)) {
        gx += depth * sobelKernel[dy + 1]![dx + 1]!;
        gy += depth * sobelKernel[dx + 1]![dy + 1]!; // Transposed for vertical
      }
    }
  }

  const gradientMagnitude = Math.sqrt(gx * gx + gy * gy);
  
  // Normalize gradient relative to center depth
  const normalizedGradient = centerDepth > 0 
    ? Math.min(1.0, gradientMagnitude / (centerDepth + 1e-6))
    : 1.0;

  // Calculate neighborhood variance (consistency measure)
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const variance = samples.reduce((sum, d) => sum + Math.pow(d - mean, 2), 0) / samples.length;
  const stdDev = Math.sqrt(variance);
  const neighborhoodVariance = mean > 0 ? stdDev / mean : Infinity;
  
  // Depth consistency: inverse of normalized variance
  const depthConsistency = Math.max(0, Math.min(1.0, 1.0 - Math.min(1.0, neighborhoodVariance)));

  // Edge strength: normalized gradient magnitude
  const edgeStrength = Math.min(1.0, normalizedGradient);

  return {
    normalizedGradient,
    edgeStrength,
    depthConsistency,
    neighborhoodVariance,
    isValid: true
  };
}

/**
 * Compute proximity to plane boundaries for confidence adjustment
 * Returns confidence multiplier based on distance to nearest plane edge
 */
export function computePlaneBoundaryProximity(
  point: Point,
  viewportWidth: number,
  viewportHeight: number,
  depthData: DecodedDepthData,
  _worldPoint: Vector3
): number {
  if (!depthData.indices || depthData.indices.length === 0) {
    return 1.0; // No boundary information available
  }

  const { width, height, indices } = depthData;
  
  // Map screen point to depth map coordinates
  const mapX = Math.floor((point.x / viewportWidth) * width);
  const mapY = Math.floor((point.y / viewportHeight) * height);
  
  if (mapX < 0 || mapX >= width || mapY < 0 || mapY >= height) {
    return 0.5; // Outside bounds, lower confidence
  }

  const centerIdx = mapY * width + mapX;
  const centerPlaneIndex = indices[centerIdx];
  
  if (centerPlaneIndex === undefined || centerPlaneIndex === 255) {
    return 0.5; // No plane assigned
  }

  // Check neighborhood for plane index changes (boundaries)
  const searchRadius = 3;
  let boundaryDistance = searchRadius + 1;
  
  for (let dy = -searchRadius; dy <= searchRadius; dy++) {
    const yy = mapY + dy;
    if (yy < 0 || yy >= height) continue;
    for (let dx = -searchRadius; dx <= searchRadius; dx++) {
      const xx = mapX + dx;
      if (xx < 0 || xx >= width) continue;
      const idx = yy * width + xx;
      const planeIdx = indices[idx];
      
      if (planeIdx !== centerPlaneIndex && planeIdx !== 255) {
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < boundaryDistance) {
          boundaryDistance = dist;
        }
      }
    }
  }

  // Convert to confidence multiplier (closer to boundary = lower confidence)
  if (boundaryDistance > searchRadius) {
    return 1.0; // Far from boundary, full confidence
  }
  
  // Linear falloff: 1.0 at distance 3, 0.7 at distance 0
  return 0.7 + (boundaryDistance / searchRadius) * 0.3;
}

/**
 * Computes confidence score for ONNX depth based on Sobel gradients and depth consistency
 */
function computeOnnxDepthConfidence(
  point: Point,
  viewportWidth: number,
  viewportHeight: number,
  onnxDepthMap: OnnxDepthMap | null,
  onnxDistanceMeters: number | null,
  settings?: Pick<AppSettings, 'depthKernelSize' | 'depthUseBilinear' | 'depthEdgeRejectThreshold'>
): number {
  if (!onnxDepthMap || !onnxDistanceMeters || !Number.isFinite(onnxDistanceMeters) || onnxDistanceMeters <= 0) {
    return 0;
  }

  // Map point to depth map coordinates
  const mappedX = (point.x / viewportWidth) * onnxDepthMap.width;
  const mappedY = (point.y / viewportHeight) * onnxDepthMap.height;
  const clampedX = Math.max(0, Math.min(onnxDepthMap.width - 1, Math.round(mappedX)));
  const clampedY = Math.max(0, Math.min(onnxDepthMap.height - 1, Math.round(mappedY)));

  // Use enhanced gradient analysis
  const kernelSize = (settings?.depthKernelSize ?? DEFAULT_KERNEL_SIZE) as 3 | 5 | 7 | 9;
  const gradientAnalysis = analyzeDepthGradients(clampedX, clampedY, onnxDepthMap, kernelSize);
  
  if (!gradientAnalysis.isValid) {
    return 0.2; // Low confidence for invalid samples
  }

  const edgeRejectThreshold = settings?.depthEdgeRejectThreshold ?? DEFAULT_EDGE_REJECT_THRESHOLD;
  
  // Gradient-based confidence: lower near edges
  const gradientConfidence = gradientAnalysis.edgeStrength <= edgeRejectThreshold
    ? 1.0
    : Math.max(0.3, 1.0 - ((gradientAnalysis.edgeStrength - edgeRejectThreshold) / (1.0 - edgeRejectThreshold + 1e-6)));

  // Use depth consistency from gradient analysis
  const consistencyConfidence = gradientAnalysis.depthConsistency;

  // Combine confidences (geometric mean for conservative estimate)
  const combinedConfidence = Math.sqrt(gradientConfidence * consistencyConfidence);
  
  // Scale by distance reasonableness with smooth falloff
  let distanceConfidence = 1.0;
  if (onnxDistanceMeters < 0.5) {
    distanceConfidence = Math.max(0.3, onnxDistanceMeters / 0.5);
  } else if (onnxDistanceMeters > 200) {
    distanceConfidence = Math.max(0.3, 1.0 - (onnxDistanceMeters - 200) / 200);
  }
  
  // Apply multi-scale confidence boost if available
  const multiScaleSamples = getMultiScaleDepthSamples(
    clampedX, 
    clampedY, 
    onnxDepthMap, 
    [1.0, 0.75, 1.5],
    kernelSize,
    edgeRejectThreshold
  );
  let multiScaleBoost = 1.0;
  if (multiScaleSamples.length > 1) {
    const avgConfidence = multiScaleSamples.reduce((sum, s) => sum + s.confidence, 0) / multiScaleSamples.length;
    multiScaleBoost = 0.9 + (avgConfidence * 0.1); // Small boost for multi-scale agreement
  }
  
  return Math.min(1.0, combinedConfidence * distanceConfidence * multiScaleBoost * 0.65); // Base ONNX confidence is 0.65 max
}

/**
 * Enhanced confidence scoring for plane-based depth with adaptive weighting
 */
function computePlaneDepthConfidence(
  point: Point,
  viewportWidth: number,
  viewportHeight: number,
  depthData: DecodedDepthData,
  worldPoint: Vector3
): number {
  // Check distance from plane boundaries using enhanced proximity function
  const boundaryProximity = computePlaneBoundaryProximity(point, viewportWidth, viewportHeight, depthData, worldPoint);
  
  const mappedX = (point.x / viewportWidth) * depthData.width;
  const mappedY = (point.y / viewportHeight) * depthData.height;
  const clampedX = Math.max(0, Math.min(depthData.width - 1, Math.round(mappedX)));
  const clampedY = Math.max(0, Math.min(depthData.height - 1, Math.round(mappedY)));
  
  const idx = clampedY * depthData.width + clampedX;
  const planeIndex = depthData.indices[idx];
  
  if (planeIndex === undefined || planeIndex === 255 || planeIndex >= depthData.planes.length) {
    return 0.3; // Low confidence for invalid plane index
  }

  // Check consistency of plane index in neighborhood
  const NEIGHBORHOOD_SIZE = 3;
  const half = Math.floor(NEIGHBORHOOD_SIZE / 2);
  let samePlaneCount = 0;
  let totalCount = 0;
  
  for (let dy = -half; dy <= half; dy++) {
    const yy = clampedY + dy;
    if (yy < 0 || yy >= depthData.height) continue;
    for (let dx = -half; dx <= half; dx++) {
      const xx = clampedX + dx;
      if (xx < 0 || xx >= depthData.width) continue;
      const neighborIdx = yy * depthData.width + xx;
      const neighborPlane = depthData.indices[neighborIdx];
      totalCount++;
      if (neighborPlane === planeIndex) {
        samePlaneCount++;
      }
    }
  }

  const planeConsistency = totalCount > 0 ? samePlaneCount / totalCount : 0.5;
  
  // Validate world point distance
  const dist = Math.sqrt(worldPoint.x * worldPoint.x + worldPoint.y * worldPoint.y + worldPoint.z * worldPoint.z);
  
  // Distance-based confidence (planes are most reliable at medium distances)
  let distanceConfidence = 1.0;
  if (dist < 2) {
    distanceConfidence = 0.85; // Close distances may have occlusion issues
  } else if (dist > 100) {
    distanceConfidence = 0.9; // Far distances may have noise
  } else if (dist < 0.1 || dist >= 1e4 || !Number.isFinite(dist)) {
    distanceConfidence = 0.5;
  }

  // Plane quality factor (more planes = better sampling)
  const planeCountConfidence = Math.min(1.0, depthData.planes.length / 20);

  // Apply boundary proximity multiplier (closer to boundaries = lower confidence)
  const boundaryMultiplier = boundaryProximity;

  // Base plane confidence is high, scaled by consistency, boundary proximity, and factors
  return 0.9 * planeConsistency * distanceConfidence * boundaryMultiplier * (0.9 + planeCountConfidence * 0.1);
}

/**
 * Enhanced fused world conversion using weighted fusion based on confidence scores.
 * Combines Street View planes, ONNX depth, and ground-plane geometry with proper weighting.
 */
export function fusedWorldPoint(
  point: Point,
  viewportWidth: number,
  viewportHeight: number,
  cameraParams: CameraParams | null,
  depthData: DecodedDepthData | null,
  onnxDistanceMeters: number | null,
  onnxDepthMap: OnnxDepthMap | null = null,
  settings?: Pick<AppSettings, 'depthKernelSize' | 'depthUseBilinear' | 'depthEdgeRejectThreshold'>
): { world: { x: number; y: number; z: number } | null; method: 'planes' | 'onnx' | 'ground'; confidence: number } {
  if (!cameraParams) {
    return { world: null, method: 'ground', confidence: 0 };
  }

  const candidates: Array<{ world: Vector3; method: 'planes' | 'onnx' | 'ground'; confidence: number }> = [];

  // Try plane-based depth (highest accuracy when available)
  if (depthData) {
    try {
      const world = screenToWorldWithDepth(point, cameraParams, viewportWidth, viewportHeight, depthData);
      if (world) {
        const dist = Math.sqrt(world.x * world.x + world.y * world.y + world.z * world.z);
        if (dist > 0.1 && dist < 1e4 && Number.isFinite(dist)) {
          const confidence = computePlaneDepthConfidence(point, viewportWidth, viewportHeight, depthData, world);
          candidates.push({ world, method: 'planes', confidence });
        }
      }
    } catch (err) {
      // Plane calculation failed, continue with other methods
    }
  }

  // Try ONNX depth with confidence scoring
  if (onnxDistanceMeters && Number.isFinite(onnxDistanceMeters) && onnxDistanceMeters > 0 && onnxDepthMap) {
    try {
      const dir = screenToWorld(point, cameraParams, viewportWidth, viewportHeight);
      // Validate direction vector
      if (Number.isFinite(dir.x) && Number.isFinite(dir.y) && Number.isFinite(dir.z)) {
        const world = { 
          x: dir.x * onnxDistanceMeters, 
          y: dir.y * onnxDistanceMeters, 
          z: dir.z * onnxDistanceMeters 
        };
        // Validate world point
        if (Number.isFinite(world.x) && Number.isFinite(world.y) && Number.isFinite(world.z)) {
          const dist = Math.hypot(world.x, world.y, world.z);
          if (dist > 0.1 && dist < 1e4) {
            const confidence = computeOnnxDepthConfidence(point, viewportWidth, viewportHeight, onnxDepthMap, onnxDistanceMeters, settings);
            if (confidence > 0.1) {
              candidates.push({ world, method: 'onnx', confidence });
            }
          }
        }
      }
    } catch (err) {
      // ONNX calculation failed, continue with fallback
    }
  }

  // Ground plane fallback
  try {
    const dir = screenToWorld(point, cameraParams, viewportWidth, viewportHeight);
    const world = estimateGroundPlaneIntersection(dir, cameraParams);
    if (world) {
      const dist = Math.sqrt(world.x * world.x + world.y * world.y + world.z * world.z);
      if (dist > 0.1 && dist < 1e4 && Number.isFinite(dist)) {
        // Ground plane confidence based on angle
        const horizontalComponent = Math.sqrt(dir.x * dir.x + dir.z * dir.z);
        const verticalComponent = Math.abs(dir.y);
        const angleConfidence = Math.min(1.0, (verticalComponent / (horizontalComponent + 1e-6)) * 0.5);
        candidates.push({ world, method: 'ground', confidence: Math.max(0.2, angleConfidence) * 0.4 });
      }
    }
  } catch (err) {
    // Ground plane calculation failed
  }

  // Adaptive method selection based on distance and scene context
  if (candidates.length === 0) {
    return { world: null, method: 'ground', confidence: 0 };
  }

  // Compute distances for adaptive selection
  const candidateDistances = candidates.map(c => Math.hypot(c.world.x, c.world.y, c.world.z));

  // Adaptive confidence adjustment based on distance and method type
  const adjustedCandidates = candidates.map((cand, idx) => {
    const distance = candidateDistances[idx]!;
    let adjustedConfidence = cand.confidence;

    // Distance-based adjustments
    if (cand.method === 'planes') {
      // Street View planes are most accurate at medium distances (5-50m)
      if (distance >= 5 && distance <= 50) {
        adjustedConfidence *= 1.1; // Boost
      } else if (distance < 2 || distance > 100) {
        adjustedConfidence *= 0.9; // Slight penalty
      }
    } else if (cand.method === 'onnx') {
      // ONNX works well at close-medium distances (1-30m)
      if (distance >= 1 && distance <= 30) {
        adjustedConfidence *= 1.05;
      } else if (distance > 50) {
        adjustedConfidence *= 0.85; // Penalty for far distances
      }
    } else if (cand.method === 'ground') {
      // Ground plane is better for far distances and downward angles
      if (distance > 20) {
        adjustedConfidence *= 1.05;
      } else {
        adjustedConfidence *= 0.8; // Penalty for close distances
      }
    }

    // Context-based adjustments (e.g., if multiple methods agree on distance)
    if (candidates.length > 1) {
      const otherDistances = candidateDistances.filter((_, i) => i !== idx);
      const distanceConsistency = otherDistances.map(d => 
        1 - Math.min(1, Math.abs(distance - d) / Math.max(distance, d, 1))
      );
      const avgConsistency = distanceConsistency.reduce((a, b) => a + b, 0) / distanceConsistency.length;
      adjustedConfidence *= (0.9 + avgConsistency * 0.1); // Small boost for consistency
    }

    return { ...cand, confidence: Math.min(1.0, adjustedConfidence) };
  });

  // Sort by adjusted confidence
  adjustedCandidates.sort((a, b) => b.confidence - a.confidence);
  const best = adjustedCandidates[0]!;

  // Enhanced hybrid fusion: combine multiple methods when they agree
  // This improves accuracy by leveraging complementary strengths of each method
  if (adjustedCandidates.length > 1 && best.confidence > 0.4) {
    const highConfidenceCandidates = adjustedCandidates.filter(c => c.confidence > 0.3);
    
    if (highConfidenceCandidates.length >= 2) {
      // Calculate 3D spatial agreement (not just distance)
      const candidateDistances = highConfidenceCandidates.map(c => 
        Math.hypot(c.world.x, c.world.y, c.world.z)
      );
      
      // Check both distance agreement and 3D position agreement
      const positions = highConfidenceCandidates.map(c => c.world);
      const avgDistance = candidateDistances.reduce((a, b) => a + b, 0) / candidateDistances.length;
      
      // Calculate pairwise 3D distances between candidate positions
      const maxPairwiseDistance = Math.max(
        ...positions.slice(0, -1).map((p1, i) => 
          Math.hypot(
            p1.x - positions[i + 1]!.x,
            p1.y - positions[i + 1]!.y,
            p1.z - positions[i + 1]!.z
          )
        )
      );
      
      // Relative 3D position difference
      const relativePositionDiff = avgDistance > 0 ? maxPairwiseDistance / avgDistance : 1;
      
      // Distance consistency check
      const distanceVariance = candidateDistances.reduce((sum, d) => 
        sum + Math.pow(d - avgDistance, 2), 0
      ) / candidateDistances.length;
      const distanceStdDev = Math.sqrt(distanceVariance);
      const relativeDistanceDiff = avgDistance > 0 ? distanceStdDev / avgDistance : 1;

      // Fuse if candidates agree spatially (within 15% distance difference and 20% position difference)
      // Stricter thresholds for better accuracy
      const distanceAgreement = relativeDistanceDiff < 0.15;
      const positionAgreement = relativePositionDiff < 0.20;
      
      if (distanceAgreement && positionAgreement) {
        // Weighted fusion using confidence scores
        const totalConfidence = highConfidenceCandidates.reduce((sum, c) => sum + c.confidence, 0);
        const weights = highConfidenceCandidates.map(c => c.confidence / totalConfidence);
        
        // Weighted average of all agreeing candidates
        const fusedWorld: Vector3 = {
          x: highConfidenceCandidates.reduce((sum, c, i) => sum + c.world.x * weights[i]!, 0),
          y: highConfidenceCandidates.reduce((sum, c, i) => sum + c.world.y * weights[i]!, 0),
          z: highConfidenceCandidates.reduce((sum, c, i) => sum + c.world.z * weights[i]!, 0),
        };

        // Agreement bonus increases confidence based on both distance and position agreement
        const distanceAgreementBonus = (1 - relativeDistanceDiff) * 0.1;
        const positionAgreementBonus = (1 - relativePositionDiff) * 0.1;
        const agreementBonus = distanceAgreementBonus + positionAgreementBonus;
        
        // Average confidence of fused candidates, boosted by agreement
        const avgConfidence = highConfidenceCandidates.reduce((sum, c) => sum + c.confidence, 0) 
          / highConfidenceCandidates.length;
        const fusedConfidence = Math.min(1.0, avgConfidence + agreementBonus);

        // Determine best method name (prefer planes > onnx > ground)
        const methodPriority: Record<'planes' | 'onnx' | 'ground', number> = {
          planes: 3,
          onnx: 2,
          ground: 1
        };
        const bestMethod = highConfidenceCandidates.reduce((best, curr) => 
          methodPriority[curr.method] > methodPriority[best.method] ? curr : best
        ).method;

        return {
          world: fusedWorld,
          method: bestMethod,
          confidence: fusedConfidence
        };
      }
    }
  }

  return best;
}