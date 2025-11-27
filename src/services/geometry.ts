import type { CameraParams, Point, Vector3, DistortionCoefficients, DecodedDepthData, OnnxDepthMap } from '../types/common';
import { dotProduct3D, normalizeVector3D, degreesToRadians, distance3D, magnitude3D } from '../utils/math';

const calibrationAppliedSymbol: unique symbol = Symbol('calibrationApplied');
type CalibratedVector3 = Vector3 & { [calibrationAppliedSymbol]?: boolean };

// Helper function to convert degrees to radians with validation (wraps unified version)
const degreesToRadiansValidated = (degrees: number): number => {
  // Validate input
  if (!Number.isFinite(degrees)) {
    return 0;
  }
  
  // Normalize to [-360, 360] range to prevent overflow
  const normalized = degrees % 360;
  
  return degreesToRadians(normalized);
}

// Use unified math functions
const dotProduct = dotProduct3D;

import { UnifiedCache, cacheRegistry } from '../utils/cacheManager';

// Unified caches with consistent management
const calculationCache = new UnifiedCache<unknown>({
  name: 'geometry-calculations',
  maxSize: 1000,
  ttl: 5 * 60 * 1000, // 5 minutes
  evictionStrategy: 'lru'
});

const fovCache = new UnifiedCache<{ hFov: number; vFov: number }>({
  name: 'geometry-fov',
  maxSize: 100,
  ttl: undefined, // No expiration for FOV cache
  evictionStrategy: 'lru'
});

const trigCache = new UnifiedCache<{ cos: number; sin: number }>({
  name: 'geometry-trig',
  maxSize: 1000,
  ttl: undefined, // No expiration for trig cache
  evictionStrategy: 'lru'
});

// Register caches for statistics
cacheRegistry.register('geometry-calculations', calculationCache);
cacheRegistry.register('geometry-fov', fovCache);
cacheRegistry.register('geometry-trig', trigCache);

// Use WeakMap to prevent memory leaks - automatically garbage collected when depthData is GC'd
const depthDataSignatureCache = new WeakMap<DecodedDepthData, string>();

const CACHE_MISS = Symbol('CACHE_MISS');

/**
 * Normalize numeric value for cache key generation to prevent floating-point collisions
 */
// Use unified math function for consistency

function getCacheKey(operation: string, params: unknown): string {
  if (params && typeof params === 'object' && !Array.isArray(params)) {
    return UnifiedCache.generateKey(operation, params as Record<string, unknown>);
  }
  return UnifiedCache.generateKey(operation, { value: params });
}

function getCachedResult<T>(key: string): T | typeof CACHE_MISS {
  const cached = calculationCache.get(key) as T | null;
  if (cached !== null) {
    return cached;
  }
  return CACHE_MISS;
}

function setCachedResult<T>(key: string, value: T): void {
  calculationCache.set(key, value);
}

function getTrigValues(angleDegrees: number): { cos: number; sin: number } {
  // Validate input
  if (!Number.isFinite(angleDegrees)) {
    return { cos: 1, sin: 0 }; // Default to 0 degrees
  }
  
  // Normalize angle to [-360, 360] range
  const normalizedAngle = angleDegrees % 360;
  const cacheKey = UnifiedCache.generateKey('trig', { angle: normalizedAngle }, 2);

  const cached = trigCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const radians = degreesToRadiansValidated(normalizedAngle);
  
  // Validate radians
  if (!Number.isFinite(radians)) {
    return { cos: 1, sin: 0 };
  }
  
  const cosValue = Math.cos(radians);
  const sinValue = Math.sin(radians);
  
  // Validate results
  if (!Number.isFinite(cosValue) || !Number.isFinite(sinValue)) {
    return { cos: 1, sin: 0 };
  }
  
  const result = {
    cos: cosValue,
    sin: sinValue,
  };
  trigCache.set(cacheKey, result);

  return result;
}

function getDepthDataSignature(depthData: DecodedDepthData): string {
  let signature = depthDataSignatureCache.get(depthData);
  if (!signature) {
    const planeSignature = depthData.planes
      .map((plane) =>
        [plane.nx, plane.ny, plane.nz, plane.d]
          .map((value) => value.toFixed(6))
          .join(',')
      )
      .join('|');
    signature = `${depthData.width}x${depthData.height}:${planeSignature}`;
    depthDataSignatureCache.set(depthData, signature);
  }
  return signature;
}

function samplePlaneIndexBilinear(
  mapX: number,
  mapY: number,
  depthData: DecodedDepthData
): number | null {
  const { width, height, indices, planes } = depthData;
  if (!indices || indices.length === 0 || !planes || planes.length === 0) {
    return null;
  }

  const x0 = Math.floor(mapX);
  const y0 = Math.floor(mapY);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  const dx = mapX - x0;
  const dy = mapY - y0;

  const neighbors = [
    { planeIndex: Number(indices[y0 * width + x0]), weight: (1 - dx) * (1 - dy) },
    { planeIndex: Number(indices[y0 * width + x1]), weight: dx * (1 - dy) },
    { planeIndex: Number(indices[y1 * width + x0]), weight: (1 - dx) * dy },
    { planeIndex: Number(indices[y1 * width + x1]), weight: dx * dy },
  ];

  let bestPlane: number | null = null;
  let bestWeight = -Infinity;
  const weightAccumulator = new Map<number, number>();

  for (const { planeIndex, weight } of neighbors) {
    if (weight <= 0) {
      continue;
    }
    if (!Number.isFinite(planeIndex) || planeIndex === 255 || planeIndex >= planes.length) {
      continue;
    }
    const totalWeight = (weightAccumulator.get(planeIndex) ?? 0) + weight;
    weightAccumulator.set(planeIndex, totalWeight);
    if (totalWeight > bestWeight) {
      bestWeight = totalWeight;
      bestPlane = planeIndex;
    }
  }

  if (bestPlane !== null) {
    return bestPlane;
  }

  for (const { planeIndex, weight } of neighbors) {
    if (!Number.isFinite(planeIndex) || planeIndex === 255 || planeIndex >= planes.length) {
      continue;
    }
    if (weight > bestWeight) {
      bestWeight = weight;
      bestPlane = planeIndex;
    }
  }

  return bestPlane;
}

// Iteratively undistort a normalized point given distortion coefficients
const undistortPoint = (
    x: number,
    y: number,
    coeffs: DistortionCoefficients
): { x: number; y: number } => {
    let xUndistorted = x;
    let yUndistorted = y;
    const { k1 = 0, k2 = 0, p1 = 0, p2 = 0, k3 = 0 } = coeffs || {};
    for (let i = 0; i < 5; i++) {
        const r2 = xUndistorted * xUndistorted + yUndistorted * yUndistorted;
        const radial = 1 + k1 * r2 + k2 * r2 * r2 + k3 * r2 * r2 * r2;
        const deltaX = 2 * p1 * xUndistorted * yUndistorted + p2 * (r2 + 2 * xUndistorted * xUndistorted);
        const deltaY = p1 * (r2 + 2 * yUndistorted * yUndistorted) + 2 * p2 * xUndistorted * yUndistorted;
        xUndistorted = (x - deltaX) / radial;
        yUndistorted = (y - deltaY) / radial;
    }
    return { x: xUndistorted, y: yUndistorted };
};

/**
 * Calibrated horizontal field of view values (in degrees) taken from
 * documented Street View camera parameters.  These values more closely
 * match the true optics of the Street View rig than the simple
 * mathematical approximation previously used.
 */
const CALIBRATED_HFOV_BY_ZOOM: Record<number, number> = {
  0: 126.87,
  1: 90,
  2: 53.13,
  3: 28.07,
  4: 14.25,
};

/**
 * Calculates the horizontal and vertical field of view (FOV) based on the
 * Street View zoom level using calibrated values from Google Street View's
 * published camera parameters.  The vertical FOV is derived from the
 * horizontal FOV and the viewport's aspect ratio.
 *
 * @param zoom - The Street View zoom level (0 is widest).
 * @param aspectRatio - The viewport aspect ratio (width / height).
 * @returns An object containing both the horizontal and vertical FOV in degrees.
 */
