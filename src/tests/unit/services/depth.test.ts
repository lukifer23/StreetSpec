import { describe, it, expect, afterEach } from '@jest/globals';
import {
  getCachedDepthMap,
  cacheDepthMap,
  clearDepthCache,
  getCacheStats,
} from '../../../services/depth';
import { estimateDistanceToPoint } from '../../../services/measurementLogic';
import { CameraParams, OnnxDepthMap } from '../../../types/common';
import { clear } from 'idb-keyval';

describe('Depth Service with fake-indexeddb', () => {
  let mockCameraParams: CameraParams;
  let mockDepthMap: OnnxDepthMap;

  beforeEach(() => {
    mockCameraParams = {
      panoId: 'test-pano-id',
      lat: 40.7128,
      lng: -74.0060,
      heading: 45,
      pitch: 10,
      fov: 90,
    };

    mockDepthMap = {
      data: new Array(100).fill(5.0),
      width: 10,
      height: 10,
    };
  });

  afterEach(async () => {
    // Completely clear the in-memory database after each test
    await clear();
  });

  describe('getCachedDepthMap', () => {
    it('should return null when cache is empty', async () => {
      const result = await getCachedDepthMap(mockCameraParams);
      expect(result).toBeNull();
    });

    it('should retrieve a previously cached depth map', async () => {
      await cacheDepthMap(mockCameraParams, mockDepthMap);
      const result = await getCachedDepthMap(mockCameraParams);

      expect(result).not.toBeNull();
      expect(result?.data).toEqual(mockDepthMap.data);
      expect(result?.width).toBe(mockDepthMap.width);
      expect(result?.height).toBe(mockDepthMap.height);
    });

    it('should cache and retrieve depth maps with zero heading and pitch', async () => {
      const zeroHeadingParams = { ...mockCameraParams, heading: 0, pitch: 0 };

      await cacheDepthMap(zeroHeadingParams, mockDepthMap);
      const result = await getCachedDepthMap(zeroHeadingParams);

      expect(result).not.toBeNull();
      expect(result?.data).toEqual(mockDepthMap.data);
      expect(result?.width).toBe(mockDepthMap.width);
      expect(result?.height).toBe(mockDepthMap.height);
    });
  });

  describe('cacheDepthMap', () => {
    it('should successfully store a depth map', async () => {
      await cacheDepthMap(mockCameraParams, mockDepthMap);
      const stats = await getCacheStats();
      expect(stats.count).toBe(1);
    });

    it('should enforce cache size limit by removing the oldest entries', async () => {
      // 1. Fill the cache to capacity (100) with older items
      for (let i = 0; i < 100; i++) {
        const params = { ...mockCameraParams, panoId: `pano-${i}` };
        await cacheDepthMap(params, mockDepthMap);
        // Introduce a small delay to ensure distinct lastUsed timestamps
        await new Promise(res => setTimeout(res, 1));
      }

      let stats = await getCacheStats();
      expect(stats.count).toBe(100);

      // 2. Add 5 new items, which should trigger eviction
      for (let i = 100; i < 105; i++) {
        const params = { ...mockCameraParams, panoId: `pano-${i}` };
        await cacheDepthMap(params, mockDepthMap);
        await new Promise(res => setTimeout(res, 1));
      }

      // 3. Verify the cache size is still at the limit
      stats = await getCacheStats();
      expect(stats.count).toBe(100);

      // 4. Verify that the oldest items have been removed
      const oldestPanoResult = await getCachedDepthMap({ ...mockCameraParams, panoId: 'pano-0' });
      const secondOldestPanoResult = await getCachedDepthMap({ ...mockCameraParams, panoId: 'pano-4' });
      expect(oldestPanoResult).toBeNull();
      expect(secondOldestPanoResult).toBeNull();


      // 5. Verify that the newest items are still present
      const newestPanoResult = await getCachedDepthMap({ ...mockCameraParams, panoId: 'pano-54' });
      expect(newestPanoResult).not.toBeNull();
    });
  });

  describe('clearDepthCache', () => {
    it('should remove all cached items', async () => {
      await cacheDepthMap(mockCameraParams, mockDepthMap);
      let stats = await getCacheStats();
      expect(stats.count).toBe(1);

      await clearDepthCache();
      stats = await getCacheStats();
      expect(stats.count).toBe(0);
    });
  });

  describe('getCacheStats', () => {
    it('should report correct count and size', async () => {
      await cacheDepthMap({ ...mockCameraParams, panoId: 'pano-1' }, mockDepthMap);
      await cacheDepthMap({ ...mockCameraParams, panoId: 'pano-2' }, mockDepthMap);

      const stats = await getCacheStats();
      expect(stats.count).toBe(2);
      // Size should be greater than 0 (compressed or uncompressed)
      expect(stats.size).toBeGreaterThan(0);
    });
  });

  describe('sparse depth data', () => {
    const camera: CameraParams = { vFov: 90, pitch: 0 };
    const viewportWidth = 2;
    const viewportHeight = 2;

    it('computes weighted average when some neighbors are invalid', () => {
      const depthMap: OnnxDepthMap = {
        data: [
          10, NaN,
          6, Infinity,
        ],
        width: 2,
        height: 2,
      };
      const result = estimateDistanceToPoint(0.5, 0.5, viewportWidth, viewportHeight, camera, depthMap);
      expect(result).toBeCloseTo(8);
    });

    it('falls back to median when fewer than two valid samples', () => {
      const depthMap: OnnxDepthMap = {
        data: [
          10, NaN,
          NaN, NaN,
        ],
        width: 2,
        height: 2,
      };
      const result = estimateDistanceToPoint(0.5, 0.5, viewportWidth, viewportHeight, camera, depthMap);
      expect(result).toBe(10);
    });
  });
});