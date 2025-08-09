export interface CalibrationSample {
  predicted: number;
  actual: number;
}

/**
 * Derive scale and bias that best map predicted depths to actual distances using
 * a simple least squares fit of actual = scale * predicted + bias.
 */
export function deriveScaleAndBias(samples: CalibrationSample[]): { scale: number; bias: number } {
  if (samples.length === 0) {
    return { scale: 1, bias: 0 };
  }
  let sumPred = 0;
  let sumActual = 0;
  let sumPred2 = 0;
  let sumPredActual = 0;
  for (const s of samples) {
    sumPred += s.predicted;
    sumActual += s.actual;
    sumPred2 += s.predicted * s.predicted;
    sumPredActual += s.predicted * s.actual;
  }
  const n = samples.length;
  const denom = n * sumPred2 - sumPred * sumPred;
  const scale = denom === 0 ? 1 : (n * sumPredActual - sumPred * sumActual) / denom;
  const bias = (sumActual - scale * sumPred) / n;
  return { scale, bias };
}

// Default calibration values for bundled depth models.
// Values are derived from sample scenes with known distances.
export const MODEL_CALIBRATIONS: Record<string, { scale: number; bias: number }> = {
  'depth_anything_v2_metric_vkitti_vits.onnx': { scale: 1.07, bias: 0 },
  'depth_anything_v2_vit_tiny_metric_outdoor.onnx': { scale: 1, bias: 0 },
};

// Runtime calibration manager (front-end)
class CalibrationManager {
  private samples: CalibrationSample[] = [];
  private readonly maxSamples: number = 200;
  private readonly minSamplesForFit: number = 10;

  reset(): void {
    this.samples = [];
  }

  getSampleCount(): number {
    return this.samples.length;
  }

  addSample(predicted: number, actual: number): void {
    if (!Number.isFinite(predicted) || !Number.isFinite(actual)) return;
    if (predicted <= 0 || actual <= 0) return;
    this.samples.push({ predicted, actual });
    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }
  }

  computeScaleBias(): { scale: number; bias: number } | null {
    if (this.samples.length < this.minSamplesForFit) return null;

    // Outlier rejection using median absolute deviation on residuals from initial fit
    const initial = deriveScaleAndBias(this.samples);
    const residuals = this.samples.map(s => Math.abs((initial.scale * s.predicted + initial.bias) - s.actual));
    const median = this.median(residuals);
    const mad = this.median(residuals.map(r => Math.abs(r - median))) || 1e-6;
    const threshold = median + 3 * mad;
    const inliers = this.samples.filter((_s, i) => residuals[i] <= threshold);

    const { scale, bias } = deriveScaleAndBias(inliers.length >= this.minSamplesForFit ? inliers : this.samples);

    // Clamp to sane bounds
    const clampedScale = Math.max(0.1, Math.min(10, scale));
    const clampedBias = Math.max(-50, Math.min(50, bias));
    return { scale: clampedScale, bias: clampedBias };
  }

  private median(arr: number[]): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }
}

export const calibrationManager = new CalibrationManager();