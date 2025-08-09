import { describe, it, expect } from '@jest/globals';
import { deriveScaleAndBias } from '../../../services/depthCalibration';

describe('deriveScaleAndBias', () => {
  it('computes scale and bias for perfect proportional samples', () => {
    const samples = [
      { predicted: 1, actual: 2 },
      { predicted: 2, actual: 4 },
      { predicted: 3, actual: 6 },
    ];
    const { scale, bias } = deriveScaleAndBias(samples);
    expect(scale).toBeCloseTo(2);
    expect(bias).toBeCloseTo(0);
  });

  it('computes bias when present', () => {
    const samples = [
      { predicted: 1, actual: 3 },
      { predicted: 2, actual: 5 },
      { predicted: 3, actual: 7 },
    ];
    const { scale, bias } = deriveScaleAndBias(samples);
    expect(scale).toBeCloseTo(2);
    expect(bias).toBeCloseTo(1);
  });

  it('returns defaults for empty sample set', () => {
    const { scale, bias } = deriveScaleAndBias([]);
    expect(scale).toBe(1);
    expect(bias).toBe(0);
  });
});
