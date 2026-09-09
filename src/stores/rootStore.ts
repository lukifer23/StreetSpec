import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { subscribeWithSelector } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { devtools } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import { pushNotification } from './notificationStore';
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
  
  // Undo/Redo history for measurements
  measurementHistory: {
    past: Measurement[][];
    present: Measurement[];
    future: Measurement[];
  };
  
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
  
  // Undo/Redo actions
  undoMeasurement: () => boolean; // Returns true if undo was successful
  redoMeasurement: () => boolean; // Returns true if redo was successful
  canUndo: () => boolean;
  canRedo: () => boolean;
  
  // Measurement templates
  saveMeasurementTemplate: (name: string, measurement: Measurement) => void;
  loadMeasurementTemplate: (name: string) => Measurement | null;
  getMeasurementTemplates: () => string[];
  deleteMeasurementTemplate: (name: string) => void;
  
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

const isDevEnvironment =
  (typeof process !== 'undefined' && process.env?.['NODE_ENV'] !== 'production') ||
  (typeof window !== 'undefined' && Boolean((window as { __STREETSPEC_DEV__?: boolean }).__STREETSPEC_DEV__));

interface TrimResult {
  trimmed: Measurement[];
  removed: number;
  effectiveLimit: number;
}

const normalizeLimit = (limit: number | undefined): number => {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) {
    return Number.POSITIVE_INFINITY;
  }

  if (limit < 0) {
    return 0;
  }

  return Math.floor(limit);
};

const trimMeasurementsArray = (
  measurements: Measurement[],
  limit: number | undefined
): TrimResult => {
  const normalizedLimit = normalizeLimit(limit);
  const effectiveLimit = Number.isFinite(normalizedLimit)
    ? normalizedLimit
    : measurements.length;

  if (normalizedLimit === 0) {
    return {
      trimmed: [],
      removed: measurements.length,
      effectiveLimit,
    };
  }

  if (!Number.isFinite(normalizedLimit) || measurements.length <= normalizedLimit) {
    return {
      trimmed: measurements.slice(),
      removed: 0,
      effectiveLimit,
    };
  }

  const overflow = measurements.length - normalizedLimit;

  return {
    trimmed: measurements.slice(overflow),
    removed: overflow,
    effectiveLimit,
  };
};

const notifyMeasurementsTrimmed = (removed: number, limit: number) => {
  if (removed <= 0) {
    return;
  }

  const measurementLabel = removed === 1 ? 'measurement' : 'measurements';

  pushNotification({
    kind: 'info',
    message: `Removed ${removed} older ${measurementLabel} to keep history within the limit of ${limit}.`,
  });
};

// Undo/Redo history management
const MAX_HISTORY_SIZE = 50;

function saveToHistory(state: RootState): void {
  const current: Measurement[] = JSON.parse(JSON.stringify(state.measurements));
  
  const lastState = current;

  // Add current state to past, clear future
  state.measurementHistory.past.push([...lastState]);
  state.measurementHistory.present = current;
  state.measurementHistory.future = [];

  // Limit history size
  if (state.measurementHistory.past.length > MAX_HISTORY_SIZE) {
    state.measurementHistory.past.shift();
  }
}

// Measurement templates storage (in-memory, could be persisted)
const measurementTemplates = new Map<string, Measurement>();

function getMeasurementTemplates(): string[] {
  return Array.from(measurementTemplates.keys());
}

function saveMeasurementTemplate(name: string, measurement: Measurement): void {
  // Create a copy without id/timestamp for template
  const template: Measurement = {
    ...measurement,
    id: uuidv4(), // New ID for template instance
    timestamp: Date.now(),
    name: name
  };
  measurementTemplates.set(name, template);
}

function loadMeasurementTemplate(name: string): Measurement | null {
  const template = measurementTemplates.get(name);
  if (!template) return null;
  
  // Return a copy with new ID and timestamp
  return {
    ...template,
    id: uuidv4(),
    timestamp: Date.now(),
    name: ''
  };
}

