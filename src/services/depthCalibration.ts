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
  [zoom: number]: {
    bias: number; // pitch offset in degrees
    confidence: number; // 0-1 confidence in this bias value
    sampleCount: number; // number of samples used
    lastUpdated: number; // timestamp
  };
}

export interface PerZoomCalibration {
  zoom: number;
  bias: number;
  confidence: number;
  sampleCount: number;
  scale?: number; // optional depth scale adjustment per zoom
  biasStdDev?: number; // standard deviation of bias measurements
}

/**
 * Enhanced zoom-level bias interpolation with confidence weighting
 */
export function interpolateZoomBias(
  zoom: number,
  biasTable: ZoomBiasTable
): { bias: number; confidence: number } {
  const zoomLevels = Object.keys(biasTable)
    .map(k => Number(k))
    .filter(k => Number.isFinite(k))
    .sort((a, b) => a - b);

  if (zoomLevels.length === 0) return { bias: 0, confidence: 0 };
  
  if (zoomLevels.length === 1) {
    const entry = biasTable[zoomLevels[0]!];
    if (entry && typeof entry === 'object') {
      return { bias: entry.bias, confidence: entry.confidence };
    }
    // Legacy format support
    const legacyBias = typeof entry === 'number' ? entry : 0;
    return { bias: legacyBias, confidence: 0.5 };
  }

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

  // Extract bias entries (handle both new and legacy formats)
  const getBiasEntry = (z: number): { bias: number; confidence: number } => {
    const entry = biasTable[z];
    if (!entry) return { bias: 0, confidence: 0 };
    if (typeof entry === 'object') {
      return { bias: entry.bias, confidence: entry.confidence };
    }
    return { bias: entry, confidence: 0.5 }; // Legacy format
  };

  const lowerEntry = getBiasEntry(lower);
  const upperEntry = getBiasEntry(upper);

  // Extrapolate if outside range (with reduced confidence)
  if (zoom < lower) {
    return { bias: lowerEntry.bias, confidence: lowerEntry.confidence * 0.7 };
  }
  if (zoom > upper) {
    return { bias: upperEntry.bias, confidence: upperEntry.confidence * 0.7 };
  }

  // Confidence-weighted interpolation
  const t = (zoom - lower) / (upper - lower);
  const totalConfidence = lowerEntry.confidence + upperEntry.confidence;
  
  if (totalConfidence < 1e-6) {
    // Simple linear interpolation if no confidence data
    const bias = lowerEntry.bias + t * (upperEntry.bias - lowerEntry.bias);
    return { bias, confidence: 0.5 };
  }

  // Weight by confidence
  const lowerWeight = lowerEntry.confidence / totalConfidence;
  const upperWeight = upperEntry.confidence / totalConfidence;
  
  const bias = lowerEntry.bias * (1 - t) * lowerWeight + upperEntry.bias * t * upperWeight +
               lowerEntry.bias * (1 - t) * (1 - lowerWeight) + upperEntry.bias * t * (1 - upperWeight);
  
  // Interpolated confidence decreases with distance from known points
  const confidence = Math.min(lowerEntry.confidence, upperEntry.confidence) * (1 - Math.abs(t - 0.5) * 0.5);
  
  return { bias, confidence: Math.max(0, Math.min(1, confidence)) };
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

// Runtime calibration manager with enhanced adaptive learning
class CalibrationManager {
  private samples: CalibrationSample[] = [];
  private readonly maxSamples: number = 500; // Increased for better learning
  private readonly minSamplesForFit: number = 10;
  private adaptiveWeights: Map<string, number> = new Map(); // Track weights per pano/zoom
  private zoomBiasTable: ZoomBiasTable = {}; // Per-zoom bias tracking
  private readonly zoomBiasDecayTime = 30 * 24 * 60 * 60 * 1000; // 30 days in ms

  reset(): void {
    this.samples = [];
    this.adaptiveWeights.clear();
    this.zoomBiasTable = {};
  }

  getSampleCount(): number {
    return this.samples.length;
  }

  /**
   * Enhanced sample addition with zoom-level bias tracking
   */
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

    // Track zoom-level bias if zoom is available
    if (context?.zoom !== undefined) {
      this.updateZoomBias(context.zoom, predicted, actual);
    }
  }

  /**
   * Update per-zoom bias table with new measurement
   */
  private updateZoomBias(zoom: number, predicted: number, actual: number): void {
    const roundedZoom = Math.round(zoom * 2) / 2; // Round to nearest 0.5
    const relativeError = (actual - predicted) / actual;
    
    // Convert error to pitch offset estimate (rough approximation)
    // Larger error at closer distances suggests pitch offset
    const biasEstimate = relativeError * 10; // Rough conversion factor

    const existing = this.zoomBiasTable[roundedZoom];
    const now = Date.now();

    if (existing && typeof existing === 'object') {
      // Update existing entry with exponential moving average
      const alpha = 0.2; // Learning rate
      const newBias = existing.bias * (1 - alpha) + biasEstimate * alpha;
      const newSampleCount = existing.sampleCount + 1;
      
      // Update confidence based on consistency
      const biasDiff = Math.abs(newBias - existing.bias);
      const consistency = Math.max(0, 1 - biasDiff / 5); // 5 degrees max difference
      const newConfidence = Math.min(1.0, existing.confidence * 0.9 + consistency * 0.1);

      this.zoomBiasTable[roundedZoom] = {
        bias: newBias,
        confidence: newConfidence,
        sampleCount: newSampleCount,
        lastUpdated: now
      };
    } else {
      // Create new entry
      this.zoomBiasTable[roundedZoom] = {
        bias: biasEstimate,
        confidence: 0.3, // Low initial confidence
        sampleCount: 1,
        lastUpdated: now
      };
    }

    // Clean up old entries
    this.cleanupZoomBiasTable();
  }

  /**
   * Remove stale zoom bias entries
   */
  private cleanupZoomBiasTable(): void {
    const now = Date.now();
    for (const [zoom, entry] of Object.entries(this.zoomBiasTable)) {
      if (typeof entry === 'object' && entry.lastUpdated < now - this.zoomBiasDecayTime) {
        delete this.zoomBiasTable[Number(zoom)];
      }
    }
  }

  /**
   * Get zoom bias table for persistence
   */
  getZoomBiasTable(): ZoomBiasTable {
    this.cleanupZoomBiasTable();
    return { ...this.zoomBiasTable };
  }

  /**
   * Set zoom bias table (e.g., from persisted settings)
   */
  setZoomBiasTable(table: ZoomBiasTable): void {
    this.zoomBiasTable = { ...table };
    this.cleanupZoomBiasTable();
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
   * Enhanced adaptive calibration: learn from measurement errors with quality filtering
   */
  learnFromMeasurement(
    predicted: number,
    measured: number,
    context: { panoId?: string; zoom?: number; confidence?: number }
  ): void {
    if (!Number.isFinite(predicted) || !Number.isFinite(measured)) return;
    if (predicted <= 0 || measured <= 0) return;

    const relativeError = Math.abs(predicted - measured) / measured;
    
    // Adaptive threshold based on measurement confidence
    const confidenceThreshold = context.confidence ?? 0.5;
    const maxError = 0.15 + (1 - confidenceThreshold) * 0.15; // 15-30% max error
    
    // Only learn from reasonably accurate measurements
    if (relativeError < maxError) {
      // Weight sample by confidence
      const sampleWeight = confidenceThreshold;
      
      // Add multiple samples for high-confidence measurements to speed learning
      const numSamples = Math.max(1, Math.floor(sampleWeight * 2));
      for (let i = 0; i < numSamples; i++) {
        this.addSample(predicted, measured, context);
      }
    }
  }

  /**
   * Get calibration statistics for visualization
   */
  getCalibrationStats(): {
    sampleCount: number;
    zoomBiasCount: number;
    avgConfidence: number;
    recentSamples: number;
  } {
    let totalConfidence = 0;
    let zoomBiasCount = 0;
    
    for (const entry of Object.values(this.zoomBiasTable)) {
      if (typeof entry === 'object') {
        zoomBiasCount++;
        totalConfidence += entry.confidence;
      }
    }

    return {
      sampleCount: this.samples.length,
      zoomBiasCount,
      avgConfidence: zoomBiasCount > 0 ? totalConfidence / zoomBiasCount : 0,
      recentSamples: this.samples.length // Could filter by timestamp if we add it
    };
  }

  private median(arr: number[]): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
}

export const calibrationManager = new CalibrationManager();