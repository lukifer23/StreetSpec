import { validatePlaneInvariant, screenToWorldWithDepth } from '../../../services/geometry';

describe('geometry invariants', () => {
  test('validatePlaneInvariant rejects degenerate normals', () => {
    expect(validatePlaneInvariant({ nx: 0, ny: 0, nz: 0, d: 1 })).toBe(false);
    expect(validatePlaneInvariant({ nx: Infinity as any, ny: 0, nz: 0, d: 0 })).toBe(false);
  });

  test('validatePlaneInvariant accepts near-unit normals', () => {
    expect(validatePlaneInvariant({ nx: 0, ny: 1, nz: 0, d: 1 })).toBe(true);
    expect(validatePlaneInvariant({ nx: 0.6, ny: 0.6, nz: 0.6, d: 1 })).toBe(true);
  });
});

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  calculateFov,
  screenToWorld,
  estimateGroundPlaneIntersection,
  calculateDistance3D,
  screenToWorldWithDepth,
} from '../../../services/geometry';
import { CameraParams, Point, Vector3 } from '../../../types/common';
import { DecodedDepthData } from '../../../types/common';

describe('Geometry Service', () => {
  let mockCameraParams: CameraParams;
  let mockPoint: Point;
  let mockDepthData: DecodedDepthData;

  beforeEach(() => {
    mockCameraParams = {
      panoId: 'test-pano',
      lat: 40.7128,
      lng: -74.0060,
      heading: 0,
      pitch: 0,
      zoom: 1,
      fov: 90,
      vFov: 90,
      cameraHeight: 2.5,
    };

    mockPoint = { x: 320, y: 240 };

    mockDepthData = {
      planes: [
        {
          nx: 0,
          ny: 1,
          nz: 0,
          d: 2.5,
        },
      ],
      indices: new Uint8Array([0, 0, 0]),
      width: 640,
      height: 480,
    };
  });

  describe('calculateFov', () => {
    it('should calculate correct FOV for zoom level 0', () => {
      const result = calculateFov(0, 1);
      expect(result.hFov).toBeCloseTo(126.87, 2);
      expect(result.vFov).toBeCloseTo(126.87, 2);
    });

    it('should calculate correct FOV for zoom level 1', () => {
      const result = calculateFov(1, 1);
      expect(result.hFov).toBeCloseTo(90, 2);
      expect(result.vFov).toBeCloseTo(90, 2);
    });

    it('should calculate correct FOV for zoom level 2', () => {
      const result = calculateFov(2, 1);
      expect(result.hFov).toBeCloseTo(53.13, 2);
      expect(result.vFov).toBeCloseTo(53.13, 2);
    });

    it('should handle undefined zoom', () => {
      const result = calculateFov(undefined, 1);
      expect(result.hFov).toBeCloseTo(90, 2);
      expect(result.vFov).toBeCloseTo(90, 2);
    });

    it('should clamp zoom levels', () => {
      const result = calculateFov(5, 1);
      expect(result.hFov).toBeCloseTo(14.25, 2);
    });
  });

  describe('screenToWorld', () => {
    it('should convert screen coordinates to world coordinates', () => {
      const result = screenToWorld(mockPoint, mockCameraParams, 640, 480);
      expect(result).toBeDefined();
      expect(typeof result.x).toBe('number');
      expect(typeof result.y).toBe('number');
      expect(typeof result.z).toBe('number');
    });

    it('should handle center screen coordinates', () => {
      const centerPoint = { x: 320, y: 240 };
      const result = screenToWorld(centerPoint, mockCameraParams, 640, 480);
      expect(result.x).toBeCloseTo(0);
      expect(result.y).toBeCloseTo(0);
      expect(result.z).toBeGreaterThan(0);
    });

    it('should handle edge screen coordinates', () => {
      const edgePoint = { x: 0, y: 0 };
      const result = screenToWorld(edgePoint, mockCameraParams, 640, 480);
      expect(result).toBeDefined();
    });

    it('should account for distortion on edge pixels', () => {
      const distortedParams: CameraParams = {
        ...mockCameraParams,
        distortion: { k1: 0.1, k2: -0.05, p1: 0.01, p2: -0.01 },
      };
      const edgePoint = { x: 0, y: 0 };
      const distortedResult = screenToWorld(edgePoint, distortedParams, 640, 480);
      const undistortedResult = screenToWorld(edgePoint, mockCameraParams, 640, 480);
      expect(distortedResult.x).not.toBeCloseTo(undistortedResult.x);
      expect(distortedResult.y).not.toBeCloseTo(undistortedResult.y);
    });

    it('should apply camera transformations correctly', () => {
      const cameraWithHeading = { ...mockCameraParams, heading: 90 };
      const result = screenToWorld(mockPoint, cameraWithHeading, 640, 480);
      expect(result).toBeDefined();
    });

    it('applies calibration pitch offsets when computing rays', () => {
      const centerPoint = { x: 320, y: 240 };
      const baseline = screenToWorld(centerPoint, mockCameraParams, 640, 480);
      const calibrated = screenToWorld(
        centerPoint,
        { ...mockCameraParams, calibrationPitchOffsetDeg: 5 },
        640,
        480
      );
      expect(calibrated.y).toBeLessThan(baseline.y);
    });
  });

  describe('estimateGroundPlaneIntersection', () => {
    it('should return null for upward-pointing vector', () => {
      const upwardDirection: Vector3 = { x: 0, y: 1, z: 0 };
      const result = estimateGroundPlaneIntersection(upwardDirection);
      expect(result).toBeNull();
    });

    it('should calculate ground plane intersection for valid direction', () => {
      const direction: Vector3 = { x: 0, y: -1, z: 1 };
      const result = estimateGroundPlaneIntersection(direction, mockCameraParams);
      expect(result).toBeDefined();
      if (result) {
        expect(result.y).toBeCloseTo(-2.5);
      }
    });

    it('should handle camera height parameter', () => {
      const direction: Vector3 = { x: 0, y: -1, z: 1 };
      const cameraWithHeight = { ...mockCameraParams, cameraHeight: 5 };
      const result = estimateGroundPlaneIntersection(direction, cameraWithHeight);
      expect(result).toBeDefined();
      if (result) {
        expect(result.y).toBeCloseTo(-5);
      }
    });

    it('uses calibration offset when provided an uncalibrated vector', () => {
      const centerPoint = { x: 320, y: 240 };
      const direction = screenToWorld(centerPoint, mockCameraParams, 640, 480);
      const uncalibratedDirection: Vector3 = { x: direction.x, y: direction.y, z: direction.z };
      const result = estimateGroundPlaneIntersection(uncalibratedDirection, {
        ...mockCameraParams,
        calibrationPitchOffsetDeg: 5,
      });

      expect(result).not.toBeNull();
      if (result) {
        expect(result.y).toBeLessThan(0);
      }
    });
  });

  describe('calculateDistance3D', () => {
    it('should calculate distance between two points', () => {
      const point1: Vector3 = { x: 0, y: 0, z: 0 };
      const point2: Vector3 = { x: 3, y: 4, z: 0 };
      const result = calculateDistance3D(point1, point2);
      expect(result).toBe(5);
    });

    it('should handle zero distance', () => {
      const point1: Vector3 = { x: 1, y: 2, z: 3 };
      const point2: Vector3 = { x: 1, y: 2, z: 3 };
      const result = calculateDistance3D(point1, point2);
      expect(result).toBe(0);
    });

    it('should handle negative coordinates', () => {
      const point1: Vector3 = { x: -1, y: -2, z: -3 };
      const point2: Vector3 = { x: 1, y: 2, z: 3 };
      const result = calculateDistance3D(point1, point2);
      expect(result).toBeCloseTo(7.483);
    });
  });

  describe('screenToWorldWithDepth', () => {
    it('should return null for invalid depth data', () => {
      const invalidDepthData: DecodedDepthData = {
        planes: [],
        indices: new Uint8Array(),
        width: 0,
        height: 0,
      };
      const result = screenToWorldWithDepth(
        mockPoint,
        mockCameraParams,
        640,
        480,
        invalidDepthData
      );
      expect(result).toBeNull();
    });

    it('should handle valid depth data', () => {
      const result = screenToWorldWithDepth(
        mockPoint,
        mockCameraParams,
        640,
        480,
        mockDepthData
      );
      expect(result).toBeDefined();
      if (result) {
        expect(typeof result.x).toBe('number');
        expect(typeof result.y).toBe('number');
        expect(typeof result.z).toBe('number');
      }
    });

    it('should handle edge cases in depth data', () => {
      const edgePoint = { x: 0, y: 0 };
      const result = screenToWorldWithDepth(
        edgePoint,
        mockCameraParams,
        640,
        480,
        mockDepthData
      );
      expect(result).toBeDefined();
    });

    it('should compute correct world point for plane facing camera', () => {
      const depthData: DecodedDepthData = {
        planes: [{ nx: 0, ny: 0, nz: -1, d: 5 }],
        indices: new Uint8Array([0]),
        width: 1,
        height: 1,
      };
      const result = screenToWorldWithDepth(
        mockPoint,
        mockCameraParams,
        640,
        480,
        depthData
      );
      expect(result).toBeDefined();
      if (result) {
        expect(result.x).toBeCloseTo(0);
        expect(result.y).toBeCloseTo(0);
        expect(result.z).toBeCloseTo(5);
      }
    });

    it('should compute correct world point for plane facing away from camera', () => {
      const depthData: DecodedDepthData = {
        planes: [{ nx: 0, ny: 0, nz: 1, d: -5 }],
        indices: new Uint8Array([0]),
        width: 1,
        height: 1,
      };
      const result = screenToWorldWithDepth(
        mockPoint,
        mockCameraParams,
        640,
        480,
        depthData
      );
      expect(result).toBeDefined();
      if (result) {
        expect(result.x).toBeCloseTo(0);
        expect(result.y).toBeCloseTo(0);
        expect(result.z).toBeCloseTo(5);
      }
    });

    it('should use bilinear sampling for sub-pixel horizontal coordinates', () => {
      const depthData: DecodedDepthData = {
        planes: [
          { nx: 0, ny: 0, nz: -1, d: 5 },
          { nx: 0, ny: 0, nz: -1, d: 10 },
        ],
        indices: new Uint8Array([0, 1]),
        width: 2,
        height: 1,
      };
      const viewWidth = 4;
      const viewHeight = 4;
      const leftPoint = { x: 1, y: viewHeight / 2 };
      const rightPoint = { x: 2, y: viewHeight / 2 };

      const left = screenToWorldWithDepth(leftPoint, mockCameraParams, viewWidth, viewHeight, depthData);
      const right = screenToWorldWithDepth(rightPoint, mockCameraParams, viewWidth, viewHeight, depthData);

      expect(left).not.toBeNull();
      expect(right).not.toBeNull();
      if (left && right) {
        expect(left.z).toBeCloseTo(5, 1);
        expect(right.z).toBeCloseTo(10, 1);
        expect(left.z).toBeLessThan(right.z);
      }
    });

    it('should map right edge to last depth column without off-by-one', () => {
      const depthData: DecodedDepthData = {
        planes: [
          { nx: 0, ny: 0, nz: -1, d: 5 },
          { nx: 0, ny: 0, nz: -1, d: 15 },
        ],
        indices: new Uint8Array([0, 1]),
        width: 2,
        height: 1,
      };
      const viewWidth = 4;
      const viewHeight = 4;
      const edgePoint = { x: viewWidth - 1, y: viewHeight / 2 };

      const result = screenToWorldWithDepth(edgePoint, mockCameraParams, viewWidth, viewHeight, depthData);

      expect(result).not.toBeNull();
      if (result) {
        expect(result.z).toBeCloseTo(15, 1);
      }
    });

    it('should map bottom edge to last depth row without off-by-one', () => {
      const depthData: DecodedDepthData = {
        planes: [
          { nx: 0, ny: 0, nz: -1, d: 5 },
          { nx: 0, ny: 0, nz: -1, d: 20 },
        ],
        indices: new Uint8Array([0, 0, 1, 1]),
        width: 2,
        height: 2,
      };
      const viewWidth = 4;
      const viewHeight = 4;
      const edgePoint = { x: viewWidth / 2, y: viewHeight - 1 };

      const result = screenToWorldWithDepth(edgePoint, mockCameraParams, viewWidth, viewHeight, depthData);

      expect(result).not.toBeNull();
      if (result) {
        expect(result.z).toBeCloseTo(20, 1);
      }
    });
  });
});
