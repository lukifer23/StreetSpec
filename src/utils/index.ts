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
  createUIError,
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
  cacheRegistry,
  type EvictionStrategy,
  type CacheOptions
} from './cacheManager';

// Polygon validation
export {
  validatePolygon,
  validateMeasurementPlausibility,
  type PolygonValidationResult,
  type PlausibilityValidationResult
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
  convertMetersToFeet,
  convertFeetToMeters,
  formatDistance,
  formatArea,
  formatVolume
} from './units';

// Measurement display
export {
  formatMeasurementLabel,
  getMeasurementDisplayValue
} from './measurementDisplay';

// Status banner
export {
  getStatusBannerPresentation
} from './statusBanner';

// Volume base calculation
export {
  calculateVolumeBase
} from './volumeBase';

// Input validation
export {
  validateString,
  validateNumber,
  validateEmail,
  type ValidationResult
} from './inputValidation';

