import { z } from 'zod';
import type { Point, CameraParams, Measurement } from '../types/common';
import { sanitizeString as sanitizeStringInput } from './inputValidation';
import { validateNumber as validateNumberInput } from './inputValidation';

/**
 * Validation schemas for input sanitization and validation
 */

export const PointSchema = z.object({
  x: z.number().finite().min(0),
  y: z.number().finite().min(0)
});

export const CameraParamsSchema = z.object({
  panoId: z.string().optional(),
  lat: z.number().finite().optional(),
  lng: z.number().finite().optional(),
  heading: z.number().finite().min(-360).max(360).optional(),
  pitch: z.number().finite().min(-90).max(90).optional(),
  zoom: z.number().finite().min(0).max(4).optional(),
  fov: z.number().finite().min(1).max(120).optional(),
  vFov: z.number().finite().min(1).max(120).optional(),
  pano: z.string().optional(),
  calibrationPitchOffsetDeg: z.number().finite().min(-90).max(90).optional(),
  cameraHeight: z.number().finite().min(0).max(100).optional(),
  distortion: z.object({
    k1: z.number().finite(),
    k2: z.number().finite(),
    p1: z.number().finite(),
    p2: z.number().finite(),
    k3: z.number().finite().optional()
  }).optional()
});

export const MeasurementSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(['distance', 'polyline', 'area', 'volume']),
  label: z.string().max(200),
  name: z.string().max(200).optional(),
  startPoint: PointSchema,
  endPoint: PointSchema,
  distanceMeters: z.number().finite().min(0).max(1e6).optional(),
  distance: z.number().finite().min(0).max(1e6).optional(),
  unit: z.enum(['metric', 'imperial']),
  areaSquareMeters: z.number().finite().min(0).max(1e8).optional(),
  perimeterMeters: z.number().finite().min(0).max(1e6).optional(),
  volumeCubicMeters: z.number().finite().min(0).max(1e9).optional(),
  dimensionsMeters: z.object({
    length: z.number().finite().min(0),
    width: z.number().finite().min(0),
    height: z.number().finite().min(0)
  }).optional(),
  points: z.array(PointSchema).optional(),
  timestamp: z.number().int().positive(),
  panoId: z.string().max(200).optional(),
  cameraParams: CameraParamsSchema.optional(),
  error: z.string().max(1000).optional(),
  source: z.enum(['planes', 'onnx', 'ground', 'area', 'volume', 'polyline']).optional(),
  confidence: z.number().min(0).max(1).optional(),
  metadata: z.record(z.unknown()).optional()
});

/**
 * Validates and sanitizes a point
 */
export function validatePoint(point: unknown): Point {
  const result = PointSchema.safeParse(point);
  if (!result.success) {
    throw new Error(`Invalid point: ${result.error.message}`);
  }
  return result.data;
}

/**
 * Validates and sanitizes camera parameters
 */
export function validateCameraParams(params: unknown): CameraParams {
  const result = CameraParamsSchema.safeParse(params);
  if (!result.success) {
    throw new Error(`Invalid camera parameters: ${result.error.message}`);
  }
  return result.data;
}

/**
 * Validates and sanitizes a measurement
 */
export function validateMeasurement(measurement: unknown): Measurement {
  const result = MeasurementSchema.safeParse(measurement);
  if (!result.success) {
    throw new Error(`Invalid measurement: ${result.error.message}`);
  }
  return result.data;
}

/**
 * Validates viewport dimensions
 */
export function validateViewportDimensions(width: unknown, height: unknown): { width: number; height: number } {
  const widthNum = typeof width === 'number' && Number.isFinite(width) && width > 0 ? width : null;
  const heightNum = typeof height === 'number' && Number.isFinite(height) && height > 0 ? height : null;
  
  if (widthNum === null || heightNum === null) {
    throw new Error(`Invalid viewport dimensions: width=${width}, height=${height}`);
  }
  
  // Reasonable limits
  const MAX_DIMENSION = 10000;
  if (widthNum > MAX_DIMENSION || heightNum > MAX_DIMENSION) {
    throw new Error(`Viewport dimensions exceed maximum: ${MAX_DIMENSION}`);
  }
  
  return { width: widthNum, height: heightNum };
}

