/**
 * Comprehensive polygon validation and analysis utilities
 * Detects degenerate cases, self-intersections, and validates geometric properties
 */

import type { Point, Vector3 } from '../types/common';
import { distance3D, isValidPoint3D } from './math';

export interface PolygonValidationResult {
  isValid: boolean;
  isDegenerate: boolean;
  warnings: string[];
  confidence: number;
  area: number;
  perimeter: number;
  properties: {
    hasSelfIntersection: boolean;
    hasCollinearPoints: boolean;
    hasDuplicatePoints: boolean;
    isConvex: boolean;
    minAngle: number;
    maxAngle: number;
    aspectRatio: number;
  };
}

const MIN_AREA_THRESHOLD = 1e-6; // Square meters
const MIN_EDGE_LENGTH = 0.01; // meters
const MAX_EDGE_LENGTH = 10000; // meters
const MIN_ANGLE_THRESHOLD = 0.01; // radians (~0.57 degrees)
const MAX_ANGLE_THRESHOLD = Math.PI - 0.01; // radians (~179.43 degrees)
const COLLINEAR_THRESHOLD = 1e-4; // Cross product magnitude threshold

/**
 * Check if two points are effectively identical
 */
function pointsAreEqual(p1: Point | Vector3, p2: Point | Vector3, threshold: number = 1e-6): boolean {
  const dx = Math.abs(p1.x - p2.x);
  const dy = Math.abs(p1.y - p2.y);
  const dz = 'z' in p1 && 'z' in p2 ? Math.abs((p1 as Vector3).z - (p2 as Vector3).z) : 0;
  
  return dx < threshold && dy < threshold && dz < threshold;
}

/**
 * Check if three points are collinear (2D or 3D)
 */
function areCollinear(p1: Vector3, p2: Vector3, p3: Vector3, threshold: number = COLLINEAR_THRESHOLD): boolean {
  const v1 = { x: p2.x - p1.x, y: p2.y - p1.y, z: p2.z - p1.z };
  const v2 = { x: p3.x - p1.x, y: p3.y - p1.y, z: p3.z - p1.z };
  
  // Cross product magnitude
  const crossX = v1.y * v2.z - v1.z * v2.y;
  const crossY = v1.z * v2.x - v1.x * v2.z;
  const crossZ = v1.x * v2.y - v1.y * v2.x;
  const crossMagnitude = Math.sqrt(crossX * crossX + crossY * crossY + crossZ * crossZ);
  
  return crossMagnitude < threshold;
}

/**
 * Calculate signed area of 2D polygon (for winding order detection)
 */
function calculateSignedArea2D(points: Array<{ x: number; y: number }>): number {
  if (points.length < 3) return 0;
  
  let area = 0;
  const n = points.length;
  
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += points[i]!.x * points[j]!.y;
    area -= points[j]!.x * points[i]!.y;
  }
  
  return area / 2;
}

/**
 * Check for self-intersections using line segment intersection test
 */
