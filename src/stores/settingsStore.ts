import { create } from 'zustand';
import type { AppSettings } from '../types/common';

interface SettingsState {
  settings: AppSettings;
  setSettings: (settings: AppSettings) => void;
  updateSettings: (updates: Partial<AppSettings>) => void;
  toggleUnit: () => void;
}

const defaultSettings: AppSettings = {
  defaultUnit: 'metric',
  autoSave: true,
  theme: 'light',
  language: 'en',
  measurementHistoryLimit: 1000,
  cameraHeight: 2.5,
  calibrationPitchOffsetDeg: 0,
  depthScale: 1,
  depthBias: 0,
};

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: defaultSettings,
  setSettings: (settings) => set({ settings }),
  updateSettings: (updates) =>
    set((state) => ({
      settings: { ...state.settings, ...updates },
    })),
  toggleUnit: () =>
    set((state) => ({
      settings: {
        ...state.settings,
        defaultUnit: state.settings.defaultUnit === 'metric' ? 'imperial' : 'metric',
      },
    })),
}));
