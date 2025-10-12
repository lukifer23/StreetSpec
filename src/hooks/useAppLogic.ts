import { useState, useEffect, useCallback } from 'react';
import { Loader } from '@googlemaps/js-api-loader';
import { useRootStore } from '../stores/rootStore';
import { calibrationManager } from '../services/depthCalibration';
import { pixelOffsetToVerticalAngle } from '../utils/cameraMath';
import { getCachedDepthMap, cacheDepthMap } from '../services/depth';
import { createDepthMapFetcher, generateDepthMap } from '../services/depthGeneration';
import { detectHorizonFromDepth } from '../services/geometry';
import { convertLengthToDisplay, convertAreaToDisplay, convertVolumeToDisplay } from '../utils/units';
import type { CameraParams, DepthDataFetchResult, Measurement } from '../types/common';

const getExportValue = (measurement: Measurement) => {
  switch (measurement.kind) {
    case 'distance':
    case 'polyline':
      return convertLengthToDisplay(measurement.distanceMeters, measurement.unit);
    case 'area':
      return convertAreaToDisplay(measurement.areaSquareMeters, measurement.unit);
    case 'volume':
      return convertVolumeToDisplay(measurement.volumeCubicMeters, measurement.unit);
    default:
      return { value: undefined, unitLabel: measurement.unit === 'imperial' ? 'imperial' : 'metric' };
  }
};

const getExportSegments = (measurement: Measurement) => {
  const meta = measurement.metadata as { segmentDistancesMeters?: unknown } | undefined;
  const segments = meta?.segmentDistancesMeters;
  if (!Array.isArray(segments) || segments.length === 0) {
    return '';
  }
  return segments
    .map((segment) => (typeof segment === 'number' && Number.isFinite(segment) ? segment.toFixed(3) : ''))
    .filter(Boolean)
    .join('|');
};

const escapeCsv = (value: string) => `"${value.replace(/"/g, '""')}"`;

