import { Point, CameraParams, Measurement, Vector3 } from '../types/common';
import { 
    screenToWorld, 
    estimateGroundPlaneIntersection, 
    calculateDistance3D 
} from './geometry'; 
import { v4 as uuidv4 } from 'uuid'; // Assuming uuid is installed

/**
 * Creates a new measurement object.
 * Converts screen points to 3D direction vectors but uses placeholder distance.
 * 
 * @param startPoint Screen coordinates of the start point.
 * @param endPoint Screen coordinates of the end point.
 * @param cameraParams Camera state at the time of measurement (must include fov).
 * @param viewWidth The width of the view/canvas in pixels.
 * @param viewHeight The height of the view/canvas in pixels.
 * @param unit User's preferred unit system.
 * @returns A new Measurement object.
 */
export function createMeasurement(
  startPoint: Point,
  endPoint: Point,
  cameraParams: CameraParams, // Expect fov to be included here
  viewWidth: number,
  viewHeight: number,
  unit: 'metric' | 'imperial' = 'metric'
): Measurement {
  console.log("Creating measurement with:", { startPoint, endPoint, cameraParams, viewWidth, viewHeight });

  if (!cameraParams || cameraParams.fov === undefined) {
      throw new Error("Camera parameters with FOV are required for measurement.");
  }

  // 1. Convert screen points to 3D direction vectors
  const directionVec1 = screenToWorld(startPoint, cameraParams, viewWidth, viewHeight);
  const directionVec2 = screenToWorld(endPoint, cameraParams, viewWidth, viewHeight);

  console.log("Calculated Direction Vectors:", { directionVec1, directionVec2 });

  // 2. Estimate world points 
  // Attempt ground plane intersection first
  let worldPoint1 = estimateGroundPlaneIntersection(directionVec1, 2.5);
  let worldPoint2 = estimateGroundPlaneIntersection(directionVec2, 2.5);

  const defaultDistanceFallback = 15; // meters - Use as fallback if ground intersection fails

  // If intersection failed for point 1, fallback to fixed distance
  if (!worldPoint1) {
      console.warn(`Ground intersection failed for point 1 (vector y: ${directionVec1.y.toFixed(3)}). Falling back to fixed distance: ${defaultDistanceFallback}m`);
      worldPoint1 = {
          x: directionVec1.x * defaultDistanceFallback,
          y: directionVec1.y * defaultDistanceFallback,
          z: directionVec1.z * defaultDistanceFallback
      };
  }

  // If intersection failed for point 2, fallback to fixed distance
  if (!worldPoint2) {
      console.warn(`Ground intersection failed for point 2 (vector y: ${directionVec2.y.toFixed(3)}). Falling back to fixed distance: ${defaultDistanceFallback}m`);
      worldPoint2 = {
          x: directionVec2.x * defaultDistanceFallback,
          y: directionVec2.y * defaultDistanceFallback,
          z: directionVec2.z * defaultDistanceFallback
      };
  }

  console.log("Estimated World Points (after fallback):", { worldPoint1, worldPoint2 });

  // 3. Calculate 3D distance between world points
  const distanceMeters = calculateDistance3D(worldPoint1, worldPoint2);

  // 4. Create the measurement object
  const measurement: Measurement = {
    id: uuidv4(),
    label: `Measurement ${new Date().toLocaleTimeString()}`,
    startPoint,
    endPoint,
    distance: distanceMeters,
    unit,
    timestamp: Date.now(),
    panoId: cameraParams.panoId,
    cameraParams: cameraParams,
  };

  console.log("Measurement created:", measurement);
  return measurement;
} 