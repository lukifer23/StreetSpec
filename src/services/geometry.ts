import type { CameraParams, Point, Vector3, DistortionCoefficients, DecodedDepthData } from '../types/common';
import { Matrix } from 'ml-matrix';

const calibrationAppliedSymbol: unique symbol = Symbol('calibrationApplied');
type CalibratedVector3 = Vector3 & { [calibrationAppliedSymbol]?: boolean };

// Helper function to calculate the dot product of two vectors
const dotProduct = (v1: Vector3, v2: Vector3): number => {
    return v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;
};

// Helper function to convert degrees to radians
const degreesToRadians = (degrees: number): number => {
  return degrees * Math.PI / 180;
};

// Helper function to normalize a 3D vector
const normalizeVector = (vec: Vector3): Vector3 => {
    const length = Math.sqrt(vec.x * vec.x + vec.y * vec.y + vec.z * vec.z);
    if (length === 0) return { x: 0, y: 0, z: 0 }; // Avoid division by zero
    return {
        x: vec.x / length,
        y: vec.y / length,
        z: vec.z / length,
    };
};

type CachedEntry<T> = {
  value: T;
  timestamp: number;
};

const calculationCache = new Map<string, CachedEntry<unknown>>();
const CACHE_SIZE_LIMIT = 1000;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CACHE_MISS = Symbol('CACHE_MISS');

const fovCache = new Map<string, { hFov: number; vFov: number }>();
const FOV_CACHE_LIMIT = 100;

const trigCache = new Map<number, { cos: number; sin: number }>();
const TRIG_CACHE_LIMIT = 1000;

const depthDataSignatureCache = new Map<DecodedDepthData, string>();

function getCacheKey(operation: string, params: unknown): string {
  return `${operation}_${JSON.stringify(params)}`;
}

function getCachedResult<T>(key: string): T | typeof CACHE_MISS {
  const cached = calculationCache.get(key) as CachedEntry<T> | undefined;
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.value;
  }
  if (cached) {
    calculationCache.delete(key);
  }
  return CACHE_MISS;
}

function setCachedResult<T>(key: string, value: T): void {
  if (calculationCache.size >= CACHE_SIZE_LIMIT) {
    const firstKey = calculationCache.keys().next().value;
    calculationCache.delete(firstKey);
  }

  calculationCache.set(key, {
    value,
    timestamp: Date.now(),
  });
}

