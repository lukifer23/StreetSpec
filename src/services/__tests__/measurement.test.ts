import { beforeEach, describe, expect, it } from '@jest/globals';
import { createMeasurement } from '../measurement';
import { CameraParams, DecodedDepthData, Point, UNIT_CONVERSIONS } from '../../types/common';
import { calculateDistance3D, screenToWorldWithDepth } from '../geometry';

jest.mock('../geometry', () => ({
  screenToWorld: jest.fn(),
  estimateGroundPlaneIntersection: jest.fn(),
  calculateDistance3D: jest.fn(),
  screenToWorldWithDepth: jest.fn(),
}));

const mockedCalculateDistance3D = calculateDistance3D as jest.MockedFunction<typeof calculateDistance3D>;
const mockedScreenToWorldWithDepth = screenToWorldWithDepth as jest.MockedFunction<typeof screenToWorldWithDepth>;

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
  });
});
