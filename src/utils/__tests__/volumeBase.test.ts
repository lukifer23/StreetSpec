import { analyzeVolumeBase, projectWorldPointsToGroundFrame } from '../volumeBase';

function createRectangleWorldPoints(
  length: number,
  width: number,
  rotationDegrees: number
): { x: number; y: number; z: number }[] {
  const halfLength = length / 2;
  const halfWidth = width / 2;

  const radians = (rotationDegrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  const basePoints = [
    { x: -halfLength, z: -halfWidth },
    { x: halfLength, z: -halfWidth },
    { x: halfLength, z: halfWidth },
    { x: -halfLength, z: halfWidth },
  ];

  return basePoints.map(({ x, z }) => ({
    x: x * cos - z * sin,
    y: 0,
    z: x * sin + z * cos,
  }));
}

describe('volume base analysis utilities', () => {
  it('analyzes an axis-aligned rectangle correctly', () => {
    const worldPoints = createRectangleWorldPoints(4, 2, 0);
    const analysis = analyzeVolumeBase(worldPoints, 0);

    expect(analysis).not.toBeNull();
    expect(analysis!.area).toBeCloseTo(8, 6);
    expect(analysis!.length).toBeCloseTo(4, 6);
    expect(analysis!.width).toBeCloseTo(2, 6);
  });

  it('returns null for degenerate polygons', () => {
    const worldPoints = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ];

    expect(analyzeVolumeBase(worldPoints, 0)).toBeNull();
  });

  it('keeps dimensions consistent for rotated footprints when heading matches rotation', () => {
    const rotation = 37;
    const worldPoints = createRectangleWorldPoints(6, 3, rotation);

    const analysis = analyzeVolumeBase(worldPoints, rotation);

    expect(analysis).not.toBeNull();
    expect(analysis!.area).toBeCloseTo(18, 6);
    expect(analysis!.length).toBeCloseTo(6, 5);
    expect(analysis!.width).toBeCloseTo(3, 5);
  });

  it('projects world points into ground frame based on heading', () => {
    const worldPoints = [
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
    ];

    const projected = projectWorldPointsToGroundFrame(worldPoints, 90);

    expect(projected[0]!.x).toBeCloseTo(0, 6);
    expect(projected[0]!.y).toBeCloseTo(-1, 6);
    expect(projected[1]!.x).toBeCloseTo(1, 6);
    expect(projected[1]!.y).toBeCloseTo(0, 6);
  });
});


test('translated footprints retain centroid and dimensions under reversed winding', () => {
  const points = createRectangleWorldPoints(6, 2, 28).map(p => ({ ...p, x: p.x + 17, z: p.z - 23 }));
  const forward = analyzeVolumeBase(points, 0)!;
  const reverse = analyzeVolumeBase([...points].reverse(), 0)!;
  for (const result of [forward, reverse]) {
    expect(result.centroid.x).toBeCloseTo(17, 8);
    expect(result.centroid.y).toBeCloseTo(-23, 8);
    expect(result.area).toBeCloseTo(12, 8);
    expect(result.length).toBeCloseTo(6, 8);
    expect(result.width).toBeCloseTo(2, 8);
  }
});