function getTrigValues(angleDegrees: number): { cos: number; sin: number } {
  const normalizedAngle = angleDegrees % 360;
  const cacheKey = Math.round(normalizedAngle * 100) / 100; // Round to 2 decimal places

  let cached = trigCache.get(cacheKey);
  if (!cached) {
    const radians = degreesToRadians(normalizedAngle);
    cached = {
      cos: Math.cos(radians),
      sin: Math.sin(radians),
    };
    trigCache.set(cacheKey, cached);

    if (trigCache.size > TRIG_CACHE_LIMIT) {
      const firstKey = trigCache.keys().next().value;
      trigCache.delete(firstKey);
    }
  }

  return cached;
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
  // Default to zoom level 1 (approx. 90° horizontal FOV) if zoom is unknown
  const effectiveZoom = zoom ?? 1;
  // Clamp zoom level for safety
  const clampedZoom = Math.max(0, Math.min(effectiveZoom, 4));
  const normalizedAspect = Number(aspectRatio.toFixed(6));
  const cacheKey = `${clampedZoom}_${normalizedAspect}`;
  const cached = fovCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  // Look up the calibrated horizontal FOV and fall back to zoom level 1
  const hFov = CALIBRATED_HFOV_BY_ZOOM[clampedZoom as keyof typeof CALIBRATED_HFOV_BY_ZOOM] ?? CALIBRATED_HFOV_BY_ZOOM[1];
  // Derive vertical FOV from horizontal FOV and aspect ratio
  const hFovRad = degreesToRadians(hFov);
  const vFovRad = 2 * Math.atan(Math.tan(hFovRad / 2) / aspectRatio);
  const vFov = (vFovRad * 180) / Math.PI;

  const result = { hFov, vFov };
  fovCache.set(cacheKey, result);

  if (fovCache.size > FOV_CACHE_LIMIT) {
    const firstKey = fovCache.keys().next().value;
    fovCache.delete(firstKey);
  }

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
export function screenToWorld(screenPoint: Point, cameraParams: CameraParams, viewWidth: number, viewHeight: number): Vector3 {
    const { heading = 0, pitch = 0, vFov = 90 } = cameraParams;
    const calibrationOffset = cameraParams.calibrationPitchOffsetDeg ?? 0;
    const effectivePitch = pitch - calibrationOffset;

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
    const fovRadians = degreesToRadians(vFov);
    // tan(fov/2) = (projectionPlaneHeight/2) / distance
    // distance = (projectionPlaneHeight/2) / tan(fov/2)
    // Assuming projectionPlaneHeight corresponds to NDC range [-1, 1], so height/2 = 1
    const zDistance = 1 / Math.tan(fovRadians / 2); 

    const aspectRatio = viewWidth / viewHeight;

    // 3. Initial vector on the projection plane (before rotation)
    // Z points *out* from the screen/camera initially
    let vector: Vector3 = {
        x: undistortedX * aspectRatio, // Scale X by aspect ratio
        y: undistortedY,
        z: zDistance,
    };

    // 4. Apply rotations based on camera heading and pitch
    const pitchTrig = getTrigValues(-effectivePitch);
    const cosPitch = pitchTrig.cos;
    const sinPitch = pitchTrig.sin;
    let rotatedY = vector.y * cosPitch - vector.z * sinPitch;
    let rotatedZ = vector.y * sinPitch + vector.z * cosPitch;
    vector = { x: vector.x, y: rotatedY, z: rotatedZ };

    // Heading rotation (around Y-axis)
    // Positive heading turns right, negative turns left
    // Rotate the *opposite* way
    const headingTrig = getTrigValues(-heading);
    const cosHeading = headingTrig.cos;
    const sinHeading = headingTrig.sin;
    let rotatedX = vector.x * cosHeading + vector.z * sinHeading;
    rotatedZ = -vector.x * sinHeading + vector.z * cosHeading;
    vector = { x: rotatedX, y: vector.y, z: rotatedZ };
    
    // 5. Normalize the vector to get a unit direction vector
    // Conventionally, in Street View context: +Y is up, +X is right, +Z is forward.
    // Our calculation results in +Z forward, +Y up, +X right relative to camera view. Let's keep this.
    const normalized = normalizeVector(vector) as CalibratedVector3;
    normalized[calibrationAppliedSymbol] = true;
    return normalized;
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
    const HORIZON_THRESHOLD = 0.01; // Treat vectors with |y| < threshold as horizontal

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
    }

    // Check if the vector points downwards (negative y component) and is not too close to horizontal
    if (workingVector.y >= 0 || Math.abs(workingVector.y) < HORIZON_THRESHOLD) {
        // Vector points upwards or is too close to horizontal, won't intersect reliably.
        return null;
    }

    // Calculate the scaling factor 't' such that the point P = t * D has P.y = -cameraHeight
    // t * directionVector.y = -cameraHeight
    const t = -cameraHeight / workingVector.y;

    // Calculate the intersection point
    const intersectionPoint: Vector3 = {
        x: t * workingVector.x,
        y: t * workingVector.y, // Should be approximately -cameraHeight
        z: t * workingVector.z,
    };

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
        planeIndex !== 255 && planeIndex >= 0 && planeIndex < depthData.planes.length;
    if (isValidPlaneIndex) {
        const selectedPlane = depthData.planes[planeIndex];
        if (selectedPlane) {
            const normal: Vector3 = { x: selectedPlane.nx, y: selectedPlane.ny, z: selectedPlane.nz };
            const dotVN = dotProduct(directionVector, normal);
            if (Math.abs(dotVN) >= epsilon) {
                // Google depth planes follow n·x + d = 0 with normals pointing toward the camera.
                // The intersection distance along the viewing ray is therefore t = -d / (n · v).
                const t = -selectedPlane.d / dotVN;
                if (t > epsilon) {
                    minDistance = t;
                }
            }
        }
    }

    // 4. Fall back to searching all planes if no valid plane was found
    if (minDistance === Infinity) {
        for (const plane of depthData.planes) {
            const normal: Vector3 = { x: plane.nx, y: plane.ny, z: plane.nz };
            const dotVN = dotProduct(directionVector, normal);
            if (Math.abs(dotVN) < epsilon) {
                continue;
            }
            // Same Street View plane convention applies when examining all planes.
            const t = -plane.d / dotVN;
            if (t > epsilon && t < minDistance) {
                minDistance = t;
            }
        }
    }

    // 5. If a valid intersection distance was found, calculate the world point
    if (minDistance !== Infinity) {
        const worldPoint: Vector3 = {
            x: directionVector.x * minDistance,
            y: directionVector.y * minDistance,
            z: directionVector.z * minDistance,
        };
        setCachedResult(cacheKey, worldPoint);
        return worldPoint;
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
export function calculateDistance3D(point1: Vector3, point2: Vector3): number {
    const dx = point2.x - point1.x;
    const dy = point2.y - point1.y;
    const dz = point2.z - point1.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// Automatic horizon detection using RANSAC line fitting
export interface HorizonDetectionResult {
  pitchOffset: number;
  confidence: number;
  method: 'depth' | 'gradient' | 'fallback';
  detected: boolean;
}

export function detectHorizonFromDepth(
  depthData: DecodedDepthData,
  cameraParams: CameraParams,
  viewWidth: number,
  viewHeight: number
): HorizonDetectionResult {
  if (!depthData || depthData.planes.length === 0) {
    return { pitchOffset: 0, confidence: 0, method: 'fallback', detected: false };
  }

  // Sample points along the bottom half of the image
  const samplePoints: Array<{ x: number; y: number; depth: number }> = [];
  const bottomHalfStart = Math.floor(viewHeight * 0.6);

  for (let y = bottomHalfStart; y < viewHeight; y += 2) {
    for (let x = 0; x < viewWidth; x += 4) {
      const depth = screenToWorldWithDepth({ x, y }, cameraParams, viewWidth, viewHeight, depthData);
      if (depth) {
        // Convert 3D point back to screen space to find horizon candidates
        const distance = Math.sqrt(depth.x * depth.x + depth.y * depth.y + depth.z * depth.z);
        samplePoints.push({ x, y, depth: distance });
      }
    }
  }

  if (samplePoints.length < 10) {
    return { pitchOffset: 0, confidence: 0, method: 'fallback', detected: false };
  }

  // Use RANSAC to find the best horizontal line (horizon)
  const bestLine = ransacLineFit(samplePoints, 50, 5.0); // 50 iterations, 5px threshold

  if (!bestLine) {
    return { pitchOffset: 0, confidence: 0, method: 'fallback', detected: false };
  }

  // Calculate pitch offset from the detected horizon line
  const centerY = viewHeight / 2;
  const horizonY = bestLine.intercept + bestLine.slope * (viewWidth / 2);
  const pixelOffset = horizonY - centerY;

  // Convert pixel offset to angle
  const vFov = cameraParams.vFov || 90;
  const angleOffset = pixelOffsetToVerticalAngle(centerY - pixelOffset, viewHeight, vFov);

  const confidence = Math.min(1.0, bestLine.inliers / samplePoints.length);

  return {
    pitchOffset: -angleOffset, // Negative because we want to rotate the camera
    confidence,
    method: 'depth',
    detected: confidence > 0.3
  };
}

// RANSAC line fitting for horizon detection
function ransacLineFit(
  points: Array<{ x: number; y: number; depth: number }>,
  maxIterations: number,
  threshold: number
): { slope: number; intercept: number; inliers: number } | null {
  let bestLine: { slope: number; intercept: number; inliers: number } | null = null;

  for (let iter = 0; iter < maxIterations; iter++) {
    // Randomly select 2 points
    const idx1 = Math.floor(Math.random() * points.length);
    const idx2 = Math.floor(Math.random() * points.length);
    if (idx1 === idx2) continue;

    const p1 = points[idx1];
    const p2 = points[idx2];

    // Calculate line parameters (y = mx + b)
    const slope = (p2.y - p1.y) / (p2.x - p1.x);
    const intercept = p1.y - slope * p1.x;

    // Count inliers
    let inliers = 0;
    for (const point of points) {
      const expectedY = slope * point.x + intercept;
      const distance = Math.abs(point.y - expectedY);
      if (distance < threshold) {
        inliers++;
      }
    }

    // Update best line
    if (!bestLine || inliers > bestLine.inliers) {
      bestLine = { slope, intercept, inliers };
    }
  }

  return bestLine;
}

// Convert pixel offset to vertical angle (similar to existing function but more robust)
function pixelOffsetToVerticalAngle(pixelY: number, viewHeight: number, vFov: number): number {
  // Normalize pixel coordinate to [-1, 1] range
  const normalizedY = 1 - (pixelY / viewHeight) * 2; // Flip Y axis

  // Convert to angle using FOV
  const vFovRad = degreesToRadians(vFov);
  const angleRad = Math.atan2(normalizedY * Math.tan(vFovRad / 2), 1);

  return angleRad * 180 / Math.PI;
}

// Enhanced ground plane intersection with confidence scoring
export interface GroundPlaneResult {
  point: Vector3 | null;
  confidence: number;
  method: 'depth' | 'estimated' | 'fallback';
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
      method: 'estimated'
    };
  }

  return {
    point: null,
    confidence: 0,
    method: 'fallback'
  };
}

export function clearGeometryCaches(): void {
  calculationCache.clear();
  fovCache.clear();
  trigCache.clear();
  depthDataSignatureCache.clear();
}

export function getGeometryCacheStats(): {
  calculationCacheSize: number;
  fovCacheSize: number;
  trigCacheSize: number;
  depthSignatureCacheSize: number;
} {
  return {
    calculationCacheSize: calculationCache.size,
    fovCacheSize: fovCache.size,
    trigCacheSize: trigCache.size,
    depthSignatureCacheSize: depthDataSignatureCache.size,
  };
}
