import { UNIT_CONVERSIONS } from '../types/common';
import type { Point, CameraParams, Measurement, Vector3 } from '../types/common';
import {
    screenToWorld,
    estimateGroundPlaneIntersection,
    calculateDistance3D,
    screenToWorldWithDepth,
    estimateGroundPlaneIntersectionWithConfidence,
    GroundPlaneResult
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
  let confidence = 0; // Overall measurement confidence
  let source = 'unknown'; // Data source used

  if (!cameraParams || cameraParams.vFov === undefined) {
      throw new Error("Camera parameters with vertical FOV are required for measurement.");
  }

  // 1. Estimate World Points with confidence scoring
  let worldPoint1: Vector3 | null = null;
  let worldPoint2: Vector3 | null = null;
  let point1Confidence = 0;
  let point2Confidence = 0;

  // Try depth-based intersection first (highest accuracy)
  if (depthData) {
    worldPoint1 = screenToWorldWithDepth(startPoint, cameraParams, viewWidth, viewHeight, depthData);
    worldPoint2 = screenToWorldWithDepth(endPoint, cameraParams, viewWidth, viewHeight, depthData);

    if (worldPoint1) {
      point1Confidence = 0.9; // High confidence for depth-based
      source = 'depth';
    } else {
      errorMessage = "Depth intersection failed for start point. ";
    }

    if (worldPoint2) {
      point2Confidence = 0.9; // High confidence for depth-based
      if (source === 'unknown') source = 'depth';
    } else {
      errorMessage = (errorMessage || "") + "Depth intersection failed for end point.";
    }
  }

  // Fallback to enhanced ground plane intersection with confidence
  if (!worldPoint1) {
    const directionVec1 = screenToWorld(startPoint, cameraParams, viewWidth, viewHeight);
    const result1: GroundPlaneResult = estimateGroundPlaneIntersectionWithConfidence(
      directionVec1, cameraParams, depthData, viewWidth, viewHeight
    );
    worldPoint1 = result1.point;
    point1Confidence = result1.confidence;
    source = result1.method;

    if (!worldPoint1) {
      errorMessage = (errorMessage || "") + "Ground plane intersection failed for start point. ";
    }
  }

  if (!worldPoint2) {
    const directionVec2 = screenToWorld(endPoint, cameraParams, viewWidth, viewHeight);
    const result2: GroundPlaneResult = estimateGroundPlaneIntersectionWithConfidence(
      directionVec2, cameraParams, depthData, viewWidth, viewHeight
    );
    worldPoint2 = result2.point;
    point2Confidence = result2.confidence;
    if (source === 'unknown') source = result2.method;

    if (!worldPoint2) {
      errorMessage = (errorMessage || "") + "Ground plane intersection failed for end point. ";
    }
  }

  // Calculate overall confidence as average of both points
  confidence = (point1Confidence + point2Confidence) / 2;

  // Adjust confidence based on calibration status
  if (cameraParams.calibrationPitchOffsetDeg === 0) {
    confidence *= 0.7; // Reduce confidence if not manually calibrated
    errorMessage = (errorMessage || "") + "No horizon calibration applied. ";
  }

  // LAST RESORT: If either point is still null, we cannot calculate distance.
  if (!worldPoint1 || !worldPoint2) {
    // Return a measurement object indicating failure
    return {
      id: uuidv4(),
      kind: 'distance',
      label: "Measurement Failed",
      startPoint,
      endPoint,
      distanceMeters: 0,
      distance: 0,
      unit,
      timestamp: Date.now(),
      panoId: cameraParams.panoId ?? cameraParams.pano,
      cameraParams: cameraParams,
      confidence: 0,
      source: 'failed',
      error: errorMessage || "Failed to determine 3D coordinates for measurement."
    };
  }

  // 2. Calculate 3D distance between world points
  const distanceMeters = calculateDistance3D(worldPoint1, worldPoint2);
  const displayDistance = unit === 'imperial'
    ? UNIT_CONVERSIONS.metersToFeet(distanceMeters)
    : distanceMeters;

  // 3. Validate measurement plausibility
  const validationResult = validateMeasurement(distanceMeters, worldPoint1, worldPoint2, cameraParams);
  if (validationResult.warning) {
    errorMessage = (errorMessage || "") + validationResult.warning;
    confidence *= validationResult.confidenceMultiplier;
  }

  // 4. Create the measurement object with enhanced metadata
  const measurement: Measurement = {
    id: uuidv4(),
    kind: 'distance',
    label: `Measurement ${new Date().toLocaleTimeString()}`,
    startPoint,
    endPoint,
    distanceMeters,
    distance: displayDistance,
    unit,
    timestamp: Date.now(),
    panoId: cameraParams.panoId ?? cameraParams.pano,
    cameraParams: cameraParams,
    confidence: Math.max(0, Math.min(1, confidence)), // Clamp to [0, 1]
    source,
    error: errorMessage // Include any error/warning messages
  };

  return measurement;
}

// Validate measurement for plausibility and accuracy
function validateMeasurement(
  distance: number,
  point1: Vector3,
  point2: Vector3,
  cameraParams: CameraParams
): { warning?: string; confidenceMultiplier: number } {
  let warning: string | undefined;
  let confidenceMultiplier = 1.0;

  // Check for unrealistic distances
  if (distance < 0.1) { // Less than 10cm
    warning = "Very small distance detected. ";
    confidenceMultiplier *= 0.5;
  } else if (distance > 1000) { // More than 1km
    warning = "Very large distance detected. ";
    confidenceMultiplier *= 0.7;
  }

  // Check for points too close to camera
  const dist1 = Math.sqrt(point1.x * point1.x + point1.y * point1.y + point1.z * point1.z);
  const dist2 = Math.sqrt(point2.x * point2.x + point2.y * point2.y + point2.z * point2.z);

  if (dist1 < 1 || dist2 < 1) {
    warning = (warning || "") + "Points too close to camera. ";
    confidenceMultiplier *= 0.8;
  }

  // Check for extreme camera angles
  const pitch = Math.abs(cameraParams.pitch || 0);
  if (pitch > 60) {
    warning = (warning || "") + "Extreme camera pitch may affect accuracy. ";
    confidenceMultiplier *= 0.9;
  }

  return { warning, confidenceMultiplier };
} 
