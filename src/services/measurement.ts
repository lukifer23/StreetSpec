import { UNIT_CONVERSIONS } from '../types/common';
import type {
  Point,
  CameraParams,
  Measurement,
  Vector3,
  OnnxDepthMap,
  DecodedDepthData,
  AppSettings
} from '../types/common';
import {
  screenToWorld,
  estimateGroundPlaneIntersectionWithConfidence
} from './geometry';
import { fusedWorldPoint, estimateDistanceToPoint } from './measurementLogic';
import { distance3D, magnitude3D } from '../utils/math';
import type { GroundPlaneResult } from './geometry';
import { v4 as uuidv4 } from 'uuid';
import {
  createMeasurementError,
  createValidationError,
  errorToAppError
} from '../utils/errorUtils';

type MeasurementFusionSettings = Pick<AppSettings, 'depthKernelSize' | 'depthUseBilinear' | 'depthEdgeRejectThreshold'>;

interface MeasurementOptions {
  isCalibrated?: boolean;
  onnxDepthMap?: OnnxDepthMap | null;
  fusionSettings?: MeasurementFusionSettings;
  fusedStart?: ReturnType<typeof fusedWorldPoint>;
  fusedEnd?: ReturnType<typeof fusedWorldPoint>;
}

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
  unit: 'metric' | 'imperial' = 'metric',
  options: MeasurementOptions = {}
): Measurement {
  const isCalibrated = options?.isCalibrated ?? false;
  let errorMessage: string | undefined = undefined;
  let confidence = 0;
  let startSource: Measurement['source'] | 'unknown' = 'unknown';
  let endSource: Measurement['source'] | 'unknown' = 'unknown';

  // Input validation with proper error handling
  if (!cameraParams || cameraParams.vFov === undefined) {
      throw createMeasurementError(
        'MEASUREMENT_INVALID_CAMERA',
        'Camera parameters with vertical FOV are required for measurement.',
        { cameraParams }
      );
  }

  if (!startPoint || !endPoint || typeof startPoint.x !== 'number' || typeof startPoint.y !== 'number' ||
      typeof endPoint.x !== 'number' || typeof endPoint.y !== 'number') {
      throw createValidationError(
        'points',
        'Invalid point coordinates provided',
        { startPoint, endPoint }
      );
  }

  if (!Number.isFinite(viewWidth) || !Number.isFinite(viewHeight) || viewWidth <= 0 || viewHeight <= 0) {
      throw createValidationError(
        'viewport',
        'Invalid viewport dimensions',
        { viewWidth, viewHeight }
      );
  }

  // Validate point coordinates are within viewport bounds
  const EPSILON_BOUNDS = 1e-6;
  if (startPoint.x < -EPSILON_BOUNDS || startPoint.x > viewWidth + EPSILON_BOUNDS ||
      startPoint.y < -EPSILON_BOUNDS || startPoint.y > viewHeight + EPSILON_BOUNDS ||
      endPoint.x < -EPSILON_BOUNDS || endPoint.x > viewWidth + EPSILON_BOUNDS ||
      endPoint.y < -EPSILON_BOUNDS || endPoint.y > viewHeight + EPSILON_BOUNDS) {
      errorMessage = "Measurement points are outside viewport bounds. ";
  }

  // Check for identical points (points at same location)
  const pointSeparationX = Math.abs(endPoint.x - startPoint.x);
  const pointSeparationY = Math.abs(endPoint.y - startPoint.y);
  const MIN_SEPARATION_THRESHOLD = 1e-6; // pixels
  
  if (pointSeparationX < MIN_SEPARATION_THRESHOLD && pointSeparationY < MIN_SEPARATION_THRESHOLD) {
      errorMessage = (errorMessage ?? "") + "Measurement points are identical. ";
  }
  
  // Check for near-horizon measurements (points too close horizontally)
  const horizontalDistance = pointSeparationX;
  const verticalDistance = pointSeparationY;
  const MIN_HORIZONTAL_SEPARATION = 2; // pixels
  const MIN_VERTICAL_SEPARATION = 2; // pixels
  
  if (horizontalDistance < MIN_HORIZONTAL_SEPARATION && verticalDistance < MIN_VERTICAL_SEPARATION) {
      errorMessage = (errorMessage ?? "") + "Measurement points are too close together. ";
  }
  
  // Check for points at infinity (extreme coordinates)
  const MAX_COORDINATE = 1e6; // pixels
  if (Math.abs(startPoint.x) > MAX_COORDINATE || Math.abs(startPoint.y) > MAX_COORDINATE ||
      Math.abs(endPoint.x) > MAX_COORDINATE || Math.abs(endPoint.y) > MAX_COORDINATE) {
      errorMessage = (errorMessage ?? "") + "Measurement points have extreme coordinates. ";
  }

  // Check for extreme camera angles that may affect accuracy
  const pitch = Math.abs(cameraParams.pitch || 0);
  const MAX_RELIABLE_PITCH = 75; // degrees
  if (pitch > MAX_RELIABLE_PITCH) {
      errorMessage = (errorMessage ?? '') + `Extreme camera pitch (${pitch} deg) may significantly affect accuracy. `;
  }

  // 1. Estimate World Points with confidence scoring
  let worldPoint1: Vector3 | null = null;
  let worldPoint2: Vector3 | null = null;
  let point1Confidence = 0;
  let point2Confidence = 0;
  const fusionSettings = options.fusionSettings ?? {};
  const onnxDepthMap = options.onnxDepthMap ?? null;

  const resolveWorldPoint = (
    point: Point,
    preset: ReturnType<typeof fusedWorldPoint> | undefined
  ): { world: Vector3 | null; method: Measurement['source'] | 'unknown'; confidence: number } => {
    if (preset) {
      return {
        world: preset.world,
        method: preset.method,
        confidence: preset.confidence
      };
    }

    const onnxDistance = onnxDepthMap
      ? estimateDistanceToPoint(
          point.x,
          point.y,
          viewWidth,
          viewHeight,
          cameraParams,
          onnxDepthMap,
          {
            depthKernelSize: fusionSettings.depthKernelSize,
            depthUseBilinear: fusionSettings.depthUseBilinear,
            depthEdgeRejectThreshold: fusionSettings.depthEdgeRejectThreshold
          }
        )
      : null;

    const fused = fusedWorldPoint(
      point,
      viewWidth,
      viewHeight,
      cameraParams,
      depthData,
      onnxDistance,
      onnxDepthMap,
      {
        depthKernelSize: fusionSettings.depthKernelSize,
        depthUseBilinear: fusionSettings.depthUseBilinear,
        depthEdgeRejectThreshold: fusionSettings.depthEdgeRejectThreshold
      }
    );

    return {
      world: fused.world,
      method: fused.method,
      confidence: fused.confidence
    };
  };

  // Resolve world points using fused depth (Street View planes > ONNX > ground)
  const startResolved = resolveWorldPoint(startPoint, options.fusedStart);
  const endResolved = resolveWorldPoint(endPoint, options.fusedEnd);

  worldPoint1 = startResolved.world;
  worldPoint2 = endResolved.world;
  startSource = startResolved.method;
  endSource = endResolved.method;
  point1Confidence = startResolved.confidence;
  point2Confidence = endResolved.confidence;

  // Validate resolved points
  const validateWorldPoint = (world: Vector3 | null, label: 'start' | 'end'): Vector3 | null => {
    if (!world) {
      errorMessage = (errorMessage ?? "") + `${label === 'start' ? 'Start' : 'End'} point could not be resolved from depth data. `;
      return null;
    }
    const dist = Math.sqrt(world.x * world.x + world.y * world.y + world.z * world.z);
    if (dist <= 0.1 || dist >= 1e4 || !Number.isFinite(dist)) {
      errorMessage = (errorMessage ?? "") + `${label === 'start' ? 'Start' : 'End'} world point is invalid. `;
      return null;
    }
    return world;
  };

  worldPoint1 = validateWorldPoint(worldPoint1, 'start');
  worldPoint2 = validateWorldPoint(worldPoint2, 'end');

  // Fallback to enhanced ground plane intersection with confidence
  if (!worldPoint1) {
    try {
      const directionVec1 = screenToWorld(startPoint, cameraParams, viewWidth, viewHeight);
      // Validate direction vector
      if (!Number.isFinite(directionVec1.x) || !Number.isFinite(directionVec1.y) || !Number.isFinite(directionVec1.z)) {
        errorMessage = (errorMessage ?? "") + "Start point direction vector is invalid. ";
      } else {
        // Check if direction vector is near-horizon (may cause unreliable intersection)
        const HORIZON_THRESHOLD = 0.01;
        if (Math.abs(directionVec1.y) < HORIZON_THRESHOLD) {
          errorMessage = (errorMessage ?? "") + "Start point is too close to horizon for reliable measurement. ";
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
            errorMessage = (errorMessage ?? "") + "Ground plane intersection produced invalid result for start point. ";
          }
        } else {
          errorMessage = (errorMessage ?? "") + "Ground plane intersection failed for start point. ";
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err ?? 'unknown');
      errorMessage = (errorMessage ?? "") + `Error computing start point ground intersection: ${errMsg}. `;
    }
  }

  if (!worldPoint2) {
    try {
      const directionVec2 = screenToWorld(endPoint, cameraParams, viewWidth, viewHeight);
      
      // Validate direction vector
      if (!Number.isFinite(directionVec2.x) || !Number.isFinite(directionVec2.y) || !Number.isFinite(directionVec2.z)) {
        errorMessage = (errorMessage ?? "") + "End point direction vector is invalid. ";
      } else {
        // Check if direction vector is near-horizon
        const HORIZON_THRESHOLD = 0.01;
        if (Math.abs(directionVec2.y) < HORIZON_THRESHOLD) {
          errorMessage = (errorMessage ?? "") + "End point is too close to horizon for reliable measurement. ";
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
            errorMessage = (errorMessage ?? "") + "Ground plane intersection produced invalid result for end point. ";
          }
        } else {
          errorMessage = (errorMessage ?? "") + "Ground plane intersection failed for end point. ";
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err ?? 'unknown');
      errorMessage = (errorMessage ?? "") + `Error computing end point ground intersection: ${errMsg}. `;
    }
  }

  // Calculate overall confidence as average of both points
  // Handle case where one point fails: use single point confidence reduced by factor
  if (worldPoint1 && worldPoint2) {
    confidence = (point1Confidence + point2Confidence) / 2;
  } else if (worldPoint1) {
    confidence = point1Confidence * 0.6; // Reduce confidence when only one point available
  } else if (worldPoint2) {
    confidence = point2Confidence * 0.6; // Reduce confidence when only one point available
  } else {
    confidence = 0; // No valid points
  }

  // Validate confidence is finite
  if (!Number.isFinite(confidence)) {
    confidence = 0;
  }

  // Adjust confidence based on calibration status
  if (!isCalibrated) {
    confidence *= 0.7; // Reduce confidence if not manually calibrated
    errorMessage = (errorMessage ?? "") + "No horizon calibration applied. ";
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
      error: errorMessage ?? "Failed to determine 3D coordinates for measurement."
    };
  }

  // 2. Calculate 3D distance between world points
  let distanceMeters: number;
  try {
    distanceMeters = distance3D(worldPoint1, worldPoint2);
    
    // Validate distance is finite and reasonable
    if (!Number.isFinite(distanceMeters) || distanceMeters < 0) {
      throw createMeasurementError(
        'MEASUREMENT_CALCULATION_FAILED',
        'Calculated distance is invalid',
        { distanceMeters, worldPoint1, worldPoint2 }
      );
    }
  } catch (err) {
    const appError = errorToAppError(err, 'MEASUREMENT_CALCULATION_FAILED');
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
      error: (errorMessage ?? "") + `Distance calculation failed: ${appError.userFriendlyMessage}`
    };
  }

  // Validate distanceMeters before conversion
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) {
    errorMessage = (errorMessage ?? "") + "Distance calculation produced invalid result. ";
  }

  // Perform unit conversion with validation
  let displayDistance: number;
  if (unit === 'imperial') {
    const feet = UNIT_CONVERSIONS.metersToFeet(distanceMeters);
    if (!Number.isFinite(feet) || feet < 0) {
      errorMessage = (errorMessage ?? "") + "Unit conversion to feet produced invalid result. ";
      displayDistance = distanceMeters; // Fallback to meters
    } else {
      displayDistance = feet;
    }
  } else {
    displayDistance = distanceMeters;
  }

  // Final validation of display distance
  if (!Number.isFinite(displayDistance) || displayDistance < 0) {
    errorMessage = (errorMessage ?? "") + "Display distance is invalid. ";
    displayDistance = 0; // Set to 0 as fallback
  }

  // 3. Validate measurement plausibility
  const validationResult = validateMeasurement(distanceMeters, worldPoint1, worldPoint2, cameraParams);
  if (validationResult.warning) {
    errorMessage = (errorMessage ?? "") + validationResult.warning;
    const multiplier = Number.isFinite(validationResult.confidenceMultiplier) 
      ? validationResult.confidenceMultiplier 
      : 1.0;
    confidence *= multiplier;
  }
  
  // Ensure confidence is still valid after multipliers
  if (!Number.isFinite(confidence) || confidence < 0) {
    confidence = 0;
  }
  confidence = Math.max(0, Math.min(1, confidence)); // Clamp to [0, 1]

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
    confidence: confidence, // Already clamped above
    source: resolveSource(startSource, endSource),
    error: errorMessage ?? undefined, // Include any error/warning messages (use undefined instead of empty string)
    metadata: {
      startMethod: startSource,
      endMethod: endSource,
      startConfidence: point1Confidence,
      endConfidence: point2Confidence
    }
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

  if (candidates.includes('planes')) {
    return 'planes';
  }
  if (candidates.includes('onnx')) {
    return 'onnx';
  }
  if (candidates.includes('ground')) {
    return 'ground';
  }
  // Mixed measurement tools (area/volume/polyline) fall back to their source label
  return candidates[0] ?? 'ground';
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

  // Validate inputs
  if (!Number.isFinite(distance) || distance < 0) {
    warning = "Invalid distance value. ";
    confidenceMultiplier = 0;
    return { warning, confidenceMultiplier };
  }

  // Validate points
  if (!point1 || !point2) {
    warning = "Invalid point coordinates. ";
    confidenceMultiplier = 0;
    return { warning, confidenceMultiplier };
  }

  // Check for unrealistic distances
  if (distance < 0.1) { // Less than 10cm
    warning = "Very small distance detected. ";
    confidenceMultiplier *= 0.5;
  } else if (distance > 1000) { // More than 1km
    warning = "Very large distance detected. ";
    confidenceMultiplier *= 0.7;
  }

  // Check for points too close to camera
  const dist1 = magnitude3D(point1);
  const dist2 = magnitude3D(point2);

  // Validate distances are finite
  if (!Number.isFinite(dist1) || !Number.isFinite(dist2)) {
    warning = (warning ?? "") + "Point distances are invalid. ";
    confidenceMultiplier *= 0.3;
  } else if (dist1 < 1 || dist2 < 1) {
    warning = (warning ?? "") + "Points too close to camera. ";
    confidenceMultiplier *= 0.8;
  }

  // Check for extreme camera angles
  const pitch = Math.abs(cameraParams.pitch ?? 0);
  if (!Number.isFinite(pitch)) {
    warning = (warning ?? "") + "Invalid camera pitch. ";
    confidenceMultiplier *= 0.5;
  } else if (pitch > 60) {
    warning = (warning ?? "") + "Extreme camera pitch may affect accuracy. ";
    confidenceMultiplier *= 0.9;
  }

  // Ensure confidence multiplier is valid
  if (!Number.isFinite(confidenceMultiplier) || confidenceMultiplier < 0) {
    confidenceMultiplier = 0;
  }
  confidenceMultiplier = Math.max(0, Math.min(1, confidenceMultiplier));

  return { warning, confidenceMultiplier };
} 
