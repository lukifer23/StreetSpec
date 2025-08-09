import { CameraParams, Point, Vector3 } from '../types/common';
import { DecodedDepthData } from './depth';

// Cache for expensive calculations
const calculationCache = new Map<string, any>();
const CACHE_SIZE_LIMIT = 1000;

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

// Cache management
function getCacheKey(operation: string, params: any): string {
  return `${operation}_${JSON.stringify(params)}`;
}

function getCachedResult<T>(key: string): T | null {
  const cached = calculationCache.get(key);
  if (cached && Date.now() - cached.timestamp < 300000) { // 5 minute cache
    return cached.value;
  }
  return null;
}

function setCachedResult<T>(key: string, value: T): void {
  // Implement LRU cache
  if (calculationCache.size >= CACHE_SIZE_LIMIT) {
    const firstKey = calculationCache.keys().next().value;
    calculationCache.delete(firstKey);
  }
  
  calculationCache.set(key, {
    value,
    timestamp: Date.now()
  });
}

// Memoized FOV calculation
const fovCache = new Map<string, { hFov: number; vFov: number }>();

/**
 * Calculates the horizontal and vertical field of view (FOV) based on the
 * Street View zoom level. Uses Google's documented relationship of
 * `hFov = 180 / 2^zoom` and derives the vertical FOV from the viewport aspect
 * ratio. Includes caching for performance.
 *
 * @param zoom - The Street View zoom level (0 is widest).
 * @param aspectRatio - The viewport aspect ratio (width / height).
 * @returns An object containing both the horizontal and vertical FOV in degrees.
 */
export function calculateFov(
  zoom: number | undefined | null,
  aspectRatio: number
): { hFov: number; vFov: number } {
  const cacheKey = `${zoom}_${aspectRatio}`;
  const cached = fovCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Default to zoom level 1 (approx. 90° horizontal FOV) if zoom is unknown
  const effectiveZoom = zoom ?? 1;
  // Clamp zoom level for safety
  const clampedZoom = Math.max(0, Math.min(effectiveZoom, 4));
  // Google Street View documented formula
  const hFov = 180 / Math.pow(2, clampedZoom);
  // Derive vertical FOV from horizontal FOV and aspect ratio
  const hFovRad = degreesToRadians(hFov);
  const vFovRad = 2 * Math.atan(Math.tan(hFovRad / 2) / aspectRatio);
  const vFov = (vFovRad * 180) / Math.PI;

  const result = { hFov, vFov };
  fovCache.set(cacheKey, result);
  
  // Limit cache size
  if (fovCache.size > 100) {
    const firstKey = fovCache.keys().next().value;
    fovCache.delete(firstKey);
  }

  return result;
}

// Pre-computed trigonometric values for common angles
const trigCache = new Map<number, { cos: number; sin: number }>();

function getTrigValues(angleDegrees: number): { cos: number; sin: number } {
  const normalizedAngle = angleDegrees % 360;
  const cacheKey = Math.round(normalizedAngle * 100) / 100; // Round to 2 decimal places
  
  let cached = trigCache.get(cacheKey);
  if (!cached) {
    const radians = degreesToRadians(normalizedAngle);
    cached = {
      cos: Math.cos(radians),
      sin: Math.sin(radians)
    };
    trigCache.set(cacheKey, cached);
    
    // Limit cache size
    if (trigCache.size > 1000) {
      const firstKey = trigCache.keys().next().value;
      trigCache.delete(firstKey);
    }
  }
  
  return cached;
}

/**
 * Converts 2D screen coordinates (origin top-left) into a 3D unit direction vector 
 * relative to the camera's orientation. Optimized with caching and pre-computed trig values.
 *
 * @param screenPoint - The {x, y} pixel coordinates on the screen/canvas.
 * @param cameraParams - Current camera parameters (heading, pitch, vertical FOV).
 * @param viewWidth - The width of the viewport/canvas in pixels.
 * @param viewHeight - The height of the viewport/canvas in pixels.
 * @returns A normalized 3D direction vector {x, y, z}.
 */
