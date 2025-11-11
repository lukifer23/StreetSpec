import { degreesToRadians, radiansToDegrees } from './math';

// Re-export from math.ts for backward compatibility
export { degreesToRadians, radiansToDegrees } from './math';

/**
 * Converts a pixel Y coordinate into a vertical angle relative to the camera centre.
 * Positive angles indicate pixels below the centre of the view (looking downward).
 */
export function pixelOffsetToVerticalAngle(
  pixelY: number,
  viewHeight: number,
  verticalFovDeg: number
): number {
  if (!Number.isFinite(pixelY) || !Number.isFinite(viewHeight) || viewHeight <= 0) {
    return 0;
  }

  if (!Number.isFinite(verticalFovDeg) || verticalFovDeg <= 0) {
    return 0;
  }

  const halfHeight = viewHeight / 2;
  if (halfHeight === 0) {
    return 0;
  }

  const normalizedOffset = (pixelY - halfHeight) / halfHeight;
  const tanHalfFov = Math.tan(degreesToRadians(verticalFovDeg) / 2);
  const angleRadians = Math.atan(normalizedOffset * tanHalfFov);
  return radiansToDegrees(angleRadians);
}
