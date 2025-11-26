import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Loader } from '@googlemaps/js-api-loader';
import { useRootStore } from '../stores/rootStore';
import { useShallow } from 'zustand/react/shallow';
import { pushNotification } from '../stores/notificationStore';
import { calibrationManager } from '../services/depthCalibration';
import { pixelOffsetToVerticalAngle } from '../utils/cameraMath';
import { getCachedDepthMap, cacheDepthMap } from '../services/depth';
import { createDepthMapFetcher, generateDepthMap } from '../services/depthGeneration';
import { detectHorizonFromDepth } from '../services/geometry';
import {
  formatCsvRow,
  getDisplayValue,
  getSegmentSummary,
  type MeasurementDisplayValue
} from '../utils/measurementDisplay';
import type { UnitSystem } from '../utils/units';
import type { CameraParams, DepthDataFetchResult, Measurement } from '../types/common';

const getExportValue = (
  measurement: Measurement,
  defaultUnit: UnitSystem
): MeasurementDisplayValue => getDisplayValue(measurement, defaultUnit);

export const useAppLogic = (apiKey: string) => {
  const [isApiLoaded, setIsApiLoaded] = useState(false);
  const [depthFetchStatus, setDepthFetchStatus] = useState<DepthDataFetchResult | null>(null);
  const lastSavedMeasurements = useRef<string | null>(null);
  const lastSavedProjectId = useRef<string | null>(null);

  const store = useRootStore(useShallow((state) => ({
    // State values
    measurements: state.measurements,
    settings: state.settings,
    isSettingsOpen: state.isSettingsOpen,
    isGeneratingMap: state.isGeneratingMap,
    calibrateMode: state.calibrateMode,
    error: state.error,
    mapGenerationError: state.mapGenerationError,
    isProjectPanelOpen: state.isProjectPanelOpen,
    targetCoords: state.targetCoords,
    currentCameraParams: state.currentCameraParams,
    onnxDepthMap: state.onnxDepthMap,
    depthData: state.depthData,
    currentProjectId: state.currentProjectId,
    isCalibrated: state.isCalibrated,

    // Actions (these are stable references in Zustand)
    loadProjects: state.loadProjects,
    deleteMeasurement: state.deleteMeasurement,
    renameMeasurement: state.renameMeasurement,
    clearMeasurements: state.clearMeasurements,
    setSettings: state.setSettings,
    updateSettings: state.updateSettings,
    toggleUnit: state.toggleUnit,
    setIsSettingsOpen: state.setIsSettingsOpen,
    setIsGeneratingMap: state.setIsGeneratingMap,
    setCalibrateMode: state.setCalibrateMode,
    setError: state.setError,
    setMapGenerationError: state.setMapGenerationError,
    setIsPolylineToolActive: state.setIsPolylineToolActive,
    setIsAreaToolActive: state.setIsAreaToolActive,
    setIsVolumeToolActive: state.setIsVolumeToolActive,
    setIsProjectPanelOpen: state.setIsProjectPanelOpen,
    setCurrentCameraParams: state.setCurrentCameraParams,
    setOnnxDepthMap: state.setOnnxDepthMap,
    setDepthData: state.setDepthData,
    saveCurrentProject: state.saveCurrentProject,
    setTargetCoords: state.setTargetCoords,
    setIsCalibrated: state.setIsCalibrated,
  })));

  const {
    measurements,
    settings,
    isSettingsOpen,
    isGeneratingMap,
    calibrateMode,
    error,
    mapGenerationError,
    isProjectPanelOpen,
    targetCoords,
    currentCameraParams,
    onnxDepthMap,
    depthData,
    currentProjectId,
    isCalibrated,
    loadProjects,
    deleteMeasurement,
    renameMeasurement,
    clearMeasurements,
    setSettings,
    updateSettings,
    toggleUnit,
    setIsSettingsOpen,
    setIsGeneratingMap,
    setCalibrateMode,
    setError,
    setMapGenerationError,
    setIsPolylineToolActive,
    setIsAreaToolActive,
    setIsVolumeToolActive,
    setIsProjectPanelOpen,
    setCurrentCameraParams,
    setOnnxDepthMap,
    setDepthData,
    saveCurrentProject,
    setTargetCoords,
    setIsCalibrated,
  } = store;

  // Initialize store from Electron persistence on mount
  useEffect(() => {
    const initializeStore = async () => {
      if (!window.electronAPI?.invoke) return;

      try {
        // Load settings from Electron store
        const persistedSettings = await window.electronAPI.invoke('get-settings');
        if (persistedSettings && typeof persistedSettings === 'object') {
          setSettings(persistedSettings as typeof settings);
        }

        // Load projects
        if (loadProjects) {
          await loadProjects();
        }
      } catch (error) {
        console.error('[app] Failed to initialize store from Electron:', error);
        pushNotification({
          kind: 'error',
          message: 'Failed to load saved data. Some settings may be reset.'
        });
      }
    };

    void initializeStore();
  }, [loadProjects, setSettings]);


  // Load Google Maps API
  useEffect(() => {
    const key = apiKey || (typeof import.meta !== 'undefined' ? (import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY : undefined) || (window as any).electronAPI?.getEnv()?.VITE_GOOGLE_MAPS_API_KEY;
    console.debug('[maps] Loader init key present?', Boolean(key), 'apiKey prop?', Boolean(apiKey), 'env?', (import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY ? 'set' : 'empty');
    if (!key) {
      setError("Error: Google Maps API Key is missing. Please check your .env file.");
      return;
    }
    setError(null);
    const loader = new Loader({
      apiKey: key,
      version: "quarterly",
      libraries: ["places", "geometry"],
      language: 'en',
      region: 'US'
    });

    loader.load().then(() => {
      setIsApiLoaded(true);
    }).catch(() => {
      setError("Failed to load Google Maps. Please check the console and API Key.");
    });
  }, [apiKey, setError]);

  // Default address center once the API is ready
  useEffect(() => {
    if (!isApiLoaded || targetCoords) {
      return;
    }
    try {
      if (typeof google !== 'undefined' && google.maps?.Geocoder) {
        const geocoder = new google.maps.Geocoder();
        geocoder.geocode({ address: '715 Maple St, Collinsville, IL 62234' }, (results, status) => {
          if (status === 'OK' && results && results[0]?.geometry?.location) {
            const loc = results[0]!.geometry!.location!;
            setTargetCoords({ lat: loc.lat(), lng: loc.lng() });
          }
        });
      }
    } catch {
      // ignore geocode fallback errors
    }
  }, [isApiLoaded, targetCoords, setTargetCoords]);

  // Apply theme when settings change
  useEffect(() => {
    const applyTheme = () => {
      const root = document.documentElement;
      let theme = settings.theme;

      if (theme === 'system') {
        theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }

      root.setAttribute('data-theme', theme);
    };

    applyTheme();

    // Listen for system theme changes
    if (settings.theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = () => applyTheme();
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
    return undefined;
  }, [settings.theme]);

  // Auto-save measurements when they change
  useEffect(() => {
    if (!settings.autoSave || !window.electronAPI?.invoke) {
      return;
    }

    const measurementSignature = JSON.stringify(
      measurements.map((m) => ({
        id: m.id,
        kind: m.kind,
        updatedAt: m.timestamp,
        value: m.distanceMeters ?? m.areaSquareMeters ?? m.volumeCubicMeters ?? 0,
        points: m.points?.length ?? 0,
      }))
    );

    if (
      lastSavedMeasurements.current === measurementSignature &&
      lastSavedProjectId.current === (currentProjectId ?? null)
    ) {
      return;
    }

    lastSavedMeasurements.current = measurementSignature;
    lastSavedProjectId.current = currentProjectId ?? null;

    const saveMeasurements = async () => {
      try {
        await window.electronAPI.invoke('save-measurements', measurements);
        if (currentProjectId) {
          saveCurrentProject();
        }
      } catch {
        // Silent error handling for production
      }
    };

    void saveMeasurements();
  }, [measurements, settings.autoSave, currentProjectId, saveCurrentProject]);

  // Update App state when MapView camera changes
  const handleCameraChange = useCallback((params: CameraParams) => {

    // Prevent infinite loops by checking if params actually changed
    const merged = {
      ...params,
      calibrationPitchOffsetDeg: settings.calibrationPitchOffsetDeg ?? 0,
      cameraHeight: params.cameraHeight ?? settings.cameraHeight ?? 2.5,
    };

    const hasChanged =
      !currentCameraParams ||
      merged.panoId !== currentCameraParams.panoId ||
      merged.lat !== currentCameraParams.lat ||
      merged.lng !== currentCameraParams.lng ||
      merged.heading !== currentCameraParams.heading ||
      merged.pitch !== currentCameraParams.pitch ||
      merged.zoom !== currentCameraParams.zoom ||
      merged.fov !== currentCameraParams.fov ||
      merged.vFov !== currentCameraParams.vFov ||
      merged.calibrationPitchOffsetDeg !== currentCameraParams.calibrationPitchOffsetDeg ||
      merged.cameraHeight !== currentCameraParams.cameraHeight;

    if (!hasChanged) {
      return;
    }

    if (params.panoId !== currentCameraParams?.panoId) {
      setIsCalibrated(false);
      updateSettings({ calibrationPitchOffsetDeg: 0 });
    }

    setCurrentCameraParams(merged);
  }, [settings.calibrationPitchOffsetDeg, settings.cameraHeight, setCurrentCameraParams, currentCameraParams, updateSettings, setIsCalibrated]);

  const handleCalibrateClick = useCallback((pixelY: number, viewH: number) => {
     if (
       !currentCameraParams ||
       !currentCameraParams.vFov ||
       currentCameraParams.pitch === undefined
     ) {
       setCalibrateMode(false);
       return;
     }
     const verticalFov = currentCameraParams.vFov;
     const angle = pixelOffsetToVerticalAngle(pixelY, viewH, verticalFov);
     const offset = -(currentCameraParams.pitch + angle);
     const newSettings = { ...settings, calibrationPitchOffsetDeg: offset };
     updateSettings({ calibrationPitchOffsetDeg: offset });
     window.electronAPI?.invoke('save-settings', newSettings).catch(() => {});
     setCalibrateMode(false);
     setIsCalibrated(true);
    pushNotification({
      kind: 'success',
      message: `Manual calibration saved. Pitch offset ${offset.toFixed(2)} deg.`,
    });
  }, [currentCameraParams, settings, updateSettings, setCalibrateMode, setIsCalibrated]);

  const handleAutoCalibrate = useCallback(async () => {
    if (!currentCameraParams || (!depthData && !onnxDepthMap)) {
      pushNotification({
        kind: 'warning',
        message: 'Auto-calibration requires depth data. Please generate a depth map first.',
      });
      return;
    }

    try {
      // Measure the current Street View viewport
      const mapViewElement = document.querySelector('[data-testid="map-view"]') as HTMLElement | null;
      const viewWidth = mapViewElement?.clientWidth ?? 800;
      const viewHeight = mapViewElement?.clientHeight ?? 600;

      let result = depthData
        ? detectHorizonFromDepth(depthData, currentCameraParams, viewWidth, viewHeight, onnxDepthMap, true)
        : { detected: false, confidence: 0, pitchOffset: 0, method: 'fallback' as const };

      // Fallback: estimate pitch using ONNX depth gradient when Street View planes are unavailable
      if ((!result.detected || result.confidence < 0.4) && onnxDepthMap) {
        try {
          // Simple heuristic: horizon tends to align where vertical gradient magnitude is minimal across rows.
          const h = onnxDepthMap.height;
          const w = onnxDepthMap.width;
          const data = onnxDepthMap.data;
          let bestRow = Math.floor(h / 2);
          let bestScore = Number.POSITIVE_INFINITY;
          for (let y = Math.floor(h * 0.25); y < Math.floor(h * 0.75); y += 2) {
            let sum = 0;
            for (let x = 1; x < w; x += 2) {
              const i = y * w + x;
              if (i >= data.length) continue;
              const current = data[i]!;
              const left = i > 0 ? data[i - 1]! : current;
              const dx = current - left;
              sum += Math.abs(dx);
            }
            if (sum < bestScore) {
              bestScore = sum;
              bestRow = y;
            }
          }
          const vFov = currentCameraParams.vFov ?? 60;
          const angle = pixelOffsetToVerticalAngle(bestRow, h, vFov);
          const pitchOffset = -(currentCameraParams.pitch ?? 0) - angle;
          result = { detected: true, confidence: 0.45, pitchOffset, method: 'depth' } as any;
        } catch {
          // ignore fallback errors
        }
      }

      if (result.detected && result.confidence > 0.5) {
        // Persist per-zoom bias entry with interpolation support
        const zoomKey = Math.max(0, Math.min(4, Math.round(currentCameraParams.zoom ?? 1)));
        const calibrationBiasByZoom = { ...(settings.calibrationBiasByZoom ?? {}) } as Record<number, number>;
        calibrationBiasByZoom[zoomKey] = result.pitchOffset;
        
        // Also store at fractional zoom levels for smoother interpolation
        const fractionalZoom = currentCameraParams.zoom ?? 1;
        if (Math.abs(fractionalZoom - zoomKey) > 0.1) {
          const fractionalKey = Math.round(fractionalZoom * 10) / 10;
          calibrationBiasByZoom[fractionalKey] = result.pitchOffset;
        }
        
        const newSettings = { ...settings, calibrationPitchOffsetDeg: result.pitchOffset, calibrationBiasByZoom } as typeof settings;
        updateSettings({ calibrationPitchOffsetDeg: result.pitchOffset, calibrationBiasByZoom });
        await window.electronAPI?.invoke('save-settings', newSettings);
        setIsCalibrated(true);
        pushNotification({
          kind: 'success',
          title: 'Auto calibration complete',
          message: `Pitch offset ${result.pitchOffset.toFixed(2)} deg (confidence ${(result.confidence * 100).toFixed(0)}%) at zoom ${zoomKey}.`,
        });
      } else {
        pushNotification({
          kind: 'warning',
          title: 'Auto calibration failed',
          message: `Confidence too low (${(result.confidence * 100).toFixed(0)}%). Try manual calibration or add more depth data.`,
        });
      }
    } catch (error) {
      console.error('Auto-calibration error:', error);
      pushNotification({
        kind: 'error',
        title: 'Auto calibration error',
        message: 'Auto-calibration failed. Please try manual calibration.',
      });
    }
  }, [currentCameraParams, depthData, onnxDepthMap, settings, updateSettings, setIsCalibrated]);

  // Fetch Street View depth data when pano changes
  useEffect(() => {
    let cancelled = false;

    const fetchDepthData = async () => {
      if (!currentCameraParams?.panoId || !window.electronAPI?.invoke) {
        if (!cancelled) {
          setDepthData(null);
          setDepthFetchStatus(null);
        }
        return;
      }

      try {
        const result = await window.electronAPI.invoke('fetch-depth-data', {
          panoId: currentCameraParams.panoId,
          maxRetries: settings.depthApiMaxRetries
        }) as DepthDataFetchResult;

        if (cancelled) {
          return;
        }

        if (!result) {
          setDepthData(null);
          setDepthFetchStatus(null);
          return;
        }

        if (result.status === 'success') {
          setDepthData(result.data);
          setDepthFetchStatus(null);
          return;
        }

        setDepthData(null);

        if (result.status === 'rate-limit') {
          const waitSeconds = result.retryAfterMs ? Math.ceil(result.retryAfterMs / 1000) : undefined;
          const message = waitSeconds && Number.isFinite(waitSeconds)
            ? `Street View depth API rate limit reached. Try again in about ${waitSeconds} second${waitSeconds === 1 ? '' : 's'}.`
            : 'Street View depth API rate limit reached. Please wait before retrying.';
          setDepthFetchStatus({
            status: 'rate-limit',
            code: 'RATE_LIMIT',
            message,
            retryAfterMs: result.retryAfterMs,
            attempts: result.attempts,
          });
          return;
        }

        const attempts = result.attempts;

        if (result.code === 'NOT_FOUND') {
          setDepthFetchStatus({
            status: 'error',
            code: 'NOT_FOUND',
            message: 'No Street View depth data is available for this panorama.',
            attempts,
            details: result.details,
          });
          return;
        }

        if (result.code === 'NO_API_KEY') {
          setDepthFetchStatus({
            status: 'error',
            code: 'NO_API_KEY',
            message: 'Street View depth requests require GOOGLE_MAPS_API_KEY to be configured.',
            attempts,
            details: result.details,
          });
          return;
        }

        if (result.code === 'NETWORK_ERROR') {
          setDepthFetchStatus({
            status: 'error',
            code: 'NETWORK_ERROR',
            message: 'Network issue while requesting Street View depth data. Measurements will use ONNX depth only until retry succeeds.',
            attempts,
            details: result.details,
          });
          return;
        }

        setDepthFetchStatus({
          status: 'error',
          code: result.code,
          message: result.message ?? 'Unable to fetch Street View depth data. Falling back to ONNX depth only.',
          attempts,
          details: result.details,
        });
      } catch (err) {
        if (cancelled) {
          return;
        }
        console.warn('[depth] Failed to fetch Street View depth data:', err);
        setDepthData(null);
        setDepthFetchStatus({
          status: 'error',
          code: 'UNKNOWN_ERROR',
          message: 'Unexpected error requesting Street View depth data.',
          attempts: 0,
          details: err instanceof Error ? { message: err.message } : err,
        });
      }
    };

    fetchDepthData();

    return () => {
      cancelled = true;
    };
  }, [currentCameraParams?.panoId, settings.depthApiMaxRetries, setDepthData]);

  // Depth Map Generation Logic
  const [depthGenProgress, setDepthGenProgress] = useState<{ stage: 'fetching' | 'processing' | 'complete'; quality?: 'low' | 'medium' | 'high' } | undefined>();

  const handleGenerateDepthMap = useCallback(async () => {
    if (!currentCameraParams || !apiKey || isGeneratingMap) {
      return;
    }

    setIsGeneratingMap(true);
    setMapGenerationError(null);
    setDepthGenProgress({ stage: 'fetching', quality: 'high' });

    try {
      const mapViewElement = document.querySelector('[data-testid="map-view"]') as HTMLElement | null;
      const viewportWidth = mapViewElement?.clientWidth;
      const viewportHeight = mapViewElement?.clientHeight;

      const deps = {
        fetchImage: createDepthMapFetcher(),
        getCachedDepthMap,
        cacheDepthMap,
        invokeDepth: async (base64data: string) => {
          if (!window.electronAPI?.invoke) {
            throw new Error('Electron IPC not available');
          }
          setDepthGenProgress({ stage: 'processing', quality: 'high' });
          const result = await window.electronAPI.invoke('infer-depth', base64data);
          if (!result) {
            throw new Error('Depth inference returned null');
          }
          return result;
        }
      };

      const result = await generateDepthMap(currentCameraParams, apiKey, deps, {
        enableCache: true,
        quality: 'high',
        progressive: false,
        viewportWidth,
        viewportHeight,
        onProgress: (progress) => {
          setDepthGenProgress(progress);
        }
      });

      setOnnxDepthMap(result.depthMap);
      setMapGenerationError(null);
      setDepthGenProgress({ stage: 'complete', quality: 'high' });
      
      // Clear progress after brief delay
      setTimeout(() => setDepthGenProgress(undefined), 2000);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      setMapGenerationError(errorMessage);
      setDepthGenProgress(undefined);
      
      // Show user-friendly error notification
      pushNotification({
        kind: 'error',
        title: 'Depth Map Generation Failed',
        message: `Failed to generate depth map: ${errorMessage}. Please try again or check your connection.`,
        timeoutMs: 10000
      });
    } finally {
      setIsGeneratingMap(false);
    }
  }, [currentCameraParams, apiKey, isGeneratingMap, setIsGeneratingMap, setOnnxDepthMap, setMapGenerationError]);

  const handleClearMeasurements = useCallback(async () => {
    clearMeasurements();
    if (window.electronAPI?.invoke) {
      try {
        await window.electronAPI.invoke('clear-data');
        // Also save to current project if one is active
        if (currentProjectId) {
          saveCurrentProject();
        }
      } catch (error) {
        // Silent error handling for production
      }
    }
  }, [clearMeasurements, currentProjectId, saveCurrentProject]);

  const handleUnitToggle = useCallback(() => {
    toggleUnit();
    if (window.electronAPI?.invoke) {
      const updatedSettings = useRootStore.getState().settings;
      window.electronAPI.invoke('save-settings', updatedSettings).catch(() => {
        // Silent error handling for production
      });
    }
  }, [toggleUnit]);

  const handleSaveSettingsPanel = useCallback(async (newSettings: any) => {
    setSettings(newSettings);
    if (window.electronAPI?.invoke) {
      try {
        await window.electronAPI.invoke('save-settings', newSettings);
      } catch {
        // silent
      }
    }
    // If auto-calibration toggled on, reset samples to fit fresh scene context
    if (newSettings.autoCalibrateDepth) {
      calibrationManager.reset();
    }
    setIsSettingsOpen(false);
  }, [setSettings, setIsSettingsOpen]);

  const handleExportCSV = useCallback(async () => {
    if (measurements.length === 0) {
      pushNotification({
        kind: 'info',
        message: 'No measurements available to export.',
      });
      return;
    }

    const header = [
      'ID',
      'Timestamp',
      'Type',
      'Label',
      'Name',
      'Value',
      'Display Unit',
      'Unit System',
      'DistanceMeters',
      'AreaSquareMeters',
      'VolumeCubicMeters',
      'PerimeterMeters',
      'SegmentsMeters',
      'StartX',
      'StartY',
      'EndX',
      'EndY',
      'Source',
      'Confidence'
    ].join(',');
    const rows = measurements.map((m) => {
      const display = getExportValue(m, settings.defaultUnit);
      const valueString =
        display.value !== undefined && Number.isFinite(display.value)
          ? display.value.toFixed(3)
          : '';
      const segmentSummary = getSegmentSummary(m);

      const raw = [
        m.id,
        new Date(m.timestamp).toISOString(),
        m.kind,
        m.label,
        m.name ?? '',
        valueString,
        display.unitLabel,
        display.unitSystem,
        m.distanceMeters ?? '',
        m.areaSquareMeters ?? '',
        m.volumeCubicMeters ?? '',
        m.perimeterMeters ?? '',
        segmentSummary,
        m.startPoint.x,
        m.startPoint.y,
        m.endPoint.x,
        m.endPoint.y,
        m.source ?? '',
        m.confidence !== undefined ? m.confidence.toFixed(2) : ''
      ];

      return formatCsvRow(raw);
    });
    const csvContent = [header, ...rows].join('\n');

    try {
      if (window.electronAPI && typeof window.electronAPI.invoke === 'function') {
        const filePath = await window.electronAPI.invoke('csv-export', csvContent);
        if (filePath) {
          pushNotification({
            kind: 'success',
            title: 'Export complete',
            message: `Measurements saved to ${filePath}`,
            timeoutMs: 8000,
          });
        }
      } else {
        pushNotification({
          kind: 'error',
          title: 'Export failed',
          message: 'Unable to communicate with the main process.',
        });
      }
    } catch (error) {
      pushNotification({
        kind: 'error',
        title: 'Export failed',
        message: error instanceof Error ? error.message : 'Unexpected export error.',
      });
    }
  }, [measurements, settings.defaultUnit]);

  return useMemo(() => ({
    // State
    isApiLoaded,
    isCalibrated,
    depthFetchStatus,

    // Handlers
    handleCameraChange,
    handleCalibrateClick,
    handleAutoCalibrate,
    handleGenerateDepthMap,
    handleClearMeasurements,
    handleUnitToggle,
    handleSaveSettingsPanel,
    handleExportCSV,

    // Props for components
    measurements,
    settings,
    isSettingsOpen,
    isGeneratingMap,
    calibrateMode,
    error,
    mapGenerationError,
    isProjectPanelOpen,
    targetCoords,
    currentCameraParams,
    onnxDepthMap,
    depthData,
    depthGenProgress,

    // Actions
    setIsSettingsOpen,
    setCalibrateMode,
    setIsPolylineToolActive,
    setIsAreaToolActive,
    setIsVolumeToolActive,
    setIsProjectPanelOpen,
    deleteMeasurement,
    renameMeasurement,
  }), [
    isApiLoaded,
    isCalibrated,
    depthFetchStatus,
    measurements,
    settings,
    isSettingsOpen,
    isGeneratingMap,
    calibrateMode,
    error,
    mapGenerationError,
    isProjectPanelOpen,
    targetCoords,
    currentCameraParams,
    onnxDepthMap,
    depthData,
    depthGenProgress,
    deleteMeasurement,
    renameMeasurement,
    handleAutoCalibrate,
    handleCalibrateClick,
    handleCameraChange,
    handleClearMeasurements,
    handleExportCSV,
    handleGenerateDepthMap,
    handleSaveSettingsPanel,
    handleUnitToggle,
    setCalibrateMode,
    setIsAreaToolActive,
    setIsPolylineToolActive,
    setIsProjectPanelOpen,
    setIsVolumeToolActive,
    setIsSettingsOpen,
  ]);
};
