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
      expect(result.hFov).toBe(180);
      expect(result.vFov).toBe(180);
    });

    it('should calculate correct FOV for zoom level 1', () => {
      const result = calculateFov(1, 1);
      expect(result.hFov).toBe(90);
      expect(result.vFov).toBe(90);
    });

    it('should handle undefined zoom', () => {
      const result = calculateFov(undefined, 1);
      expect(result.hFov).toBe(90);
      expect(result.vFov).toBe(90);
    });

    it('should clamp zoom levels', () => {
      const result = calculateFov(5, 1);
      expect(result.hFov).toBe(180 / Math.pow(2, 4));
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

    it('should apply camera transformations correctly', () => {
      const cameraWithHeading = { ...mockCameraParams, heading: 90 };
      const result = screenToWorld(mockPoint, cameraWithHeading, 640, 480);
      expect(result).toBeDefined();
    });
  });

  describe('estimateGroundPlaneIntersection', () => {
    it('should return null for upward-pointing vector', () => {
      const upwardDirection: Vector3 = { x: 0, y: 1, z: 0 };
      const result = estimateGroundPlaneIntersection(upwardDirection, mockCameraParams);
      expect(result).toBeNull();
    });

    it('should return null when camera height is missing', () => {
      const direction: Vector3 = { x: 0, y: -1, z: 1 };
      const result = estimateGroundPlaneIntersection(direction);
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
  });
});
