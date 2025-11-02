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

export interface MultiPointCalibration {
  points: Array<{ x: number; y: number; pitchOffset: number }>;
  confidence: number;
  timestamp: number;
}

export interface ZoomBiasTable {
  [zoom: number]: number; // pitch offset in degrees
}

/**
 * Interpolate zoom-level bias values for smooth transitions
 */
export function interpolateZoomBias(
  zoom: number,
  biasTable: ZoomBiasTable
): number {
  const zoomLevels = Object.keys(biasTable)
    .map(k => Number(k))
    .filter(k => Number.isFinite(k))
    .sort((a, b) => a - b);

  if (zoomLevels.length === 0) return 0;
  if (zoomLevels.length === 1) return biasTable[zoomLevels[0]!] ?? 0;

  // Find surrounding zoom levels
  let lower = zoomLevels[0]!;
  let upper = zoomLevels[zoomLevels.length - 1]!;

  for (let i = 0; i < zoomLevels.length - 1; i++) {
    if (zoom >= zoomLevels[i]! && zoom <= zoomLevels[i + 1]!) {
      lower = zoomLevels[i]!;
      upper = zoomLevels[i + 1]!;
      break;
    }
  }

  // Extrapolate if outside range
  if (zoom < lower) {
    return biasTable[lower] ?? 0;
  }
  if (zoom > upper) {
    return biasTable[upper] ?? 0;
  }

  // Linear interpolation
  const lowerBias = biasTable[lower] ?? 0;
  const upperBias = biasTable[upper] ?? 0;
  const t = (zoom - lower) / (upper - lower);
  return lowerBias + t * (upperBias - lowerBias);
}

/**
 * Fit pitch offset from multiple horizon points using RANSAC-like approach
 */
export function fitMultiPointCalibration(
  points: Array<{ x: number; y: number }>,
  cameraParams: { pitch: number; vFov: number },
  viewHeight: number
): { pitchOffset: number; confidence: number } | null {
  if (points.length < 2) return null;

  // Convert pixel Y positions to pitch offsets
  const offsets = points.map(p => {
    const angle = ((p.y / viewHeight) - 0.5) * cameraParams.vFov;
    return -(cameraParams.pitch + angle);
  });

  // Use median as robust estimate
  const sorted = [...offsets].sort((a, b) => a - b);
  const medianOffset = sorted.length % 2
    ? sorted[Math.floor(sorted.length / 2)]!
    : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2;

  // Compute confidence based on consistency
  const deviations = offsets.map(o => Math.abs(o - medianOffset));
  const medianDeviation = deviations.sort((a, b) => a - b)[Math.floor(deviations.length / 2)]!;
  const consistency = Math.max(0, Math.min(1, 1 - medianDeviation / 5)); // 5 degrees max deviation

  // Boost confidence with more points
  const pointConfidence = Math.min(1, points.length / 5);

  return {
    pitchOffset: medianOffset,
    confidence: consistency * pointConfidence
  };
}

// Runtime calibration manager (front-end)
class CalibrationManager {
  private samples: CalibrationSample[] = [];
  private readonly maxSamples: number = 200;
  private readonly minSamplesForFit: number = 10;
  private adaptiveWeights: Map<string, number> = new Map(); // Track weights per pano/zoom

  reset(): void {
    this.samples = [];
    this.adaptiveWeights.clear();
  }

  getSampleCount(): number {
    return this.samples.length;
  }

  addSample(predicted: number, actual: number, context?: { panoId?: string; zoom?: number }): void {
    if (!Number.isFinite(predicted) || !Number.isFinite(actual)) return;
    if (predicted <= 0 || actual <= 0) return;
    this.samples.push({ predicted, actual });
    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }

    // Adaptive learning: track weight per context
    if (context?.panoId && context?.zoom !== undefined) {
      const key = `${context.panoId}_${Math.round(context.zoom)}`;
      const currentWeight = this.adaptiveWeights.get(key) ?? 1.0;
      // Increase weight slightly for contexts with good samples
      const error = Math.abs(predicted - actual) / actual;
      if (error < 0.1) {
        this.adaptiveWeights.set(key, Math.min(2.0, currentWeight * 1.05));
      }
    }
  }

  computeScaleBias(context?: { panoId?: string; zoom?: number }): { scale: number; bias: number } | null {
    if (this.samples.length < this.minSamplesForFit) return null;

    // Weight samples by context if available
    let weightedSamples = this.samples;
    if (context?.panoId && context?.zoom !== undefined) {
      const key = `${context.panoId}_${Math.round(context.zoom)}`;
      const weight = this.adaptiveWeights.get(key) ?? 1.0;
      // Duplicate samples from relevant contexts for weighted fit
      if (weight > 1.0) {
        weightedSamples = [...this.samples];
        for (let i = 0; i < Math.floor(weight - 1.0) * this.samples.length; i++) {
          weightedSamples.push(this.samples[i % this.samples.length]!);
        }
      }
    }

    // Outlier rejection using median absolute deviation on residuals from initial fit
    const initial = deriveScaleAndBias(weightedSamples);
    const residuals = weightedSamples.map(s => Math.abs((initial.scale * s.predicted + initial.bias) - s.actual));
    const median = this.median(residuals);
    const mad = this.median(residuals.map(r => Math.abs(r - median))) || 1e-6;
    const threshold = median + 3 * mad;
    const inliers = weightedSamples.filter((_s, i) => residuals[i]! <= threshold);

    const { scale, bias } = deriveScaleAndBias(inliers.length >= this.minSamplesForFit ? inliers : weightedSamples);

    // Clamp to sane bounds
    const clampedScale = Math.max(0.1, Math.min(10, scale));
    const clampedBias = Math.max(-50, Math.min(50, bias));
    return { scale: clampedScale, bias: clampedBias };
  }

  /**
   * Adaptive calibration: learn from measurement errors over time
   */
  learnFromMeasurement(
    predicted: number,
    measured: number,
    context: { panoId?: string; zoom?: number }
  ): void {
    if (!Number.isFinite(predicted) || !Number.isFinite(measured)) return;
    if (predicted <= 0 || measured <= 0) return;

    const relativeError = Math.abs(predicted - measured) / measured;
    
    // Only learn from reasonably accurate measurements (< 20% error)
    if (relativeError < 0.2) {
      this.addSample(predicted, measured, context);
    }
  }

  private median(arr: number[]): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
}

export const calibrationManager = new CalibrationManager();