export function screenToWorld(screenPoint: Point, cameraParams: CameraParams, viewWidth: number, viewHeight: number): Vector3 {
    const { heading = 0, pitch = 0, vFov = 90 } = cameraParams;

    // 1. Convert screen coordinates to Normalized Device Coordinates (NDC)
    // NDC range from -1 to 1, with (0,0) at the center.
    const ndcX = (screenPoint.x / viewWidth) * 2 - 1;
    const ndcY = 1 - (screenPoint.y / viewHeight) * 2; // Invert Y because screen Y is down

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
        x: ndcX * aspectRatio, // Scale X by aspect ratio
        y: ndcY, 
        z: zDistance,
    };

    // 4. Apply rotations based on camera heading and pitch using cached trig values
    const headingTrig = getTrigValues(-heading);
    const pitchTrig = getTrigValues(-pitch);

    // Pitch rotation (around X-axis)
    let rotatedY = vector.y * pitchTrig.cos - vector.z * pitchTrig.sin; 
    let rotatedZ = vector.y * pitchTrig.sin + vector.z * pitchTrig.cos; 
    vector = { x: vector.x, y: rotatedY, z: rotatedZ };

    // Heading rotation (around Y-axis)
    // Positive heading turns right, negative turns left
    // Rotate the *opposite* way
    let rotatedX = vector.x * headingTrig.cos + vector.z * headingTrig.sin;
    rotatedZ = -vector.x * headingTrig.sin + vector.z * headingTrig.cos;
    vector = { x: rotatedX, y: vector.y, z: rotatedZ };
    
    // 5. Normalize the vector to get a unit direction vector
    // Conventionally, in Street View context: +Y is up, +X is right, +Z is forward.
    // Our calculation results in +Z forward, +Y up, +X right relative to camera view. Let's keep this.
    const normalized = normalizeVector(vector);
    return normalized;
}

/**
 * Estimates the 3D world coordinates by intersecting the direction vector
 * with a horizontal ground plane below the camera.
 * Assumes camera is at origin (0,0,0) and ground is at y = -cameraHeight.
 * Optimized with caching for repeated calculations.
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

    // Check if the vector points downwards (negative y component) and is not too close to horizontal
    if (directionVector.y >= 0 || Math.abs(directionVector.y) < HORIZON_THRESHOLD) {
        // Vector points upwards or is too close to horizontal, won't intersect reliably.
        return null; 
    }

    // Calculate the scaling factor 't' such that the point P = t * D has P.y = -cameraHeight
    // t * directionVector.y = -cameraHeight
    const t = -cameraHeight / directionVector.y;

    // Calculate the intersection point
    const intersectionPoint: Vector3 = {
        x: t * directionVector.x,
        y: t * directionVector.y, // Should be approximately -cameraHeight
        z: t * directionVector.z,
    };

    return intersectionPoint;
}

/**
 * Calculates the 3D world coordinates corresponding to a 2D screen point using depth data.
 * Optimized with caching and early termination for better performance.
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
    // Cache key for this calculation
    const cacheKey = getCacheKey('screenToWorldWithDepth', {
      screenPoint,
      cameraParams: { heading: cameraParams.heading, pitch: cameraParams.pitch, vFov: cameraParams.vFov },
      viewWidth,
      viewHeight,
      depthDataHash: `${depthData.width}x${depthData.height}_${depthData.planes.length}`
    });

    const cached = getCachedResult<Vector3>(cacheKey);
    if (cached) {
      return cached;
    }

    // 1. Get the 3D direction vector for the screen point
    const directionVector = screenToWorld(screenPoint, cameraParams, viewWidth, viewHeight);

    // 2. Map the screen pixel to a depth-map index
    const mapX = Math.round((screenPoint.x / viewWidth) * depthData.width);
    const mapY = Math.round((screenPoint.y / viewHeight) * depthData.height);
    const clampedX = Math.max(0, Math.min(depthData.width - 1, mapX));
    const clampedY = Math.max(0, Math.min(depthData.height - 1, mapY));
    const pixelIndex = clampedY * depthData.width + clampedX;
    const planeIndex = depthData.indices[pixelIndex];

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
                const t = selectedPlane.d / dotVN;
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
            const t = plane.d / dotVN;
            if (t > epsilon && t < minDistance) {
                minDistance = t;
            }
        }
    }

    // 5. If a valid intersection distance was found, calculate the world point
    let result: Vector3 | null = null;
    if (minDistance !== Infinity) {
        const worldPoint: Vector3 = {
            x: directionVector.x * minDistance,
            y: directionVector.y * minDistance,
            z: directionVector.z * minDistance,
        };
        result = worldPoint;
    }

    // Cache the result
    setCachedResult(cacheKey, result);
    return result;
}

/**
 * Calculates the Euclidean distance between two 3D points.
 * Optimized with early termination for zero distances.
 *
 * @param point1 - The first 3D point.
 * @param point2 - The second 3D point.
 * @returns The distance in the same units as the point coordinates.
 */
export function calculateDistance3D(point1: Vector3, point2: Vector3): number {
    const dx = point2.x - point1.x;
    const dy = point2.y - point1.y;
    const dz = point2.z - point1.z;
    
    // Early termination for zero distance
    if (dx === 0 && dy === 0 && dz === 0) {
        return 0;
    }
    
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// Utility function to clear all caches (useful for memory management)
export function clearGeometryCaches(): void {
  calculationCache.clear();
  fovCache.clear();
  trigCache.clear();
}

// Utility function to get cache statistics
export function getGeometryCacheStats(): {
  calculationCacheSize: number;
  fovCacheSize: number;
  trigCacheSize: number;
} {
  return {
    calculationCacheSize: calculationCache.size,
    fovCacheSize: fovCache.size,
    trigCacheSize: trigCache.size
  };
}
