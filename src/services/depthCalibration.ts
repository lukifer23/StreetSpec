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
