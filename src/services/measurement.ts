import { UNIT_CONVERSIONS } from '../types/common';
import type { Point, CameraParams, Measurement, Vector3 } from '../types/common';
import {
    screenToWorld,
    calculateDistance3D,
    screenToWorldWithDepth,
    estimateGroundPlaneIntersectionWithConfidence
} from './geometry';
import type { GroundPlaneResult } from './geometry';
import { v4 as uuidv4 } from 'uuid'; // Assuming uuid is installed
import type { DecodedDepthData } from '../types/common'; // Import from common types

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
  let errorMessage: string | undefined = undefined;
  let confidence = 0;
  let startSource: Measurement['source'] | 'unknown' = 'unknown';
  let endSource: Measurement['source'] | 'unknown' = 'unknown';

  // Input validation
  if (!cameraParams || cameraParams.vFov === undefined) {
      throw new Error("Camera parameters with vertical FOV are required for measurement.");
  }

  if (!startPoint || !endPoint || typeof startPoint.x !== 'number' || typeof startPoint.y !== 'number' ||
      typeof endPoint.x !== 'number' || typeof endPoint.y !== 'number') {
      throw new Error("Invalid point coordinates provided.");
  }

  if (!Number.isFinite(viewWidth) || !Number.isFinite(viewHeight) || viewWidth <= 0 || viewHeight <= 0) {
      throw new Error("Invalid viewport dimensions.");
  }

  // Validate point coordinates are within viewport bounds
  const EPSILON_BOUNDS = 1e-6;
  if (startPoint.x < -EPSILON_BOUNDS || startPoint.x > viewWidth + EPSILON_BOUNDS ||
      startPoint.y < -EPSILON_BOUNDS || startPoint.y > viewHeight + EPSILON_BOUNDS ||
      endPoint.x < -EPSILON_BOUNDS || endPoint.x > viewWidth + EPSILON_BOUNDS ||
      endPoint.y < -EPSILON_BOUNDS || endPoint.y > viewHeight + EPSILON_BOUNDS) {
      errorMessage = "Measurement points are outside viewport bounds. ";
  }

  // Check for near-horizon measurements (points too close horizontally)
  const horizontalDistance = Math.abs(endPoint.x - startPoint.x);
  const verticalDistance = Math.abs(endPoint.y - startPoint.y);
  const MIN_HORIZONTAL_SEPARATION = 2; // pixels
  const MIN_VERTICAL_SEPARATION = 2; // pixels
  
  if (horizontalDistance < MIN_HORIZONTAL_SEPARATION && verticalDistance < MIN_VERTICAL_SEPARATION) {
      errorMessage = (errorMessage || "") + "Measurement points are too close together. ";
  }

  // Check for extreme camera angles that may affect accuracy
  const pitch = Math.abs(cameraParams.pitch || 0);
  const MAX_RELIABLE_PITCH = 75; // degrees
  if (pitch > MAX_RELIABLE_PITCH) {
      errorMessage = (errorMessage || "") + `Extreme camera pitch (${pitch.toFixed(1)}°) may significantly affect accuracy. `;
  }

  // 1. Estimate World Points with confidence scoring
  let worldPoint1: Vector3 | null = null;
  let worldPoint2: Vector3 | null = null;
  let point1Confidence = 0;
  let point2Confidence = 0;

  // Try depth-based intersection first (highest accuracy)
  if (depthData) {
    try {
      worldPoint1 = screenToWorldWithDepth(startPoint, cameraParams, viewWidth, viewHeight, depthData);
      if (worldPoint1) {
        // Validate world point is reasonable
        const dist1 = Math.sqrt(worldPoint1.x * worldPoint1.x + worldPoint1.y * worldPoint1.y + worldPoint1.z * worldPoint1.z);
        if (dist1 > 0.1 && dist1 < 1e4 && Number.isFinite(dist1)) {
          point1Confidence = 0.9;
          startSource = 'planes';
        } else {
          worldPoint1 = null;
          errorMessage = (errorMessage || "") + "Start point depth intersection produced invalid result. ";
        }
      } else {
        errorMessage = (errorMessage || "") + "Depth intersection failed for start point. ";
      }
    } catch (err) {
      worldPoint1 = null;
      errorMessage = (errorMessage || "") + `Error computing start point depth: ${err instanceof Error ? err.message : 'unknown'}. `;
    }

    try {
      worldPoint2 = screenToWorldWithDepth(endPoint, cameraParams, viewWidth, viewHeight, depthData);
      if (worldPoint2) {
        // Validate world point is reasonable
        const dist2 = Math.sqrt(worldPoint2.x * worldPoint2.x + worldPoint2.y * worldPoint2.y + worldPoint2.z * worldPoint2.z);
        if (dist2 > 0.1 && dist2 < 1e4 && Number.isFinite(dist2)) {
          point2Confidence = 0.9;
          endSource = 'planes';
        } else {
          worldPoint2 = null;
          errorMessage = (errorMessage || "") + "End point depth intersection produced invalid result. ";
        }
      } else {
        errorMessage = (errorMessage || "") + "Depth intersection failed for end point. ";
      }
    } catch (err) {
      worldPoint2 = null;
      errorMessage = (errorMessage || "") + `Error computing end point depth: ${err instanceof Error ? err.message : 'unknown'}. `;
    }
  }

  // Fallback to enhanced ground plane intersection with confidence
  if (!worldPoint1) {
    try {
      const directionVec1 = screenToWorld(startPoint, cameraParams, viewWidth, viewHeight);
      // Check if direction vector is near-horizon (may cause unreliable intersection)
      const HORIZON_THRESHOLD = 0.01;
      if (Math.abs(directionVec1.y) < HORIZON_THRESHOLD) {
        errorMessage = (errorMessage || "") + "Start point is too close to horizon for reliable measurement. ";
      }
      
      const result1: GroundPlaneResult = estimateGroundPlaneIntersectionWithConfidence(
        directionVec1, cameraParams, depthData, viewWidth, viewHeight
      );
      if (result1.point) {
        // Validate ground plane intersection result
        const dist1 = Math.sqrt(result1.point.x * result1.point.x + result1.point.y * result1.point.y + result1.point.z * result1.point.z);
        if (dist1 > 0.1 && dist1 < 1e4 && Number.isFinite(dist1)) {
          worldPoint1 = result1.point;
          point1Confidence = result1.confidence;
          startSource = result1.method;
        } else {
          errorMessage = (errorMessage || "") + "Ground plane intersection produced invalid result for start point. ";
        }
      } else {
        errorMessage = (errorMessage || "") + "Ground plane intersection failed for start point. ";
      }
    } catch (err) {
      errorMessage = (errorMessage || "") + `Error computing start point ground intersection: ${err instanceof Error ? err.message : 'unknown'}. `;
    }
  }

  if (!worldPoint2) {
    try {
      const directionVec2 = screenToWorld(endPoint, cameraParams, viewWidth, viewHeight);
      // Check if direction vector is near-horizon
      const HORIZON_THRESHOLD = 0.01;
      if (Math.abs(directionVec2.y) < HORIZON_THRESHOLD) {
        errorMessage = (errorMessage || "") + "End point is too close to horizon for reliable measurement. ";
      }
      
      const result2: GroundPlaneResult = estimateGroundPlaneIntersectionWithConfidence(
        directionVec2, cameraParams, depthData, viewWidth, viewHeight
      );
      if (result2.point) {
        // Validate ground plane intersection result
        const dist2 = Math.sqrt(result2.point.x * result2.point.x + result2.point.y * result2.point.y + result2.point.z * result2.point.z);
        if (dist2 > 0.1 && dist2 < 1e4 && Number.isFinite(dist2)) {
          worldPoint2 = result2.point;
          point2Confidence = result2.confidence;
          if (endSource === 'unknown') {
            endSource = result2.method;
          }
        } else {
          errorMessage = (errorMessage || "") + "Ground plane intersection produced invalid result for end point. ";
        }
      } else {
        errorMessage = (errorMessage || "") + "Ground plane intersection failed for end point. ";
      }
    } catch (err) {
      errorMessage = (errorMessage || "") + `Error computing end point ground intersection: ${err instanceof Error ? err.message : 'unknown'}. `;
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
      source: undefined,
      error: errorMessage || "Failed to determine 3D coordinates for measurement."
    };
  }

  // 2. Calculate 3D distance between world points
  let distanceMeters: number;
  try {
    distanceMeters = calculateDistance3D(worldPoint1, worldPoint2);
    
    // Validate distance is finite and reasonable
    if (!Number.isFinite(distanceMeters) || distanceMeters < 0) {
      throw new Error("Calculated distance is invalid.");
    }
  } catch (err) {
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
      source: undefined,
      error: (errorMessage || "") + `Distance calculation failed: ${err instanceof Error ? err.message : 'unknown'}`
    };
  }

  const displayDistance = unit === 'imperial'
    ? UNIT_CONVERSIONS.metersToFeet(distanceMeters)
    : distanceMeters;

  // Validate display distance is finite
  if (!Number.isFinite(displayDistance)) {
    errorMessage = (errorMessage || "") + "Unit conversion produced invalid result. ";
  }

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
    source: resolveSource(startSource, endSource),
    error: errorMessage // Include any error/warning messages
  };

  return measurement;
}

function resolveSource(
  startSource: Measurement['source'] | 'unknown',
  endSource: Measurement['source'] | 'unknown'
): Measurement['source'] {
  const candidates = [startSource, endSource].filter(
    (value): value is Measurement['source'] => value !== 'unknown' && value !== undefined
  );

  if (candidates.length === 0) {
    return 'ground';
  }

  const uniqueSources = new Set(candidates);
  if (uniqueSources.size === 1) {
    const [source] = uniqueSources;
    return source;
  }

  // Mixed sources fall back to ground since part of the measurement relied on geometry
  return 'ground';
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
