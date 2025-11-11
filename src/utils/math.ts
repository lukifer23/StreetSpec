/**
 * Unified math utilities
 * Consolidates common mathematical operations used throughout the application
 */

import type { Vector3, Point } from '../types/common';

/**
 * Calculates Euclidean distance between two 3D points
 */
export function distance3D(point1: Vector3, point2: Vector3): number {
  const dx = point2.x - point1.x;
  const dy = point2.y - point1.y;
  const dz = point2.z - point1.z;
  return Math.hypot(dx, dy, dz);
}

/**
 * Calculates Euclidean distance between two 2D points
 */
export function distance2D(point1: Point, point2: Point): number {
  const dx = point2.x - point1.x;
  const dy = point2.y - point1.y;
  return Math.hypot(dx, dy);
}

/**
 * Calculates the magnitude (length) of a 3D vector
 */
export function magnitude3D(vector: Vector3): number {
  return Math.hypot(vector.x, vector.y, vector.z);
}

/**
 * Normalizes a 3D vector to unit length
 * Returns null if vector is zero or invalid
 */
export function normalizeVector3D(vector: Vector3): Vector3 | null {
  const mag = magnitude3D(vector);
  if (mag < 1e-10 || !Number.isFinite(mag)) {
    return null;
  }
  return {
    x: vector.x / mag,
    y: vector.y / mag,
    z: vector.z / mag
  };
}

/**
 * Normalizes a number to a fixed precision string for cache keys
 * Prevents floating-point collisions
 */
export function normalizeNumberForCache(value: number, precision: number = 6): string {
  if (!Number.isFinite(value)) {
    return 'inf';
  }
  // Round to specified precision to prevent floating-point collisions
  const rounded = Math.round(value * Math.pow(10, precision)) / Math.pow(10, precision);
  return rounded.toString();
}

/**
 * Clamps a number between min and max values
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Checks if a number is finite and within valid range
 */
export function isValidNumber(value: unknown, min?: number, max?: number): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return false;
  }
  if (min !== undefined && value < min) {
    return false;
  }
  if (max !== undefined && value > max) {
    return false;
  }
  return true;
}

/**
 * Checks if all components of a 3D point are finite
 */
export function isValidPoint3D(point: Vector3): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z);
}

/**
 * Checks if all components of a 2D point are finite
 */
export function isValidPoint2D(point: Point): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

/**
 * Calculates dot product of two 3D vectors
 */
export function dotProduct3D(v1: Vector3, v2: Vector3): number {
  return v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;
}

/**
 * Calculates cross product of two 3D vectors
 */
export function crossProduct3D(v1: Vector3, v2: Vector3): Vector3 {
  return {
    x: v1.y * v2.z - v1.z * v2.y,
    y: v1.z * v2.x - v1.x * v2.z,
    z: v1.x * v2.y - v1.y * v2.x
  };
}

/**
 * Linear interpolation between two numbers
 */
export function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * clamp(t, 0, 1);
}

/**
 * Checks if two numbers are approximately equal within epsilon
 */
export function approximatelyEqual(a: number, b: number, epsilon: number = 1e-9): boolean {
  return Math.abs(a - b) < epsilon;
}

/**
 * Converts degrees to radians
 */
export function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Converts radians to degrees
 */
export function radiansToDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