function hasSelfIntersection(points: Vector3[]): boolean {
  if (points.length < 4) return false;
  
  const n = points.length;
  
  for (let i = 0; i < n; i++) {
    const p1 = points[i]!;
    const p2 = points[(i + 1) % n]!;
    
    // Check against non-adjacent edges
    for (let j = i + 2; j < n; j++) {
      // Skip last edge when i=0 (closing edge)
      if (i === 0 && j === n - 1) continue;
      
      const p3 = points[j]!;
      const p4 = points[(j + 1) % n]!;
      
      if (segmentsIntersect2D(p1, p2, p3, p4)) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Check if two 2D line segments intersect (using cross product method)
 */
function segmentsIntersect2D(p1: Vector3, p2: Vector3, p3: Vector3, p4: Vector3): boolean {
  // Project to 2D (x-z plane for ground-aligned polygons)
  const o1 = { x: p1.x, y: p1.z };
  const o2 = { x: p2.x, y: p2.z };
  const o3 = { x: p3.x, y: p3.z };
  const o4 = { x: p4.x, y: p4.z };
  
  const d1 = orientation(o1, o2, o3);
  const d2 = orientation(o1, o2, o4);
  const d3 = orientation(o3, o4, o1);
  const d4 = orientation(o3, o4, o2);
  
  // General case: segments intersect if orientations differ
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  
  // Special cases: collinear points
  if (d1 === 0 && onSegment(o1, o2, o3)) return true;
  if (d2 === 0 && onSegment(o1, o2, o4)) return true;
  if (d3 === 0 && onSegment(o3, o4, o1)) return true;
  if (d4 === 0 && onSegment(o3, o4, o2)) return true;
  
  return false;
}

function orientation(p: { x: number; y: number }, q: { x: number; y: number }, r: { x: number; y: number }): number {
  const val = (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
  if (Math.abs(val) < 1e-10) return 0; // Collinear
  return val > 0 ? 1 : -1; // Clockwise or counterclockwise
}

function onSegment(p: { x: number; y: number }, q: { x: number; y: number }, r: { x: number; y: number }): boolean {
  return q.x <= Math.max(p.x, r.x) && q.x >= Math.min(p.x, r.x) &&
         q.y <= Math.max(p.y, r.y) && q.y >= Math.min(p.y, r.y);
}

/**
 * Check if polygon is convex (all interior angles < 180 degrees)
 */
function isConvex(points: Vector3[]): boolean {
  if (points.length < 3) return false;
  
  const n = points.length;
  let sign = 0;
  
  for (let i = 0; i < n; i++) {
    const p1 = points[i]!;
    const p2 = points[(i + 1) % n]!;
    const p3 = points[(i + 2) % n]!;
    
    // Calculate cross product (using x-z plane for ground-aligned)
    const v1 = { x: p2.x - p1.x, z: p2.z - p1.z };
    const v2 = { x: p3.x - p2.x, z: p3.z - p2.z };
    const cross = v1.x * v2.z - v1.z * v2.x;
    
    if (Math.abs(cross) < COLLINEAR_THRESHOLD) continue; // Skip collinear points
    
    if (sign === 0) {
      sign = cross > 0 ? 1 : -1;
    } else if ((cross > 0 && sign < 0) || (cross < 0 && sign > 0)) {
      return false; // Sign change indicates concavity
    }
  }
  
  return true;
}

/**
 * Calculate interior angles of polygon
 */
function calculateAngles(points: Vector3[]): { min: number; max: number } {
  if (points.length < 3) return { min: 0, max: 0 };
  
  const n = points.length;
  const angles: number[] = [];
  
  for (let i = 0; i < n; i++) {
    const p1 = points[(i - 1 + n) % n]!;
    const p2 = points[i]!;
    const p3 = points[(i + 1) % n]!;
    
    // Calculate vectors
    const v1 = { x: p1.x - p2.x, y: p1.y - p2.y, z: p1.z - p2.z };
    const v2 = { x: p3.x - p2.x, y: p3.y - p2.y, z: p3.z - p2.z };
    
    // Dot product and magnitudes
    const dot = v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;
    const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y + v1.z * v1.z);
    const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y + v2.z * v2.z);
    
    if (mag1 < 1e-10 || mag2 < 1e-10) continue;
    
    const cosAngle = dot / (mag1 * mag2);
    const angle = Math.acos(Math.max(-1, Math.min(1, cosAngle)));
    
    if (Number.isFinite(angle)) {
      angles.push(angle);
    }
  }
  
  if (angles.length === 0) return { min: 0, max: 0 };
  
  return {
    min: Math.min(...angles),
    max: Math.max(...angles)
  };
}

/**
 * Calculate polygon area (3D, projects to ground plane)
 */
function calculatePolygonArea3D(points: Vector3[]): number {
  if (points.length < 3) return 0;
  
  // Project to x-z plane (ground plane)
  const projected = points.map(p => ({ x: p.x, y: p.z }));
  return Math.abs(calculateSignedArea2D(projected));
}

/**
 * Calculate polygon perimeter
 */
function calculatePolygonPerimeter(points: Vector3[]): number {
  if (points.length < 2) return 0;
  
  let perimeter = 0;
  const n = points.length;
  
  for (let i = 0; i < n; i++) {
    const p1 = points[i]!;
    const p2 = points[(i + 1) % n]!;
    
    const dist = distance3D(p1, p2);
    
    if (Number.isFinite(dist)) {
      perimeter += dist;
    }
  }
  
  return perimeter;
}

/**
 * Calculate aspect ratio (length/width) of polygon bounding box
 */
function calculateAspectRatio(points: Vector3[]): number {
  if (points.length < 3) return 1;
  
  // Project to x-z plane
  const projected = points.map(p => ({ x: p.x, y: p.z }));
  
  const xs = projected.map(p => p.x);
  const ys = projected.map(p => p.y);
  
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  
  if (height < 1e-10) return Infinity;
  return width / height;
}

/**
 * Comprehensive polygon validation
 */
export function validatePolygon(points: Vector3[]): PolygonValidationResult {
  const warnings: string[] = [];
  let confidence = 1.0;
  let isDegenerate = false;
  
  // Basic checks
  if (points.length < 3) {
    return {
      isValid: false,
      isDegenerate: true,
      warnings: ['Polygon must have at least 3 points'],
      confidence: 0,
      area: 0,
      perimeter: 0,
      properties: {
        hasSelfIntersection: false,
        hasCollinearPoints: false,
        hasDuplicatePoints: false,
        isConvex: false,
        minAngle: 0,
        maxAngle: 0,
        aspectRatio: 1
      }
    };
  }
  
  // Filter out invalid points
  const validPoints = points.filter(isValidPoint3D);
  
  if (validPoints.length < 3) {
    warnings.push('Polygon contains invalid (NaN/Infinity) points');
    confidence *= 0.3;
    isDegenerate = true;
  }
  
  // Check for duplicate points
  const hasDuplicates = validPoints.some((p1, i) => 
    validPoints.slice(i + 1).some(p2 => pointsAreEqual(p1, p2, MIN_EDGE_LENGTH))
  );
  
  if (hasDuplicates) {
    warnings.push('Polygon contains duplicate or very close points');
    confidence *= 0.5;
    isDegenerate = true;
  }
  
  // Check for collinear points
  const hasCollinear = validPoints.some((p1, i) => {
    const p2 = validPoints[(i + 1) % validPoints.length]!;
    const p3 = validPoints[(i + 2) % validPoints.length]!;
    return areCollinear(p1, p2, p3);
  });
  
  if (hasCollinear) {
    warnings.push('Polygon contains collinear points');
    confidence *= 0.7;
  }
  
  // Calculate area
  const area = calculatePolygonArea3D(validPoints);
  
  if (area < MIN_AREA_THRESHOLD) {
    warnings.push(`Polygon area is too small: ${area.toFixed(6)} m^2`);
    confidence *= 0.2;
    isDegenerate = true;
  }
  
  // Check edge lengths
  const edgeLengths: number[] = [];
  for (let i = 0; i < validPoints.length; i++) {
    const p1 = validPoints[i]!;
    const p2 = validPoints[(i + 1) % validPoints.length]!;
    const length = distance3D(p1, p2);
    
    if (Number.isFinite(length)) {
      edgeLengths.push(length);
      
      if (length < MIN_EDGE_LENGTH) {
        warnings.push(`Edge ${i} is too short: ${length.toFixed(4)} m`);
        confidence *= 0.6;
      }
      
      if (length > MAX_EDGE_LENGTH) {
        warnings.push(`Edge ${i} is extremely long: ${length.toFixed(2)} m`);
        confidence *= 0.8;
      }
    }
  }
  
  // Check for self-intersections
  const hasSelfIntersect = hasSelfIntersection(validPoints);
  
  if (hasSelfIntersect) {
    warnings.push('Polygon has self-intersections');
    confidence *= 0.4;
    isDegenerate = true;
  }
  
  // Check convexity
  const convex = isConvex(validPoints);
  
  // Calculate angles
  const angles = calculateAngles(validPoints);
  
  if (angles.min < MIN_ANGLE_THRESHOLD) {
    warnings.push(`Polygon contains very acute angles (min: ${(angles.min * 180 / Math.PI).toFixed(2)} deg)`);
    confidence *= 0.7;
  }
  
  if (angles.max > MAX_ANGLE_THRESHOLD) {
    warnings.push(`Polygon contains very obtuse angles (max: ${(angles.max * 180 / Math.PI).toFixed(2)} deg)`);
    confidence *= 0.8;
  }
  
  // Calculate aspect ratio
  const aspectRatio = calculateAspectRatio(validPoints);
  
  if (aspectRatio > 100 || aspectRatio < 0.01) {
    warnings.push(`Polygon has extreme aspect ratio: ${aspectRatio.toFixed(2)}`);
    confidence *= 0.7;
  }
  
  // Calculate perimeter
  const perimeter = calculatePolygonPerimeter(validPoints);
  
  // Final validation
  const isValid = !isDegenerate && 
                  validPoints.length >= 3 && 
                  area >= MIN_AREA_THRESHOLD &&
                  !hasSelfIntersect &&
                  edgeLengths.every(l => l >= MIN_EDGE_LENGTH && l <= MAX_EDGE_LENGTH);
  
  // Clamp confidence
  confidence = Math.max(0, Math.min(1, confidence));
  
  return {
    isValid,
    isDegenerate,
    warnings,
    confidence,
    area,
    perimeter,
    properties: {
      hasSelfIntersection: hasSelfIntersect,
      hasCollinearPoints: hasCollinear,
      hasDuplicatePoints: hasDuplicates,
      isConvex: convex,
      minAngle: angles.min,
      maxAngle: angles.max,
      aspectRatio
    }
  };
}

/**
 * Validate measurement plausibility based on physical constraints
 */
export function validateMeasurementPlausibility(
  distance: number,
  points: Vector3[],
  cameraParams?: { pitch?: number; vFov?: number }
): { isValid: boolean; warnings: string[]; confidenceMultiplier: number } {
  const warnings: string[] = [];
  let confidenceMultiplier = 1.0;
  
  // Distance checks
  if (distance < 0.01) {
    warnings.push('Distance is extremely small (< 1cm)');
    confidenceMultiplier *= 0.3;
  } else if (distance > 5000) {
    warnings.push('Distance is very large (> 5km)');
    confidenceMultiplier *= 0.6;
  }
  
  // Point distribution checks
  if (points.length >= 2) {
    const distances: number[] = [];
    for (let i = 1; i < points.length; i++) {
      const dist = distance3D(points[i - 1]!, points[i]!);
      if (Number.isFinite(dist)) {
        distances.push(dist);
      }
    }
    
    const avgDist = distances.reduce((a, b) => a + b, 0) / distances.length;
    const variance = distances.reduce((sum, d) => sum + (d - avgDist) ** 2, 0) / distances.length;
    const stdDev = Math.sqrt(variance);
    const coefficientOfVariation = avgDist > 0 ? stdDev / avgDist : Infinity;
    
    if (coefficientOfVariation > 2.0) {
      warnings.push('Measurement points have highly variable spacing');
      confidenceMultiplier *= 0.7;
    }
  }
  
  // Camera angle checks
  if (cameraParams) {
    const pitch = Math.abs(cameraParams.pitch ?? 0);
    if (pitch > 75) {
      warnings.push('Extreme camera pitch may affect accuracy');
      confidenceMultiplier *= 0.8;
    }
  }
  
  confidenceMultiplier = Math.max(0, Math.min(1, confidenceMultiplier));
  
  return {
    isValid: confidenceMultiplier > 0.3,
    warnings,
    confidenceMultiplier
  };
}

