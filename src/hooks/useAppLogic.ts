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
  const [isCalibrated, setIsCalibrated] = useState(false);
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
  } = store;

  useEffect(() => {
    if (loadProjects) {
      void loadProjects();
    }
  }, [loadProjects]);


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
  }, [settings.calibrationPitchOffsetDeg, settings.cameraHeight, setCurrentCameraParams, currentCameraParams, updateSettings]);

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
  }, [currentCameraParams, settings, updateSettings, setCalibrateMode]);

  const handleAutoCalibrate = useCallback(async () => {
    if (!currentCameraParams || !depthData || !onnxDepthMap) {
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

      const result = detectHorizonFromDepth(depthData, currentCameraParams, viewWidth, viewHeight);

      if (result.detected && result.confidence > 0.5) {
        const newSettings = { ...settings, calibrationPitchOffsetDeg: result.pitchOffset };
        updateSettings({ calibrationPitchOffsetDeg: result.pitchOffset });
        await window.electronAPI?.invoke('save-settings', newSettings);
        setIsCalibrated(true);
        pushNotification({
          kind: 'success',
          title: 'Auto calibration complete',
          message: `Pitch offset ${result.pitchOffset.toFixed(2)} deg (confidence ${(result.confidence * 100).toFixed(0)}%).`,
        });
      } else {
        pushNotification({
          kind: 'warning',
          title: 'Auto calibration failed',
          message: `Confidence too low (${(result.confidence * 100).toFixed(0)}%). Try manual calibration.`,
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
  }, [currentCameraParams, depthData, onnxDepthMap, settings, updateSettings]);

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
  const handleGenerateDepthMap = useCallback(async () => {
    if (!currentCameraParams || !apiKey || isGeneratingMap) {
      if (!currentCameraParams) {
        pushNotification({
          kind: 'error',
          message: 'No camera parameters available. Please wait for the Street View panorama to load.',
        });
      } else if (!apiKey) {
        pushNotification({
          kind: 'error',
          message: 'Google Maps API key is missing. Check the .env configuration.',
        });
      } else if (isGeneratingMap) {
        pushNotification({
          kind: 'info',
          message: 'Depth map generation is already in progress.',
        });
      }
      return;
    }

    // Validate camera parameters
    if (!currentCameraParams.panoId && (!currentCameraParams.lat || !currentCameraParams.lng)) {
      pushNotification({
        kind: 'error',
        message: 'Invalid location data. Please try a different location.',
      });
      return;
    }

    setIsGeneratingMap(true);
    setMapGenerationError(null);
    setOnnxDepthMap(null);

    try {
      const fetchImage = createDepthMapFetcher();
      const { depthMap, fromCache } = await generateDepthMap(currentCameraParams, apiKey, {
        fetchImage,
        getCachedDepthMap,
        cacheDepthMap,
        invokeDepth: async (base64data) => {
          if (!window.electronAPI?.invoke) {
            throw new Error('IPC invoke function not available. Please restart the application.');
          }

          try {
            return await window.electronAPI.invoke('infer-depth', base64data);
          } catch (err) {
            throw err instanceof Error ? err : new Error('Depth inference failed');
          }
        }
      }, {
        quality: settings.depthQuality,
        enableCache: settings.enableDepthCache
      });

      if (fromCache) {
        console.log('[depth] Using cached depth map');
      }

      setOnnxDepthMap(depthMap);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to generate depth map';

      // Provide more specific error messages based on error type
      let userMessage = errorMessage;
      if (errorMessage.includes('API key')) {
        userMessage = 'Google Maps API key error. Please check your API key configuration.';
      } else if (errorMessage.includes('network') || errorMessage.includes('fetch')) {
        userMessage = 'Network error. Please check your internet connection and try again.';
      } else if (errorMessage.includes('timeout')) {
        userMessage = 'Request timed out. The location might be too remote or the service unavailable.';
      } else if (errorMessage.includes('Static API')) {
        userMessage = 'Street View image unavailable. This location might not have Street View coverage.';
      }

      setMapGenerationError(userMessage);
      console.error('[depth] Generation failed:', error);
    } finally {
      setIsGeneratingMap(false);
    }
  }, [currentCameraParams, apiKey, isGeneratingMap, setIsGeneratingMap, setMapGenerationError, setOnnxDepthMap, settings.depthQuality, settings.enableDepthCache]);

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
