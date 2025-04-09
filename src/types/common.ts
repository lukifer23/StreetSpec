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
  fov?: number;          // Calculated Field of View (degrees)
  pano?: string;         // Optional: The current panorama ID
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
export interface OnnxDepthMap {
  data: number[]; // Flattened Float32 array
  width: number;
  height: number;
}