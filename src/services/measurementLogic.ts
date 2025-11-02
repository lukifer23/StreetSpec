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

  // Compute gradient-based confidence
  const gradient = computeNormalizedSobelGradient(clampedX, clampedY, onnxDepthMap);
  const edgeRejectThreshold = settings?.depthEdgeRejectThreshold ?? DEFAULT_EDGE_REJECT_THRESHOLD;
  
  // Lower confidence near edges (high gradients)
  let gradientConfidence = 1.0;
  if (gradient !== null) {
    gradientConfidence = Math.max(0.3, 1.0 - (gradient / edgeRejectThreshold));
  }

  // Check depth consistency in local neighborhood
  const kernelSize = (settings?.depthKernelSize ?? DEFAULT_KERNEL_SIZE) as 3 | 5 | 7 | 9;
  const half = Math.floor(kernelSize / 2);
  const depths: number[] = [];
  
  for (let dy = -half; dy <= half; dy++) {
    const yy = clampedY + dy;
    if (yy < 0 || yy >= onnxDepthMap.height) continue;
    for (let dx = -half; dx <= half; dx++) {
      const xx = clampedX + dx;
      if (xx < 0 || xx >= onnxDepthMap.width) continue;
      const idx = yy * onnxDepthMap.width + xx;
      const v = onnxDepthMap.data[idx];
      if (v && v > 0 && Number.isFinite(v)) {
        depths.push(v);
      }
    }
  }

  // Compute consistency as inverse of coefficient of variation
  let consistencyConfidence = 0.5; // Default moderate confidence
  if (depths.length >= 3) {
    const mean = depths.reduce((a, b) => a + b, 0) / depths.length;
    const variance = depths.reduce((sum, d) => sum + Math.pow(d - mean, 2), 0) / depths.length;
    const stdDev = Math.sqrt(variance);
    const coefficientOfVariation = mean > 0 ? stdDev / mean : Infinity;
    
    // Lower CV = higher consistency = higher confidence
    consistencyConfidence = Math.max(0.2, Math.min(1.0, 1.0 / (1.0 + coefficientOfVariation * 2)));
  }

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
  // Check distance from plane boundaries
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

  // Base plane confidence is high, scaled by consistency and factors
  return 0.9 * planeConsistency * distanceConfidence * (0.9 + planeCountConfidence * 0.1);
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
  const avgDistance = candidateDistances.reduce((a, b) => a + b, 0) / candidateDistances.length;

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

  // Hybrid fusion: combine multiple methods when they agree
  if (adjustedCandidates.length > 1 && best.confidence > 0.4) {
    const highConfidenceCandidates = adjustedCandidates.filter(c => c.confidence > 0.3);
    
    if (highConfidenceCandidates.length >= 2) {
      // Check agreement between top candidates
      const topTwo = highConfidenceCandidates.slice(0, 2);
      const dist1 = Math.hypot(topTwo[0]!.world.x, topTwo[0]!.world.y, topTwo[0]!.world.z);
      const dist2 = Math.hypot(topTwo[1]!.world.x, topTwo[1]!.world.y, topTwo[1]!.world.z);
      const distanceDiff = Math.abs(dist1 - dist2);
      const avgDist = (dist1 + dist2) / 2;
      const relativeDiff = avgDist > 0 ? distanceDiff / avgDist : 1;

      // Fuse if candidates agree (within 15% distance difference)
      if (relativeDiff < 0.15) {
        const totalConfidence = topTwo.reduce((sum, c) => sum + c.confidence, 0);
        const weights = topTwo.map(c => c.confidence / totalConfidence);
        
        const fusedWorld: Vector3 = {
          x: topTwo[0]!.world.x * weights[0]! + topTwo[1]!.world.x * weights[1]!,
          y: topTwo[0]!.world.y * weights[0]! + topTwo[1]!.world.y * weights[1]!,
          z: topTwo[0]!.world.z * weights[0]! + topTwo[1]!.world.z * weights[1]!,
        };

        // Agreement bonus increases confidence
        const agreementBonus = (1 - relativeDiff) * 0.15;
        const fusedConfidence = Math.min(1.0, 
          (topTwo[0]!.confidence + topTwo[1]!.confidence) / 2 + agreementBonus
        );

        // Determine best method name (prefer planes > onnx > ground)
        const methodPriority: Record<'planes' | 'onnx' | 'ground', number> = {
          planes: 3,
          onnx: 2,
          ground: 1
        };
        const bestMethod = topTwo.reduce((best, curr) => 
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