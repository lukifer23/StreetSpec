/**
 * Centralized exports for types
 * Provides cleaner imports throughout the application
 */

// Core types
export type {
  Point,
  Vector3,
  CameraParams,
  Measurement,
  Project,
  AppSettings,
  DecodedDepthData,
  DepthPlane,
  OnnxDepthMap,
  AppError,
  ErrorContext,
  ErrorHandler,
  RecoveryStrategy,
  SerializedError,
  DepthDataFetchResult,
  DepthDataErrorCode
} from './common';

export {
  ERROR_CODES,
  ErrorSeverity,
  ErrorCategory,
  UNIT_CONVERSIONS,
  createError
} from './common';

// Branded types
export type {
  MeasurementId,
  ProjectId,
  PanoId,
  DistanceMeters,
  ConfidenceScore,
  Timestamp
} from './branded';

export {
  isMeasurementId,
  isProjectId,
  isPanoId,
  isDistanceMeters,
  isConfidenceScore,
  isTimestamp
} from './branded';

// Electron types
export type {
  ElectronAPI
} from './electron';

