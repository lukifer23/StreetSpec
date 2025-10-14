import { describe, it, expect, jest } from '@jest/globals';
import { generateDepthMap } from '../../../services/depthGeneration';
import { CameraParams, OnnxDepthMap } from '../../../types/common';

const baseCameraParams: CameraParams = {
  panoId: 'test-pano',
  lat: 10,
  lng: 20,
  heading: 0,
  pitch: 0,
  fov: 90,
};

describe('depthGeneration helpers', () => {

  it('returns cached depth maps without hitting the network', async () => {
    const cachedDepthMap: OnnxDepthMap = { data: [1, 2, 3], width: 1, height: 3 };

    const fetchImage = jest.fn();
    const cacheDepthMap = jest.fn();
    const result = await generateDepthMap(baseCameraParams, 'api-key', {
      fetchImage: fetchImage as unknown as (url: string) => Promise<Response>,
      getCachedDepthMap: jest.fn().mockResolvedValue(cachedDepthMap),
      cacheDepthMap: cacheDepthMap,
      invokeDepth: jest.fn(),
    });

    expect(result.fromCache).toBe(true);
    expect(result.depthMap).toBe(cachedDepthMap);
    expect(fetchImage).not.toHaveBeenCalled();
    expect(cacheDepthMap).not.toHaveBeenCalled();
  });

  it('awaits caching before resolving when generating a new depth map', async () => {
    const imageBuffer = Buffer.from([1, 2, 3]);
    const blob = {
      type: 'image/jpeg',
      arrayBuffer: async () => imageBuffer
    } as Blob;
    const response = {
      ok: true,
      status: 200,
      statusText: 'OK',
      blob: async () => blob,
    } as Response;

    const fetchImage = jest.fn().mockResolvedValue(response);
    const invokeDepth = jest.fn().mockResolvedValue({ data: [0.1, 0.2], width: 1, height: 2 } satisfies OnnxDepthMap);
    const cacheDepthMap = jest.fn().mockResolvedValue(undefined);

    const generationPromise = generateDepthMap(baseCameraParams, 'api-key', {
      fetchImage,
      getCachedDepthMap: jest.fn().mockResolvedValue(null),
      cacheDepthMap,
      invokeDepth,
    });

    const result = await generationPromise;

    expect(fetchImage).toHaveBeenCalledWith(expect.stringContaining('size=640x640'));
    expect(invokeDepth).toHaveBeenCalledWith(expect.stringContaining('data:image/jpeg;base64,'));
    expect(cacheDepthMap).toHaveBeenCalled();
    expect(result.fromCache).toBe(false);
    expect(result.depthMap.width).toBe(1);
    expect(cacheDepthMap).toHaveBeenCalledTimes(1);
  });

  it('throws when the Street View request fails', async () => {
    const response = {
      ok: false,
      status: 500,
      statusText: 'Internal Error',
      arrayBuffer: async () => Buffer.from([]),
    } as Response;

    await expect(generateDepthMap(baseCameraParams, 'api-key', {
      fetchImage: jest.fn().mockResolvedValue(response),
      getCachedDepthMap: jest.fn().mockResolvedValue(null),
      cacheDepthMap: jest.fn(),
      invokeDepth: jest.fn(),
    })).rejects.toThrow('Static API request failed');
  });

  it('throws when inference result is invalid', async () => {
    const imageBuffer = Buffer.from([1, 2, 3]);
    const blob = {
      type: 'image/jpeg',
      arrayBuffer: async () => imageBuffer
    } as Blob;
    const response = {
      ok: true,
      status: 200,
      statusText: 'OK',
      blob: async () => blob,
    } as Response;

    await expect(generateDepthMap(baseCameraParams, 'api-key', {
      fetchImage: jest.fn().mockResolvedValue(response),
      getCachedDepthMap: jest.fn().mockResolvedValue(null),
      cacheDepthMap: jest.fn(),
      invokeDepth: jest.fn().mockResolvedValue(null),
    })).rejects.toThrow('Main process failed to return valid depth map data');
  });

  it('clamps FOV values beyond API limits', async () => {
    const imageBuffer = Buffer.from([1, 2, 3]);
    const blob = {
      type: 'image/jpeg',
      arrayBuffer: async () => imageBuffer
    } as Blob;
    const response = {
      ok: true,
      status: 200,
      statusText: 'OK',
      blob: async () => blob,
    } as Response;

    const fetchImage = jest.fn().mockResolvedValue(response);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      await generateDepthMap({ ...baseCameraParams, fov: 200 }, 'api-key', {
        fetchImage,
        getCachedDepthMap: jest.fn().mockResolvedValue(null),
        cacheDepthMap: jest.fn(),
        invokeDepth: jest.fn().mockResolvedValue({ data: [0.1, 0.2], width: 1, height: 2 } satisfies OnnxDepthMap),
      });

      expect(fetchImage).toHaveBeenCalledWith(expect.stringContaining('fov=120'));
      expect(warnSpy).toHaveBeenCalledWith('[DepthGeneration] Clamping FOV from 200 to 120');
    } finally {
      warnSpy.mockRestore();
    }
  });
});
