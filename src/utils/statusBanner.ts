import type { DepthDataFetchResult } from '../types/common';

type BannerTone = 'info' | 'warning' | 'error';
type BannerRole = 'status' | 'alert';

export interface BannerPresentation {
  tone: BannerTone;
  role: BannerRole;
}

type DepthErrorCode = Extract<DepthDataFetchResult, { status: 'error' }>['code'];

const WARNING_CODES = new Set<DepthErrorCode>(['NOT_FOUND', 'NETWORK_ERROR']);

export const getStatusBannerPresentation = (
  status: DepthDataFetchResult | null
): BannerPresentation | null => {
  if (!status) {
    return null;
  }

  if (status.status === 'rate-limit') {
    return { tone: 'warning', role: 'status' };
  }

  if (status.status === 'error') {
    if (WARNING_CODES.has(status.code)) {
      return { tone: 'warning', role: 'status' };
    }

    return { tone: 'error', role: 'alert' };
  }

  return { tone: 'info', role: 'status' };
};
