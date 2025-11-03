import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { depthPrefetchService } from '../depthPrefetch';
import type { CameraParams } from '../../types/common';
import { generateDepthMap } from '../depthGeneration';
import { getCachedDepthMap } from '../depth';
import { getRateLimitStatus } from '../rateLimiter';

jest.mock('../depthGeneration', () => ({
  generateDepthMap: jest.fn(),
  createDepthMapFetcher: jest.fn(() => jest.fn()),
}));

jest.mock('../depth', () => ({
  getCachedDepthMap: jest.fn(),
  cacheDepthMap: jest.fn(),
}));

jest.mock('../rateLimiter', () => ({
  getRateLimitStatus: jest.fn(),
}));

const mockedGenerateDepthMap = generateDepthMap as jest.MockedFunction<typeof generateDepthMap>;
const mockedGetCachedDepthMap = getCachedDepthMap as jest.MockedFunction<typeof getCachedDepthMap>;
const mockedGetRateLimitStatus = getRateLimitStatus as jest.MockedFunction<typeof getRateLimitStatus>;

const advanceTimersByTimeAsync = (ms: number) =>
  (jest as unknown as { advanceTimersByTimeAsync: (ms: number) => Promise<void> }).advanceTimersByTimeAsync(ms);

describe('depthPrefetchService.warmCache', () => {
  const originalHardwareConcurrency = navigator.hardwareConcurrency;
  const cameraParams: CameraParams = { panoId: 'base-pano', heading: 0, pitch: 0 };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    Object.defineProperty(window.navigator, 'hardwareConcurrency', {
      configurable: true,
      value: 4,
    });
    depthPrefetchService.cancelAll();
    mockedGetRateLimitStatus.mockReturnValue(null);
    mockedGetCachedDepthMap.mockResolvedValue(null);
    depthPrefetchService.init('test-api-key');
  });

  afterEach(() => {
    Object.defineProperty(window.navigator, 'hardwareConcurrency', {
      configurable: true,
      value: originalHardwareConcurrency,
    });
    jest.useRealTimers();
  });

  it('waits for each batch before starting the next one', async () => {
    const resolvers: Array<() => void> = [];
    mockedGenerateDepthMap.mockImplementation(
      () =>
        new Promise<void>(resolve => {
          resolvers.push(resolve);
        })
    );

    const panoIds = ['p1', 'p2', 'p3', 'p4'];

    const warmPromise = depthPrefetchService.warmCache(panoIds, cameraParams, {
      maxConcurrent: 2,
      enableCache: false,
      quality: 'medium',
    });

    for (let spins = 0; spins < 10 && resolvers.length < 2; spins++) {
      await Promise.resolve();
    }

    expect(mockedGenerateDepthMap).toHaveBeenCalledTimes(2);
    expect(resolvers).toHaveLength(2);

    await advanceTimersByTimeAsync(200);
    expect(mockedGenerateDepthMap).toHaveBeenCalledTimes(2);

    const firstBatchResolvers = resolvers.splice(0, resolvers.length);
    firstBatchResolvers.forEach(resolve => resolve());
    await Promise.resolve();

    await advanceTimersByTimeAsync(200);
    for (let spins = 0; spins < 10 && resolvers.length < 2; spins++) {
      await Promise.resolve();
    }
    expect(mockedGenerateDepthMap).toHaveBeenCalledTimes(4);
    expect(resolvers).toHaveLength(2);

    const secondBatchResolvers = resolvers.splice(0, resolvers.length);
    secondBatchResolvers.forEach(resolve => resolve());

    await warmPromise;

    expect(mockedGenerateDepthMap).toHaveBeenCalledTimes(4);
  });
});