function deleteMeasurementTemplate(name: string): void {
  measurementTemplates.delete(name);
}

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
        measurementHistory: {
          past: [],
          present: [],
          future: []
        },
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
          state.settings = { ...state.settings, ...settings };
        }),

        updateSettings: async (updates) => {
          const state = get();
          const previousSettings = state.settings;
          const newSettings = { ...state.settings, ...updates };
          
          // Update local state
          set((state) => {
            Object.assign(state.settings, updates);
          });
          
          // Persist to Electron store
          if (window.electronAPI?.invoke) {
            try {
              const success = await window.electronAPI.invoke('save-settings', newSettings);
              if (!success) {
                pushNotification({ kind: 'error', message: 'Settings could not be saved.' });
                // Rollback on failure
                set((state) => {
                  state.settings = previousSettings;
                });
              }
            } catch (error) {
              set((draft) => { draft.settings = previousSettings; });
              pushNotification({ kind: 'error', message: 'Settings could not be saved.' });
              console.error('[store] Error saving settings:', error);
            }
          }
        },

        toggleUnit: () => {
          void get().updateSettings({ defaultUnit: get().settings.defaultUnit === 'metric' ? 'imperial' : 'metric' });
        },

        saveCurrentProject: async () => {
          const state = get();
          try {
            if (await window.electronAPI.invoke('save-measurements', state.measurements) !== true) throw new Error('Measurements were not saved');
            const project = state.currentProjectId ? state.projects[state.currentProjectId] : null;
            if (project) {
              const snapshot = { ...project, measurements: [...state.measurements] };
              if (await window.electronAPI.invoke('save-project', snapshot) !== true) throw new Error('Project was not saved');
              set(state => { if (state.projects[snapshot.id]) state.projects[snapshot.id] = snapshot; });
            }
            pushNotification({ kind: 'success', message: 'Measurements saved.' });
          } catch (error) {
            pushNotification({ kind: 'error', message: 'Save failed. Keep the app open and retry saving.' });
            console.error('[store] Save failed:', error);
          }
        },

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

        // Measurement actions with undo/redo support
        addMeasurement: (measurement) => set((state) => {
          saveToHistory(state);
          
          const newMeasurement: Measurement = {
            ...measurement,
            id: uuidv4(),
            timestamp: Date.now(),
            name: '',
          };
          state.measurements.push(newMeasurement);

          const { trimmed, removed, effectiveLimit } = trimMeasurementsArray(
            state.measurements,
            state.settings.measurementHistoryLimit
          );

          state.measurements = trimmed;
          state.measurementHistory.present = [...state.measurements];
          notifyMeasurementsTrimmed(removed, effectiveLimit);
        }),

        deleteMeasurement: (id) => set((state) => {
          saveToHistory(state);
          state.measurements = state.measurements.filter((m) => m.id !== id);
          state.measurementHistory.present = [...state.measurements];
        }),

        renameMeasurement: (id, newName) => set((state) => {
          saveToHistory(state);
          const measurement = state.measurements.find((m) => m.id === id);
          if (measurement) {
            measurement.name = newName;
            state.measurementHistory.present = [...state.measurements];
          }
        }),

        clearMeasurements: () => set((state) => {
          saveToHistory(state);
          state.measurements = [];
          state.measurementHistory.present = [];
        }),

        setMeasurements: (measurements) => set((state) => {
          state.measurements = [...measurements];
          state.measurementHistory = { past: [], present: [...measurements], future: [] };
        }),

        // Undo/Redo actions
        undoMeasurement: () => {
          const state = get();
          if (state.measurementHistory.past.length === 0) {
            return false;
          }

          set((state) => {
            const previous = state.measurementHistory.past.pop();
            if (previous) {
              state.measurementHistory.future.unshift(state.measurementHistory.present.slice() as any);
              state.measurementHistory.present = previous;
              state.measurements = previous.slice();
            }
          });

          pushNotification({
            kind: 'success',
            message: 'Measurement change undone',
            timeoutMs: 2000
          });
          return true;
        },

        redoMeasurement: () => {
          const state = get();
          if (state.measurementHistory.future.length === 0) {
            return false;
          }

          set((state) => {
            const next = state.measurementHistory.future.shift();
            if (next) {
              state.measurementHistory.past.push((state.measurementHistory.present as unknown as Measurement[]).slice());
              state.measurementHistory.present = next as any;
              state.measurements = (next as unknown as Measurement[]).slice();
            }
          });

          pushNotification({
            kind: 'success',
            message: 'Measurement change redone',
            timeoutMs: 2000
          });
          return true;
        },

        canUndo: () => {
          const state = get();
          return state.measurementHistory.past.length > 0;
        },

        canRedo: () => {
          const state = get();
          return state.measurementHistory.future.length > 0;
        },

        // Measurement template actions
        saveMeasurementTemplate: (name, measurement) => {
          saveMeasurementTemplate(name, measurement);
          pushNotification({
            kind: 'success',
            message: `Template "${name}" saved`,
            timeoutMs: 2000
          });
        },

        loadMeasurementTemplate: (name) => {
          const template = loadMeasurementTemplate(name);
          if (template) {
            const state = get();
            saveToHistory(state);
            set((state) => {
              state.measurements.push(template);
              state.measurementHistory.present = [...state.measurements];
            });
            pushNotification({
              kind: 'success',
              message: `Template "${name}" loaded`,
              timeoutMs: 2000
            });
          }
          return template;
        },

        getMeasurementTemplates: () => {
          return getMeasurementTemplates();
        },

        deleteMeasurementTemplate: (name) => {
          deleteMeasurementTemplate(name);
          pushNotification({
            kind: 'success',
            message: `Template "${name}" deleted`,
            timeoutMs: 2000
          });
        },

        // Project actions
        loadProjects: async () => {
          if (window.electronAPI?.invoke) {
            try {
              const projectsRaw = await window.electronAPI.invoke('get-projects');
              set((state) => {
                const sanitizedProjects: Record<string, Project> = {};

                if (projectsRaw && typeof projectsRaw === 'object' && !Array.isArray(projectsRaw)) {
                  const entries = Object.entries(projectsRaw as Record<string, any>);
                  
                  for (const [id, value] of entries) {
                    // Validate project ID
                    if (typeof id !== 'string' || id.length === 0 || id.length > 200) {
                      console.warn('[store] Skipping project with invalid ID:', id);
                      continue;
                    }
                    
                    // Validate project structure
                    if (!value || typeof value !== 'object') {
                      console.warn('[store] Skipping invalid project object:', id);
                      continue;
                    }
                    
                    const rawMeasurements = Array.isArray((value as any)?.measurements)
                      ? ((value as any).measurements as Measurement[])
                      : [];


                    const name = typeof (value as any)?.name === 'string' && (value as any).name.length <= 200
                      ? (value as any).name
                      : 'Untitled';
                    
                    const revisionHistory = Array.isArray((value as any)?.revisionHistory)
                      ? ((value as any).revisionHistory as Revision[])
                      : [];

                    sanitizedProjects[id] = {
                      id: typeof (value as any)?.id === 'string' && (value as any).id === id
                        ? (value as any).id
                        : id,
                      name,
                      measurements: rawMeasurements,
                      revisionHistory,
                    };
                  }
                } else {
                  console.warn('[store] Invalid projects data format received');
                }

                state.projects = sanitizedProjects;
              });
            } catch (error) {
              console.error('[store] Failed to load projects:', error);
              pushNotification({
                kind: 'error',
                message: 'Failed to load projects from storage.'
              });
            }
          }
        },

        createProject: async (name) => {
          const project: Project = { id: uuidv4(), name: name.trim(), measurements: [...get().measurements], revisionHistory: [] };
          try {
            if (await window.electronAPI.invoke('save-project', project) !== true) throw new Error('Storage rejected project');
            set(state => { state.projects[project.id] = project; state.currentProjectId = project.id; });
          } catch (error) {
            pushNotification({ kind: 'error', message: 'Project could not be created. Measurements are still in the workspace.' });
          }
        },

        loadProject: (id) => {
          const project = get().projects[id];
          if (!project) return;
          set(state => {
            state.measurements = [...project.measurements];
            state.currentProjectId = id;
            state.measurementHistory = { past: [], present: [...project.measurements], future: [] };
          });
        },

        deleteProject: async (id) => {
          try {
            if (await window.electronAPI.invoke('delete-project', id) !== true) throw new Error('Storage rejected deletion');
            set(state => {
              delete state.projects[id];
              if (state.currentProjectId === id) state.currentProjectId = null;
            });
          } catch (error) {
            pushNotification({ kind: 'error', message: 'Project could not be deleted.' });
          }
        },

        saveRevision: async () => {
          const { currentProjectId, projects, measurements } = get();
          const project = currentProjectId ? projects[currentProjectId] : null;
          if (!project) return;
          if (project.revisionHistory.length >= 100) {
            pushNotification({ kind: 'error', message: 'This project has 100 revisions. Create a new project to continue archiving without deleting existing revisions.' });
            return;
          }
          const updatedProject = { ...project, measurements: [...measurements], revisionHistory: [...project.revisionHistory, { timestamp: Date.now(), measurements: [...measurements] }] };
          try {
            if (await window.electronAPI.invoke('save-project', updatedProject) !== true) throw new Error('Storage rejected revision');
            set(state => { if (state.projects[project.id]) state.projects[project.id] = updatedProject; });
            pushNotification({ kind: 'success', message: 'Revision saved.' });
          } catch (error) {
            pushNotification({ kind: 'error', message: 'Revision could not be saved.' });
          }
        },

        revertToRevision: async (timestamp) => {
          const { currentProjectId, projects } = get();
          const project = currentProjectId ? projects[currentProjectId] : null;
          const revision = project?.revisionHistory.find(r => r.timestamp === timestamp);
          if (!project || !revision) return;
          const updatedProject = { ...project, measurements: [...revision.measurements] };
          try {
            if (await window.electronAPI.invoke('save-project', updatedProject) !== true) throw new Error('Storage rejected revision restore');
            set(state => {
              if (state.projects[project.id]) state.projects[project.id] = updatedProject;
              if (state.currentProjectId === project.id) {
                saveToHistory(state);
                state.measurements = [...revision.measurements];
                state.measurementHistory.present = [...revision.measurements];
              }
            });
          } catch (error) {
            pushNotification({ kind: 'error', message: 'Revision could not be restored.' });
          }
        },

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
                const { trimmed, removed, effectiveLimit } = trimMeasurementsArray(
                  importedState.measurements,
                  state.settings.measurementHistoryLimit
                );

                state.measurements = trimmed;
                notifyMeasurementsTrimmed(removed, effectiveLimit);
              }
              if (importedState.settings) {
                state.settings = { ...state.settings, ...importedState.settings };
              }
              if (importedState.projects && typeof importedState.projects === 'object') {
                const sanitizedProjects: Record<string, Project> = {};

                for (const [projectId, value] of Object.entries(importedState.projects as Record<string, any>)) {
                  const rawMeasurements = Array.isArray((value as any)?.measurements)
                    ? ((value as any).measurements as Measurement[])
                    : [];
                  const trimmed = rawMeasurements;

                  const name = typeof (value as any)?.name === 'string' ? (value as any).name : 'Untitled';
                  const revisionHistory = Array.isArray((value as any)?.revisionHistory)
                    ? ((value as any).revisionHistory as Revision[])
                    : [];

                  sanitizedProjects[projectId] = {
                    id: typeof (value as any)?.id === 'string' ? (value as any).id : projectId,
                    name,
                    measurements: trimmed,
                    revisionHistory,
                  };
                }

                state.projects = sanitizedProjects;
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
      enabled: isDevEnvironment,
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
