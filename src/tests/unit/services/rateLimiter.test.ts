import { rateLimiter, resetRateLimit } from '@/services/rateLimiter';

describe('rateLimiter.executeWithRateLimit', () => {
  const TEST_CATEGORY = 'test-rate-limiter';
  const testConfig = {
    maxRequests: 2,
    windowMs: 1000,
    retryDelay: 10,
    maxRetries: 0,
    backoffMultiplier: 1,
    circuitBreakerThreshold: 5,
    circuitBreakerTimeout: 1000,
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    rateLimiter.addConfig(TEST_CATEGORY, testConfig);
    resetRateLimit(TEST_CATEGORY);
  });

  afterEach(() => {
    // Don't clear queue for this test as it tests queue behavior
    resetRateLimit(TEST_CATEGORY);
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('defers requests beyond the rate limit window before processing them', async () => {
    const executionTimes: number[] = [];

    const operations = Array.from({ length: testConfig.maxRequests + 1 }, (_, index) =>
      rateLimiter.executeWithRateLimit(TEST_CATEGORY, async () => {
        executionTimes.push(Date.now());
        return index;
      })
    );

    // Wait for initial processing to complete
    await Promise.resolve();
    expect(executionTimes).toHaveLength(testConfig.maxRequests);

    jest.advanceTimersByTime(testConfig.windowMs - 1);
    await Promise.resolve();
    expect(executionTimes).toHaveLength(testConfig.maxRequests);

    jest.advanceTimersByTime(1);
    await Promise.resolve();

    await allPromise;

    expect(executionTimes).toHaveLength(testConfig.maxRequests + 1);
    expect(executionTimes[testConfig.maxRequests]).toBeGreaterThanOrEqual(testConfig.windowMs);
  });
});