/**
 * Sanitizes string input to prevent XSS
 * Delegates to inputValidation.sanitizeString for consistency
 */
export function sanitizeString(input: unknown, maxLength: number = 1000): string {
  if (typeof input !== 'string') {
    throw new Error('Input must be a string');
  }
  return sanitizeStringInput(input, maxLength);
}

/**
 * Validates panorama ID format
 */
export function validatePanoId(panoId: unknown): string {
  if (typeof panoId !== 'string') {
    throw new Error('Panorama ID must be a string');
  }
  
  // Google Street View panorama IDs are alphanumeric with some special chars
  if (!/^[A-Za-z0-9_-]+$/.test(panoId)) {
    throw new Error('Invalid panorama ID format');
  }
  
  if (panoId.length > 200) {
    throw new Error('Panorama ID too long');
  }
  
  return panoId;
}

/**
 * Validates numeric input with bounds
 * Uses inputValidation.validateNumber for consistency
 */
export function validateNumeric(value: unknown, min: number, max: number, name: string): number {
  const result = validateNumberInput(value, { min, max, required: true });
  if (!result.valid || result.value === undefined) {
    throw new Error(result.error || `${name} must be a finite number between ${min} and ${max}`);
  }
  return result.value;
}

/**
 * IPC message validation schemas using Zod
 * These schemas provide runtime validation for all IPC communication
 */

// Schema for depth data fetch payload
const DepthDataFetchPayloadSchema = z.union([
  z.string().regex(/^[A-Za-z0-9_-]+$/).min(1).max(200), // PanoId string
  z.object({
    panoId: z.string().regex(/^[A-Za-z0-9_-]+$/).min(1).max(200),
    maxRetries: z.number().int().min(1).max(10).optional(),
    retryDelayMs: z.number().int().min(0).max(60000).optional()
  })
]);

// Schema for CSV export content
const CsvContentSchema = z.string().max(10 * 1024 * 1024); // 10MB max

// Schema for base64 image data URL
const ImageDataUrlSchema = z.string()
  .regex(/^data:image\/(jpeg|jpg|png|webp);base64,/)
  .max(50 * 1024 * 1024); // 50MB max for base64 image

// Schema for revision history
const RevisionSchema = z.object({
  timestamp: z.number().int().positive(),
  measurements: z.array(MeasurementSchema).max(10000)
});

// Schema for project
const ProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  measurements: z.array(MeasurementSchema).max(10000),
  revisionHistory: z.array(RevisionSchema).max(100).optional()
});

// Schema for app settings
const AppSettingsSchema = z.object({
  defaultUnit: z.enum(['metric', 'imperial']).optional(),
  autoSave: z.boolean().optional(),
  theme: z.enum(['light', 'dark', 'system']).optional(),
  language: z.string().length(2).optional(), // ISO 639-1 code
  measurementHistoryLimit: z.number().int().min(1).max(10000).optional(),
  useGPU: z.boolean().optional(),
  cameraHeight: z.number().finite().min(0.1).max(100).optional(),
  depthQuality: z.enum(['low', 'medium', 'high']).optional(),
  enableDepthCache: z.boolean().optional(),
  autoCalibrateDepth: z.boolean().optional(),
  showDebugOverlay: z.boolean().optional(),
  googleMapsApiKey: z.string().max(500).optional(),
  calibrationPitchOffsetDeg: z.number().finite().min(-90).max(90).optional(),
  calibrationBiasByZoom: z.record(z.number().finite()).optional(),
  telemetryOptIn: z.boolean().optional(),
  depthScale: z.number().finite().min(0.1).max(10).optional(),
  depthBias: z.number().finite().min(-1000).max(1000).optional(),
  depthApiMaxRetries: z.number().int().min(1).max(10).optional(),
  depthKernelSize: z.union([z.literal(3), z.literal(5), z.literal(7), z.literal(9)]).optional(),
  depthUseBilinear: z.boolean().optional(),
  depthEdgeRejectThreshold: z.number().min(0).max(1).optional()
}).passthrough(); // Allow additional properties for forward compatibility