export function calculateFov(
  zoom: number | undefined | null,
  aspectRatio: number
): { hFov: number; vFov: number } {
  // Default to zoom level 1 (approx. 90 deg horizontal FOV) if zoom is unknown
  const effectiveZoom = zoom ?? 1;
  // Clamp zoom level for safety
  const clampedZoom = Math.max(0, Math.min(effectiveZoom, 4));
  const cacheKey = UnifiedCache.generateKey('fov', { zoom: clampedZoom, aspectRatio });
  const cached = fovCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  // Look up the calibrated horizontal FOV and fall back to zoom level 1
  const hFov = CALIBRATED_HFOV_BY_ZOOM[clampedZoom as keyof typeof CALIBRATED_HFOV_BY_ZOOM] ?? CALIBRATED_HFOV_BY_ZOOM[1];
  // Derive vertical FOV from horizontal FOV and aspect ratio
  const hFovRad = degreesToRadiansValidated(hFov!);
  
  // Validate aspect ratio
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    return { hFov: hFov!, vFov: hFov! }; // Fallback to same as horizontal
  }
  
  const tanHalfHFov = Math.tan(hFovRad / 2);
  if (!Number.isFinite(tanHalfHFov) || tanHalfHFov <= 0) {
    return { hFov: hFov!, vFov: hFov! }; // Fallback
  }
  
  const vFovRad = 2 * Math.atan(tanHalfHFov / aspectRatio);
  
  // Validate result
  if (!Number.isFinite(vFovRad)) {
    return { hFov: hFov!, vFov: hFov! }; // Fallback
  }
  
  const vFov = (vFovRad * 180) / Math.PI;
  
  // Validate final vFov
  if (!Number.isFinite(vFov) || vFov <= 0 || vFov > 180) {
    return { hFov: hFov!, vFov: hFov! }; // Fallback
  }

  const result = { hFov: hFov!, vFov };
  fovCache.set(cacheKey, result);

  return result;
}

/**
 * Converts 2D screen coordinates (origin top-left) into a 3D unit direction vector 
 * relative to the camera's orientation.
 *
 * @param screenPoint - The {x, y} pixel coordinates on the screen/canvas.
 * @param cameraParams - Current camera parameters (heading, pitch, vertical FOV).
 * @param viewWidth - The width of the viewport/canvas in pixels.
 * @param viewHeight - The height of the viewport/canvas in pixels.
 * @returns A normalized 3D direction vector {x, y, z}.
 */
/**
 * Get effective calibration pitch offset with enhanced zoom-level bias interpolation
 * Returns both the offset and confidence level
 */
export function getEffectiveCalibrationPitchOffset(
  cameraParams: CameraParams,
  settings?: { calibrationPitchOffsetDeg?: number; calibrationBiasByZoom?: Record<number, number | { bias: number; confidence: number; sampleCount: number; lastUpdated: number }> }
): { offset: number; confidence: number } {
  const baseOffset = settings?.calibrationPitchOffsetDeg ?? cameraParams.calibrationPitchOffsetDeg ?? 0;
  
  if (!settings?.calibrationBiasByZoom || !cameraParams.zoom) {
    return { offset: baseOffset, confidence: 0.8 }; // Default confidence for base offset
  }

  // Check if using new format with confidence
  const firstEntry = Object.values(settings.calibrationBiasByZoom)[0];
  const isNewFormat = firstEntry && typeof firstEntry === 'object' && 'bias' in firstEntry;

  if (isNewFormat) {
    const { interpolateZoomBias } = require('./depthCalibration');
    const zoomBias = interpolateZoomBias(cameraParams.zoom, settings.calibrationBiasByZoom as any);
    return {
      offset: baseOffset + zoomBias.bias,
      confidence: Math.min(1.0, zoomBias.confidence * 0.9) // Slightly reduce confidence for interpolation
    };
  } else {
    // Legacy format support
    const { interpolateZoomBias } = require('./depthCalibration');
    const zoomBias = interpolateZoomBias(cameraParams.zoom, settings.calibrationBiasByZoom as any);
    return {
      offset: baseOffset + zoomBias.bias,
      confidence: 0.6 // Lower confidence for legacy format
    };
  }
}

export function screenToWorld(screenPoint: Point, cameraParams: CameraParams, viewWidth: number, viewHeight: number, zoomBiasTable?: Record<number, number>): Vector3 {
    // Validate inputs
    if (!Number.isFinite(screenPoint.x) || !Number.isFinite(screenPoint.y) || 
        !Number.isFinite(viewWidth) || !Number.isFinite(viewHeight) ||
        viewWidth <= 0 || viewHeight <= 0) {
        return { x: 0, y: 0, z: 1 }; // Return default forward vector
    }

    const { heading = 0, pitch = 0, vFov = 90 } = cameraParams;
    const calibrationResult = zoomBiasTable
      ? getEffectiveCalibrationPitchOffset(cameraParams, zoomBiasTable)
      : { offset: cameraParams.calibrationPitchOffsetDeg ?? 0, confidence: 0.8 };
    const effectivePitch = pitch - calibrationResult.offset;

    // Clamp inputs to reasonable ranges
    const clampedHeading = Number.isFinite(heading) ? heading % 360 : 0;
    const clampedPitch = Number.isFinite(effectivePitch) ? Math.max(-90, Math.min(90, effectivePitch)) : 0;
    const clampedVFov = Number.isFinite(vFov) && vFov > 0 && vFov <= 180 ? vFov : 90;

    // 1. Convert screen coordinates to Normalized Device Coordinates (NDC)
    // NDC range from -1 to 1, with (0,0) at the center.
    const ndcX = (screenPoint.x / viewWidth) * 2 - 1;
    const ndcY = 1 - (screenPoint.y / viewHeight) * 2; // Invert Y because screen Y is down

    // Apply undistortion if distortion coefficients are provided
    let undistortedX = ndcX;
    let undistortedY = ndcY;
    if (cameraParams.distortion) {
        const undistorted = undistortPoint(ndcX, ndcY, cameraParams.distortion);
        undistortedX = undistorted.x;
        undistortedY = undistorted.y;
    }

    // 2. Account for FOV and aspect ratio
    // Calculate the distance from the camera to the projection plane based on FOV
    const fovRadians = degreesToRadiansValidated(clampedVFov);
    // tan(fov/2) = (projectionPlaneHeight/2) / distance
    // distance = (projectionPlaneHeight/2) / tan(fov/2)
    // Assuming projectionPlaneHeight corresponds to NDC range [-1, 1], so height/2 = 1
    const halfFovRad = fovRadians / 2;
    const tanHalfFov = Math.tan(halfFovRad);
    if (!Number.isFinite(tanHalfFov) || tanHalfFov <= 0) {
        return { x: 0, y: 0, z: 1 }; // Return default forward vector
    }
    const zDistance = 1 / tanHalfFov; 

    const aspectRatio = viewWidth / viewHeight;

    // 3. Initial vector on the projection plane (before rotation)
    // Z points *out* from the screen/camera initially
    let vector: Vector3 = {
        x: undistortedX * aspectRatio, // Scale X by aspect ratio
        y: undistortedY,
        z: zDistance,
    };

    // 4. Apply rotations based on camera heading and pitch
    const pitchTrig = getTrigValues(-clampedPitch);
    const cosPitch = pitchTrig.cos;
    const sinPitch = pitchTrig.sin;
    if (!Number.isFinite(cosPitch) || !Number.isFinite(sinPitch)) {
        return { x: 0, y: 0, z: 1 }; // Return default forward vector
    }
    
    let rotatedY = vector.y * cosPitch - vector.z * sinPitch;
    let rotatedZ = vector.y * sinPitch + vector.z * cosPitch;
    vector = { x: vector.x, y: rotatedY, z: rotatedZ };

    // Validate intermediate vector
    if (!Number.isFinite(vector.x) || !Number.isFinite(vector.y) || !Number.isFinite(vector.z)) {
        return { x: 0, y: 0, z: 1 }; // Return default forward vector
    }

    // Heading rotation (around Y-axis)
    // Positive heading turns right, negative turns left
    // Rotate the *opposite* way
    const headingTrig = getTrigValues(-clampedHeading);
    const cosHeading = headingTrig.cos;
    const sinHeading = headingTrig.sin;
    if (!Number.isFinite(cosHeading) || !Number.isFinite(sinHeading)) {
        return { x: 0, y: 0, z: 1 }; // Return default forward vector
    }
    
    let rotatedX = vector.x * cosHeading + vector.z * sinHeading;
    rotatedZ = -vector.x * sinHeading + vector.z * cosHeading;
    vector = { x: rotatedX, y: vector.y, z: rotatedZ };
    
    // Validate final vector before normalization
    if (!Number.isFinite(vector.x) || !Number.isFinite(vector.y) || !Number.isFinite(vector.z)) {
        return { x: 0, y: 0, z: 1 }; // Return default forward vector
    }
    
    // 5. Normalize the vector to get a unit direction vector
    // Conventionally, in Street View context: +Y is up, +X is right, +Z is forward.
    // Our calculation results in +Z forward, +Y up, +X right relative to camera view. Let's keep this.
    const normalized = normalizeVector3D(vector);
    if (!normalized) {
      return { x: 0, y: 0, z: 1 }; // Return default forward vector
    }
    
    // Validate normalized vector
    if (!Number.isFinite(normalized.x) || !Number.isFinite(normalized.y) || !Number.isFinite(normalized.z)) {
        return { x: 0, y: 0, z: 1 }; // Return default forward vector
    }
    
    (normalized as CalibratedVector3)[calibrationAppliedSymbol] = true;
    return normalized;
}

