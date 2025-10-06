import { pixelOffsetToVerticalAngle } from '../../../utils/cameraMath';

describe('pixelOffsetToVerticalAngle', () => {
  const viewHeight = 480;
  const verticalFov = 60;

  it('returns zero for the centre pixel', () => {
    const result = pixelOffsetToVerticalAngle(viewHeight / 2, viewHeight, verticalFov);
    expect(result).toBeCloseTo(0, 5);
  });

  it('returns positive values for pixels below the centre', () => {
    const result = pixelOffsetToVerticalAngle(viewHeight - 1, viewHeight, verticalFov);
    expect(result).toBeGreaterThan(0);
  });

  it('returns negative values for pixels above the centre', () => {
    const result = pixelOffsetToVerticalAngle(0, viewHeight, verticalFov);
    expect(result).toBeLessThan(0);
  });

  it('respects the camera vertical FOV', () => {
    const bottomAngle = pixelOffsetToVerticalAngle(viewHeight, viewHeight, verticalFov);
    expect(bottomAngle).toBeCloseTo(verticalFov / 2, 3);
  });

  it('handles invalid inputs gracefully', () => {
    expect(pixelOffsetToVerticalAngle(0, 0, verticalFov)).toBe(0);
    expect(pixelOffsetToVerticalAngle(0, viewHeight, 0)).toBe(0);
  });
});
