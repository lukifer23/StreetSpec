import { CameraParams, OnnxDepthMap } from '../types/common';

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
        console.warn("[estimateDistanceToPoint] Depth map data is missing or invalid.");
        return null;
    }
    if (!cameraParams) {
        console.warn("[estimateDistanceToPoint] Missing camera parameters for context.");
        // Decide if you want to proceed without cameraParams or return null
        // return null;
    }

    // Scale viewport coordinates to depth map coordinates
    // Assuming viewport aspect ratio might differ from depth map
    const mapX = Math.round((pixelX / viewportWidth) * depthMap.width);
    const mapY = Math.round((pixelY / viewportHeight) * depthMap.height);

    // Clamp coordinates to be within map bounds
    const clampedX = Math.max(0, Math.min(depthMap.width - 1, mapX));
    const clampedY = Math.max(0, Math.min(depthMap.height - 1, mapY));

    // Calculate the index in the flattened depth array
    const index = clampedY * depthMap.width + clampedX;

    if (index < 0 || index >= depthMap.data.length) {
        console.error(`[estimateDistanceToPoint] Calculated index ${index} is out of bounds for depth map data (length ${depthMap.data.length}). Coords: (${pixelX}, ${pixelY}) -> (${mapX}, ${mapY}) -> (${clampedX}, ${clampedY})`);
        return null;
    }

    // Retrieve the depth value
    const distance = depthMap.data[index];

    if (distance === undefined || distance === null || distance <= 0) {
        console.warn(`[estimateDistanceToPoint] Invalid depth value (${distance}) found at index ${index} for coords (${clampedX}, ${clampedY}).`);
        // Return null or a default value? Returning null for now.
        return null;
    }

    console.log(`[estimateDistanceToPoint] Sampled depth at (${clampedX}, ${clampedY}) [from pixel (${pixelX.toFixed(0)}, ${pixelY.toFixed(0)})]: ${distance.toFixed(2)}m`);
    return distance; // Return the depth value from the map
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
    if (!cameraParams?.fov || !cameraParams?.pitch || distanceToBase === null) {
        console.warn("[calculateEstimatedHeight] Missing inputs for calculation.");
        return null;
    }

    // Simple linear FOV assumption (more accurate would use tan)
    const verticalFovRadians = (cameraParams.fov * Math.PI) / 180;
    
    // Calculate angle for each pixel relative to the center (pitch angle)
    const centerPixelY = viewportHeight / 2;
    const pitchRadians = (cameraParams.pitch * Math.PI) / 180;

    // Angle relative to horizon for base and top points
    // Note: Positive angle is downwards from horizon in this calculation
    const angleToBase = pitchRadians + ((basePixelY - centerPixelY) / viewportHeight) * verticalFovRadians;
    const angleToTop = pitchRadians + ((topPixelY - centerPixelY) / viewportHeight) * verticalFovRadians;

    // Use tangent to find height relative to camera horizon plane
    const heightAtBase = distanceToBase * Math.tan(angleToBase);
    const heightAtTop = distanceToBase * Math.tan(angleToTop);

    // Estimated height is the difference
    const estimatedHeight = Math.abs(heightAtBase - heightAtTop);

    console.log(`[calculateEstimatedHeight] BaseY: ${basePixelY}, TopY: ${topPixelY}, Dist: ${distanceToBase.toFixed(1)}, Pitch: ${cameraParams.pitch.toFixed(1)}, FOV: ${cameraParams.fov.toFixed(1)} -> Est Height: ${estimatedHeight.toFixed(2)}m`);

    return estimatedHeight;
} 