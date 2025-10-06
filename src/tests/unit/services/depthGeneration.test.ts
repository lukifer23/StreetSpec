import { describe, it, expect, jest } from '@jest/globals';
import { blobToDataUrl, generateDepthMap } from '../../../services/depthGeneration';
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
  it('converts blobs into data URLs', async () => {
    const blob = new Blob([Uint8Array.from([0xde, 0xad, 0xbe, 0xef])], { type: 'image/png' });
    const dataUrl = await blobToDataUrl(blob);

    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    const base64 = dataUrl.split(',')[1];
    const restored = Buffer.from(base64, 'base64');
    expect(Array.from(restored.values())).toEqual([0xde, 0xad, 0xbe, 0xef]);
  });

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
    const blob = new Blob([Uint8Array.from([1, 2, 3])], { type: 'image/jpeg' });
    const response = {
      ok: true,
      status: 200,
      statusText: 'OK',
      blob: async () => blob,
    } as Response;

    const fetchImage = jest.fn().mockResolvedValue(response);
    const invokeDepth = jest.fn().mockResolvedValue({ data: [0.1, 0.2], width: 1, height: 2 } satisfies OnnxDepthMap);
    let resolveCache!: () => void;
    const cacheDepthMap = jest.fn(() => new Promise<void>(resolve => {
      resolveCache = resolve;
    }));

    const generationPromise = generateDepthMap(baseCameraParams, 'api-key', {
      fetchImage,
      getCachedDepthMap: jest.fn().mockResolvedValue(null),
      cacheDepthMap,
      invokeDepth,
    });

    let settled = false;
    generationPromise.then(() => { settled = true; });

    await Promise.resolve();

    expect(fetchImage).toHaveBeenCalledWith(expect.stringContaining('size=640x640'));
    expect(invokeDepth).toHaveBeenCalledWith(expect.stringContaining('data:image/jpeg;base64,'));
    expect(settled).toBe(false);

    resolveCache();
    const result = await generationPromise;

    expect(settled).toBe(true);
    expect(result.fromCache).toBe(false);
    expect(result.depthMap.width).toBe(1);
    expect(cacheDepthMap).toHaveBeenCalledTimes(1);
  });

  it('throws when the Street View request fails', async () => {
    const response = {
      ok: false,
      status: 500,
      statusText: 'Internal Error',
      blob: async () => new Blob(),
    } as Response;

    await expect(generateDepthMap(baseCameraParams, 'api-key', {
      fetchImage: jest.fn().mockResolvedValue(response),
      getCachedDepthMap: jest.fn().mockResolvedValue(null),
      cacheDepthMap: jest.fn(),
      invokeDepth: jest.fn(),
    })).rejects.toThrow('Static API request failed');
  });

  it('throws when inference result is invalid', async () => {
    const blob = new Blob([Uint8Array.from([1, 2, 3])], { type: 'image/jpeg' });
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
});
