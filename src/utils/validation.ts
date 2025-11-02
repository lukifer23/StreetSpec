import { z } from 'zod';
import type { Point, CameraParams, Measurement } from '../types/common';

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
    k1: z.number().finite().optional(),
    k2: z.number().finite().optional(),
    p1: z.number().finite().optional(),
    p2: z.number().finite().optional(),
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
 */
export function sanitizeString(input: unknown, maxLength: number = 1000): string {
  if (typeof input !== 'string') {
    throw new Error('Input must be a string');
  }
  
  // Remove potentially dangerous characters
  let sanitized = input
    .replace(/[<>]/g, '') // Remove angle brackets
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/on\w+=/gi, '') // Remove event handlers
    .trim();
  
  // Enforce length limit
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }
  
  return sanitized;
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
 */
export function validateNumeric(value: unknown, min: number, max: number, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
  
  if (value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  
  return value;
}

/**
 * IPC message validation schemas
 */
export const IPCInvokeSchemas = {
  'fetch-depth-data': z.union([
    z.string(),
    z.object({
      panoId: z.string().min(1).max(200),
      maxRetries: z.number().int().min(1).max(10).optional(),
      retryDelayMs: z.number().int().min(0).max(60000).optional()
    })
  ]),
  'csv-export': z.string().max(10 * 1024 * 1024), // 10MB max
  'infer-depth': z.string().max(50 * 1024 * 1024), // 50MB max for base64 image
  'get-projects': z.undefined(),
  'get-measurements': z.undefined(),
  'save-measurements': z.array(MeasurementSchema).max(10000),
  'save-project': z.object({
    id: z.string().uuid(),
    name: z.string().max(200),
    measurements: z.array(MeasurementSchema).max(10000),
    revisionHistory: z.array(z.any()).max(100).optional()
  }),
  'delete-project': z.string().uuid(),
  'get-settings': z.undefined(),
  'save-settings': z.record(z.unknown()),
  'clear-data': z.undefined(),
  'log-error': z.object({
    message: z.string().max(5000),
    stack: z.string().max(10000).optional(),
    context: z.record(z.unknown()).optional()
  })
};

/**
 * Validates IPC invoke message
 */
export function validateIPCInvoke(channel: string, data: unknown): unknown {
  const schema = IPCInvokeSchemas[channel as keyof typeof IPCInvokeSchemas];
  if (!schema) {
    throw new Error(`Unknown IPC channel: ${channel}`);
  }
  
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new Error(`Invalid IPC data for channel ${channel}: ${result.error.message}`);
  }
  
  return result.data;
}

