import { useRootStore } from '../rootStore';
import type { Measurement, Project } from '../../types/common';

const measurement: Measurement = { id: 'm1', label: 'Reference', kind: 'distance', unit: 'metric', distanceMeters: 12, timestamp: 1, startPoint: { x: 1, y: 2 }, endPoint: { x: 3, y: 4 } };
const project: Project = { id: 'p1', name: 'Survey', measurements: [measurement], revisionHistory: [{ timestamp: 2, measurements: [{ ...measurement, distanceMeters: 7 }] }] };
let invoke: jest.Mock;
beforeEach(() => {
  useRootStore.getState().resetState();
  invoke = jest.fn().mockResolvedValue(true);
  window.electronAPI.invoke = invoke;
  useRootStore.setState({ projects: { p1: project }, currentProjectId: 'p1', measurements: [measurement] });
});

test('failed project creation and deletion preserve the current workspace', async () => {
  invoke.mockResolvedValue(false);
  await useRootStore.getState().createProject('Second');
  await useRootStore.getState().deleteProject('p1');
  expect(Object.keys(useRootStore.getState().projects)).toEqual(['p1']);
  expect(useRootStore.getState().currentProjectId).toBe('p1');
  expect(useRootStore.getState().measurements).toEqual([measurement]);
});

test('failed revision saves and restores leave both measurements and revision history intact', async () => {
  invoke.mockRejectedValue(new Error('disk full'));
  await useRootStore.getState().saveRevision();
  await useRootStore.getState().revertToRevision(2);
  expect(useRootStore.getState().projects.p1).toEqual(project);
  expect(useRootStore.getState().measurements).toEqual([measurement]);
});

test('successful revision restore persists the restored values and supports undo', async () => {
  await useRootStore.getState().revertToRevision(2);
  expect(invoke).toHaveBeenCalledWith('save-project', expect.objectContaining({ measurements: [expect.objectContaining({ distanceMeters: 7 })] }));
  expect(useRootStore.getState().measurements[0].distanceMeters).toBe(7);
  useRootStore.getState().undoMeasurement();
  expect(useRootStore.getState().measurements[0].distanceMeters).toBe(12);
});

test('rename and deletion can each be undone and redone', () => {
  useRootStore.getState().setMeasurements([measurement]);
  useRootStore.getState().renameMeasurement('m1', 'Renamed');
  useRootStore.getState().deleteMeasurement('m1');
  expect(useRootStore.getState().measurements).toEqual([]);
  useRootStore.getState().undoMeasurement();
  expect(useRootStore.getState().measurements[0].name).toBe('Renamed');
  useRootStore.getState().undoMeasurement();
  expect(useRootStore.getState().measurements[0].name).toBeUndefined();
  useRootStore.getState().redoMeasurement();
  expect(useRootStore.getState().measurements[0].name).toBe('Renamed');
});
