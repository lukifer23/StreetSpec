import { create } from 'zustand';

interface ViewState {
  isSettingsOpen: boolean;
  isGeneratingMap: boolean;
  calibrateMode: boolean;
  isPolylineToolActive: boolean;
  isAreaToolActive: boolean;
  isVolumeToolActive: boolean;
  isProjectPanelOpen: boolean;
  error: string | null;
  mapGenerationError: string | null;
  onGenerateDepthMap: (() => Promise<void>) | null;
  setIsSettingsOpen: (isOpen: boolean) => void;
  setIsGeneratingMap: (isGenerating: boolean) => void;
  setCalibrateMode: (isOn: boolean) => void;
  setIsPolylineToolActive: (isActive: boolean) => void;
  setIsAreaToolActive: (isActive: boolean) => void;
  setIsVolumeToolActive: (isActive: boolean) => void;
  setIsProjectPanelOpen: (isOpen: boolean) => void;
  setError: (error: string | null) => void;
  setMapGenerationError: (error: string | null) => void;
  setOnGenerateDepthMap: (fn: () => Promise<void>) => void;
}

export const useViewStore = create<ViewState>((set) => ({
  isSettingsOpen: false,
  isGeneratingMap: false,
  calibrateMode: false,
  isPolylineToolActive: false,
  isAreaToolActive: false,
  isVolumeToolActive: false,
  isProjectPanelOpen: false,
  error: null,
  mapGenerationError: null,
  onGenerateDepthMap: null,
  setIsSettingsOpen: (isOpen) => set({ isSettingsOpen: isOpen }),
  setIsGeneratingMap: (isGenerating) => set({ isGeneratingMap: isGenerating }),
  setCalibrateMode: (isOn) => set({ calibrateMode: isOn }),
  setIsPolylineToolActive: (isActive) => set({ isPolylineToolActive: isActive }),
  setIsAreaToolActive: (isActive) => set({ isAreaToolActive: isActive }),
  setIsVolumeToolActive: (isActive) => set({ isVolumeToolActive: isActive }),
  setIsProjectPanelOpen: (isOpen) => set({ isProjectPanelOpen: isOpen }),
  setError: (error) => set({ error }),
  setMapGenerationError: (error) => set({ mapGenerationError: error }),
  setOnGenerateDepthMap: (fn) => set({ onGenerateDepthMap: fn }),
}));
