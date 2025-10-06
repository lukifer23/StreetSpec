import React, { useState, useEffect, useCallback } from 'react';
import { Loader } from '@googlemaps/js-api-loader';
import MapView from './components/MapView';
import SearchBox from './components/SearchBox';
import MeasurementTool from './components/MeasurementTool';
import SettingsPanel from './components/SettingsPanel';
import { CameraParams, Measurement, AppSettings, DepthDataFetchResult } from './types/common';
import { calibrationManager } from './services/depthCalibration';
import { getCachedDepthMap, cacheDepthMap } from './services/depth';
import { createDepthMapFetcher, generateDepthMap } from './services/depthGeneration';
import styles from './App.module.css';
import './App.css';

import { useRootStore } from './stores/rootStore';
import PolylineTool from './components/PolylineTool';
import ProjectPanel from './components/ProjectPanel';

// Tooltip component for better UX
const Tooltip: React.FC<{ text: string; children: React.ReactNode }> = ({ text, children }) => {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div 
      style={{ position: 'relative', display: 'inline-block' }}
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
    >
      {children}
      {isVisible && (
        <div style={{
          position: 'absolute',
          bottom: '100%',
          left: '50%',
          transform: 'translateX(-50%)',
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          color: 'white',
          padding: '8px 12px',
          borderRadius: '4px',
          fontSize: '12px',
          whiteSpace: 'nowrap',
          zIndex: 1000,
          marginBottom: '8px',
          pointerEvents: 'none'
        }}>
          {text}
          <div style={{
            position: 'absolute',
            top: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            border: '4px solid transparent',
            borderTopColor: 'rgba(0, 0, 0, 0.8)'
          }} />
        </div>
      )}
    </div>
  );
};


