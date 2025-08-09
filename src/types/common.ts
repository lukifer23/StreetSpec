// Common type definitions for the application

export interface Vector3 {
    x: number;
    y: number;
    z: number;
}

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface Point {
  x: number;
  y: number;
}

// Distortion coefficients for camera lens
export interface DistortionCoefficients {
  k1: number;
  k2: number;
  p1: number;
  p2: number;
  k3?: number;
}

// Represents the state of the Street View camera
export interface CameraParams {
  panoId?: string;       // Current Panorama ID
  lat?: number;          // Camera Latitude
  lng?: number;          // Camera Longitude
  heading?: number;      // Camera direction (degrees clockwise from North)
  pitch?: number;        // Camera angle relative to horizon (degrees)
  zoom?: number;         // Street View zoom level (0 is widest)
  fov?: number;          // Calculated horizontal Field of View (degrees)
  vFov?: number;         // Calculated vertical Field of View (degrees)
  pano?: string;         // Optional: The current panorama ID
  calibrationPitchOffsetDeg?: number; // applied offset for horizon calibration
  cameraHeight?: number; // Height of camera above ground in meters
  distortion?: DistortionCoefficients; // Lens distortion coefficients
  // Potentially add: altitude, exact camera position vector later
}

export interface Revision {
  timestamp: number;
  measurements: Measurement[];
}

export interface Project {
  id: string;
  name: string;
  measurements: Measurement[];
  revisionHistory: Revision[];
}

// Represents a single measurement
export interface Measurement {
  id: string;           // Unique ID (e.g., uuid)
  label: string;        // User-defined label
  name?: string;        // Optional user-defined name
  startPoint: Point;    // Screen coordinates
  endPoint: Point;
  distance: number;     // Calculated distance in meters
  unit: 'metric' | 'imperial'; // Unit at time of calculation
  timestamp: number;    // Creation timestamp
  panoId?: string;       // Pano ID where measurement was taken
  cameraParams?: CameraParams; // Camera state when taken (optional, for context)
  error?: string; // Optional field for storing errors
}

// Structure for the returned ONNX depth map
export interface ImageTransform {
  originalWidth: number;
  originalHeight: number;
  resizedWidth: number;
  resizedHeight: number;
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
}

export interface OnnxDepthMap {
  data: number[]; // Flattened Float32 array
  width: number;
  height: number;
  transform?: ImageTransform; // Resize/crop parameters used before inference
}

// Depth plane representation for Street View depth data. Google encodes
// planes using the equation `n·x + d = 0` where the normal vector points
// toward the camera and `d` is the signed distance from the origin along that
// normal (positive for planes in front of the camera).
export interface DepthPlane {
  nx: number; // Normal vector X component
  ny: number; // Normal vector Y component
  nz: number; // Normal vector Z component
  d: number;  // Signed distance from origin to plane along the normal
}

// Parsed depth data structure
export interface DecodedDepthData {
  planes: DepthPlane[];     // Array of depth planes
  indices: Uint8Array;      // Index array for depth map
  width: number;            // Width of the depth map
  height: number;           // Height of the depth map
}

// Application settings interface
export interface AppSettings {
  defaultUnit: 'metric' | 'imperial';
  autoSave: boolean;
  theme: 'light' | 'dark' | 'system';
  language: string;
  measurementHistoryLimit: number;
  useGPU?: boolean;
  calibrationPitchOffsetDeg?: number;
  cameraHeight?: number;
  depthScale?: number;
  depthBias?: number;
}

// Comprehensive error handling system
export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

export enum ErrorCategory {
  NETWORK = 'network',
  MODEL = 'model',
  GEOMETRY = 'geometry',
  MEASUREMENT = 'measurement',
  STORAGE = 'storage',
  UI = 'ui',
  SYSTEM = 'system',
  UNKNOWN = 'unknown'
}

export interface AppError {
  id: string;
  code: string;
  message: string;
  userFriendlyMessage: string;
  severity: ErrorSeverity;
  category: ErrorCategory;
  details?: unknown;
  timestamp: number;
  stack?: string;
  recoverable: boolean;
  retryCount?: number;
  maxRetries?: number;
}

