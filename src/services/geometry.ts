import { CameraParams, Point, Vector3 } from '../types/common';

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
 * Calculates the Field of View (FOV) based on the Street View zoom level.
 * This is an approximation, the exact formula might vary slightly.
 * @param zoom - The Street View zoom level (0 is widest).
 * @returns The horizontal FOV in degrees.
 */
export function calculateFov(zoom: number | undefined | null): number {
  if (zoom === undefined || zoom === null) {
    // Default to a reasonable FOV if zoom is unknown (e.g., zoom 1)
    return 90;
  }
  // Clamp zoom level for safety, e.g., between 0 and 4 or 5
  const clampedZoom = Math.max(0, Math.min(zoom, 4)); 
  return 180 / Math.pow(2, clampedZoom);
}

/**
 * Converts 2D screen coordinates (origin top-left) into a 3D unit direction vector 
 * relative to the camera's orientation.
 *
 * @param screenPoint - The {x, y} pixel coordinates on the screen/canvas.
 * @param cameraParams - Current camera parameters (heading, pitch, fov).
 * @param viewWidth - The width of the viewport/canvas in pixels.
 * @param viewHeight - The height of the viewport/canvas in pixels.
 * @returns A normalized 3D direction vector {x, y, z}.
 */
export function screenToWorld(screenPoint: Point, cameraParams: CameraParams, viewWidth: number, viewHeight: number): Vector3 {
    const { heading = 0, pitch = 0, fov = 90 } = cameraParams;

    // 1. Convert screen coordinates to Normalized Device Coordinates (NDC)
    // NDC range from -1 to 1, with (0,0) at the center.
    const ndcX = (screenPoint.x / viewWidth) * 2 - 1;
    const ndcY = 1 - (screenPoint.y / viewHeight) * 2; // Invert Y because screen Y is down

    // 2. Account for FOV and aspect ratio
    // Calculate the distance from the camera to the projection plane based on FOV
    const fovRadians = degreesToRadians(fov);
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
    // Positive pitch looks down, negative looks up
    // We need to rotate the *opposite* way because we're transforming the point
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
    return normalizeVector(vector);
}

/**
 * Estimates the 3D world coordinates by intersecting the direction vector
 * with a horizontal ground plane below the camera.
 * Assumes camera is at origin (0,0,0) and ground is at y = -cameraHeight.
 *
 * @param directionVector - Normalized 3D direction vector from the camera.
 * @param cameraHeight - Assumed height of the camera above the ground plane (meters).
 * @returns The estimated 3D world point {x, y, z} relative to the camera, or null if no intersection.
 */
export function estimateGroundPlaneIntersection(
    directionVector: Vector3,
    cameraHeight: number = 2.5 // Default assumed height
): Vector3 | null {
    // Check if the vector points downwards (negative y component)
    if (directionVector.y >= 0) {
        // Vector points upwards or horizontally, won't intersect the ground plane below.
        console.warn("Direction vector does not point towards the ground plane.", directionVector);
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

// TODO:
// - Consider alternative world point estimation methods (e.g., depth data if available, sphere projection)
// - Refine camera height assumption or make it configurable 