function App() {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
  const [isApiLoaded, setIsApiLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const [isCalibrated, setIsCalibrated] = useState(false);
  const [depthFetchStatus, setDepthFetchStatus] = useState<{ type: 'info' | 'warning' | 'error'; message: string } | null>(null);

  // Use consolidated root store
  const { 
    measurements, 
    addMeasurement, 
    deleteMeasurement, 
    renameMeasurement, 
    clearMeasurements, 
    setMeasurements,
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
    depthData,
    setTargetCoords,
    setCurrentCameraParams,
    setOnnxDepthMap,
    setDepthData
  } = useRootStore();

  // Load settings and measurements on app start
  useEffect(() => {
    const loadPersistedData = async () => {
      try {
        if (window.electronAPI?.invoke) {
          const [savedSettings, savedMeasurements] = await Promise.all([
            window.electronAPI.invoke('get-settings'),
            window.electronAPI.invoke('get-measurements')
          ]);
          
          if (savedSettings) {
            setSettings(savedSettings);
          }
          
          if (savedMeasurements && Array.isArray(savedMeasurements)) {
            setMeasurements(savedMeasurements);
          }
        }
      } catch (error) {
        // Silent error handling for production
      } finally {
        setIsLoading(false);
      }
    };

    loadPersistedData();
  }, [setSettings, setMeasurements]);

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
    if (!isLoading && settings.autoSave && window.electronAPI?.invoke) {
      const saveMeasurements = async () => {
        try {
          await window.electronAPI.invoke('save-measurements', measurements);
        } catch (error) {
          // Silent error handling for production
        }
      };
      
      saveMeasurements();
    }
  }, [measurements, settings.autoSave, isLoading]);

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

  const handleCalibrateClick = useCallback((pixelY:number, viewH:number)=>{
     if(!currentCameraParams||!currentCameraParams.vFov||currentCameraParams.pitch===undefined) {setCalibrateMode(false);return;}
     const verticalFov=currentCameraParams.vFov;
     const center=viewH/2;
     const angle=((pixelY-center)/viewH)*verticalFov; // degrees
     const offset = -(currentCameraParams.pitch + angle);
     const newSettings={...settings, calibrationPitchOffsetDeg:offset};
     updateSettings({ calibrationPitchOffsetDeg: offset });
     window.electronAPI?.invoke('save-settings',newSettings).catch(()=>{});
     setCalibrateMode(false);
     setIsCalibrated(true);
     alert(`Calibration saved ΔPitch ${offset.toFixed(2)}°`);
  },[currentCameraParams, settings, updateSettings, setCalibrateMode]);

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
          setDepthFetchStatus({ type: 'error', message });
          return;
        }

        if (result.code === 'NOT_FOUND') {
          setDepthFetchStatus({ type: 'warning', message: 'No Street View depth data is available for this panorama.' });
          return;
        }

        if (result.code === 'NO_API_KEY') {
          setDepthFetchStatus({ type: 'error', message: 'Street View depth requests require GOOGLE_MAPS_API_KEY to be configured.' });
          return;
        }

        if (result.code === 'NETWORK_ERROR') {
          setDepthFetchStatus({ type: 'warning', message: 'Network issue while requesting Street View depth data. Measurements will use ONNX depth only until retry succeeds.' });
          return;
        }

        setDepthFetchStatus({ type: 'error', message: 'Unable to fetch Street View depth data. Falling back to ONNX depth only.' });
      } catch (err) {
        if (cancelled) {
          return;
        }
        console.warn('[depth] Failed to fetch Street View depth data:', err);
        setDepthData(null);
        setDepthFetchStatus({ type: 'error', message: 'Unexpected error requesting Street View depth data.' });
      }
    };

    fetchDepthData();

    return () => {
      cancelled = true;
    };
  }, [currentCameraParams?.panoId, settings.depthApiMaxRetries, setDepthData, setDepthFetchStatus]);

  // --- Depth Map Generation Logic (Lifted from MapView) ---
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
  const { setOnGenerateDepthMap } = useRootStore();

  useEffect(() => {
    setOnGenerateDepthMap(handleGenerateDepthMap);
  }, [handleGenerateDepthMap, setOnGenerateDepthMap]);

  // Add a new measurement to the list
  const handleMeasurementComplete = useCallback((newMeasurement: Omit<Measurement, 'id' | 'timestamp' | 'name'>) => {
    addMeasurement(newMeasurement);
  }, [addMeasurement]);

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

  const handleSaveSettingsPanel = async (newSettings: AppSettings) => {
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
    
    const header = "ID,Timestamp,Label,Name,Distance (m),Start X,Start Y,End X,End Y,Source,Confidence";
    const rows = measurements.map(m => 
      `${m.id},${new Date(m.timestamp).toISOString()},${m.label},"${m.name || ''}",${m.distance.toFixed(3)},${m.startPoint.x},${m.startPoint.y},${m.endPoint.x},${m.endPoint.y},${m.source ?? ''},${m.confidence !== undefined ? Math.round((m.confidence || 0) * 100) + '%' : ''}`
    );
    const csvContent = `${header}\n${rows.join('\n')}`;

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

  // Keyboard shortcuts handler
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Export data with Ctrl+E
      if (event.ctrlKey && event.key === 'e') {
        event.preventDefault();
        handleExportCSV();
        return;
      }

      // Clear all with Ctrl+Shift+Delete
      if (event.ctrlKey && event.shiftKey && event.key === 'Delete') {
        event.preventDefault();
        handleClearMeasurements();
        return;
      }

      // Toggle unit with 'u' key
      if (event.key === 'u') {
        event.preventDefault();
        handleUnitToggle();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUnitToggle, handleExportCSV, handleClearMeasurements]);

  useEffect(()=>{
    const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape'&&calibrateMode){setCalibrateMode(false);}}
    window.addEventListener('keydown',onKey);
    return ()=>window.removeEventListener('keydown',onKey);
  },[calibrateMode, setCalibrateMode]);

  // Display error state
  if (error) {
    return <div className={styles.loadingPlaceholder}>{error}</div>;
  }

  // Display loading state
  if (isLoading) {
    return <div className={styles.loadingPlaceholder}>Loading application...</div>;
  }

  return (
    <div className={styles.appContainer}>
      {currentCameraParams && settings.calibrationPitchOffsetDeg === 0 && (
        <div className={styles.calibrationNotification}>
          <p>For accurate measurements, please calibrate the horizon first.</p>
          <button onClick={() => setCalibrateMode(true)}>Calibrate Now</button>
        </div>
      )}
      <div className={styles.header}>
        <button
          style={{ marginRight: 10 }}
          onClick={() => setIsProjectPanelOpen(true)}
          title="Projects"
        >📁</button>
        <button
          style={{ marginRight: 10 }}
          onClick={() => setIsSettingsOpen(true)}
          title="Settings"
        >⚙️</button>
        <Tooltip text="Generate depth map for current Street View location">
          <button style={{marginRight:10}} onClick={handleGenerateDepthMap} disabled={isGeneratingMap || !currentCameraParams}> 
            {isGeneratingMap? 'Generating...' : 'Generate Depth Map'} 
          </button>
        </Tooltip>
        <Tooltip text="Calibrate the horizon for accurate measurements. Click on the flat horizontal line where the sky meets the ground - like where the ocean meets the sky, or where a flat field meets the sky, or where distant mountains meet the sky. This tells the app what 'level' means in your view so measurements are accurate.">
          <button style={{marginRight:10}} onClick={()=>setCalibrateMode(true)} disabled={!currentCameraParams || calibrateMode} className={!isCalibrated ? styles.highlight : ''}>
            Calibrate Horizon
          </button>
        </Tooltip>
        <Tooltip text="Measure distances along a path">
          <button style={{marginRight:10}} onClick={() => setIsPolylineToolActive(true)} disabled={!currentCameraParams || !isCalibrated}>
            Polyline Tool
          </button>
        </Tooltip>
        <Tooltip text="Measure area on the ground plane">
          <button style={{marginRight:10}} onClick={() => setIsAreaToolActive(true)} disabled={!currentCameraParams || !isCalibrated}>
            Area Tool
          </button>
        </Tooltip>
        <Tooltip text="Measure volume on the ground plane">
          <button style={{marginRight:10}} onClick={() => setIsVolumeToolActive(true)} disabled={!currentCameraParams || !isCalibrated}>
            Volume Tool
          </button>
        </Tooltip>
        {isApiLoaded ? (
          <SearchBox />
        ) : (
          <div className={styles.loadingPlaceholder} style={{height: 'auto', width: '400px'}}>Loading Search...</div>
        )}
      </div>

      {isProjectPanelOpen && <ProjectPanel />}
      {isSettingsOpen && (
        <SettingsPanel
          initial={settings}
          onSave={handleSaveSettingsPanel}
          onClose={() => setIsSettingsOpen(false)}
        />
      )}

      {depthFetchStatus && (
        <div
          className={`${styles.statusBanner} ${
            depthFetchStatus.type === 'error'
              ? styles.statusBannerError
              : depthFetchStatus.type === 'warning'
                ? styles.statusBannerWarning
                : styles.statusBannerInfo
          }`}
          role={depthFetchStatus.type === 'error' ? 'alert' : 'status'}
        >
          {depthFetchStatus.message}
        </div>
      )}

      <div className={styles.mainContent}>
        <div className={styles.sidebar}>
          <div className={styles.sidebarHeader}>
            <h4>Measurements</h4>
            <div className={styles.sidebarControls}>
              <button 
                onClick={handleUnitToggle} 
                className={styles.unitToggle}
                title={`Toggle units (${settings.defaultUnit === 'metric' ? 'Imperial' : 'Metric'})`}
              >
                {settings.defaultUnit === 'metric' ? 'm/ft' : 'ft/m'}
              </button>
              {measurements.length > 0 && (
                <>
                   <button onClick={handleExportCSV} className={styles.sidebarButton} title="Export as CSV (Ctrl+E)">Export</button>
                   <button onClick={handleClearMeasurements} className={`${styles.sidebarButton} ${styles.dangerButton}`} title="Clear All Measurements (Ctrl+Shift+Delete)">Clear All</button>
                </>
              )}
            </div>
          </div>

          {measurements.length === 0 ? (
             <div className={styles.noMeasurements}> 
                No measurements yet.
             </div> 
          ) : (
              <ul className={styles.measurementList}>
                {measurements.map(m => (
                    <li key={m.id} className={styles.measurementItem}>
                       <input 
                         type="text" 
                         placeholder="Add Name..." 
                         value={m.name || ''} 
                         onChange={(e) => renameMeasurement(m.id, e.target.value)}
                         className={styles.nameInput}
                         title="Rename Measurement"
                       />
                        <span className={styles.measurementDetails}>
                            {m.label}: {m.distance.toFixed(2)}{m.unit === 'metric' ? 'm' : 'ft'}
                            {m.source ? ` · ${m.source}` : ''}
                            {m.confidence !== undefined ? ` · conf ${Math.round((m.confidence || 0) * 100)}%` : ''}
                        </span>
                       <button 
                         onClick={() => deleteMeasurement(m.id)}
                         className={styles.deleteButton}
                         title="Delete Measurement"
                       >✕</button>
                    </li>
                ))}
             </ul>
          )}
          <div className={styles.sidebarFooter}>
            <div>PoleCheck Desktop v0.0.1</div>
            <div className={styles.shortcuts}>
              <span>M: Measure</span>
              <span>U: Toggle Units</span>
              <span>Ctrl+E: Export</span>
            </div>
          </div>
        </div>
        
        <div className={styles.mapArea}>
          {isApiLoaded ? (
            <>
              <MapView 
                lat={targetCoords?.lat}
                lng={targetCoords?.lng}
                onCameraParamsChange={handleCameraChange} 
                isGeneratingMap={isGeneratingMap}
                mapGenerationError={mapGenerationError}
                onnxDepthMap={onnxDepthMap}
                onGenerateDepthMap={handleGenerateDepthMap}
                calibrateMode={calibrateMode}
                onCalibrateClick={handleCalibrateClick}
              />
              <MeasurementTool />
              <PolylineTool />
            </>
          ) : (
            <div className={styles.loadingPlaceholder}>Loading Map...</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
