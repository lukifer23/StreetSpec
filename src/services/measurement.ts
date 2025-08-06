import {
  Point,
  CameraParams,
  Measurement,
  OnnxDepthMap,
  DecodedDepthData,
  UNIT_CONVERSIONS
} from '../types/common';
import {
  screenToWorld,
  estimateGroundPlaneIntersection,
  calculateDistance3D,
  screenToWorldWithDepth
} from './geometry';
import { estimateDistanceToPoint, calculateEstimatedHeight } from './measurementLogic';
import { v4 as uuidv4 } from 'uuid';

/**
 * Calculates the height between two screen points in meters.
 * Attempts to use Street View depth planes, falling back to ONNX depth
 * or ground-plane intersection when necessary.
 */
export function calculateHeight(
  startPoint: Point,
  endPoint: Point,
  cameraParams: CameraParams,
  viewWidth: number,
  viewHeight: number,
  depthData: DecodedDepthData | null,
  onnxDepthMap: OnnxDepthMap | null
): number | null {
  if (!cameraParams) return null;

  let distanceToBase: number | null = null;
  let planeDistance: number | null = null;

  if (depthData) {
    const worldStart = screenToWorldWithDepth(startPoint, cameraParams, viewWidth, viewHeight, depthData);
    const worldEnd = screenToWorldWithDepth(endPoint, cameraParams, viewWidth, viewHeight, depthData);
    if (worldStart && worldEnd) {
      planeDistance = calculateDistance3D(worldStart, worldEnd);
      distanceToBase = calculateDistance3D({ x: 0, y: 0, z: 0 }, worldStart);
    }
  }

  if (distanceToBase === null && onnxDepthMap) {
    distanceToBase = estimateDistanceToPoint(
      startPoint.x,
      startPoint.y,
      viewWidth,
      viewHeight,
      cameraParams,
      onnxDepthMap
    );
  }

  if (distanceToBase === null) {
    const dir = screenToWorld(startPoint, cameraParams, viewWidth, viewHeight);
    const wp = estimateGroundPlaneIntersection(dir, cameraParams);
    if (wp) {
      distanceToBase = calculateDistance3D({ x: 0, y: 0, z: 0 }, wp);
    }
  }

  if (distanceToBase === null && planeDistance === null) {
    return null;
  }

  let estimatedHeight: number | null = null;
  if (distanceToBase !== null) {
    estimatedHeight = calculateEstimatedHeight(
      startPoint.y,
      endPoint.y,
      viewHeight,
      cameraParams,
      distanceToBase
    );
  }

  let finalHeight: number | null = null;
  if (planeDistance !== null && estimatedHeight !== null) {
    finalHeight = (planeDistance + estimatedHeight) / 2;
  } else {
    finalHeight = planeDistance ?? estimatedHeight;
  }

  return finalHeight;
}

/**
 * Creates a measurement object representing the height between two screen points.
 */
export function createMeasurement(
  startPoint: Point,
  endPoint: Point,
  cameraParams: CameraParams,
  viewWidth: number,
  viewHeight: number,
  depthData: DecodedDepthData | null,
  onnxDepthMap: OnnxDepthMap | null,
  unit: 'metric' | 'imperial' = 'metric'
): Measurement | null {
  const heightMeters = calculateHeight(
    startPoint,
    endPoint,
    cameraParams,
    viewWidth,
    viewHeight,
    depthData,
    onnxDepthMap
  );

  if (heightMeters === null) {
    return null;
  }

  const distance =
    unit === 'imperial' ? UNIT_CONVERSIONS.metersToFeet(heightMeters) : heightMeters;

  return {
    id: uuidv4(),
    label: 'Est. Height',
    startPoint,
    endPoint,
    distance,
    unit,
    timestamp: Date.now(),
    panoId: cameraParams.pano,
    cameraParams
  };
}
