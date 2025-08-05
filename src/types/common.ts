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
  // Potentially add: altitude, exact camera position vector later
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

// Depth plane representation for Street View depth data
export interface DepthPlane {
  nx: number; // Normal vector X component
  ny: number; // Normal vector Y component
  nz: number; // Normal vector Z component
  d: number;  // Distance from origin to plane
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
}

// Error types for better error handling
export interface AppError {
  code: string;
  message: string;
  details?: unknown;
  timestamp: number;
  userFriendly?: string;
}

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