export const useAppLogic = (apiKey: string) => {
  const [isApiLoaded, setIsApiLoaded] = useState(false);
  const [isCalibrated, setIsCalibrated] = useState(false);
  const [depthFetchStatus, setDepthFetchStatus] = useState<DepthDataFetchResult | null>(null);

  const {
    measurements,
    addMeasurement,
    deleteMeasurement,
    renameMeasurement,
    clearMeasurements,
    settings,
    setSettings,
    updateSettings,
    toggleUnit,
    isSettingsOpen,
    isGeneratingMap,
    calibrateMode,
    error,
    mapGenerationError,
    setIsSettingsOpen,
    setIsGeneratingMap,
    setCalibrateMode,
    setError,
    setMapGenerationError,
    setIsPolylineToolActive,
    setIsAreaToolActive,
    setIsVolumeToolActive,
    isProjectPanelOpen,
    setIsProjectPanelOpen,
    targetCoords,
    currentCameraParams,
    onnxDepthMap,
    setCurrentCameraParams,
    setOnnxDepthMap,
    setDepthData,
    depthData
  } = useRootStore();

  // Load Google Maps API
  useEffect(() => {
    if (!apiKey) {
      setError("Error: Google Maps API Key is missing. Please check your .env file.");
      return;
    }
    setError(null);
    const loader = new Loader({
      apiKey: apiKey,
      version: "quarterly",
      libraries: ["places", "geometry"]
    });

    loader.load().then(() => {
      setIsApiLoaded(true);
    }).catch(() => {
      setError("Failed to load Google Maps. Please check the console and API Key.");
    });
  }, [apiKey, setError]);

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
  }, [settings.theme]);

  // Auto-save measurements when they change
  useEffect(() => {
    if (settings.autoSave && window.electronAPI?.invoke) {
      const saveMeasurements = async () => {
        try {
          await window.electronAPI.invoke('save-measurements', measurements);
        } catch (error) {
          // Silent error handling for production
        }
      };

      saveMeasurements();
    }
  }, [measurements, settings.autoSave]);

  // Update App state when MapView camera changes
  const handleCameraChange = useCallback((params: CameraParams) => {
    if (params.panoId !== currentCameraParams?.panoId) {
      setIsCalibrated(false);
      updateSettings({ calibrationPitchOffsetDeg: 0 });
    }

    const merged = {
      ...params,
      calibrationPitchOffsetDeg: settings.calibrationPitchOffsetDeg ?? 0,
      cameraHeight: params.cameraHeight ?? settings.cameraHeight ?? 2.5,
    };
    setCurrentCameraParams(merged);
  }, [settings.calibrationPitchOffsetDeg, settings.cameraHeight, setCurrentCameraParams, currentCameraParams?.panoId, updateSettings]);

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
    alert(`Manual calibration saved. Pitch offset ${offset.toFixed(2)} deg`);
  }, [currentCameraParams, settings, updateSettings, setCalibrateMode]);

  const handleAutoCalibrate = useCallback(async () => {
    if (!currentCameraParams || !depthData || !onnxDepthMap) {
      alert('Auto-calibration requires depth data. Please generate depth map first.');
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
        alert(`Auto-calibration successful! Pitch offset ${result.pitchOffset.toFixed(2)} deg (confidence: ${(result.confidence * 100).toFixed(0)}%)`);
      } else {
        alert(`Auto-calibration failed. Confidence too low (${(result.confidence * 100).toFixed(0)}%). Please try manual calibration.`);
      }
    } catch (error) {
      console.error('Auto-calibration error:', error);
      alert('Auto-calibration failed. Please try manual calibration.');
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
          setDepthFetchStatus({ type: 'error', message } as any);
          return;
        }

        if (result.code === 'NOT_FOUND') {
          setDepthFetchStatus({ type: 'warning', message: 'No Street View depth data is available for this panorama.' } as any);
          return;
        }

        if (result.code === 'NO_API_KEY') {
          setDepthFetchStatus({ type: 'error', message: 'Street View depth requests require GOOGLE_MAPS_API_KEY to be configured.' } as any);
          return;
        }

        if (result.code === 'NETWORK_ERROR') {
          setDepthFetchStatus({ type: 'warning', message: 'Network issue while requesting Street View depth data. Measurements will use ONNX depth only until retry succeeds.' } as any);
          return;
        }

        setDepthFetchStatus({ type: 'error', message: 'Unable to fetch Street View depth data. Falling back to ONNX depth only.' } as any);
      } catch (err) {
        if (cancelled) {
          return;
        }
        console.warn('[depth] Failed to fetch Street View depth data:', err);
        setDepthData(null);
        setDepthFetchStatus({ type: 'error', message: 'Unexpected error requesting Street View depth data.' } as any);
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
      });

      if (fromCache) {
        console.log('[depth] Using cached depth map');
      }

      setOnnxDepthMap(depthMap);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to generate depth map';
      setMapGenerationError(errorMessage);
    } finally {
      setIsGeneratingMap(false);
    }
  }, [currentCameraParams, apiKey, isGeneratingMap, setIsGeneratingMap, setMapGenerationError, setOnnxDepthMap]);

  const handleClearMeasurements = useCallback(async () => {
    clearMeasurements();
    if (window.electronAPI?.invoke) {
      try {
        await window.electronAPI.invoke('clear-data');
      } catch (error) {
        // Silent error handling for production
      }
    }
  }, [clearMeasurements]);

  const handleUnitToggle = useCallback(() => {
    toggleUnit();
    if (window.electronAPI?.invoke) {
      window.electronAPI.invoke('save-settings', settings).catch(() => {
        // Silent error handling for production
      });
    }
  }, [toggleUnit, settings]);

  const handleSaveSettingsPanel = async (newSettings: any) => {
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
  };

  const handleExportCSV = useCallback(async () => {
    if (measurements.length === 0) {
      alert("No measurements to export.");
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
      const display = getExportValue(m);
      const valueString =
        display.value !== undefined && Number.isFinite(display.value)
          ? display.value.toFixed(3)
          : '';
      const segmentSummary = getExportSegments(m);

      const raw = [
        m.id,
        new Date(m.timestamp).toISOString(),
        m.kind,
        m.label,
        m.name ?? '',
        valueString,
        display.unitLabel,
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

      return raw.map((value) => escapeCsv(String(value ?? ''))).join(',');
    });
    const csvContent = [header, ...rows].join('\n');

    try {
      if (window.electronAPI && typeof window.electronAPI.invoke === 'function') {
        const filePath = await window.electronAPI.invoke('csv-export', csvContent);
        if (filePath) {
          alert(`Measurements exported successfully to: ${filePath}`);
        }
      } else {
        alert("Export failed: Cannot communicate with the main process.");
      }
    } catch (error) {
      alert(`Export failed: ${error}`);
    }
  }, [measurements]);

  return {
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
  };
};
