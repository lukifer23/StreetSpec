/**
 * Centralized exports for services
 * Provides cleaner imports throughout the application
 */

// Depth services
export {
  getCachedDepthMap,
  cacheDepthMap,
  clearDepthCache,
  getCacheStats,
  prefetchDepthMap,
  clearExpiredPredictiveCache
} from './depth';

export {
  generateDepthMap,
  generateBatchDepthMaps,
  createDepthMapFetcher,
  blobToDataUrl,
  type DepthGenerationDeps,
  type DepthGenerationResult,
  type DepthGenerationOptions
} from './depthGeneration';

export {
  depthPrefetchService,
  prefetchAdjacentDepthMaps,
  type PrefetchOptions
} from './depthPrefetch';

export {
  calibrationManager,
  interpolateZoomBias,
  type ZoomBiasTable,
  type PerZoomCalibration
} from './depthCalibration';

// Measurement services
export {
  createMeasurement
} from './measurement';

export {
  fusedWorldPoint,
  analyzeDepthGradients,
  computeOnnxDepthConfidence,
  computePlaneDepthConfidence,
  type FusedWorldPointResult
} from './measurementLogic';

// Geometry services
export {
  screenToWorld,
  screenToWorldWithDepth,
  calculateDistance3D, // Deprecated: use distance3D from '../utils/math' instead
  estimateGroundPlaneIntersection,
  estimateGroundPlaneIntersectionWithConfidence,
  detectHorizonFromDepth,
  getEffectiveCalibrationPitchOffset,
  clearGeometryCaches,
  getGeometryCacheStats,
  type GroundPlaneResult,
  type HorizonDetectionResult
} from './geometry';

// Error handling
export {
  errorHandler
} from './errorHandler';

// Rate limiting
export {
  executeWithRateLimit,
  getRateLimitStatus,
  resetRateLimit
} from './rateLimiter';

