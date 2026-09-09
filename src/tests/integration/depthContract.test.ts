import { estimateDistanceToPoint } from '../../services/measurementLogic';
import type { CameraParams, OnnxDepthMap } from '../../types/common';

const map: OnnxDepthMap = { width: 101, height: 101, data: Array(10201).fill(10), depthType: 'axial' };
const camera: CameraParams = { panoId: 'analytic', lat: 0, lng: 0, heading: 0, pitch: 0, zoom: 0, fov: 90, vFov: 90 };

test.each([[0, 0], [113, 20], [270, -35]])('axial depth becomes radial range independently of heading %s and pitch %s', (heading, pitch) => {
  const pose = { ...camera, heading, pitch };
  const center = estimateDistanceToPoint(50, 50, 100, 100, pose, map);
  const offAxis = estimateDistanceToPoint(75, 50, 100, 100, pose, map);
  expect(center).toBeCloseTo(10, 6);
  expect(offAxis).toBeCloseTo(Math.hypot(10, 5), 6);
  expect(estimateDistanceToPoint(75, 50, 100, 100, pose, { ...map, depthType: 'radial' })).toBeCloseTo(10, 6);
});