// Schema for error log entry
const ErrorLogEntrySchema = z.object({
  message: z.string().max(5000),
  stack: z.string().max(10000).optional(),
  context: z.record(z.unknown()).optional(),
  code: z.string().max(100).optional(),
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  category: z.string().max(100).optional()
});

// Schema for telemetry payload
const TelemetryPayloadSchema = z.object({
  event: z.string().min(1).max(100),
  data: z.record(z.unknown()).optional(),
  timestamp: z.number().int().positive().optional()
});

/**
 * Complete IPC invoke schemas mapping
 */
export const IPCInvokeSchemas = {
  'fetch-depth-data': DepthDataFetchPayloadSchema,
  'csv-export': CsvContentSchema,
  'infer-depth': ImageDataUrlSchema,
  'get-projects': z.undefined(),
  'get-measurements': z.undefined(),
  'save-measurements': z.array(MeasurementSchema).max(10000),
  'save-project': ProjectSchema,
  'delete-project': z.string().uuid(),
  'get-settings': z.undefined(),
  'save-settings': AppSettingsSchema,
  'set-use-gpu': z.boolean(),
  'clear-data': z.undefined(),
  'log-error': ErrorLogEntrySchema,
  'log-telemetry': TelemetryPayloadSchema
} as const;

/**
 * Type-safe IPC channel names
 */
export type IPCChannel = keyof typeof IPCInvokeSchemas;

/**
 * Type-safe IPC request types
 */
export type IPCRequest<T extends IPCChannel> = 
  T extends 'fetch-depth-data' ? z.infer<typeof DepthDataFetchPayloadSchema> :
  T extends 'csv-export' ? z.infer<typeof CsvContentSchema> :
  T extends 'infer-depth' ? z.infer<typeof ImageDataUrlSchema> :
  T extends 'get-projects' ? undefined :
  T extends 'get-measurements' ? undefined :
  T extends 'save-measurements' ? z.infer<typeof MeasurementSchema>[] :
  T extends 'save-project' ? z.infer<typeof ProjectSchema> :
  T extends 'delete-project' ? string :
  T extends 'get-settings' ? undefined :
  T extends 'save-settings' ? z.infer<typeof AppSettingsSchema> :
  T extends 'set-use-gpu' ? boolean :
  T extends 'clear-data' ? undefined :
  T extends 'log-error' ? z.infer<typeof ErrorLogEntrySchema> :
  T extends 'log-telemetry' ? z.infer<typeof TelemetryPayloadSchema> :
  never;

/**
 * Type-safe IPC validation function
 */
export function validateIPCInvoke<T extends IPCChannel>(
  channel: T,
  data: unknown
): IPCRequest<T> {
  const schema = IPCInvokeSchemas[channel];
  if (!schema) {
    throw new Error(`Unknown IPC channel: ${channel}`);
  }
  
  const result = schema.safeParse(data);
  if (!result.success) {
    const errorMessages = result.error.errors.map(e => 
      `${e.path.join('.')}: ${e.message}`
    ).join('; ');
    throw new Error(`Invalid IPC data for channel ${channel}: ${errorMessages}`);
  }
  
  return result.data as IPCRequest<T>;
}

/**
 * Type guard to check if a string is a valid IPC channel
 */
export function isValidIPCChannel(channel: string): channel is IPCChannel {
  return channel in IPCInvokeSchemas;
}

/**
 * Runtime type guard for IPC requests
 */
export function isValidIPCRequest<T extends IPCChannel>(
  channel: T,
  data: unknown
): data is IPCRequest<T> {
  const schema = IPCInvokeSchemas[channel];
  if (!schema) {
    return false;
  }
  return schema.safeParse(data).success;
}

