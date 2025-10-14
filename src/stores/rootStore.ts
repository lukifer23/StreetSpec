import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { subscribeWithSelector } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { devtools } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import type {
  Measurement,
  Project,
  Revision,
  AppSettings,
  CameraParams,
  OnnxDepthMap,
  DecodedDepthData,
  Coordinates
} from '../types/common';

// Location state machine for coordinated flow
type LocationState = 
  | 'idle'
  | 'loading_pano'
  | 'pano_loaded'
  | 'fetching_depth'
  | 'depth_ready'
  | 'calibrating'
  | 'ready'
  | 'error';

// Root state interface
interface RootState {
  // Core application state
  isLoading: boolean;
  error: string | null;
  locationState: LocationState;
  
  // Settings
  settings: AppSettings;
  
  // Camera and depth data
  targetCoords: Coordinates | null;
  currentCameraParams: CameraParams | null;
  onnxDepthMap: OnnxDepthMap | null;
  depthData: DecodedDepthData | null;
  
  // Measurements
  measurements: Measurement[];
  
  // Projects
  projects: Record<string, Project>;
  currentProjectId: string | null;
  
  // UI state
  isSettingsOpen: boolean;
  isGeneratingMap: boolean;
  calibrateMode: boolean;
  isPolylineToolActive: boolean;
  isAreaToolActive: boolean;
  isVolumeToolActive: boolean;
  isProjectPanelOpen: boolean;
  mapGenerationError: string | null;
  isCalibrated: boolean;
  onGenerateDepthMap: (() => Promise<void>) | null;
  
  // Computed properties
  canMeasure: boolean; // True when ready to measure
  canGenerateDepth: boolean; // True when pano is loaded
  canCalibrate: boolean; // True when depth data is available
  
  // Actions
  // Settings actions
  setSettings: (settings: AppSettings) => void;
  updateSettings: (updates: Partial<AppSettings>) => void;
  toggleUnit: () => void;
  saveCurrentProject: () => void;
  
  // Camera actions
  setTargetCoords: (coords: Coordinates | null) => void;
  setCurrentCameraParams: (params: CameraParams | null) => void;
  setOnnxDepthMap: (depthMap: OnnxDepthMap | null) => void;
  setDepthData: (depthData: DecodedDepthData | null) => void;
  
  // Measurement actions
  addMeasurement: (measurement: Omit<Measurement, 'id' | 'timestamp' | 'name'>) => void;
  deleteMeasurement: (id: string) => void;
  renameMeasurement: (id: string, newName: string) => void;
  clearMeasurements: () => void;
  setMeasurements: (measurements: Measurement[]) => void;
  
  // Project actions
  loadProjects: () => Promise<void>;
  createProject: (name: string) => void;
  loadProject: (id: string) => void;
  deleteProject: (id: string) => void;
  saveRevision: () => void;
  revertToRevision: (timestamp: number) => void;
  
  // UI actions
  setIsSettingsOpen: (isOpen: boolean) => void;
  setIsGeneratingMap: (isGenerating: boolean) => void;
  setCalibrateMode: (isOn: boolean) => void;
  setIsPolylineToolActive: (isActive: boolean) => void;
  setIsAreaToolActive: (isActive: boolean) => void;
  setIsVolumeToolActive: (isActive: boolean) => void;
  setIsProjectPanelOpen: (isOpen: boolean) => void;
  setError: (error: string | null) => void;
  setMapGenerationError: (error: string | null) => void;
  setIsCalibrated: (isCalibrated: boolean) => void;
  setLoading: (loading: boolean) => void;
  setOnGenerateDepthMap: (fn: (() => Promise<void>) | null) => void;
  
  // Location state actions
  setLocationState: (state: LocationState) => void;
  advanceLocationState: () => void; // Automatically advance based on current state
  
  // Utility actions
  resetState: () => void;
  exportState: () => string;
  importState: (state: string) => void;
}