/**
 * Fast rejection test for ground plane intersection
 * Returns true if intersection is unlikely to succeed
 */
export function fastRejectGroundPlaneIntersection(
  directionVector: Vector3,
  cameraHeight: number
): boolean {
  // Fast validation checks
  if (!Number.isFinite(directionVector.y) || !Number.isFinite(cameraHeight)) {
    return true;
  }

  // Vector must point downward (negative y)
  if (directionVector.y >= 0) {
    return true;
  }

  // Reject vectors too close to horizontal
  const HORIZON_THRESHOLD = 0.01;
  if (Math.abs(directionVector.y) < HORIZON_THRESHOLD) {
    return true;
  }

  // Reject if camera height is invalid
  if (cameraHeight <= 0 || cameraHeight > 100) {
    return true;
  }

  return false;
}

/**
 * Estimates the 3D world coordinates by intersecting the direction vector
 * with a horizontal ground plane below the camera.
 * Assumes camera is at origin (0,0,0) and ground is at y = -cameraHeight.
 *
 * @param directionVector - Normalized 3D direction vector from the camera.
 * @param cameraParams - Camera parameters containing cameraHeight (meters).
 * @returns The estimated 3D world point {x, y, z} relative to the camera, or null if no intersection.
 */
export function estimateGroundPlaneIntersection(
    directionVector: Vector3,
    cameraParams?: CameraParams
): Vector3 | null {
    const cameraHeight = cameraParams?.cameraHeight ?? 2.5; // Default assumed height

    // Fast rejection first
    if (fastRejectGroundPlaneIntersection(directionVector, cameraHeight)) {
        return null;
    }

    const calibrationOffset = cameraParams?.calibrationPitchOffsetDeg ?? 0;
    let workingVector = directionVector as CalibratedVector3;

    if (!workingVector[calibrationAppliedSymbol] && calibrationOffset !== 0) {
        const calibrationTrig = getTrigValues(calibrationOffset);
        const rotatedY = workingVector.y * calibrationTrig.cos - workingVector.z * calibrationTrig.sin;
        const rotatedZ = workingVector.y * calibrationTrig.sin + workingVector.z * calibrationTrig.cos;
        const rotatedVector = {
            x: workingVector.x,
            y: rotatedY,
            z: rotatedZ,
        } as CalibratedVector3;
        rotatedVector[calibrationAppliedSymbol] = true;
        workingVector = rotatedVector;
        
        // Re-check after calibration rotation
        if (fastRejectGroundPlaneIntersection(workingVector, cameraHeight)) {
            return null;
        }
    }

    // Validate working vector components are finite
    if (!Number.isFinite(workingVector.x) || !Number.isFinite(workingVector.y) || !Number.isFinite(workingVector.z)) {
        return null;
    }

    // Calculate the scaling factor 't' such that the point P = t * D has P.y = -cameraHeight
    // t * directionVector.y = -cameraHeight
    const t = -cameraHeight / workingVector.y;

    // Validate t is finite and positive
    if (!Number.isFinite(t) || t <= 0 || t > 1e5) {
        return null;
    }

    // Calculate the intersection point
    const intersectionPoint: Vector3 = {
        x: t * workingVector.x,
        y: t * workingVector.y, // Should be approximately -cameraHeight
        z: t * workingVector.z,
    };

    // Final validation of intersection point
    if (!Number.isFinite(intersectionPoint.x) || !Number.isFinite(intersectionPoint.y) || !Number.isFinite(intersectionPoint.z)) {
        return null;
    }

    const dist = magnitude3D(intersectionPoint);
    if (dist > 1e5 || dist < 1e-6) {
        return null; // Unrealistic distance
    }

    return intersectionPoint;
}

/**
 * Calculates the 3D world coordinates corresponding to a 2D screen point using depth data.
 * 
 * @param screenPoint - The {x, y} pixel coordinates on the screen/canvas.
 * @param cameraParams - Current camera parameters (heading, pitch, vertical FOV).
 * @param viewWidth - The width of the viewport/canvas in pixels.
 * @param viewHeight - The height of the viewport/canvas in pixels.
 * @param depthData - Parsed depth data containing plane information.
 * @returns The calculated 3D world point {x, y, z} relative to the camera, or null if no intersection is found.
 */
