import { test } from 'node:test';
import assert from 'node:assert/strict';
// Import compiled output when running tests. TypeScript will accept this
// since we only need runtime behavior.
import { calculateEstimatedHeight } from './measurementLogic.js';

test('calculateEstimatedHeight uses perspective angle mapping', () => {
  const cameraParams = { vFov: 90, pitch: 0 };
  const height = calculateEstimatedHeight(1, 0.5, 2, cameraParams, 1);
  assert.ok(height !== null);
  if (height !== null) {
    assert.ok(Math.abs(height - 0.5) < 1e-6);
  }
});