// Default settings
const defaultSettings: AppSettings = {
  defaultUnit: 'metric',
  autoSave: true,
  theme: 'light',
  language: 'en',
  measurementHistoryLimit: 1000,
  cameraHeight: 2.5,
  calibrationPitchOffsetDeg: 0,
  depthApiMaxRetries: 5,
  depthQuality: 'high',
  enableDepthCache: true,
};

// Create the root store with middleware
export const useRootStore = create<RootState>()(
  devtools(
    subscribeWithSelector(
      immer((set, get) => ({
        // Initial state
        isLoading: false,
        error: null,
        locationState: 'idle' as LocationState,
        settings: defaultSettings,
        targetCoords: null,
        currentCameraParams: null,
        onnxDepthMap: null,
        depthData: null,
        measurements: [],
        projects: {},
        currentProjectId: null,
        isSettingsOpen: false,
        isGeneratingMap: false,
        calibrateMode: false,
        isPolylineToolActive: false,
        isAreaToolActive: false,
        isVolumeToolActive: false,
        isProjectPanelOpen: false,
        mapGenerationError: null,
        isCalibrated: false,
        onGenerateDepthMap: null,
        
        // Computed properties (getter functions)
        get canMeasure(): boolean {
          const state = get();
          return state.locationState === 'ready' && 
                 state.isCalibrated && 
                 (state.onnxDepthMap !== null || state.depthData !== null) &&
                 state.currentCameraParams !== null;
        },
        
        get canGenerateDepth(): boolean {
          const state = get();
          return state.currentCameraParams !== null &&
                 (state.locationState === 'pano_loaded' || state.locationState === 'ready');
        },
        
        get canCalibrate(): boolean {
          const state = get();
          return (state.onnxDepthMap !== null || state.depthData !== null) &&
                 state.currentCameraParams !== null;
        },

        // Settings actions
        setSettings: (settings) => set((state) => {
          state.settings = settings;
        }),

        updateSettings: (updates) => set((state) => {
          Object.assign(state.settings, updates);
        }),

        toggleUnit: () => set((state) => {
          state.settings.defaultUnit = state.settings.defaultUnit === 'metric' ? 'imperial' : 'metric';
        }),

        saveCurrentProject: () => set((state) => {
          if (!state.currentProjectId) return;
          const project = state.projects[state.currentProjectId];
          if (project) {
            project.measurements = [...state.measurements];
            // save to IPC
            if (window.electronAPI?.invoke) {
              window.electronAPI.invoke('save-project', project);
            }
          }
        }),

        // Camera actions
        setTargetCoords: (coords) => set((state) => {
          state.targetCoords = coords;
        }),

        setCurrentCameraParams: (params) => set((state) => {
          state.currentCameraParams = params;
        }),

        setOnnxDepthMap: (depthMap) => set((state) => {
          state.onnxDepthMap = depthMap;
        }),

        setDepthData: (depthData) => set((state) => {
          state.depthData = depthData;
        }),

        // Measurement actions
        addMeasurement: (measurement) => set((state) => {
          const newMeasurement: Measurement = {
            ...measurement,
            id: uuidv4(),
            timestamp: Date.now(),
            name: '',
          };
          state.measurements.push(newMeasurement);
        }),

        deleteMeasurement: (id) => set((state) => {
          state.measurements = state.measurements.filter((m) => m.id !== id);
        }),

        renameMeasurement: (id, newName) => set((state) => {
          const measurement = state.measurements.find((m) => m.id === id);
          if (measurement) {
            measurement.name = newName;
          }
        }),

        clearMeasurements: () => set((state) => {
          state.measurements = [];
        }),

        setMeasurements: (measurements) => set((state) => {
          state.measurements = measurements;
        }),

        // Project actions
        loadProjects: async () => {
          if (window.electronAPI?.invoke) {
            try {
              const projects = await window.electronAPI.invoke('get-projects');
              set((state) => {
                state.projects = projects || {};
              });
            } catch (error) {
              console.error('Failed to load projects:', error);
            }
          }
        },

        createProject: (name) => set((state) => {
          const id = uuidv4();
          const newProject: Project = {
            id,
            name,
            measurements: [...state.measurements],
            revisionHistory: [],
          };
          state.projects[id] = newProject;
          state.currentProjectId = id;

          if (window.electronAPI?.invoke) {
            window.electronAPI.invoke('save-project', newProject);
          }
        }),

        loadProject: (id) => set((state) => {
          const project = state.projects[id];
          if (project) {
            state.measurements = [...project.measurements];
            state.currentProjectId = id;
          }
        }),

        deleteProject: (id) => set((state) => {
          delete state.projects[id];
          if (state.currentProjectId === id) {
            state.currentProjectId = null;
          }
          
          if (window.electronAPI?.invoke) {
            window.electronAPI.invoke('delete-project', id);
          }
        }),

        saveRevision: () => set((state) => {
          const { currentProjectId, projects, measurements } = state;
          if (!currentProjectId) return;

          const project = projects[currentProjectId];
          if (!project) return;

          // Update project's measurements with current state
          project.measurements = [...measurements];

          const newRevision: Revision = {
            timestamp: Date.now(),
            measurements: [...measurements],
          };

          project.revisionHistory.push(newRevision);

          if (window.electronAPI?.invoke) {
            window.electronAPI.invoke('save-project', project);
          }
        }),

        revertToRevision: (timestamp) => set((state) => {
          const { currentProjectId, projects } = state;
          if (!currentProjectId) return;

          const project = projects[currentProjectId];
          if (!project) return;

          const revision = project.revisionHistory.find(r => r.timestamp === timestamp);
          if (!revision) return;

          state.measurements = [...revision.measurements];

          if (window.electronAPI?.invoke) {
            window.electronAPI.invoke('save-project', project);
          }
        }),

        // UI actions
        setIsSettingsOpen: (isOpen) => set((state) => {
          state.isSettingsOpen = isOpen;
        }),

        setIsGeneratingMap: (isGenerating) => set((state) => {
          state.isGeneratingMap = isGenerating;
        }),

        setCalibrateMode: (isOn) => set((state) => {
          state.calibrateMode = isOn;
        }),

        setIsPolylineToolActive: (isActive) => set((state) => {
          state.isPolylineToolActive = isActive;
        }),

        setIsAreaToolActive: (isActive) => set((state) => {
          state.isAreaToolActive = isActive;
        }),

        setIsVolumeToolActive: (isActive) => set((state) => {
          state.isVolumeToolActive = isActive;
        }),

        setIsProjectPanelOpen: (isOpen) => set((state) => {
          state.isProjectPanelOpen = isOpen;
        }),

        setError: (error) => set((state) => {
          state.error = error;
        }),

        setMapGenerationError: (error) => set((state) => {
          state.mapGenerationError = error;
        }),

        setIsCalibrated: (isCalibrated) => set((state) => {
          state.isCalibrated = isCalibrated;
        }),

        setLoading: (loading) => set((state) => {
          state.isLoading = loading;
        }),

        setOnGenerateDepthMap: (fn) => set((state) => {
          state.onGenerateDepthMap = fn;
        }),
        
        // Location state actions
        setLocationState: (locationState) => set((state) => {
          state.locationState = locationState;
        }),
        
        advanceLocationState: () => set((state) => {
          // State machine transitions
          switch (state.locationState) {
            case 'idle':
              if (state.currentCameraParams) {
                state.locationState = 'pano_loaded';
              }
              break;
            case 'loading_pano':
              if (state.currentCameraParams) {
                state.locationState = 'pano_loaded';
              }
              break;
            case 'pano_loaded':
              if (state.depthData || state.onnxDepthMap) {
                state.locationState = 'depth_ready';
              } else if (state.isGeneratingMap) {
                state.locationState = 'fetching_depth';
              }
              break;
            case 'fetching_depth':
              if (state.depthData || state.onnxDepthMap) {
                state.locationState = 'depth_ready';
              }
              break;
            case 'depth_ready':
              if (state.calibrateMode) {
                state.locationState = 'calibrating';
              } else if (state.isCalibrated) {
                state.locationState = 'ready';
              }
              break;
            case 'calibrating':
              if (state.isCalibrated && !state.calibrateMode) {
                state.locationState = 'ready';
              }
              break;
            case 'ready':
              // Stay in ready unless pano changes
              if (!state.currentCameraParams) {
                state.locationState = 'idle';
              }
              break;
            case 'error':
              // Can reset to idle manually
              break;
          }
        }),

        // Utility actions
        resetState: () => set((state) => {
          state.measurements = [];
          state.onnxDepthMap = null;
          state.depthData = null;
          state.error = null;
          state.mapGenerationError = null;
          state.isCalibrated = false;
          state.locationState = 'idle';
        }),

        exportState: () => {
          const state = get();
          return JSON.stringify({
            measurements: state.measurements,
            settings: state.settings,
            projects: state.projects,
            currentProjectId: state.currentProjectId,
          });
        },

        importState: (stateString) => {
          try {
            const importedState = JSON.parse(stateString);
            set((state) => {
              if (importedState.measurements) {
                state.measurements = importedState.measurements;
              }
              if (importedState.settings) {
                state.settings = { ...state.settings, ...importedState.settings };
              }
              if (importedState.projects) {
                state.projects = importedState.projects;
              }
              if (importedState.currentProjectId) {
                state.currentProjectId = importedState.currentProjectId;
              }
            });
          } catch (error) {
            console.error('Failed to import state:', error);
          }
        },
      }))
    ),
    {
      name: 'streetspec-store',
      enabled: import.meta.env.DEV,
    }
  )
);

