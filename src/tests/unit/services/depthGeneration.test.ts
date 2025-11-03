import { describe, it, expect, jest } from '@jest/globals';
import { generateDepthMap } from '../../../services/depthGeneration';
import { cacheDepthMap, clearDepthCache, getCachedDepthMap } from '../../../services/depth';
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

  beforeAll(() => {
    (globalThis as unknown as { FileReader?: unknown }).FileReader = undefined;
    if (typeof globalThis.btoa !== 'function') {
      (globalThis as unknown as { btoa?: (input: string) => string }).btoa = (input: string) =>
        Buffer.from(input, 'binary').toString('base64');
    }
  });

  beforeEach(async () => {
    await clearDepthCache();
  });

  afterEach(async () => {
    await clearDepthCache();
  });

  it('returns cached depth maps without hitting the network', async () => {
    const cachedDepthMap: OnnxDepthMap = { data: [1, 2, 3], width: 1, height: 3 };

    const fetchImage = jest.fn();
    const cacheDepthMapMock = jest.fn();
    const result = await generateDepthMap(baseCameraParams, 'api-key', {
      fetchImage: fetchImage as unknown as (url: string) => Promise<Response>,
      getCachedDepthMap: jest.fn().mockResolvedValue(cachedDepthMap),
      cacheDepthMap: cacheDepthMapMock,
      invokeDepth: jest.fn(),
    });

    expect(result.fromCache).toBe(true);
    expect(result.depthMap).toBe(cachedDepthMap);
    expect(fetchImage).not.toHaveBeenCalled();
    expect(cacheDepthMapMock).not.toHaveBeenCalled();
  });

  it('awaits caching before resolving when generating a new depth map', async () => {
    const imageBuffer = Uint8Array.from([1, 2, 3]).buffer;
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
    const cacheDepthMapMock = jest.fn().mockResolvedValue(undefined);

    const generationPromise = generateDepthMap(baseCameraParams, 'api-key', {
      fetchImage,
      getCachedDepthMap: jest.fn().mockResolvedValue(null),
      cacheDepthMap: cacheDepthMapMock,
      invokeDepth,
    });

    const result = await generationPromise;

    expect(fetchImage).toHaveBeenCalledWith(expect.stringContaining('size=640x640'));
    expect(invokeDepth).toHaveBeenCalledWith(expect.stringContaining('data:image/jpeg;base64,'));
    expect(cacheDepthMapMock).toHaveBeenCalled();
    expect(result.fromCache).toBe(false);
    expect(result.depthMap.width).toBe(1);
    expect(cacheDepthMapMock).toHaveBeenCalledTimes(1);
  });

  it('returns cached transform results without invoking inference twice', async () => {
    const imageBuffer = Uint8Array.from([4, 5, 6]).buffer;
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
    const invokeDepth = jest.fn().mockResolvedValue({
      data: [0.3, 0.4, 0.5, 0.6],
      width: 2,
      height: 2,
      transform: {
        originalWidth: 1024,
        originalHeight: 1024,
        resizedWidth: 640,
        resizedHeight: 640,
        scaleX: 0.625,
        scaleY: 0.625,
        offsetX: 8.12,
        offsetY: -3.45,
      }
    } satisfies OnnxDepthMap);

    const getCache = jest.fn((params: CameraParams) => getCachedDepthMap(params));
    const setCache = jest.fn((params: CameraParams, depth: OnnxDepthMap) => cacheDepthMap(params, depth));

    const firstResult = await generateDepthMap(baseCameraParams, 'api-key', {
      fetchImage,
      getCachedDepthMap: getCache,
      cacheDepthMap: setCache,
      invokeDepth,
    });

    expect(firstResult.fromCache).toBe(false);
    expect(fetchImage).toHaveBeenCalledTimes(1);
    expect(invokeDepth).toHaveBeenCalledTimes(1);
    expect(setCache).toHaveBeenCalledTimes(1);

    fetchImage.mockClear();
    invokeDepth.mockClear();
    setCache.mockClear();
    getCache.mockClear();

    const secondResult = await generateDepthMap(baseCameraParams, 'api-key', {
      fetchImage,
      getCachedDepthMap: getCache,
      cacheDepthMap: setCache,
      invokeDepth,
    });

    expect(secondResult.fromCache).toBe(true);
    expect(secondResult.depthMap).toEqual(firstResult.depthMap);
    expect(fetchImage).not.toHaveBeenCalled();
    expect(invokeDepth).not.toHaveBeenCalled();
    expect(setCache).not.toHaveBeenCalled();
  });

  it('throws when the Street View request fails', async () => {
    const response = {
      ok: false,
      status: 500,
      statusText: 'Internal Error',
      arrayBuffer: async () => new ArrayBuffer(0),
    } as Response;

    await expect(generateDepthMap(baseCameraParams, 'api-key', {
      fetchImage: jest.fn().mockResolvedValue(response),
      getCachedDepthMap: jest.fn().mockResolvedValue(null),
      cacheDepthMap: jest.fn(),
      invokeDepth: jest.fn(),
    })).rejects.toThrow('Static API request failed');
  });

  it('throws when inference result is invalid', async () => {
    const imageBuffer = Uint8Array.from([1, 2, 3]).buffer;
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
