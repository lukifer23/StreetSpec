import { Point, CameraParams, Measurement, Vector3, UNIT_CONVERSIONS } from '../types/common';
import {
    screenToWorld,
    estimateGroundPlaneIntersection,
    calculateDistance3D,
    screenToWorldWithDepth
} from './geometry';
import { v4 as uuidv4 } from 'uuid'; // Assuming uuid is installed
import { DecodedDepthData } from '../types/common'; // Import from common types

/**
 * Creates a new measurement object.
 * Converts screen points to 3D direction vectors.
 * Uses depth data (if available) or ground plane intersection to estimate world points.
 * 
 * @param startPoint Screen coordinates of the start point.
 * @param endPoint Screen coordinates of the end point.
 * @param cameraParams Camera state at the time of measurement (must include horizontal and vertical FOV and optional panoId).
 * @param viewWidth The width of the view/canvas in pixels.
 * @param viewHeight The height of the view/canvas in pixels.
 * @param depthData Parsed depth data for the current panorama (optional).
 * @param unit User's preferred unit system ('metric' or 'imperial').
 * @returns A new Measurement object.
 */
export function createMeasurement(
  startPoint: Point,
  endPoint: Point,
  cameraParams: CameraParams,
  viewWidth: number,
  viewHeight: number,
  depthData: DecodedDepthData | null,
  unit: 'metric' | 'imperial' = 'metric'
): Measurement {
  let errorMessage: string | undefined = undefined; // To store potential errors/warnings

  if (!cameraParams || cameraParams.vFov === undefined) {
      throw new Error("Camera parameters with vertical FOV are required for measurement.");
  }

  // 1. Estimate World Points
  let worldPoint1: Vector3 | null = null;
  let worldPoint2: Vector3 | null = null;

  if (depthData) {
    worldPoint1 = screenToWorldWithDepth(startPoint, cameraParams, viewWidth, viewHeight, depthData);
    worldPoint2 = screenToWorldWithDepth(endPoint, cameraParams, viewWidth, viewHeight, depthData);

    if (!worldPoint1) errorMessage = "Depth intersection failed for start point. ";
    if (!worldPoint2) errorMessage = (errorMessage || "") + "Depth intersection failed for end point.";

  } else {
    errorMessage = "No depth data; used ground plane estimate. ";
  }

  // Fallback to Ground Plane Intersection if depth data failed or wasn't available
  if (!worldPoint1) {
      const directionVec1 = screenToWorld(startPoint, cameraParams, viewWidth, viewHeight);
      worldPoint1 = estimateGroundPlaneIntersection(directionVec1, cameraParams);
      if (!worldPoint1) errorMessage = (errorMessage || "") + "Ground plane intersection failed for start point. ";
  }
  if (!worldPoint2) {
      const directionVec2 = screenToWorld(endPoint, cameraParams, viewWidth, viewHeight);
      worldPoint2 = estimateGroundPlaneIntersection(directionVec2, cameraParams);
      if (!worldPoint2) errorMessage = (errorMessage || "") + "Ground plane intersection failed for end point. ";
  }

  // LAST RESORT: If either point is still null, we cannot calculate distance.
  if (!worldPoint1 || !worldPoint2) {
    // Return a measurement object indicating failure
    return {
      id: uuidv4(),
      label: "Measurement Failed",
      startPoint,
      endPoint,
      distanceMeters: 0,
      distance: 0,
      unit,
      timestamp: Date.now(),
      panoId: cameraParams.pano,
      cameraParams: cameraParams,
      error: errorMessage || "Failed to determine 3D coordinates for measurement."
    };
  }

  // 2. Calculate 3D distance between world points
  const distanceMeters = calculateDistance3D(worldPoint1, worldPoint2);
  const displayDistance = unit === 'imperial'
    ? UNIT_CONVERSIONS.metersToFeet(distanceMeters)
    : distanceMeters;

  // 3. Create the measurement object
  const measurement: Measurement = {
    id: uuidv4(),
    label: `Measurement ${new Date().toLocaleTimeString()}`,
    startPoint,
    endPoint,
    distanceMeters,
    distance: displayDistance,
    unit,
    timestamp: Date.now(),
    panoId: cameraParams.pano,
    cameraParams: cameraParams,
    error: errorMessage // Include any error/warning messages
  };

  return measurement;
} 