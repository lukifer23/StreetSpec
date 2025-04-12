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
    // No need to warn about cameraParams here, just use for logging if available

    const mapX = Math.round((pixelX / viewportWidth) * depthMap.width);
    const mapY = Math.round((pixelY / viewportHeight) * depthMap.height);
    const clampedX = Math.max(0, Math.min(depthMap.width - 1, mapX));
    const clampedY = Math.max(0, Math.min(depthMap.height - 1, mapY));
    const index = clampedY * depthMap.width + clampedX;

    console.log(`[estimateDistanceToPoint] Input: pixel=(${pixelX.toFixed(1)}, ${pixelY.toFixed(1)}), viewport=(${viewportWidth}x${viewportHeight})`);
    console.log(`[estimateDistanceToPoint] Mapped Coords: raw=(${mapX}, ${mapY}), clamped=(${clampedX}, ${clampedY}), index=${index}`);

    if (index < 0 || index >= depthMap.data.length) {
        console.error(`[estimateDistanceToPoint] Calculated index ${index} is out of bounds for depth map data (length ${depthMap.data.length}).`);
        return null;
    }

    const distance = depthMap.data[index];
    console.log(`[estimateDistanceToPoint] Raw depth value at index ${index}: ${distance}`);

    if (distance === undefined || distance === null || distance <= 0) {
        console.warn(`[estimateDistanceToPoint] Invalid depth value (${distance}).`);
        return null;
    }

    console.log(`[estimateDistanceToPoint] Returning distance: ${distance.toFixed(3)}m`);
    return distance;
}

/**
 * Estimates the height of an object based on pixel clicks and camera parameters.
 * 
 * @param basePixelY Vertical pixel coordinate of the object's base.
 * @param topPixelY Vertical pixel coordinate of the object's top.
 * @param viewportHeight Total height of the viewport in pixels.
 * @param cameraParams Current camera parameters (fov, pitch).
 * @param distanceToBase Estimated distance from camera to the object's base (in meters).
 * @param fovOverride Optional override for the field of view (in degrees).
 * @returns Estimated height in meters, or null if calculation is not possible.
 */
export function calculateEstimatedHeight(
    basePixelY: number,
    topPixelY: number,
    viewportHeight: number,
    cameraParams: CameraParams | null,
    distanceToBase: number | null,
    fovOverride?: number | null
): number | null {
    console.log(`[calculateEstimatedHeight] Inputs: baseY=${basePixelY.toFixed(1)}, topY=${topPixelY.toFixed(1)}, vpHeight=${viewportHeight}, dist=${distanceToBase?.toFixed(3)}, fovOverride=${fovOverride}`);
    
    const fovToUse = (fovOverride && fovOverride > 0 && fovOverride < 180)
                       ? fovOverride
                       : cameraParams?.fov;

    console.log(`[calculateEstimatedHeight] Resolved Params: fovToUse=${fovToUse?.toFixed(2)}, pitch=${cameraParams?.pitch?.toFixed(2)}`);

    if (!fovToUse || cameraParams?.pitch === undefined || cameraParams?.pitch === null || distanceToBase === null) {
        console.warn("[calculateEstimatedHeight] Missing resolved inputs (FOV, pitch, or distance) for calculation.");
        return null;
    }

    const verticalFovRadians = (fovToUse * Math.PI) / 180; 
    const centerPixelY = viewportHeight / 2;
    const pitchRadians = (cameraParams.pitch * Math.PI) / 180;
    const angleToBase = pitchRadians + ((basePixelY - centerPixelY) / viewportHeight) * verticalFovRadians;
    const angleToTop = pitchRadians + ((topPixelY - centerPixelY) / viewportHeight) * verticalFovRadians;

    console.log(`[calculateEstimatedHeight] Angles (rad): pitch=${pitchRadians.toFixed(4)}, base=${angleToBase.toFixed(4)}, top=${angleToTop.toFixed(4)}`);

    const heightAtBase = distanceToBase * Math.tan(angleToBase);
    const heightAtTop = distanceToBase * Math.tan(angleToTop);
    const estimatedHeight = Math.abs(heightAtBase - heightAtTop);

    console.log(`[calculateEstimatedHeight] Intermediate heights: base=${heightAtBase.toFixed(3)}, top=${heightAtTop.toFixed(3)}`);
    console.log(`[calculateEstimatedHeight] Final Estimated Height: ${estimatedHeight.toFixed(3)}m`);

    return estimatedHeight;
} 