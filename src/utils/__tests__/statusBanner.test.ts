import { getStatusBannerPresentation } from '../statusBanner';
import type { DepthDataFetchResult } from '../../types/common';

describe('getStatusBannerPresentation', () => {
  it('returns warning tone for rate limit responses', () => {
    const status: DepthDataFetchResult = {
      status: 'rate-limit',
      code: 'RATE_LIMIT',
      message: 'Rate limited.',
      retryAfterMs: 2000,
      attempts: 2,
    };

    const presentation = getStatusBannerPresentation(status);
    expect(presentation).toEqual({ tone: 'warning', role: 'status' });
  });

  it('returns warning tone for recoverable depth errors', () => {
    const status: DepthDataFetchResult = {
      status: 'error',
      code: 'NETWORK_ERROR',
      message: 'Temporary issue.',
      attempts: 1,
    };

    const presentation = getStatusBannerPresentation(status);
    expect(presentation).toEqual({ tone: 'warning', role: 'status' });
  });

  it('returns error tone for hard failures', () => {
    const status: DepthDataFetchResult = {
      status: 'error',
      code: 'NO_API_KEY',
      message: 'Missing API key.',
      attempts: 1,
    };

    const presentation = getStatusBannerPresentation(status);
    expect(presentation).toEqual({ tone: 'error', role: 'alert' });
  });
});
