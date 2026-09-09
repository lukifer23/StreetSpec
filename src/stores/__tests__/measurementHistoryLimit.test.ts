import { act } from '@testing-library/react';
import { useRootStore } from '../rootStore';
import { useNotificationStore } from '../notificationStore';
import type { Measurement } from '../../types/common';

type NewMeasurement = Omit<Measurement, 'id' | 'timestamp' | 'name'>;

const createNewMeasurement = (label: string): NewMeasurement => ({
  kind: 'distance',
  label,
  startPoint: { x: 0, y: 0 },
  endPoint: { x: 1, y: 1 },
  unit: 'metric',
});

const createExistingMeasurement = (
  id: string,
  label: string,
  timestamp: number
): Measurement => ({
  id,
  label,
  name: '',
  kind: 'distance',
  startPoint: { x: 0, y: 0 },
  endPoint: { x: 1, y: 1 },
  unit: 'metric',
  timestamp,
});

describe('measurement history limit enforcement', () => {
  beforeEach(() => {
    act(() => {
      useRootStore.getState().resetState();
      useNotificationStore.getState().clear();
      useRootStore.setState((state) => {
        state.settings.measurementHistoryLimit = 2;
      });
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('trims older measurements when adding beyond the limit', () => {
    let currentTimestamp = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => {
      currentTimestamp += 1;
      return currentTimestamp;
    });

    act(() => {
      const { addMeasurement } = useRootStore.getState();
      addMeasurement(createNewMeasurement('m1'));
      addMeasurement(createNewMeasurement('m2'));
      addMeasurement(createNewMeasurement('m3'));
    });

    const measurements = useRootStore.getState().measurements;
    expect(measurements).toHaveLength(2);
    expect(measurements.map((m) => m.label)).toEqual(['m2', 'm3']);

    const notifications = useNotificationStore.getState().notifications;
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      message: 'Removed 1 older measurement to keep history within the limit of 2.',
      kind: 'info',
    });
  });

  it('preserves all persisted measurements when hydrating the workspace', () => {
    const importedMeasurements: Measurement[] = [
      createExistingMeasurement('id-1', 'm1', 1),
      createExistingMeasurement('id-2', 'm2', 2),
      createExistingMeasurement('id-3', 'm3', 3),
      createExistingMeasurement('id-4', 'm4', 4),
    ];

    act(() => {
      useRootStore.getState().setMeasurements(importedMeasurements);
    });

    const measurements = useRootStore.getState().measurements;
    expect(measurements).toHaveLength(4);
    expect(measurements.map((m) => m.id)).toEqual(['id-1', 'id-2', 'id-3', 'id-4']);
    expect(useRootStore.getState().canUndo()).toBe(false);

    const notifications = useNotificationStore.getState().notifications;
    expect(notifications).toHaveLength(0);
  });

  it('preserves archived project measurements regardless of the active history limit', () => {
    const projectMeasurements: Measurement[] = [
      createExistingMeasurement('id-1', 'm1', 1),
      createExistingMeasurement('id-2', 'm2', 2),
      createExistingMeasurement('id-3', 'm3', 3),
    ];

    act(() => {
      useRootStore.setState((state) => {
        state.projects = {
          project1: {
            id: 'project1',
            name: 'Project 1',
            measurements: projectMeasurements,
            revisionHistory: [],
          },
        };
      });
    });

    act(() => {
      useRootStore.getState().loadProject('project1');
    });

    const store = useRootStore.getState();
    expect(store.measurements).toHaveLength(3);
    expect(store.measurements.map((m) => m.id)).toEqual(['id-1', 'id-2', 'id-3']);

    const project = store.projects['project1'];
    expect(project.measurements).toHaveLength(3);
    expect(project.measurements.map((m) => m.id)).toEqual(['id-1', 'id-2', 'id-3']);

    const notifications = useNotificationStore.getState().notifications;
    expect(notifications).toHaveLength(0);
  });
});
