import { beforeEach, describe, expect, it } from '@jest/globals';
import { createMeasurement } from '../measurement';
import { CameraParams, DecodedDepthData, Point, UNIT_CONVERSIONS } from '../../types/common';
import {
  calculateDistance3D,
  screenToWorld,
  screenToWorldWithDepth,
  estimateGroundPlaneIntersectionWithConfidence,
} from '../geometry';

jest.mock('../geometry', () => ({
  screenToWorld: jest.fn(),
  calculateDistance3D: jest.fn(),
  screenToWorldWithDepth: jest.fn(),
  estimateGroundPlaneIntersectionWithConfidence: jest.fn(),
}));

const mockedCalculateDistance3D = calculateDistance3D as jest.MockedFunction<typeof calculateDistance3D>;
const mockedScreenToWorldWithDepth = screenToWorldWithDepth as jest.MockedFunction<typeof screenToWorldWithDepth>;
const mockedScreenToWorld = screenToWorld as jest.MockedFunction<typeof screenToWorld>;
const mockedEstimateGroundPlaneIntersectionWithConfidence =
  estimateGroundPlaneIntersectionWithConfidence as jest.MockedFunction<
    typeof estimateGroundPlaneIntersectionWithConfidence
  >;

describe('createMeasurement', () => {
  const cameraParams: CameraParams = {
    vFov: 90,
    pano: 'test-pano',
    panoId: 'test-pano-id',
  };

  const startPoint: Point = { x: 0, y: 0 };
  const endPoint: Point = { x: 10, y: 10 };
  const depthData: DecodedDepthData = {
    planes: [],
    indices: new Uint8Array(1),
    width: 1,
    height: 1,
  };

  const mockDistanceMeters = 12.34;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedScreenToWorldWithDepth.mockReturnValue({ x: 1, y: 2, z: 3 });
    mockedEstimateGroundPlaneIntersectionWithConfidence.mockReturnValue({
      point: { x: 1, y: 0, z: 1 },
      confidence: 0.5,
      method: 'ground',
    });
    mockedScreenToWorld.mockReturnValue({ x: 0, y: -1, z: 0 });
    mockedCalculateDistance3D.mockReturnValue(mockDistanceMeters);
  });

  it('stores raw meters when unit is metric', () => {
    const measurement = createMeasurement(
      startPoint,
      endPoint,
      cameraParams,
      100,
      100,
      depthData,
      'metric'
    );

    expect(measurement.kind).toBe('distance');
    expect(measurement.distanceMeters).toBe(mockDistanceMeters);
    expect(measurement.distance).toBeCloseTo(mockDistanceMeters);
    expect(measurement.unit).toBe('metric');
    expect(measurement.panoId).toBe(cameraParams.panoId);
    expect(measurement.source).toBe('planes');
  });

  it('converts to feet when unit is imperial', () => {
    const measurement = createMeasurement(
      startPoint,
      endPoint,
      cameraParams,
      100,
      100,
      depthData,
      'imperial'
    );

    expect(measurement.kind).toBe('distance');
    expect(measurement.distanceMeters).toBe(mockDistanceMeters);
    expect(measurement.distance).toBeCloseTo(UNIT_CONVERSIONS.metersToFeet(mockDistanceMeters));
    expect(measurement.unit).toBe('imperial');
    expect(measurement.panoId).toBe(cameraParams.panoId);
    expect(measurement.source).toBe('planes');
  });

  it('falls back to ground source when depth lookup fails', () => {
    mockedScreenToWorldWithDepth.mockReturnValueOnce(null).mockReturnValueOnce(null);
    mockedEstimateGroundPlaneIntersectionWithConfidence.mockReturnValueOnce({
      point: { x: 0, y: 0, z: 1 },
      confidence: 0.3,
      method: 'ground',
    });
    mockedEstimateGroundPlaneIntersectionWithConfidence.mockReturnValueOnce({
      point: { x: 0, y: 0, z: 2 },
      confidence: 0.4,
      method: 'ground',
    });

    const measurement = createMeasurement(
      startPoint,
      endPoint,
      cameraParams,
      100,
      100,
      depthData,
      'metric'
    );

    expect(measurement.source).toBe('ground');
  });

  it('does not penalize confidence when calibration offset is zero but calibration is confirmed', () => {
    const calibratedMeasurement = createMeasurement(
      startPoint,
      endPoint,
      { ...cameraParams, calibrationPitchOffsetDeg: 0 },
      100,
      100,
      depthData,
      'metric',
      { isCalibrated: true }
    );

    const uncalibratedMeasurement = createMeasurement(
      startPoint,
      endPoint,
      { ...cameraParams, calibrationPitchOffsetDeg: 0 },
      100,
      100,
      depthData,
      'metric',
      { isCalibrated: false }
    );

    expect(calibratedMeasurement.confidence).toBeCloseTo(0.9, 5);
    expect(uncalibratedMeasurement.confidence).toBeCloseTo(0.63, 5);
    expect(calibratedMeasurement.confidence).toBeGreaterThan(uncalibratedMeasurement.confidence);
  });
});
