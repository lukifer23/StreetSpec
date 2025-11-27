import { createError, ErrorSeverity, ErrorCategory, ERROR_CODES } from '../types/common';
import type { AppError, ErrorContext } from '../types/common';
import { errorHandler } from '../services/errorHandler';

/**
 * Unified error creation utility - always use this instead of throwing raw Errors
 */
export function createAppError(
  code: keyof typeof ERROR_CODES,
  message: string,
  userFriendlyMessage?: string,
  severity: ErrorSeverity = ErrorSeverity.MEDIUM,
  category: ErrorCategory = ErrorCategory.UNKNOWN,
  details?: unknown,
  recoverable = true,
  maxRetries = 3
): AppError {
  const defaultUserMessage = userFriendlyMessage ?? message;
  return createError(code, message, defaultUserMessage, severity, category, details, recoverable, maxRetries);
}

/**
 * Convert a standard Error to AppError format
 */
export function errorToAppError(error: unknown, code?: keyof typeof ERROR_CODES): AppError {
  if (error && typeof error === 'object' && 'code' in error && 'severity' in error) {
    return error as AppError;
  }

  const errorMessage = error instanceof Error ? error.message : String(error ?? 'Unknown error');
  const errorStack = error instanceof Error ? error.stack : undefined;

  return createAppError(
    code ?? 'SYSTEM_UNKNOWN',
    errorMessage,
    `An error occurred: ${errorMessage}`,
    ErrorSeverity.MEDIUM,
    ErrorCategory.UNKNOWN,
    {
      originalError: errorMessage,
      stack: errorStack
    },
    true,
    1
  );
}

/**
 * Wrap async operations with automatic error handling
 */
export async function withErrorHandling<T>(
  operation: () => Promise<T>,
  context?: ErrorContext,
  errorCode?: keyof typeof ERROR_CODES
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const appError = errorToAppError(error, errorCode);
    await errorHandler.handleError(appError, context);
    throw appError;
  }
}

/**
 * Network error helpers
 */
export function createNetworkError(
  message: string,
  details?: unknown,
  recoverable = true
): AppError {
  return createAppError(
    'NETWORK_UNREACHABLE',
    message,
    'Network error occurred. Please check your connection.',
    ErrorSeverity.MEDIUM,
    ErrorCategory.NETWORK,
    details,
    recoverable,
    3
  );
}

export function createNetworkTimeoutError(details?: unknown): AppError {
  return createAppError(
    'NETWORK_TIMEOUT',
    'Network request timed out',
    'The request took too long. Please try again.',
    ErrorSeverity.MEDIUM,
    ErrorCategory.NETWORK,
    details,
    true,
    2
  );
}

export function createRateLimitError(waitSeconds?: number, details?: unknown): AppError {
  const message = waitSeconds
    ? `Rate limit exceeded. Please wait ${waitSeconds} seconds.`
    : 'Rate limit exceeded. Please wait before trying again.';
  return createAppError(
    'API_RATE_LIMITED',
    'API rate limit exceeded',
    message,
    ErrorSeverity.MEDIUM,
    ErrorCategory.NETWORK,
    details,
    true,
    1
  );
}

/**
 * Model/ML error helpers
 */
export function createModelLoadError(message: string, details?: unknown): AppError {
  return createAppError(
    'MODEL_LOAD_FAILED',
    message,
    'Failed to load the depth estimation model. Please restart the application.',
    ErrorSeverity.HIGH,
    ErrorCategory.MODEL,
    details,
    true,
    2
  );
}

export function createModelInferenceError(message: string, details?: unknown): AppError {
  return createAppError(
    'MODEL_INFERENCE_FAILED',
    message,
    'Depth estimation failed. Try generating the depth map again.',
    ErrorSeverity.MEDIUM,
    ErrorCategory.MODEL,
    details,
    true,
    2
  );
}

