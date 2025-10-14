import type { CameraParams } from '../types/common';

export interface GroundFramePoint {
  x: number;
  y: number;
}

export interface VolumeBaseAnalysis {
  area: number;
  length: number;
  width: number;
  orientationRadians: number;
  centroid: GroundFramePoint;
  projectedPoints: GroundFramePoint[];
}

const MINIMUM_AREA_EPSILON = 1e-6;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function projectWorldPointsToGroundFrame(
  points: { x: number; y: number; z: number }[],
  headingDegrees: CameraParams['heading']
): GroundFramePoint[] {
  const heading = toRadians(headingDegrees ?? 0);
  const cosHeading = Math.cos(heading);
  const sinHeading = Math.sin(heading);

  return points.map((point) => ({
    x: point.x * cosHeading + point.z * sinHeading,
    y: -point.x * sinHeading + point.z * cosHeading,
  }));
}

function calculatePolygonArea2D(points: GroundFramePoint[]): number {
  const n = points.length;
  if (n < 3) return 0;

  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += points[i]!.x * points[j]!.y;
    area -= points[j]!.x * points[i]!.y;
  }

  return Math.abs(area) / 2;
}

function calculatePolygonCentroid(points: GroundFramePoint[], area: number): GroundFramePoint {
  const n = points.length;
  if (n === 0 || area === 0) {
    return { x: 0, y: 0 };
  }

  let centroidX = 0;
  let centroidY = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const cross = points[i]!.x * points[j]!.y - points[j]!.x * points[i]!.y;
    centroidX += (points[i]!.x + points[j]!.x) * cross;
    centroidY += (points[i]!.y + points[j]!.y) * cross;
  }

  const scale = 1 / (6 * area);
  return {
    x: centroidX * scale,
    y: centroidY * scale,
  };
}

function normalizeVector(x: number, y: number): { x: number; y: number } | null {
  const length = Math.hypot(x, y);
  if (length < 1e-12) {
    return null;
  }
  return { x: x / length, y: y / length };
}

function computePrincipalAxes(points: GroundFramePoint[], centroid: GroundFramePoint) {
  const n = points.length;
  if (n === 0) {
    return null;
  }

  let xx = 0;
  let xy = 0;
  let yy = 0;

  for (const point of points) {
    const dx = point.x - centroid.x;
    const dy = point.y - centroid.y;
    xx += dx * dx;
    xy += dx * dy;
    yy += dy * dy;
  }

  xx /= n;
  xy /= n;
  yy /= n;

  const trace = xx + yy;
  const determinant = xx * yy - xy * xy;
  const discriminant = Math.max(trace * trace / 4 - determinant, 0);
  const sqrtDiscriminant = Math.sqrt(discriminant);

  const majorEigenValue = trace / 2 + sqrtDiscriminant;

  let majorEigenVector: { x: number; y: number } | null = null;

  if (Math.abs(xy) > 1e-10) {
    majorEigenVector = normalizeVector(majorEigenValue - yy, xy);
  } else if (xx >= yy) {
    majorEigenVector = { x: 1, y: 0 };
  } else {
    majorEigenVector = { x: 0, y: 1 };
  }

  if (!majorEigenVector) {
    return null;
  }

  const minorEigenVector = { x: -majorEigenVector.y, y: majorEigenVector.x };

  return {
    majorEigenVector,
    minorEigenVector,
  };
}

export function analyzeVolumeBase(
  worldPoints: { x: number; y: number; z: number }[],
  headingDegrees: CameraParams['heading']
): VolumeBaseAnalysis | null {
  if (worldPoints.length < 3) {
    return null;
  }

  const projectedPoints = projectWorldPointsToGroundFrame(worldPoints, headingDegrees);
  const area = calculatePolygonArea2D(projectedPoints);

  if (!Number.isFinite(area) || area <= MINIMUM_AREA_EPSILON) {
    return null;
  }

  const centroid = calculatePolygonCentroid(projectedPoints, area);
  const principalAxes = computePrincipalAxes(projectedPoints, centroid);

  if (!principalAxes) {
    return null;
  }

  const { majorEigenVector, minorEigenVector } = principalAxes;

  let minMajor = Infinity;
  let maxMajor = -Infinity;
  let minMinor = Infinity;
  let maxMinor = -Infinity;

  for (const point of projectedPoints) {
    const dx = point.x - centroid.x;
    const dy = point.y - centroid.y;
    const majorProjection = dx * majorEigenVector.x + dy * majorEigenVector.y;
    const minorProjection = dx * minorEigenVector.x + dy * minorEigenVector.y;

    minMajor = Math.min(minMajor, majorProjection);
    maxMajor = Math.max(maxMajor, majorProjection);
    minMinor = Math.min(minMinor, minorProjection);
    maxMinor = Math.max(maxMinor, minorProjection);
  }

  const length = maxMajor - minMajor;
  const width = maxMinor - minMinor;

  if (!Number.isFinite(length) || !Number.isFinite(width) || length <= 0 || width <= 0) {
    return null;
  }

  const orientationRadians = Math.atan2(majorEigenVector.y, majorEigenVector.x);

  return {
    area,
    length,
    width,
    orientationRadians,
    centroid,
    projectedPoints,
  };
}

export const MINIMUM_BASE_AREA = 0.05;
