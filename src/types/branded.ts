/**
 * Branded types for type safety and preventing ID/string mixups
 */

// Branded string types for IDs
export type MeasurementId = string & { readonly __brand: 'MeasurementId' };
export type ProjectId = string & { readonly __brand: 'ProjectId' };
export type PanoId = string & { readonly __brand: 'PanoId' };

// Branded number types for validated values
export type DistanceMeters = number & { readonly __brand: 'DistanceMeters' };
export type ConfidenceScore = number & { readonly __brand: 'ConfidenceScore' };
export type Timestamp = number & { readonly __brand: 'Timestamp' };

/**
 * Type guards for branded types
 */
export function isMeasurementId(value: string): value is MeasurementId {
  // UUID format validation
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function isProjectId(value: string): value is ProjectId {
  // UUID format validation
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function isPanoId(value: string): value is PanoId {
  // Google Street View panorama ID format
  return /^[A-Za-z0-9_-]+$/.test(value) && value.length > 0 && value.length <= 200;
}

export function isDistanceMeters(value: number): value is DistanceMeters {
  return Number.isFinite(value) && value >= 0 && value <= 1e6;
}

export function isConfidenceScore(value: number): value is ConfidenceScore {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

export function isTimestamp(value: number): value is Timestamp {
  return Number.isInteger(value) && value > 0 && value <= Date.now() + 86400000; // Allow slight future tolerance
}

/**
 * Constructors for branded types (with validation)
 */
export function createMeasurementId(value: string): MeasurementId {
  if (!isMeasurementId(value)) {
    throw new Error(`Invalid MeasurementId: ${value}`);
  }
  return value as MeasurementId;
}

export function createProjectId(value: string): ProjectId {
  if (!isProjectId(value)) {
    throw new Error(`Invalid ProjectId: ${value}`);
  }
  return value as ProjectId;
}

export function createPanoId(value: string): PanoId {
  if (!isPanoId(value)) {
    throw new Error(`Invalid PanoId: ${value}`);
  }
  return value as PanoId;
}

export function createDistanceMeters(value: number): DistanceMeters {
  if (!isDistanceMeters(value)) {
    throw new Error(`Invalid DistanceMeters: ${value}`);
  }
  return value as DistanceMeters;
}

export function createConfidenceScore(value: number): ConfidenceScore {
  if (!isConfidenceScore(value)) {
    throw new Error(`Invalid ConfidenceScore: ${value}`);
  }
  return value as ConfidenceScore;
}

export function createTimestamp(value: number = Date.now()): Timestamp {
  if (!isTimestamp(value)) {
    throw new Error(`Invalid Timestamp: ${value}`);
  }
  return value as Timestamp;
}