export function createModelMemoryError(details?: unknown): AppError {
  return createAppError(
    'MODEL_MEMORY_ERROR',
    'Model memory error',
    'Not enough memory available. Try closing other applications or reducing cache size.',
    ErrorSeverity.HIGH,
    ErrorCategory.MODEL,
    details,
    true,
    1
  );
}

/**
 * Geometry error helpers
 */
export function createGeometryError(
  code: 'GEOMETRY_INVALID_POINT' | 'GEOMETRY_CALCULATION_FAILED' | 'GEOMETRY_DEPTH_INTERSECTION_FAILED',
  message: string,
  details?: unknown
): AppError {
  const userMessages: Record<typeof code, string> = {
    GEOMETRY_INVALID_POINT: 'Invalid measurement point selected. Please click on a visible object.',
    GEOMETRY_CALCULATION_FAILED: 'Measurement calculation failed. Try selecting different points.',
    GEOMETRY_DEPTH_INTERSECTION_FAILED: 'Could not determine depth at this location. Try a different point.'
  };

  return createAppError(
    code,
    message,
    userMessages[code],
    ErrorSeverity.MEDIUM,
    ErrorCategory.GEOMETRY,
    details,
    true,
    1
  );
}

/**
 * Measurement error helpers
 */
export function createMeasurementError(
  code: 'MEASUREMENT_INVALID_CAMERA' | 'MEASUREMENT_NO_DEPTH_DATA' | 'MEASUREMENT_CALCULATION_FAILED',
  message: string,
  details?: unknown
): AppError {
  const userMessages: Record<typeof code, string> = {
    MEASUREMENT_INVALID_CAMERA: 'Camera parameters are invalid. Please reload the Street View.',
    MEASUREMENT_NO_DEPTH_DATA: 'Depth data is not available. Please generate a depth map first.',
    MEASUREMENT_CALCULATION_FAILED: 'Unable to calculate measurement. Ensure depth map is generated and points are valid.'
  };

  return createAppError(
    code,
    message,
    userMessages[code],
    ErrorSeverity.MEDIUM,
    ErrorCategory.MEASUREMENT,
    details,
    true,
    1
  );
}

/**
 * Storage error helpers
 */
export function createStorageError(
  code: 'STORAGE_SAVE_FAILED' | 'STORAGE_LOAD_FAILED' | 'STORAGE_CORRUPTED',
  message: string,
  details?: unknown
): AppError {
  const userMessages: Record<typeof code, string> = {
    STORAGE_SAVE_FAILED: 'Failed to save data. Please check available disk space.',
    STORAGE_LOAD_FAILED: 'Failed to load saved data. The file may be corrupted.',
    STORAGE_CORRUPTED: 'Saved data appears corrupted. Some data may be lost.'
  };

  return createAppError(
    code,
    message,
    userMessages[code],
    ErrorSeverity.HIGH,
    ErrorCategory.STORAGE,
    details,
    true,
    2
  );
}

/**
 * Validation error helper
 */
export function createValidationError(field: string, reason: string, details?: unknown): AppError {
  return createAppError(
    'SYSTEM_UNKNOWN',
    `Validation failed for ${field}: ${reason}`,
    `Invalid input: ${reason}`,
    ErrorSeverity.LOW,
    ErrorCategory.UNKNOWN,
    details ? { field, reason, ...(details as object) } : { field, reason },
    false,
    0
  );
}

/**
 * Assertion helper that throws AppError
 */
export function assert(condition: boolean, error: AppError): asserts condition {
  if (!condition) {
    throw error;
  }
}

/**
 * Assertion helper with automatic error creation
 */
export function assertValue<T>(
  value: T | null | undefined,
  code: keyof typeof ERROR_CODES,
  message: string,
  userFriendlyMessage?: string
): asserts value is T {
  if (value === null || value === undefined) {
    throw createAppError(
      code,
      message,
      userFriendlyMessage ?? message,
      ErrorSeverity.MEDIUM,
      ErrorCategory.UNKNOWN,
      { value }
    );
  }
}