export interface ErrorContext {
  component?: string;
  action?: string;
  data?: unknown;
  userId?: string;
  sessionId?: string;
}

export interface ErrorHandler {
  handleError: (error: AppError, context?: ErrorContext) => Promise<void>;
  logError: (error: AppError, context?: ErrorContext) => void;
  showUserError: (error: AppError) => void;
  isRecoverable: (error: AppError) => boolean;
  retryOperation: <T>(operation: () => Promise<T>, error: AppError) => Promise<T>;
}

// Error codes for consistent error handling
export const ERROR_CODES = {
  // Network errors
  NETWORK_TIMEOUT: 'NETWORK_TIMEOUT',
  NETWORK_UNREACHABLE: 'NETWORK_UNREACHABLE',
  API_RATE_LIMITED: 'API_RATE_LIMITED',
  API_UNAUTHORIZED: 'API_UNAUTHORIZED',
  
  // Model errors
  MODEL_LOAD_FAILED: 'MODEL_LOAD_FAILED',
  MODEL_INFERENCE_FAILED: 'MODEL_INFERENCE_FAILED',
  MODEL_MEMORY_ERROR: 'MODEL_MEMORY_ERROR',
  
  // Geometry errors
  GEOMETRY_INVALID_POINT: 'GEOMETRY_INVALID_POINT',
  GEOMETRY_CALCULATION_FAILED: 'GEOMETRY_CALCULATION_FAILED',
  GEOMETRY_DEPTH_INTERSECTION_FAILED: 'GEOMETRY_DEPTH_INTERSECTION_FAILED',
  
  // Measurement errors
  MEASUREMENT_INVALID_CAMERA: 'MEASUREMENT_INVALID_CAMERA',
  MEASUREMENT_NO_DEPTH_DATA: 'MEASUREMENT_NO_DEPTH_DATA',
  MEASUREMENT_CALCULATION_FAILED: 'MEASUREMENT_CALCULATION_FAILED',
  
  // Storage errors
  STORAGE_SAVE_FAILED: 'STORAGE_SAVE_FAILED',
  STORAGE_LOAD_FAILED: 'STORAGE_LOAD_FAILED',
  STORAGE_CORRUPTED: 'STORAGE_CORRUPTED',
  
  // UI errors
  UI_RENDER_FAILED: 'UI_RENDER_FAILED',
  UI_INTERACTION_FAILED: 'UI_INTERACTION_FAILED',
  
  // System errors
  SYSTEM_MEMORY_LOW: 'SYSTEM_MEMORY_LOW',
  SYSTEM_RESOURCE_UNAVAILABLE: 'SYSTEM_RESOURCE_UNAVAILABLE',
  SYSTEM_UNKNOWN: 'SYSTEM_UNKNOWN'
} as const;

// Error factory functions
export const createError = (
  code: keyof typeof ERROR_CODES,
  message: string,
  userFriendlyMessage: string,
  severity: ErrorSeverity,
  category: ErrorCategory,
  details?: unknown,
  recoverable = true,
  maxRetries = 3
): AppError => ({
  id: `${code}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
  code: ERROR_CODES[code],
  message,
  userFriendlyMessage,
  severity,
  category,
  details,
  timestamp: Date.now(),
  stack: new Error().stack,
  recoverable,
  retryCount: 0,
  maxRetries
});

// Measurement validation result
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  confidence?: number;
}

// Unit conversion utilities
export const UNIT_CONVERSIONS = {
  metersToFeet: (meters: number): number => meters * 3.28084,
  feetToMeters: (feet: number): number => feet * 0.3048,
  metersToInches: (meters: number): number => meters * 39.3701,
  inchesToMeters: (inches: number): number => inches * 0.0254
} as const;

// Keyboard shortcuts configuration
export interface KeyboardShortcuts {
  startMeasurement: string;
  cancelMeasurement: string;
  exportData: string;
  clearAll: string;
  toggleUnit: string;
}

// Default keyboard shortcuts
export const DEFAULT_SHORTCUTS: KeyboardShortcuts = {
  startMeasurement: 'm',
  cancelMeasurement: 'Escape',
  exportData: 'Ctrl+E',
  clearAll: 'Ctrl+Shift+Delete',
  toggleUnit: 'u'
} as const;