import { CameraParams, Point, Vector3, OnnxDepthMap, ConfidenceLevel } from '../types/common';
// Removed DecodedDepthData import as it's not used for ONNX
// import { DecodedDepthData } from './depth'; 

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
 * @param fovOverride - Optional override for the field of view (in degrees).
 * @returns A normalized 3D direction vector {x, y, z}.
 */
export function screenToWorld(
    screenPoint: Point, 
    cameraParams: CameraParams, 
    viewWidth: number, 
    viewHeight: number, 
    fovOverride?: number | null
): Vector3 {
    // Use override if provided and valid, otherwise use calculated FOV, default to 90
    const fovToUse = (fovOverride && fovOverride > 0 && fovOverride < 180) 
                       ? fovOverride 
                       : (cameraParams.fov ?? 90);
    const { heading = 0, pitch = 0 } = cameraParams; // Keep heading/pitch

    // 1. Convert screen coordinates to Normalized Device Coordinates (NDC)
    const ndcX = (screenPoint.x / viewWidth) * 2 - 1;
    const ndcY = 1 - (screenPoint.y / viewHeight) * 2; // Invert Y
    // console.log(`  screenToWorld Input: screenY=${screenPoint.y}, viewHeight=${viewHeight}, ndcY=${ndcY.toFixed(4)}`);

    // 2. Account for FOV and aspect ratio
    const fovRadians = degreesToRadians(fovToUse); // Use fovToUse
    const zDistance = 1 / Math.tan(fovRadians / 2); 
    const aspectRatio = viewWidth / viewHeight;

    // 3. Initial vector on the projection plane (before rotation)
    let vector: Vector3 = {
        x: ndcX * aspectRatio, 
        y: ndcY, 
        z: zDistance,
    };
    // console.log(`  screenToWorld Initial Vector: y=${vector.y.toFixed(4)}, z=${vector.z.toFixed(4)}, fov=${fovToUse.toFixed(2)}`);

    // 4. Apply rotations based on camera heading and pitch
    // Convert heading and pitch to radians
    const headingRad = degreesToRadians(heading);
    const pitchRad = degreesToRadians(pitch); // REVERT: Use original pitch 

    // Pitch rotation (around X-axis)
    // REVERT: Use -pitchRad again in rotation formulas
    const cosPitch = Math.cos(-pitchRad); 
    const sinPitch = Math.sin(-pitchRad); 
    let rotatedY = vector.y * cosPitch - vector.z * sinPitch; 
    let rotatedZ = vector.y * sinPitch + vector.z * cosPitch; 
    // REVERT: Log message
    // console.log(`  screenToWorld After Pitch (${pitch.toFixed(2)}deg): rotatedY=${rotatedY.toFixed(4)}, vector.y=${vector.y.toFixed(4)}, vector.z=${vector.z.toFixed(4)}, sinPitch=${sinPitch.toFixed(4)}`);
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
    // console.log(`  screenToWorld Final Normalized: y=${normalized.y.toFixed(4)}`);
    return normalized;
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
    const HORIZON_THRESHOLD = 0.01; // Treat vectors with |y| < threshold as horizontal

    // Check if the vector points downwards (negative y component) and is not too close to horizontal
    if (directionVector.y >= 0 || Math.abs(directionVector.y) < HORIZON_THRESHOLD) {
        // Vector points upwards or is too close to horizontal, won't intersect reliably.
        console.warn(`Direction vector does not point sufficiently towards the ground plane (y=${directionVector.y.toFixed(4)}).`, directionVector);
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
 * Kept for potential future use with different depth sources.
 * 
 * @param screenPoint - The {x, y} pixel coordinates on the screen/canvas.
 * @param cameraParams - Current camera parameters (heading, pitch, fov).
 * @param viewWidth - The width of the viewport/canvas in pixels.
 * @param viewHeight - The height of the viewport/canvas in pixels.
 * @param depthData - Parsed depth data containing plane information (Requires specific format).
 * @param fovOverride - Optional override for the field of view (in degrees).
 * @returns The calculated 3D world point {x, y, z} relative to the camera, or null if no intersection is found.
 */
export function screenToWorldWithDepth(
    screenPoint: Point,
    cameraParams: CameraParams,
    viewWidth: number,
    viewHeight: number,
    depthData: any, // Use any for now, define specific type if used later
    fovOverride?: number | null // Pass through fovOverride
): Vector3 | null {
    // 1. Get the 3D direction vector for the screen point
    const directionVector = screenToWorld(screenPoint, cameraParams, viewWidth, viewHeight, fovOverride);

    // 2. Iterate through depth map planes to find the intersection distance
    let minDistance = Infinity;
    const epsilon = 1e-6; // Small value to avoid division by zero and parallel checks

    for (const plane of depthData.planes) {
        // Construct the normal vector from the plane data
        const normal: Vector3 = { x: plane.nx, y: plane.ny, z: plane.nz }; 
        const planeDistance = plane.d; // Use the correct distance property 'd'

        // Calculate the dot product of the direction vector and the plane normal
        const dotVN = dotProduct(directionVector, normal);

        // Check if the ray is parallel to the plane (dot product is close to zero)
        if (Math.abs(dotVN) < epsilon) {
            continue; // Skip this plane
        }

        // Calculate the distance 't' along the ray to the intersection point
        // Formula: t = planeDistance / (directionVector . planeNormal)
        const t = planeDistance / dotVN;

        // We only care about intersections in front of the camera (t > 0)
        if (t > epsilon && t < minDistance) {
            minDistance = t;
        }
    }

    // 3. If a valid intersection distance was found, calculate the world point
    if (minDistance !== Infinity) {
        const worldPoint: Vector3 = {
            x: directionVector.x * minDistance,
            y: directionVector.y * minDistance,
            z: directionVector.z * minDistance,
        };
        console.log(`  screenToWorldWithDepth: Found intersection at distance ${minDistance.toFixed(2)}m`, worldPoint);
        return worldPoint;
    } else {
        console.warn("screenToWorldWithDepth: No valid intersection found with depth planes for point:", screenPoint);
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
    console.log(`[calculateDistance3D] Point 1: (${point1.x.toFixed(3)}, ${point1.y.toFixed(3)}, ${point1.z.toFixed(3)})`);
    console.log(`[calculateDistance3D] Point 2: (${point2.x.toFixed(3)}, ${point2.y.toFixed(3)}, ${point2.z.toFixed(3)})`);
    const dx = point2.x - point1.x;
    const dy = point2.y - point1.y;
    const dz = point2.z - point1.z;
    const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);
    console.log(`[calculateDistance3D] Calculated Distance: ${distance.toFixed(3)}m`);
    return distance;
}

/**
 * Samples the depth value for a given screen point from the ONNX depth map.
 * Accounts for potential scaling differences between viewport and depth map.
 *
 * @param screenPoint - The {x, y} pixel coordinates on the screen/viewport.
 * @param depthMap - The ONNX depth map data.
 * @param viewWidth - The width of the viewport/canvas in pixels.
 * @param viewHeight - The height of the viewport/canvas in pixels.
 * @returns The depth value in meters, or null if out of bounds or invalid.
 */
function sampleOnnxDepth(screenPoint: Point, depthMap: OnnxDepthMap, viewWidth: number, viewHeight: number): number | null {
    const mapWidth = depthMap.width;
    const mapHeight = depthMap.height;

    // Calculate the corresponding coordinates in the depth map
    // Assuming the depth map covers the same FOV as the viewport
    const mapX = Math.floor((screenPoint.x / viewWidth) * mapWidth);
    const mapY = Math.floor((screenPoint.y / viewHeight) * mapHeight);

    // Check bounds
    if (mapX < 0 || mapX >= mapWidth || mapY < 0 || mapY >= mapHeight) {
        console.warn(`[sampleOnnxDepth] Screen point (${screenPoint.x}, ${screenPoint.y}) maps outside depth map bounds (${mapX}, ${mapY})`);
        return null;
    }

    // Calculate the index in the flattened depth map data array
    const index = mapY * mapWidth + mapX;
    const depth = depthMap.data[index];

    // Check for invalid depth values (e.g., zero, negative, or excessively large)
    // The metric models should output positive values in meters.
    if (depth === undefined || depth <= 0 || depth > 1000) { // Adjust max threshold as needed
        // console.log(`[sampleOnnxDepth] Invalid depth value (${depth}) sampled at map coordinates (${mapX}, ${mapY})`);
        return null;
    }

    // console.log(`[sampleOnnxDepth] Sampled depth ${depth.toFixed(2)}m at map coords (${mapX}, ${mapY}) for screen point (${screenPoint.x}, ${screenPoint.y})`);
    return depth;
}

/**
 * Unprojects a 2D screen point to a 3D point relative to the camera 
 * using the provided ONNX depth map.
 * 
 * @param screenPoint - The {x, y} pixel coordinates on the screen/canvas.
 * @param cameraParams - Current camera parameters (heading, pitch, fov).
 * @param viewWidth - The width of the viewport/canvas in pixels.
 * @param viewHeight - The height of the viewport/canvas in pixels.
 * @param depthMap - The ONNX depth map data.
 * @param fovOverride - Optional override for the field of view (in degrees).
 * @returns The calculated 3D point relative to the camera, or null if depth is invalid.
 */
export function unprojectPointWithOnnxDepth(
    screenPoint: Point, 
    cameraParams: CameraParams, 
    viewWidth: number, 
    viewHeight: number, 
    depthMap: OnnxDepthMap,
    fovOverride?: number | null
): Vector3 | null {
    console.log(`[unprojectPoint] Input: point=(${screenPoint.x.toFixed(1)}, ${screenPoint.y.toFixed(1)}), vp=(${viewWidth}x${viewHeight})`);

    const depth = sampleOnnxDepth(screenPoint, depthMap, viewWidth, viewHeight);
    
    console.log(`[unprojectPoint] Sampled depth for unprojection: ${depth?.toFixed(3)}`);

    if (depth === null || depth <= 0) {
        console.warn("[unprojectPoint] Invalid or zero depth for unprojection.");
        return null;
    }

    const fov = (fovOverride && fovOverride > 0 && fovOverride < 180) 
                ? fovOverride 
                : cameraParams.fov;
                
    const pitch = cameraParams.pitch;
    const heading = cameraParams.heading;

    console.log(`[unprojectPoint] Using params: depth=${depth.toFixed(3)}, fov=${fov?.toFixed(2)}, pitch=${pitch?.toFixed(2)}, heading=${heading?.toFixed(2)}`);

    if (fov === undefined || pitch === undefined || heading === undefined) {
        console.warn("[unprojectPoint] Missing camera parameters (fov, pitch, heading) for unprojection.");
        return null;
    }

    // Convert FOV to radians
    const fovRad = (fov * Math.PI) / 180;
    const pitchRad = (pitch * Math.PI) / 180;
    const headingRad = (heading * Math.PI) / 180;

    // Normalize pixel coordinates to [-1, 1] range (approx)
    // Note: This assumes lens distortion is negligible or handled elsewhere.
    // It also assumes the vertical FOV is what 'fov' represents.
    const ndcX = ((screenPoint.x / viewWidth) * 2 - 1);
    const ndcY = ((screenPoint.y / viewHeight) * 2 - 1);
    
    // Calculate view space coordinates (simplified perspective projection inversion)
    const aspectRatio = viewWidth / viewHeight;
    const tanHalfFov = Math.tan(fovRad / 2);
    
    // Y is up/down in view space, affected by pitch and vertical position
    // X is left/right, affected by aspect ratio and horizontal position
    const viewY = -ndcY * tanHalfFov;
    const viewX = ndcX * aspectRatio * tanHalfFov;

    // Create initial direction vector in view space (Z forward)
    // Length doesn't matter yet, we normalize
    const directionView = { x: viewX, y: viewY, z: 1 }; 

    // Normalize the direction vector
    const dirLength = Math.sqrt(directionView.x**2 + directionView.y**2 + directionView.z**2);
    const normalizedDirView = {
        x: directionView.x / dirLength,
        y: directionView.y / dirLength,
        z: directionView.z / dirLength
    };

    // Scale direction vector by depth to get point in view space relative to camera
    const pointView = {
        x: normalizedDirView.x * depth,
        y: normalizedDirView.y * depth,
        z: normalizedDirView.z * depth
    };

    // Rotate point based on camera pitch (around X-axis)
    const cosPitch = Math.cos(pitchRad);
    const sinPitch = Math.sin(pitchRad);
    const pointAfterPitch = {
        x: pointView.x,
        y: pointView.y * cosPitch - pointView.z * sinPitch,
        z: pointView.y * sinPitch + pointView.z * cosPitch
    };

    // Rotate point based on camera heading (around Y-axis)
    const cosHeading = Math.cos(headingRad);
    const sinHeading = Math.sin(headingRad);
    const pointWorld = {
        x: pointAfterPitch.x * cosHeading + pointAfterPitch.z * sinHeading,
        y: pointAfterPitch.y,
        z: -pointAfterPitch.x * sinHeading + pointAfterPitch.z * cosHeading
    };

    console.log(`[unprojectPoint] Result: 3D point = (${pointWorld.x.toFixed(3)}, ${pointWorld.y.toFixed(3)}, ${pointWorld.z.toFixed(3)})`);

    // Assuming camera is at (0,0,0) for this relative coordinate system
    return pointWorld; 
}

/**
 * Calculates the standard deviation of depth values in a neighborhood
 * around a given point in the depth map.
 *
 * @param mapX - Center X coordinate in the depth map.
 * @param mapY - Center Y coordinate in the depth map.
 * @param depthMap - The ONNX depth map data.
 * @param neighborhoodSize - The size of the square neighborhood (e.g., 3 for 3x3).
 * @returns The standard deviation, or null if the neighborhood is invalid.
 */
function calculateLocalDepthStdDev(
    mapX: number,
    mapY: number,
    depthMap: OnnxDepthMap,
    neighborhoodSize: number = 3
): number | null {
    const { data, width, height } = depthMap;
    const halfSize = Math.floor(neighborhoodSize / 2);
    let sum = 0;
    let sumSq = 0;
    let count = 0;
    const validDepths: number[] = [];

    for (let dy = -halfSize; dy <= halfSize; dy++) {
        for (let dx = -halfSize; dx <= halfSize; dx++) {
            const currentX = mapX + dx;
            const currentY = mapY + dy;

            // Check bounds
            if (currentX >= 0 && currentX < width && currentY >= 0 && currentY < height) {
                const index = currentY * width + currentX;
                const depth = data[index];
                
                // Consider only valid depth values for variance calculation
                if (depth !== undefined && depth > 0 && depth < 1000) { // Use same validity check as sampling
                    validDepths.push(depth);
                    sum += depth;
                    sumSq += depth * depth;
                    count++;
                }
            }
        }
    }

    // Need at least 2 points to calculate variance
    if (count < 2) {
        return null;
    }

    const mean = sum / count;
    const variance = (sumSq / count) - (mean * mean);
    
    // Variance might be slightly negative due to floating point errors
    return Math.sqrt(Math.max(0, variance)); 
}

/**
 * Estimates the confidence level based on local depth standard deviation.
 *
 * @param screenPoint - The {x, y} pixel coordinates on the screen/viewport.
 * @param depthMap - The ONNX depth map data.
 * @param viewWidth - The width of the viewport/canvas in pixels.
 * @param viewHeight - The height of the viewport/canvas in pixels.
 * @returns A ConfidenceLevel ('High', 'Medium', 'Low', 'Unknown').
 */
export function estimateDepthConfidence(
    screenPoint: Point,
    depthMap: OnnxDepthMap,
    viewWidth: number,
    viewHeight: number
): ConfidenceLevel {
    const mapWidth = depthMap.width;
    const mapHeight = depthMap.height;
    const mapX = Math.floor((screenPoint.x / viewWidth) * mapWidth);
    const mapY = Math.floor((screenPoint.y / viewHeight) * mapHeight);

    // Check bounds for the center point
    if (mapX < 0 || mapX >= mapWidth || mapY < 0 || mapY >= mapHeight) {
        return 'Unknown';
    }

    const stdDev = calculateLocalDepthStdDev(mapX, mapY, depthMap, 3); // Use a 3x3 neighborhood

    if (stdDev === null) {
        return 'Unknown';
    }

    // Define thresholds for confidence based on standard deviation (in meters)
    // These thresholds might need tuning based on model characteristics and scene types.
    const lowThreshold = 0.5; // Std dev > 0.5m -> Low confidence
    const mediumThreshold = 0.1; // Std dev > 0.1m -> Medium confidence
                             // Std dev <= 0.1m -> High confidence

    if (stdDev > lowThreshold) {
        return 'Low';
    }
    if (stdDev > mediumThreshold) {
        return 'Medium';
    }
    return 'High';
}

/**
 * Calculates the area of a 3D polygon defined by ordered vertices.
 * Assumes the polygon is reasonably planar (deviation will cause inaccuracies).
 * Uses the formula based on summing cross products of triangle components.
 * See: https://math.stackexchange.com/questions/138462/calculating-the-area-of-a-planar-polygon-in-3d-space
 * 
 * @param vertices - An array of 3D points defining the polygon vertices in order.
 * @returns The calculated area of the polygon.
 */
function calculatePolygonArea3D(vertices: Vector3[]): number {
    if (vertices.length < 3) {
        return 0; // Not a polygon
    }

    // Calculate the normal vector of the polygon (approximated using Newell's method)
    let normal: Vector3 = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < vertices.length; i++) {
        const current = vertices[i];
        const next = vertices[(i + 1) % vertices.length]; // Wrap around for the last edge
        normal.x += (current.y - next.y) * (current.z + next.z);
        normal.y += (current.z - next.z) * (current.x + next.x);
        normal.z += (current.x - next.x) * (current.y + next.y);
    }

    const normalLength = Math.sqrt(normal.x * normal.x + normal.y * normal.y + normal.z * normal.z);
    if (normalLength < 1e-8) {
        // Polygon might be degenerate (collinear points)
        return 0; 
    }
    
    // Normalize the normal vector
    normal.x /= normalLength;
    normal.y /= normalLength;
    normal.z /= normalLength;

    // Project the polygon onto the plane defined by the normal vector and calculate area
    // (Effectively summing signed areas of triangles formed by origin and polygon edges)
    let area = 0;
    const origin = vertices[0]; // Choose first vertex as reference
    for (let i = 1; i < vertices.length - 1; i++) {
        const p1 = vertices[i];
        const p2 = vertices[i + 1];

        // Vectors from origin to p1 and p2
        const v1 = { x: p1.x - origin.x, y: p1.y - origin.y, z: p1.z - origin.z };
        const v2 = { x: p2.x - origin.x, y: p2.y - origin.y, z: p2.z - origin.z };

        // Cross product v1 x v2
        const cross = {
            x: v1.y * v2.z - v1.z * v2.y,
            y: v1.z * v2.x - v1.x * v2.z,
            z: v1.x * v2.y - v1.y * v2.x,
        };
        
        // The area of the triangle is 0.5 * |(v1 x v2) . normal|
        // Summing the dot products directly gives twice the signed area projected onto the normal
        area += cross.x * normal.x + cross.y * normal.y + cross.z * normal.z;
    }

    return Math.abs(area / 2);
}

/**
 * Unprojects a list of 2D screen points to 3D points and calculates the area
 * of the resulting 3D polygon.
 *
 * @param screenPoints - Array of 2D points forming the polygon.
 * @param cameraParams - Current camera parameters.
 * @param viewWidth - Viewport width.
 * @param viewHeight - Viewport height.
 * @param depthMap - ONNX depth map data.
 * @param fovOverride - Optional FOV override.
 * @returns Calculated area in square meters, or null if any point fails unprojection.
 */
export function calculateAreaFromScreenPoints(
    screenPoints: Point[],
    cameraParams: CameraParams,
    viewWidth: number,
    viewHeight: number,
    depthMap: OnnxDepthMap,
    fovOverride?: number | null
): number | null {
    if (screenPoints.length < 3) {
        return null; // Cannot form an area
    }

    const vertices3D: Vector3[] = [];
    for (const point of screenPoints) {
        const point3D = unprojectPointWithOnnxDepth(
            point,
            cameraParams,
            viewWidth,
            viewHeight,
            depthMap,
            fovOverride
        );
        if (point3D === null) {
            console.error(`[calculateAreaFromScreenPoints] Failed to unproject point (${point.x}, ${point.y}). Cannot calculate area.`);
            return null; // If any point fails, area calculation is invalid
        }
        vertices3D.push(point3D);
    }

    return calculatePolygonArea3D(vertices3D);
}

// TODO:
// - [DONE] Implement screenToWorldWithDepth
// - Use screenToWorldWithDepth in measurement.ts
// - Consider alternative world point estimation methods (e.g., ground plane) as fallback for screenToWorldWithDepth
// - Refine camera height assumption or make it configurable 