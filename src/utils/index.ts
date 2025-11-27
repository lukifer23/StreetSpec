/**
 * Centralized exports for utilities
 * Provides cleaner imports throughout the application
 */

// Error utilities
export {
  createAppError,
  errorToAppError,
  withErrorHandling,
  createNetworkError,
  createModelInferenceError,
  createGeometryError,
  createMeasurementError,
  createStorageError,
  createValidationError,
  assert
} from './errorUtils';

// Validation utilities
export {
  validateIPCInvoke,
  validatePoint,
  validateCameraParams,
  validateMeasurement,
  validateViewportDimensions,
  sanitizeString,
  validatePanoId,
  validateNumeric,
  isValidIPCChannel,
  isValidIPCRequest,
  type IPCChannel,
  type IPCRequest,
  IPCInvokeSchemas
} from './validation';

// Cache management
export {
  UnifiedCache,
  cacheRegistry
} from './cacheManager';

// Polygon validation
export {
  validatePolygon,
  validateMeasurementPlausibility,
  type PolygonValidationResult
} from './polygonValidation';

// Math utilities
export {
  distance3D,
  distance2D,
  magnitude3D,
  normalizeVector3D,
  normalizeNumberForCache,
  clamp,
  isValidNumber,
  isValidPoint3D,
  isValidPoint2D,
  dotProduct3D,
  crossProduct3D,
  lerp,
  approximatelyEqual,
  degreesToRadians,
  radiansToDegrees
} from './math';

// Camera math utilities
export {
  pixelOffsetToVerticalAngle
} from './cameraMath';

// Unit conversion
export {
  formatArea,
  formatVolume
} from './units';

// Status banner
export {
  getStatusBannerPresentation
} from './statusBanner';

// Input validation
export {
  validateString,
  validateNumber,
  type ValidationResult
} from './inputValidation';

