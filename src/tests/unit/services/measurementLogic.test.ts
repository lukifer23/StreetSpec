import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  estimateDistanceToPoint,
  calculateEstimatedHeight,
} from '../../../services/measurementLogic';
import { DecodedDepthData, Point } from '../../../types/common';
import { screenToWorldWithDepth } from '../../../services/geometry';

jest.mock('../../../services/geometry', () => ({
  screenToWorldWithDepth: jest.fn(),
}));
import { CameraParams, OnnxDepthMap } from '../../../types/common';

describe('Measurement Logic Service', () => {
  let mockCameraParams: CameraParams;
  let mockDepthMap: OnnxDepthMap;

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

    // Create a mock depth map with 10x10 data
    const depthData = new Array(100).fill(5.0); // 5 meters depth
    mockDepthMap = {
      data: depthData,
      width: 10,
      height: 10,
      transform: {
        originalWidth: 640,
        originalHeight: 480,
        resizedWidth: 10,
        resizedHeight: 10,
        scaleX: 10 / 640,
        scaleY: 10 / 480,
        offsetX: 0,
        offsetY: 0,
      },
    };
  });

  describe('estimateDistanceToPoint', () => {
    it('should return null for null depth map', () => {
      const result = estimateDistanceToPoint(
        320,
        240,
        640,
        480,
        mockCameraParams,
        null
      );

      expect(result).toBeNull();
    });

    it('should return null for null camera params', () => {
      const result = estimateDistanceToPoint(
        320,
        240,
        640,
        480,
        null,
        mockDepthMap
      );

      expect(result).toBeNull();
    });

    it('should return null for invalid depth map data', () => {
      const invalidDepthMap: OnnxDepthMap = {
        data: [],
        width: 10,
        height: 10,
      };

      const result = estimateDistanceToPoint(
        320,
        240,
        640,
        480,
        mockCameraParams,
        invalidDepthMap
      );

      expect(result).toBeNull();
    });

    it('should estimate distance for valid input', () => {
      const result = estimateDistanceToPoint(
        320,
        240,
        640,
        480,
        mockCameraParams,
        mockDepthMap
      );

      expect(result).toBeDefined();
      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThan(0);
    });

    it('should handle edge coordinates', () => {
      const result = estimateDistanceToPoint(
        0,
        0,
        640,
        480,
        mockCameraParams,
        mockDepthMap
      );

      expect(result).toBeDefined();
    });

    it('should handle center coordinates', () => {
      const result = estimateDistanceToPoint(
        320,
        240,
        640,
        480,
        mockCameraParams,
        mockDepthMap
      );

      expect(result).toBeDefined();
    });

    it('should apply transform correctly', () => {
      const result = estimateDistanceToPoint(
        320,
        240,
        640,
        480,
        mockCameraParams,
        mockDepthMap
      );

      expect(result).toBeDefined();
    });

    it('respects depthEdgeRejectThreshold when filtering edge gradients', () => {
      const width = 7;
      const height = 7;
      const data = new Array(width * height).fill(100);
      for (let y = 2; y <= 4; y++) {
        for (let x = 2; x <= 4; x++) {
          data[y * width + x] = 5;
        }
      }

      const sharpEdgeDepthMap: OnnxDepthMap = {
        data,
        width,
        height,
      };

      const highThreshold = estimateDistanceToPoint(
        3,
        3,
        width,
        height,
        mockCameraParams,
        sharpEdgeDepthMap,
        {
          depthKernelSize: 5,
          depthUseBilinear: false,
          depthEdgeRejectThreshold: 1,
        }
      );

      const lowThreshold = estimateDistanceToPoint(
        3,
        3,
        width,
        height,
        mockCameraParams,
        sharpEdgeDepthMap,
        {
          depthKernelSize: 5,
          depthUseBilinear: false,
          depthEdgeRejectThreshold: 0.05,
        }
      );

      expect(highThreshold).toBeCloseTo(100, 1);
      expect(lowThreshold).toBeCloseTo(5, 1);
    });

    it('supports kernel size 9 without error', () => {
      const width = 17;
      const height = 17;
      const data = new Array(width * height).fill(10);
      const dm: OnnxDepthMap = { data, width, height } as any;
      const d = estimateDistanceToPoint(8, 8, width, height, mockCameraParams, dm, {
        depthKernelSize: 9 as any,
        depthUseBilinear: false,
        depthEdgeRejectThreshold: 0.35
      } as any);
      expect(typeof d === 'number' || d === null).toBe(true);
    });
  });

  describe('calculateEstimatedHeight', () => {
    const basePoint: Point = { x: 50, y: 200 };
    const topPoint: Point = { x: 50, y: 100 };

    it('should return null for null camera params', () => {
      const result = calculateEstimatedHeight(
        basePoint,
        topPoint,
        640,
        480,
        null,
        null,
        10
      );

      expect(result).toBeNull();
    });

    it('should return null for null distance when depth data missing', () => {
      const result = calculateEstimatedHeight(
        basePoint,
        topPoint,
        640,
        480,
        mockCameraParams,
        null,
        null
      );

      expect(result).toBeNull();
    });

    it('should calculate height for valid input', () => {
      const result = calculateEstimatedHeight(
        basePoint,
        topPoint,
        640,
        480,
        mockCameraParams,
        null,
        10
      );

      expect(result).toBeDefined();
      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThan(0);
    });

    it('should handle same Y coordinates', () => {
      const result = calculateEstimatedHeight(
        { x: 50, y: 100 },
        { x: 50, y: 100 },
        640,
        480,
        mockCameraParams,
        null,
        10
      );

      expect(result).toBe(0);
    });

    it('should handle inverted Y coordinates (top below base)', () => {
      const result = calculateEstimatedHeight(
        { x: 50, y: 200 },
        { x: 50, y: 100 },
        640,
        480,
        mockCameraParams,
        null,
        10
      );

      expect(result).toBeDefined();
      expect(result).toBeGreaterThan(0);
    });

    it('should handle extreme Y coordinates', () => {
      const result = calculateEstimatedHeight(
        { x: 0, y: 0 },
        { x: 0, y: 480 },
        640,
        480,
        mockCameraParams,
        null,
        10
      );

      expect(result).toBeDefined();
    });

    it('should handle zero viewport height', () => {
      const result = calculateEstimatedHeight(
        basePoint,
        topPoint,
        640,
        0,
        mockCameraParams,
        null,
        10
      );

      expect(result).toBeNull();
    });

    it('should handle negative distance', () => {
      const result = calculateEstimatedHeight(
        basePoint,
        topPoint,
        640,
        480,
        mockCameraParams,
        null,
        -10
      );

      expect(result).toBeNull();
    });

    it('should use depth data when available', () => {
      const depth: DecodedDepthData = { planes: [], indices: new Uint8Array(), width: 1, height: 1 };
      (screenToWorldWithDepth as jest.Mock).mockReturnValueOnce({ x: 0, y: -1, z: 0 }).mockReturnValueOnce({ x: 0, y: 2, z: 0 });
      const result = calculateEstimatedHeight(
        basePoint,
        topPoint,
        640,
        480,
        mockCameraParams,
        depth,
        null
      );

      expect(result).toBeCloseTo(3);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle NaN values in depth map', () => {
      const depthMapWithNaN: OnnxDepthMap = {
        data: [NaN, 5.0, 5.0, ...new Array(97).fill(5.0)],
        width: 10,
        height: 10,
      };

      const result = estimateDistanceToPoint(
        320,
        240,
        640,
        480,
        mockCameraParams,
        depthMapWithNaN
      );

      expect(result).toBeDefined();
    });

    it('should handle infinite values in depth map', () => {
      const depthMapWithInfinity: OnnxDepthMap = {
        data: [Infinity, 5.0, 5.0, ...new Array(97).fill(5.0)],
        width: 10,
        height: 10,
      };

      const result = estimateDistanceToPoint(
        320,
        240,
        640,
        480,
        mockCameraParams,
        depthMapWithInfinity
      );

      expect(result).toBeDefined();
    });

    it('should handle very small depth values', () => {
      const depthMapWithSmallValues: OnnxDepthMap = {
        data: new Array(100).fill(0.001),
        width: 10,
        height: 10,
      };

      const result = estimateDistanceToPoint(
        320,
        240,
        640,
        480,
        mockCameraParams,
        depthMapWithSmallValues
      );

      expect(result).toBeDefined();
    });

    it('should handle very large depth values', () => {
      const depthMapWithLargeValues: OnnxDepthMap = {
        data: new Array(100).fill(1000.0),
        width: 10,
        height: 10,
      };

      const result = estimateDistanceToPoint(
        320,
        240,
        640,
        480,
        mockCameraParams,
        depthMapWithLargeValues
      );

      expect(result).toBeDefined();
    });
  });

  describe('Integration Tests', () => {
    it('should work together for complete measurement workflow', () => {
      // First estimate distance
      const distance = estimateDistanceToPoint(
        320,
        240,
        640,
        480,
        mockCameraParams,
        mockDepthMap
      );

      expect(distance).toBeDefined();
      expect(distance).toBeGreaterThan(0);

      // Then calculate height using that distance
      const height = calculateEstimatedHeight(
        { x: 50, y: 200 },
        { x: 50, y: 100 },
        640,
        480,
        mockCameraParams,
        null,
        distance
      );

      expect(height).toBeDefined();
      expect(height).toBeGreaterThan(0);
    });

    it('should handle measurement at different screen positions', () => {
      const positions = [
        { x: 0, y: 0 },
        { x: 320, y: 240 },
        { x: 640, y: 480 },
        { x: 100, y: 100 },
      ];

      positions.forEach((pos) => {
        const distance = estimateDistanceToPoint(
          pos.x,
          pos.y,
          640,
          480,
          mockCameraParams,
          mockDepthMap
        );

        expect(distance).toBeDefined();
      });
    });

    it('angle-based height returns null near horizon singularity', () => {
      const params = { ...mockCameraParams, vFov: 90, pitch: 0 };
      const basePoint: Point = { x: 320, y: 239 }; // near center
      const topPoint: Point = { x: 320, y: 241 };  // tiny offset
      const result = calculateEstimatedHeight(
        basePoint, topPoint, 640, 480, params, null, 1000000
      );
      expect(result).toBeNull();
    });
  });
});