export function screenToWorldWithDepth(
    screenPoint: Point,
    cameraParams: CameraParams,
    viewWidth: number,
    viewHeight: number,
    depthData: DecodedDepthData
): Vector3 | null {
    if (
        !depthData ||
        depthData.width <= 0 ||
        depthData.height <= 0 ||
        !depthData.indices ||
        depthData.indices.length === 0 ||
        !depthData.planes ||
        depthData.planes.length === 0
    ) {
        return null;
    }

    // 1. Map the screen pixel to a depth-map index
    const depthWidthMax = depthData.width - 1;
    const depthHeightMax = depthData.height - 1;
    const viewWidthRange = Math.max(viewWidth - 1, 1);
    const viewHeightRange = Math.max(viewHeight - 1, 1);
    const mappedX = (screenPoint.x / viewWidthRange) * depthWidthMax;
    const mappedY = (screenPoint.y / viewHeightRange) * depthHeightMax;
    const clampedMapX = Math.max(0, Math.min(depthWidthMax, mappedX));
    const clampedMapY = Math.max(0, Math.min(depthHeightMax, mappedY));
    const sampledPlaneIndex = samplePlaneIndexBilinear(clampedMapX, clampedMapY, depthData);
    const nearestX = Math.round(clampedMapX);
    const nearestY = Math.round(clampedMapY);
    const nearestIndex = nearestY * depthData.width + nearestX;
    const fallbackPlaneIndex = depthData.indices[nearestIndex];
    const planeIndex = sampledPlaneIndex ?? fallbackPlaneIndex;

    const normalizedHeading = Number((cameraParams.heading ?? 0).toFixed(6));
    const normalizedPitch = Number((cameraParams.pitch ?? 0).toFixed(6));
    const normalizedCalibrationOffset = Number((cameraParams.calibrationPitchOffsetDeg ?? 0).toFixed(6));
    const normalizedVFov = Number((cameraParams.vFov ?? 90).toFixed(6));
    const normalizedDistortion = cameraParams.distortion
      ? {
          k1: cameraParams.distortion.k1,
          k2: cameraParams.distortion.k2,
          p1: cameraParams.distortion.p1,
          p2: cameraParams.distortion.p2,
          ...(cameraParams.distortion.k3 !== undefined ? { k3: cameraParams.distortion.k3 } : {}),
        }
      : null;

    const cacheKey = getCacheKey('screenToWorldWithDepth', {
      screen: {
        x: Number(screenPoint.x.toFixed(3)),
        y: Number(screenPoint.y.toFixed(3)),
      },
      mapX: Number(clampedMapX.toFixed(4)),
      mapY: Number(clampedMapY.toFixed(4)),
      planeIndex: planeIndex ?? -1,
      heading: normalizedHeading,
      pitch: normalizedPitch,
      calibrationOffset: normalizedCalibrationOffset,
      vFov: normalizedVFov,
      viewWidth,
      viewHeight,
      distortion: normalizedDistortion,
      depthSignature: getDepthDataSignature(depthData),
    });

    const cachedResult = getCachedResult<Vector3 | null>(cacheKey);
    if (cachedResult !== CACHE_MISS) {
      return cachedResult;
    }

    // 2. Get the 3D direction vector for the screen point
    const directionVector = screenToWorld(screenPoint, cameraParams, viewWidth, viewHeight);

    let minDistance = Infinity;
    const epsilon = 1e-6; // Small value to avoid division by zero and parallel checks

    // 3. Try intersecting with the plane selected by the depth index if valid
    const isValidPlaneIndex =
        planeIndex != null && planeIndex !== 255 && planeIndex >= 0 && planeIndex < depthData.planes.length;
    if (isValidPlaneIndex) {
        const selectedPlane = depthData.planes[planeIndex!];
        if (selectedPlane) {
            // Fast rejection before expensive validation
            if (!fastRejectPlane(selectedPlane.nx, selectedPlane.ny, selectedPlane.nz, selectedPlane.d)) {
                // Validate and normalize plane normal
                const normal = validateAndNormalizePlaneNormal(
                    selectedPlane.nx,
                    selectedPlane.ny,
                    selectedPlane.nz
                );
                
                if (normal) {
                    const dotVN = dotProduct(directionVector, normal);
                    
                    // Reject near-parallel intersections (more conservative threshold)
                    const PARALLEL_THRESHOLD = epsilon * 10; // 1e-5
                    if (Math.abs(dotVN) >= PARALLEL_THRESHOLD) {
                        // Google depth planes follow n dot x + d = 0 with normals pointing toward the camera.
                        // The intersection distance along the viewing ray is therefore t = -d / (n dot v).
                        const t = -selectedPlane.d / dotVN;
                        
                        // Validate t is finite and within plausible scene bounds (0.1m to 10km)
                        const MIN_DISTANCE = 0.1;
                        const MAX_DISTANCE = 10000;
                        if (Number.isFinite(t) && t > MIN_DISTANCE && t < MAX_DISTANCE) {
                            // Validate the resulting world point
                            const testPoint: Vector3 = {
                                x: directionVector.x * t,
                                y: directionVector.y * t,
                                z: directionVector.z * t
                            };
                            if (Number.isFinite(testPoint.x) && Number.isFinite(testPoint.y) && Number.isFinite(testPoint.z)) {
                                const testDist = magnitude3D(testPoint);
                                if (testDist > MIN_DISTANCE && testDist < MAX_DISTANCE) {
                                    minDistance = t;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 4. Fall back to searching all planes if no valid plane was found
    if (minDistance === Infinity) {
        const PARALLEL_THRESHOLD = epsilon * 10; // 1e-5
        const MIN_DISTANCE = 0.1;
        const MAX_DISTANCE = 10000;
        
        for (const plane of depthData.planes) {
            // Fast rejection before expensive validation
            if (fastRejectPlane(plane.nx, plane.ny, plane.nz, plane.d)) {
                continue;
            }

            // Validate and normalize plane normal
            const normal = validateAndNormalizePlaneNormal(plane.nx, plane.ny, plane.nz);
            if (!normal) {
                continue; // Skip invalid plane
            }
            
            const dotVN = dotProduct(directionVector, normal);
            
            if (Math.abs(dotVN) < PARALLEL_THRESHOLD) {
                continue; // Skip near-parallel planes
            }
            
            // Same Street View plane convention applies when examining all planes.
            const t = -plane.d / dotVN;
            
            // Validate t is finite and closer than current best, within physical bounds
            if (Number.isFinite(t) && t > MIN_DISTANCE && t < minDistance && t < MAX_DISTANCE) {
                // Validate the resulting world point
                const testPoint: Vector3 = {
                    x: directionVector.x * t,
                    y: directionVector.y * t,
                    z: directionVector.z * t
                };
                if (Number.isFinite(testPoint.x) && Number.isFinite(testPoint.y) && Number.isFinite(testPoint.z)) {
                    const testDist = Math.hypot(testPoint.x, testPoint.y, testPoint.z);
                    if (testDist > MIN_DISTANCE && testDist < MAX_DISTANCE) {
                        minDistance = t;
                    }
                }
            }
        }
    }

    // 5. If a valid intersection distance was found, calculate the world point
    if (minDistance !== Infinity && Number.isFinite(minDistance)) {
        const worldPoint: Vector3 = {
            x: directionVector.x * minDistance,
            y: directionVector.y * minDistance,
            z: directionVector.z * minDistance,
        };
        
        // Final validation of world point with consistent bounds
        const MIN_DISTANCE = 0.1;
        const MAX_DISTANCE = 10000;
        if (Number.isFinite(worldPoint.x) && Number.isFinite(worldPoint.y) && Number.isFinite(worldPoint.z)) {
            const dist = magnitude3D(worldPoint);
            if (dist > MIN_DISTANCE && dist < MAX_DISTANCE) {
                setCachedResult(cacheKey, worldPoint);
                return worldPoint;
            }
        }
    }

    setCachedResult(cacheKey, null);
    return null; // No valid intersection found
}

/**
 * Calculates the Euclidean distance between two 3D points.
 *
 * @param point1 - The first 3D point.
 * @param point2 - The second 3D point.
 * @returns The distance in the same units as the point coordinates.
 */
/**
 * Calculates the Euclidean distance between two 3D points.
 * @deprecated Use distance3D from '../utils/math' instead
 */
export function calculateDistance3D(point1: Vector3, point2: Vector3): number {
    return distance3D(point1, point2);
}

// Automatic horizon detection using multi-scale RANSAC and Hough transform
export interface HorizonDetectionResult {
  pitchOffset: number;
  confidence: number;
  method: 'depth' | 'gradient' | 'hough' | 'fallback';
  detected: boolean;
}

/**
 * Enhanced multi-scale RANSAC with adaptive thresholding and quality-based selection
 */
function multiScaleRansacLineFit(
  points: Array<{ x: number; y: number; depth: number }>,
  scales: number[] = [1.0, 0.75, 0.5, 1.5, 2.0],
  baseIterations: number = 100,
  baseThreshold: number = 5.0
): { slope: number; intercept: number; inliers: number; scale: number; quality: number } | null {
  if (points.length < 4) return null;

  let bestResult: { slope: number; intercept: number; inliers: number; scale: number; quality: number } | null = null;
  let bestQuality = 0;

  // Sort scales to try most promising first (1.0 scale typically best)
  const sortedScales = [...scales].sort((a, b) => Math.abs(a - 1.0) - Math.abs(b - 1.0));

  for (const scale of sortedScales) {
    // Scale points for this iteration
    const scaledPoints = points.map(p => ({
      x: p.x * scale,
      y: p.y,
      depth: p.depth
    }));

    // Adaptive iterations: more for smaller scales (more challenging)
    const iterations = Math.floor(baseIterations * (1 + (1 - scale) * 0.5));
    const threshold = baseThreshold * Math.max(0.5, Math.min(2.0, scale));
    
    const result = ransacLineFit(scaledPoints, iterations, threshold);
    
    if (result) {
      const unscaledResult = {
        slope: result.slope / scale, // Unscale slope
        intercept: result.intercept,
        inliers: result.inliers,
        scale,
        quality: result.quality
      };

      // Select based on quality first, then inliers
      if (!bestResult || result.quality > bestQuality || 
          (result.quality === bestQuality && result.inliers > bestResult.inliers)) {
        bestResult = unscaledResult;
        bestQuality = result.quality;
      }

      // Early exit if we find an excellent result
      if (result.quality > 0.9 && result.inliers >= points.length * 0.5) {
        break;
      }
    }
  }

  return bestResult;
}

/**
 * Hough transform for robust line detection (alternative to RANSAC)
 */
function houghLineFit(
  points: Array<{ x: number; y: number; depth: number }>,
  viewWidth: number,
  viewHeight: number
): { slope: number; intercept: number; votes: number } | null {
  // Hough space: (rho, theta) where rho is distance from origin, theta is angle
  const NUM_THETA = 180; // 1 degree resolution
  const NUM_RHO = Math.ceil(Math.sqrt(viewWidth * viewWidth + viewHeight * viewHeight));
  
  const accumulator: number[][] = [];
  for (let i = 0; i < NUM_RHO; i++) {
    accumulator[i] = new Array(NUM_THETA).fill(0);
  }

  const maxRho = Math.sqrt(viewWidth * viewWidth + viewHeight * viewHeight);
  
  // Vote for lines
  for (const point of points) {
    for (let thetaIdx = 0; thetaIdx < NUM_THETA; thetaIdx++) {
      const theta = (thetaIdx * Math.PI) / NUM_THETA;
      const rho = point.x * Math.cos(theta) + point.y * Math.sin(theta);
      const rhoIdx = Math.floor((rho + maxRho) / (2 * maxRho) * NUM_RHO);
      
      if (rhoIdx >= 0 && rhoIdx < NUM_RHO) {
        if (!accumulator[rhoIdx]) {
          accumulator[rhoIdx] = new Array(NUM_THETA).fill(0);
        }
        accumulator[rhoIdx]![thetaIdx] = (accumulator[rhoIdx]![thetaIdx] || 0) + 1;
      }
    }
  }

  // Find peak
  let maxVotes = 0;
  let bestRhoIdx = 0;
  let bestThetaIdx = 0;
  
  for (let rhoIdx = 0; rhoIdx < NUM_RHO; rhoIdx++) {
    const rhoAccumulator = accumulator[rhoIdx];
    if (!rhoAccumulator) continue;

    for (let thetaIdx = 0; thetaIdx < NUM_THETA; thetaIdx++) {
      const votes = rhoAccumulator[thetaIdx];
      if (votes !== undefined && votes > maxVotes) {
        maxVotes = votes;
        bestRhoIdx = rhoIdx;
        bestThetaIdx = thetaIdx;
      }
    }
  }

  if (maxVotes < points.length * 0.2) {
    return null; // Not enough votes
  }

  const theta = (bestThetaIdx * Math.PI) / NUM_THETA;
  const rho = ((bestRhoIdx / NUM_RHO) * 2 * maxRho) - maxRho;

  // Convert (rho, theta) to (slope, intercept)
  if (Math.abs(Math.sin(theta)) < 1e-6) {
    return null; // Vertical line, not useful for horizon
  }

  const slope = -Math.cos(theta) / Math.sin(theta);
  const intercept = rho / Math.sin(theta);

  return { slope, intercept, votes: maxVotes };
}

// Temporal smoothing for horizon detection
class HorizonTracker {
  private history: Array<{ pitchOffset: number; confidence: number; timestamp: number }> = [];
  private readonly maxHistory = 10;
  private readonly timeWindow = 2000; // 2 seconds

  add(pitchOffset: number, confidence: number): void {
    const now = Date.now();
    this.history.push({ pitchOffset, confidence, timestamp: now });
    
    // Remove old entries
    this.history = this.history.filter(h => now - h.timestamp < this.timeWindow);
    
    // Limit size
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory);
    }
  }

  getSmoothed(): { pitchOffset: number; confidence: number } | null {
    if (this.history.length === 0) return null;
    
    // Weighted average by confidence, with exponential decay for older samples
    const now = Date.now();
    let totalWeight = 0;
    let weightedSum = 0;
    let maxConfidence = 0;

    for (const entry of this.history) {
      const age = now - entry.timestamp;
      const timeWeight = Math.exp(-age / (this.timeWindow / 2)); // Exponential decay
      const weight = entry.confidence * timeWeight;
      totalWeight += weight;
      weightedSum += entry.pitchOffset * weight;
      maxConfidence = Math.max(maxConfidence, entry.confidence);
    }

    if (totalWeight === 0) return null;

    return {
      pitchOffset: weightedSum / totalWeight,
      confidence: maxConfidence * Math.min(1, this.history.length / 3) // Boost confidence with more samples
    };
  }

  reset(): void {
    this.history = [];
  }
}

const horizonTracker = new HorizonTracker();

/**
 * Gradient-based horizon detection using depth discontinuities
 */
function detectHorizonFromGradient(
  onnxDepthMap: OnnxDepthMap | null,
  _viewWidth: number,
  viewHeight: number
): { horizonY: number; confidence: number } | null {
  if (!onnxDepthMap) return null;

  const depthMap = onnxDepthMap.data;
  const mapWidth = onnxDepthMap.width;
  const mapHeight = onnxDepthMap.height;
  
  // Compute vertical gradients for each row
  const rowGradients: number[] = [];
  const minGradientY = Math.floor(mapHeight * 0.3);
  const maxGradientY = Math.floor(mapHeight * 0.85);

  for (let y = minGradientY; y < maxGradientY; y++) {
    let totalGradient = 0;
    let count = 0;

    for (let x = 1; x < mapWidth - 1; x += 2) {
      const idx = y * mapWidth + x;
      if (idx >= depthMap.length || idx < 0) continue;

      const center = depthMap[idx];
      const up = depthMap[Math.max(0, (y - 1) * mapWidth + x)];
      const down = depthMap[Math.min(depthMap.length - 1, (y + 1) * mapWidth + x)];

      if (center && up && down && center > 0 && up > 0 && down > 0) {
        const verticalGradient = Math.abs(down - up) / center;
        totalGradient += verticalGradient;
        count++;
      }
    }

    if (count > 0) {
      rowGradients.push(totalGradient / count);
    } else {
      rowGradients.push(Infinity);
    }
  }

  // Find row with minimum gradient (horizon typically has low vertical gradient)
  let minGradient = Infinity;
  let bestRow = -1;
  for (let i = 0; i < rowGradients.length; i++) {
    if (rowGradients[i]! < minGradient && Number.isFinite(rowGradients[i]!)) {
      minGradient = rowGradients[i]!;
      bestRow = i + minGradientY;
    }
  }

  if (bestRow === -1 || minGradient === Infinity) return null;

  // Convert to viewport coordinates
  const horizonY = (bestRow / mapHeight) * viewHeight;
  
  // Confidence based on gradient magnitude (lower is better for horizon)
  const normalizedGradient = Math.min(1, minGradient * 10);
  const confidence = Math.max(0.3, 1 - normalizedGradient);

  return { horizonY, confidence };
}

export function detectHorizonFromDepth(
  depthData: DecodedDepthData | null,
  cameraParams: CameraParams,
  viewWidth: number,
  viewHeight: number,
  onnxDepthMap?: OnnxDepthMap | null,
  useTemporalSmoothing: boolean = true
): HorizonDetectionResult {
  if (!depthData || depthData.planes.length === 0) {
    // Try gradient-based detection as fallback
    if (onnxDepthMap) {
      const gradientResult = detectHorizonFromGradient(onnxDepthMap, viewWidth, viewHeight);
      if (gradientResult) {
        const centerY = viewHeight / 2;
        const pixelOffset = gradientResult.horizonY - centerY;
        const vFov = cameraParams.vFov || 90;
        const angleOffset = pixelOffsetToVerticalAngle(centerY - pixelOffset, viewHeight, vFov);
        const pitchOffset = Math.max(-30, Math.min(30, -angleOffset));
        
        const result = {
          pitchOffset,
          confidence: gradientResult.confidence * 0.7, // Lower confidence for gradient-only
          method: 'gradient' as const,
          detected: true
        };
        
        if (useTemporalSmoothing) {
          horizonTracker.add(pitchOffset, result.confidence);
          const smoothed = horizonTracker.getSmoothed();
          if (smoothed) {
            return { ...result, pitchOffset: smoothed.pitchOffset, confidence: smoothed.confidence };
          }
        }
        
        return result;
      }
    }
    return { pitchOffset: 0, confidence: 0, method: 'fallback', detected: false };
  }

  // Sample points along the bottom 60% of the image (horizon typically in lower portion)
  const samplePoints: Array<{ x: number; y: number; depth: number }> = [];
  const bottomStart = Math.floor(viewHeight * 0.4);
  const bottomEnd = Math.floor(viewHeight * 0.95);

  // Adaptive sampling: denser near expected horizon
  const expectedHorizonY = viewHeight * 0.6; // Rough estimate
  const horizonBand = viewHeight * 0.15; // Band around expected horizon
  
  for (let y = bottomStart; y < bottomEnd; y++) {
    // Adaptive step size: smaller near expected horizon
    const distanceFromExpected = Math.abs(y - expectedHorizonY);
    const stepSize = distanceFromExpected < horizonBand ? 1 : 2;
    
    if ((y - bottomStart) % stepSize !== 0) continue;
    
    for (let x = 0; x < viewWidth; x += 4) {
      try {
        const depth = screenToWorldWithDepth({ x, y }, cameraParams, viewWidth, viewHeight, depthData);
        if (depth) {
          const distance = Math.sqrt(depth.x * depth.x + depth.y * depth.y + depth.z * depth.z);
          // Filter out invalid depths
          if (distance > 0.1 && distance < 1e4 && Number.isFinite(distance)) {
            samplePoints.push({ x, y, depth: distance });
          }
        }
      } catch {
        // Skip invalid points
      }
    }
  }

  if (samplePoints.length < 20) {
    // Try gradient-based detection as fallback
    if (onnxDepthMap) {
      const gradientResult = detectHorizonFromGradient(onnxDepthMap, viewWidth, viewHeight);
      if (gradientResult) {
        const centerY = viewHeight / 2;
        const pixelOffset = gradientResult.horizonY - centerY;
        const vFov = cameraParams.vFov || 90;
        const angleOffset = pixelOffsetToVerticalAngle(centerY - pixelOffset, viewHeight, vFov);
        const pitchOffset = Math.max(-30, Math.min(30, -angleOffset));
        return {
          pitchOffset,
          confidence: gradientResult.confidence * 0.6,
          method: 'gradient',
          detected: true
        };
      }
    }
    return { pitchOffset: 0, confidence: 0, method: 'fallback', detected: false };
  }

  // Multi-method detection with confidence weighting
  const methods: Array<{ pitchOffset: number; confidence: number; method: 'ransac' | 'hough' | 'gradient' }> = [];

  // Try enhanced multi-scale RANSAC
  const ransacResult = multiScaleRansacLineFit(samplePoints, [1.0, 0.75, 0.5, 1.5, 2.0], 150, 5.0);
  if (ransacResult && ransacResult.inliers >= samplePoints.length * 0.25) {
    const centerY = viewHeight / 2;
    const horizonY = ransacResult.intercept + ransacResult.slope * (viewWidth / 2);
    const pixelOffset = horizonY - centerY;
    const vFov = cameraParams.vFov || 90;
    const angleOffset = pixelOffsetToVerticalAngle(centerY - pixelOffset, viewHeight, vFov);
    const pitchOffset = Math.max(-30, Math.min(30, -angleOffset));
    
    // Enhanced confidence: combines inlier ratio and quality metric
    const inlierRatio = ransacResult.inliers / samplePoints.length;
    const confidence = Math.min(1.0, inlierRatio * 0.7 + ransacResult.quality * 0.3);
    
    // More lenient slope check: horizon can have slight tilt
    if (Math.abs(ransacResult.slope) <= 0.15) {
      methods.push({ pitchOffset, confidence, method: 'ransac' });
    }
  }
  
  // Try Hough transform
  const houghResult = houghLineFit(samplePoints, viewWidth, viewHeight);
  if (houghResult && houghResult.votes >= samplePoints.length * 0.3) {
    const centerY = viewHeight / 2;
    const horizonY = houghResult.intercept + houghResult.slope * (viewWidth / 2);
    const pixelOffset = horizonY - centerY;
    const vFov = cameraParams.vFov || 90;
    const angleOffset = pixelOffsetToVerticalAngle(centerY - pixelOffset, viewHeight, vFov);
    const pitchOffset = Math.max(-30, Math.min(30, -angleOffset));
    const confidence = Math.min(1.0, houghResult.votes / samplePoints.length);
    
    if (Math.abs(houghResult.slope) <= 0.1) {
      methods.push({ pitchOffset, confidence, method: 'hough' });
    }
  }

  // Try gradient-based detection if available
  if (onnxDepthMap) {
    const gradientResult = detectHorizonFromGradient(onnxDepthMap, viewWidth, viewHeight);
    if (gradientResult) {
      const centerY = viewHeight / 2;
      const pixelOffset = gradientResult.horizonY - centerY;
      const vFov = cameraParams.vFov || 90;
      const angleOffset = pixelOffsetToVerticalAngle(centerY - pixelOffset, viewHeight, vFov);
      const pitchOffset = Math.max(-30, Math.min(30, -angleOffset));
      methods.push({ pitchOffset, confidence: gradientResult.confidence * 0.8, method: 'gradient' });
    }
  }

  if (methods.length === 0) {
    return { pitchOffset: 0, confidence: 0, method: 'fallback', detected: false };
  }

  // Fuse methods using confidence-weighted average
  let totalWeight = 0;
  let weightedSum = 0;
  let bestMethod: 'ransac' | 'hough' | 'gradient' | 'fallback' = 'fallback';
  let maxConfidence = 0;

  for (const method of methods) {
    const weight = method.confidence * method.confidence; // Square for stronger weighting
    totalWeight += weight;
    weightedSum += method.pitchOffset * weight;
    if (method.confidence > maxConfidence) {
      maxConfidence = method.confidence;
      bestMethod = method.method;
    }
  }

  const fusedPitchOffset = totalWeight > 0 ? weightedSum / totalWeight : 0;
  const fusedConfidence = Math.min(1.0, maxConfidence * (methods.length / 2)); // Boost with multiple methods

  const result: HorizonDetectionResult = {
    pitchOffset: fusedPitchOffset,
    confidence: fusedConfidence,
    method: bestMethod === 'ransac' || bestMethod === 'hough' ? 'depth' : bestMethod,
    detected: true
  };

  // Apply temporal smoothing
  if (useTemporalSmoothing && result.detected) {
    horizonTracker.add(result.pitchOffset, result.confidence);
    const smoothed = horizonTracker.getSmoothed();
    if (smoothed) {
      return { ...result, pitchOffset: smoothed.pitchOffset, confidence: smoothed.confidence };
    }
  }

  return result;
}

/**
 * Enhanced RANSAC line fitting with adaptive thresholds and early termination
 * Uses progressive sampling and quality-based iteration control
 */
function ransacLineFit(
  points: Array<{ x: number; y: number; depth: number }>,
  maxIterations: number,
  threshold: number
): { slope: number; intercept: number; inliers: number; quality: number } | null {
  if (points.length < 2) return null;

  let bestLine: { slope: number; intercept: number; inliers: number; quality: number } | null = null;
  let bestInlierRatio = 0;
  const minInlierRatio = 0.3; // Minimum acceptable inlier ratio
  const earlyTerminationRatio = 0.95; // Stop if we find a line with this many inliers

  // Pre-compute point distances for adaptive thresholding
  const pointDepths = points.map(p => p.depth);
  const minDepth = Math.min(...pointDepths);
  const maxDepth = Math.max(...pointDepths);
  const depthRange = maxDepth - minDepth || 1;

  // Adaptive threshold based on depth variation
  const adaptiveThreshold = threshold * (1 + depthRange / 100);

  // Target depth for horizon detection (used in sampling and thresholding)
  const depthTarget = minDepth + depthRange * 0.5;

  // Progressive sampling: start with small random samples, expand if needed
  const sampleIndices = Array.from({ length: points.length }, (_, i) => i);
  
  // Shuffle for random sampling
  for (let i = sampleIndices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [sampleIndices[i], sampleIndices[j]] = [sampleIndices[j]!, sampleIndices[i]!];
  }

  let consecutiveFailures = 0;
  const maxConsecutiveFailures = Math.floor(maxIterations * 0.3);

  for (let iter = 0; iter < maxIterations; iter++) {
    // Early termination if we have a high-quality result
    if (bestInlierRatio >= earlyTerminationRatio && iter > 10) {
      break;
    }

    // Progressive sample selection: prefer points with similar depths (horizon consistency)
    let idx1: number, idx2: number;
    if (iter < maxIterations * 0.5) {
      // First half: random sampling
      idx1 = Math.floor(Math.random() * points.length);
      idx2 = Math.floor(Math.random() * points.length);
    } else {
      // Second half: depth-guided sampling (horizon points often have similar depths)
      const depthSorted = [...points]
        .map((p, i) => ({ point: p, idx: i, depthDiff: Math.abs(p.depth - depthTarget) }))
        .sort((a, b) => a.depthDiff - b.depthDiff)
        .slice(0, Math.min(20, points.length));
      
      if (depthSorted.length >= 2) {
        const selected = depthSorted[Math.floor(Math.random() * depthSorted.length)]!;
        idx1 = selected.idx;
        const secondSelected = depthSorted.filter(s => s.idx !== idx1)[Math.floor(Math.random() * (depthSorted.length - 1))];
        idx2 = secondSelected?.idx ?? Math.floor(Math.random() * points.length);
      } else {
        idx1 = Math.floor(Math.random() * points.length);
        idx2 = Math.floor(Math.random() * points.length);
      }
    }

    if (idx1 === idx2 || idx1 >= points.length || idx2 >= points.length) {
      consecutiveFailures++;
      if (consecutiveFailures > maxConsecutiveFailures) break;
      continue;
    }

    const p1 = points[idx1]!;
    const p2 = points[idx2]!;

    // Skip if points are too close (numerically unstable)
    const dx = p2.x - p1.x;
    if (Math.abs(dx) < 1e-6) {
      consecutiveFailures++;
      continue;
    }

    // Calculate line parameters (y = mx + b)
    const slope = (p2.y - p1.y) / dx;
    const intercept = p1.y - slope * p1.x;

    // Skip extreme slopes (horizon should be nearly horizontal)
    if (Math.abs(slope) > 0.5) {
      consecutiveFailures++;
      continue;
    }

    // Count inliers with adaptive threshold
    let inliers = 0;
    let totalError = 0;
    const inlierPoints: Array<{ x: number; y: number }> = [];

    for (const point of points) {
      const expectedY = slope * point.x + intercept;
      const distance = Math.abs(point.y - expectedY);
      
      // Adaptive threshold based on point depth
      const pointThreshold = adaptiveThreshold * (1 + Math.abs(point.depth - depthTarget) / depthRange * 0.5);
      
      if (distance < pointThreshold) {
        inliers++;
        totalError += distance;
        inlierPoints.push({ x: point.x, y: point.y });
      }
    }

    const inlierRatio = inliers / points.length;
    
    // Quality metric: combines inlier ratio and average error
    const avgError = inliers > 0 ? totalError / inliers : Infinity;
    const quality = inlierRatio * (1 - Math.min(1, avgError / threshold));

    // Update best line
    if (!bestLine || quality > bestLine.quality || (quality === bestLine.quality && inliers > bestLine.inliers)) {
      bestLine = { slope, intercept, inliers, quality };
      bestInlierRatio = inlierRatio;
      consecutiveFailures = 0;
    } else {
      consecutiveFailures++;
    }

    // Early termination conditions
    if (bestInlierRatio >= earlyTerminationRatio && iter > 10) break;
    if (consecutiveFailures > maxConsecutiveFailures) break;
  }

  // Refine best line using least squares on inliers
  if (bestLine && bestLine.inliers >= points.length * minInlierRatio) {
    // Re-compute inliers for refinement
    const inlierPoints: Array<{ x: number; y: number }> = [];
    for (const point of points) {
      const expectedY = bestLine.slope * point.x + bestLine.intercept;
      const distance = Math.abs(point.y - expectedY);
      if (distance < adaptiveThreshold) {
        inlierPoints.push({ x: point.x, y: point.y });
      }
    }

    if (inlierPoints.length >= 2) {
      // Least squares refinement
      let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
      for (const p of inlierPoints) {
        sumX += p.x;
        sumY += p.y;
        sumXY += p.x * p.y;
        sumX2 += p.x * p.x;
      }
      const n = inlierPoints.length;
      const denom = n * sumX2 - sumX * sumX;
      if (Math.abs(denom) > 1e-6) {
        const refinedSlope = (n * sumXY - sumX * sumY) / denom;
        const refinedIntercept = (sumY - refinedSlope * sumX) / n;
        
        // Verify refinement improved quality
        let refinedInliers = 0;
        for (const point of points) {
          const expectedY = refinedSlope * point.x + refinedIntercept;
          const distance = Math.abs(point.y - expectedY);
          if (distance < adaptiveThreshold) {
            refinedInliers++;
          }
        }
        
        if (refinedInliers >= bestLine.inliers) {
          const refinedQuality = (refinedInliers / points.length) * (1 - Math.min(1, adaptiveThreshold / threshold));
          return { slope: refinedSlope, intercept: refinedIntercept, inliers: refinedInliers, quality: refinedQuality };
        }
      }
    }
  }

  return bestLine && bestLine.inliers >= points.length * minInlierRatio ? bestLine : null;
}

// Convert pixel offset to vertical angle (similar to existing function but more robust)
function pixelOffsetToVerticalAngle(pixelY: number, viewHeight: number, vFov: number): number {
  // Validate inputs to prevent division by zero and NaN
  if (!Number.isFinite(pixelY) || !Number.isFinite(viewHeight) || !Number.isFinite(vFov)) {
    return 0;
  }

  if (viewHeight <= 0) {
    return 0;
  }

  // Clamp vFov to valid range
  const clampedVFov = Math.max(1, Math.min(179, vFov));

  // Normalize pixel coordinate to [-1, 1] range
  const normalizedY = 1 - (pixelY / viewHeight) * 2; // Flip Y axis

  // Clamp normalizedY to prevent extreme values
  const clampedY = Math.max(-1, Math.min(1, normalizedY));

  // Convert to angle using FOV
  const vFovRad = degreesToRadiansValidated(clampedVFov);
  const tanHalfFov = Math.tan(vFovRad / 2);
  
  // Validate tan result
  if (!Number.isFinite(tanHalfFov) || tanHalfFov <= 0) {
    return 0;
  }

  const angleRad = Math.atan2(clampedY * tanHalfFov, 1);

  // Validate result
  if (!Number.isFinite(angleRad)) {
    return 0;
  }

  return angleRad * 180 / Math.PI;
}

// Enhanced ground plane intersection with confidence scoring
export interface GroundPlaneResult {
  point: Vector3 | null;
  confidence: number;
  method: 'ground' | 'planes' | 'onnx';
}

export function estimateGroundPlaneIntersectionWithConfidence(
  directionVector: Vector3,
  cameraParams: CameraParams,
  depthData?: DecodedDepthData | null,
  viewWidth?: number,
  viewHeight?: number
): GroundPlaneResult {
  // Try depth-based intersection first
  if (depthData && viewWidth && viewHeight) {
    // This would use the depth data for more accurate intersection
    // For now, fall back to the existing method
  }

  // Use existing ground plane estimation
  const point = estimateGroundPlaneIntersection(directionVector, cameraParams);

  if (point) {
    // Calculate confidence based on direction vector properties
    const horizontalComponent = Math.sqrt(directionVector.x * directionVector.x + directionVector.z * directionVector.z);
    const verticalComponent = Math.abs(directionVector.y);

    // High confidence if vector points significantly downward and has reasonable horizontal spread
    const confidence = Math.min(1.0, (verticalComponent / horizontalComponent) * 0.5);

    return {
      point,
      confidence: Math.max(0.1, confidence), // Minimum confidence
      method: 'ground'
    };
  }

  return {
    point: null,
    confidence: 0,
    method: 'ground'
  };
}

export function clearGeometryCaches(): void {
  calculationCache.clear();
  fovCache.clear();
  trigCache.clear();
  // WeakMap doesn't need explicit clearing - entries are GC'd automatically
  // depthDataSignatureCache entries will be garbage collected when depthData objects are GC'd
}

export function getGeometryCacheStats(): {
  calculationCacheSize: number;
  fovCacheSize: number;
  trigCacheSize: number;
  depthSignatureCacheSize: number;
  calculationCacheStats: ReturnType<typeof calculationCache.getStats>;
  fovCacheStats: ReturnType<typeof fovCache.getStats>;
  trigCacheStats: ReturnType<typeof trigCache.getStats>;
} {
  return {
    calculationCacheSize: calculationCache.size(),
    fovCacheSize: fovCache.size(),
    trigCacheSize: trigCache.size(),
    depthSignatureCacheSize: -1, // WeakMap doesn't expose size - entries are GC'd automatically
    calculationCacheStats: calculationCache.getStats(),
    fovCacheStats: fovCache.getStats(),
    trigCacheStats: trigCache.getStats(),
  };
}

/**
 * Fast rejection test for plane validity (checks before full validation)
 * Returns true if plane should be rejected immediately
 */
export function fastRejectPlane(
  nx: number,
  ny: number,
  nz: number,
  d: number
): boolean {
  // Fast NaN/Infinity check
  if (!Number.isFinite(nx) || !Number.isFinite(ny) || !Number.isFinite(nz) || !Number.isFinite(d)) {
    return true;
  }

  // Fast normal length check (squared to avoid sqrt)
  const normalLenSq = nx * nx + ny * ny + nz * nz;
  if (normalLenSq < 1e-12 || normalLenSq > 4.0) {
    return true; // Normal too short or too long
  }

  // Fast d range check (planes too far are likely invalid)
  if (Math.abs(d) > 1e6) {
    return true;
  }

  return false;
}

/**
 * Validate and normalize plane normal vector
 * Returns normalized normal vector or null if invalid
 */
export function validateAndNormalizePlaneNormal(
  nx: number,
  ny: number,
  nz: number
): Vector3 | null {
  // Fast rejection first
  if (fastRejectPlane(nx, ny, nz, 0)) {
    return null;
  }

  const normalized = normalizeVector3D({ x: nx, y: ny, z: nz });
  if (!normalized) {
    return null;
  }
  
  // Validate normal length (should be near 1.0 for unit vectors, allow some drift)
  const normalLen = magnitude3D(normalized);
  if (!Number.isFinite(normalLen) || normalLen < 1e-6 || normalLen > 2.0) {
    return null;
  }

  return normalized;
}

/**
 * Validate complete plane equation: n dot x + d = 0
 * Returns true if plane is valid for intersection calculations
 */
export function validatePlaneEquation(
  nx: number,
  ny: number,
  nz: number,
  d: number
): boolean {
  if (fastRejectPlane(nx, ny, nz, d)) {
    return false;
  }

  const normal = validateAndNormalizePlaneNormal(nx, ny, nz);
  return normal !== null;
}

// Lightweight invariant check helper for plane parameters (development builds)
export function validatePlaneInvariant(plane: { nx: number; ny: number; nz: number; d: number }): boolean {
  return validatePlaneEquation(plane.nx, plane.ny, plane.nz, plane.d);
}

/**
 * Calculate height between two 3D points with improved accuracy
 * Handles edge cases and provides confidence score
 */
export interface HeightEstimate {
  height: number;
  confidence: number;
  method: 'direct' | 'projected' | 'angle';
}

export function estimateHeightBetweenPoints(
  basePoint: Vector3,
  topPoint: Vector3,
  cameraPosition: Vector3 = { x: 0, y: 0, z: 0 }
): HeightEstimate | null {
  // Validate inputs
  if (!Number.isFinite(basePoint.y) || !Number.isFinite(topPoint.y)) {
    return null;
  }

  // Direct height difference (most accurate when both points have valid depth)
  const directHeight = topPoint.y - basePoint.y;
  
  if (Number.isFinite(directHeight) && Math.abs(directHeight) < 1000) {
    // High confidence for direct measurement with reasonable height
    return {
      height: directHeight,
      confidence: 0.9,
      method: 'direct'
    };
  }

  // Fallback: calculate horizontal distance and use angle
  const baseDist = Math.hypot(
    basePoint.x - cameraPosition.x,
    basePoint.z - cameraPosition.z
  );
  const topDist = Math.hypot(
    topPoint.x - cameraPosition.x,
    topPoint.z - cameraPosition.z
  );

  if (baseDist > 0.1 && topDist > 0.1) {
    // Use average distance for angle-based estimation
    const avgDist = (baseDist + topDist) / 2;
    const projectedHeight = directHeight * (avgDist / Math.max(baseDist, topDist));
    
    if (Number.isFinite(projectedHeight) && Math.abs(projectedHeight) < 1000) {
      return {
        height: projectedHeight,
        confidence: 0.6,
        method: 'projected'
      };
    }
  }

  return null;
}

/**
 * Calculate intersection point between ray and plane with validation
 * Returns intersection point and confidence score
 */
export interface PlaneIntersectionResult {
  point: Vector3;
  distance: number;
  confidence: number;
}

export function intersectRayWithPlane(
  rayOrigin: Vector3,
  rayDirection: Vector3,
  planeNormal: Vector3,
  planeD: number
): PlaneIntersectionResult | null {
  // Fast rejection
  if (fastRejectPlane(planeNormal.x, planeNormal.y, planeNormal.z, planeD)) {
    return null;
  }

  // Normalize plane normal
  const normal = validateAndNormalizePlaneNormal(planeNormal.x, planeNormal.y, planeNormal.z);
  if (!normal) {
    return null;
  }

  // Validate ray direction
  if (!Number.isFinite(rayDirection.x) || !Number.isFinite(rayDirection.y) || !Number.isFinite(rayDirection.z)) {
    return null;
  }

  const dotVN = dotProduct(rayDirection, normal);
  const PARALLEL_THRESHOLD = 1e-5;
  
  if (Math.abs(dotVN) < PARALLEL_THRESHOLD) {
    return null; // Ray is parallel to plane
  }

  // Calculate intersection distance: t = -(n dot o + d) / (n dot v)
  const dotON = dotProduct(rayOrigin, normal);
  const t = -(dotON + planeD) / dotVN;

  if (!Number.isFinite(t) || t < 0.1 || t > 10000) {
    return null;
  }

  // Calculate intersection point
  const point: Vector3 = {
    x: rayOrigin.x + rayDirection.x * t,
    y: rayOrigin.y + rayDirection.y * t,
    z: rayOrigin.z + rayDirection.z * t
  };

  // Validate point
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) {
    return null;
  }

  const dist = magnitude3D(point);
  if (dist < 0.1 || dist > 10000) {
    return null;
  }

  // Calculate confidence based on angle between ray and plane
  const angleRad = Math.acos(Math.abs(dotVN));
  const confidence = Math.min(1.0, angleRad / (Math.PI / 2)); // Higher confidence for perpendicular rays

  return {
    point,
    distance: t,
    confidence
  };
}
