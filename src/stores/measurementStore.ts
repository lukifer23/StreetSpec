import { create } from 'zustand';
import { Measurement } from '../types/common';
import { v4 as uuidv4 } from 'uuid';

interface MeasurementState {
  measurements: Measurement[];
  addMeasurement: (measurement: Omit<Measurement, 'id' | 'timestamp' | 'name'>) => void;
  deleteMeasurement: (id: string) => void;
  renameMeasurement: (id: string, newName: string) => void;
  clearMeasurements: () => void;
  setMeasurements: (measurements: Measurement[]) => void;
}

export const useMeasurementStore = create<MeasurementState>((set) => ({
  measurements: [],
  addMeasurement: (measurement) =>
    set((state) => {
      const newMeasurement: Measurement = {
        ...measurement,
        id: uuidv4(),
        timestamp: Date.now(),
        name: '',
      };
      return { measurements: [...state.measurements, newMeasurement] };
    }),
  deleteMeasurement: (id) =>
    set((state) => ({
      measurements: state.measurements.filter((m) => m.id !== id),
    })),
  renameMeasurement: (id, newName) =>
    set((state) => ({
      measurements: state.measurements.map((m) =>
        m.id === id ? { ...m, name: newName } : m
      ),
    })),
  clearMeasurements: () => set({ measurements: [] }),
  setMeasurements: (measurements) => set({ measurements }),
}));
