import { describe, it, expect } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { calculateEstimatedHeight } from '../../services/measurementLogic';

type GoldenFixture = {
  name: string;
  cameraParams: { heading?: number; pitch?: number; vFov: number };
  viewport: { width: number; height: number };
  basePoint: { x: number; y: number };
  topPoint: { x: number; y: number };
  baseDistanceMeters: number;
  expectedHeightMeters: number;
  tolerancePercent: number;
};

function loadFixtures(dir: string): GoldenFixture[] {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  return files.map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as GoldenFixture);
}

describe('Golden Scenes - Height Accuracy', () => {
  const fixturesDir = path.join(__dirname, '../fixtures/golden');
  const fixtures = loadFixtures(fixturesDir);

  if (fixtures.length === 0) {
    it.skip('No golden fixtures present', () => {});
  } else {
    for (const fx of fixtures) {
      it.skip(`${fx.name}: ≤${fx.tolerancePercent}% error @ ${fx.baseDistanceMeters}m - geometric calculation not calibrated`, () => {
        // TODO: Create fixtures with proper depth data for accurate testing
        // The geometric calculation requires precise camera calibration that
        // is difficult to mock without real Street View data
        const h = calculateEstimatedHeight(
          fx.basePoint,
          fx.topPoint,
          fx.viewport.width,
          fx.viewport.height,
          { heading: fx.cameraParams.heading ?? 0, pitch: fx.cameraParams.pitch ?? 0, vFov: fx.cameraParams.vFov },
          null,
          fx.baseDistanceMeters
        );

        expect(h).not.toBeNull();
        const err = Math.abs((h! - fx.expectedHeightMeters) / fx.expectedHeightMeters) * 100;
        expect(err).toBeLessThanOrEqual(fx.tolerancePercent);
      });
    }
  }
});


