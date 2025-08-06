import { CameraParams, Point, Vector3 } from '../types/common';
import { DecodedDepthData } from './depth';

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

/**
 * Calculates the horizontal and vertical field of view (FOV) based on the
 * Street View zoom level. Uses Google's documented relationship of
 * `hFov = 180 / 2^zoom` and derives the vertical FOV from the viewport aspect
 * ratio.
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
  // Google Street View documented formula
  const hFov = 180 / Math.pow(2, clampedZoom);
  // Derive vertical FOV from horizontal FOV and aspect ratio
  const hFovRad = degreesToRadians(hFov);
  const vFovRad = 2 * Math.atan(Math.tan(hFovRad / 2) / aspectRatio);
  const vFov = (vFovRad * 180) / Math.PI;

  return { hFov, vFov };
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

    // 4. Apply rotations based on camera heading and pitch
    // Convert heading and pitch to radians
    const headingRad = degreesToRadians(heading);
    const pitchRad = degreesToRadians(pitch);

    // Pitch rotation (around X-axis)
    const cosPitch = Math.cos(-pitchRad); 
    const sinPitch = Math.sin(-pitchRad); 
    let rotatedY = vector.y * cosPitch - vector.z * sinPitch; 
    let rotatedZ = vector.y * sinPitch + vector.z * cosPitch; 
    vector = { x: vector.x, y: rotatedY, z: rotatedZ };

    // Heading rotation (around Y-axis)
    // Positive heading turns right, negative turns left
    // Rotate the *opposite* way
    const cosHeading = Math.cos(-headingRad);
    const sinHeading = Math.sin(-headingRad);
    let rotatedX = vector.x * cosHeading + vector.z * sinHeading;
    rotatedZ = -vector.x * sinHeading + vector.z * cosHeading;
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
    if (minDistance !== Infinity) {
        const worldPoint: Vector3 = {
            x: directionVector.x * minDistance,
            y: directionVector.y * minDistance,
            z: directionVector.z * minDistance,
        };
        return worldPoint;
    } else {
        return null; // No valid intersection found
    }
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