// Selector hooks for better performance
export const useSettings = () => useRootStore((state) => state.settings);
export const useMeasurements = () => useRootStore((state) => state.measurements);
export const useCameraParams = () => useRootStore((state) => state.currentCameraParams);
export const useProjects = () => useRootStore((state) => state.projects);
export const useUIState = () =>
  useRootStore(useShallow((state) => ({
    isSettingsOpen: state.isSettingsOpen,
    isGeneratingMap: state.isGeneratingMap,
    calibrateMode: state.calibrateMode,
    isPolylineToolActive: state.isPolylineToolActive,
    isAreaToolActive: state.isAreaToolActive,
    isVolumeToolActive: state.isVolumeToolActive,
    isProjectPanelOpen: state.isProjectPanelOpen,
    isCalibrated: state.isCalibrated,
    onGenerateDepthMap: state.onGenerateDepthMap,
  })));

// Action hooks
export const useSettingsActions = () =>
  useRootStore(useShallow((state) => ({
    setSettings: state.setSettings,
    updateSettings: state.updateSettings,
    toggleUnit: state.toggleUnit,
  })));

export const useMeasurementActions = () =>
  useRootStore(useShallow((state) => ({
    addMeasurement: state.addMeasurement,
    deleteMeasurement: state.deleteMeasurement,
    renameMeasurement: state.renameMeasurement,
    clearMeasurements: state.clearMeasurements,
    setMeasurements: state.setMeasurements,
  })));

export const useProjectActions = () =>
  useRootStore(useShallow((state) => ({
    loadProjects: state.loadProjects,
    createProject: state.createProject,
    loadProject: state.loadProject,
    deleteProject: state.deleteProject,
    saveRevision: state.saveRevision,
    revertToRevision: state.revertToRevision,
    saveCurrentProject: state.saveCurrentProject,
  })));

export const useUIActions = () =>
  useRootStore(useShallow((state) => ({
    setIsSettingsOpen: state.setIsSettingsOpen,
    setIsGeneratingMap: state.setIsGeneratingMap,
    setCalibrateMode: state.setCalibrateMode,
    setIsPolylineToolActive: state.setIsPolylineToolActive,
    setIsAreaToolActive: state.setIsAreaToolActive,
    setIsVolumeToolActive: state.setIsVolumeToolActive,
    setIsProjectPanelOpen: state.setIsProjectPanelOpen,
    setError: state.setError,
    setMapGenerationError: state.setMapGenerationError,
    setIsCalibrated: state.setIsCalibrated,
    setLoading: state.setLoading,
    setOnGenerateDepthMap: state.setOnGenerateDepthMap,
  })));
