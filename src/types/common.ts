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
export type ConfidenceLevel = 'High' | 'Medium' | 'Low' | 'Unknown';

export interface Measurement {
  id: string;           // Unique ID (e.g., uuid)
  label: 'Height' | '3D Distance' | 'Area'; // Add Area type
  name?: string;        // Optional user-defined name
  // Make points more generic for different types
  points: Point[]; // Store all points for polygon/line
  startPoint?: Point; // Keep for backward compatibility or specific display?
  startPointConfidence?: ConfidenceLevel; // Confidence at start point
  endPoint?: Point; // Keep for backward compatibility or specific display?
  endPointConfidence?: ConfidenceLevel; // Confidence at end point
  // Store confidence for all points? Maybe later.
  distance?: number;     // Calculated distance/height/area in meters/meters^2
  unit?: 'metric' | 'imperial'; // Unit at time of calculation
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

export type MeasurementPhase = 'idle' | 'placingHeightStart' | 'placingHeightEnd' | 'placingDistStart' | 'placingDistEnd' | 'placingAreaPoints' | 'placingAreaLastPoint';