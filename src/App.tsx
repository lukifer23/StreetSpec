import React, { useState, useEffect, useCallback } from 'react';
import { Loader } from '@googlemaps/js-api-loader';
import MapView from './components/MapView';
import SearchBox from './components/SearchBox';
import MeasurementTool from './components/MeasurementTool';
import SettingsPanel from './components/SettingsPanel';
import { Coordinates, CameraParams, Measurement, OnnxDepthMap, AppSettings } from './types/common';
import { getCachedDepthMap, cacheDepthMap } from './services/depth';
import styles from './App.module.css';
import './App.css';

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

// Add rate-limited fetch function
async function rateLimitedFetch(url: string, retryCount = 0): Promise<Response> {
  const maxRetries = 3;
  const retryDelay = 1000;
  
  try {
    const response = await fetch(url);
    if (response.status === 429 && retryCount < maxRetries) {
      await new Promise(resolve => setTimeout(resolve, retryDelay));
      return rateLimitedFetch(url, retryCount + 1);
    }
    return response;
  } catch (error) {
    if (retryCount < maxRetries) {
      await new Promise(resolve => setTimeout(resolve, retryDelay));
      return rateLimitedFetch(url, retryCount + 1);
    }
    throw error;
  }
}

function App() {
  // State to hold the target coordinates for the map
  const [targetCoords, setTargetCoords] = useState<Coordinates | null>(null);
  // State to hold the API key (ensure it's loaded safely)
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
  const [isApiLoaded, setIsApiLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // --- State Lifted from MapView ---
  const [currentCameraParams, setCurrentCameraParams] = useState<CameraParams | null>(null);
  const [onnxDepthMap, setOnnxDepthMap] = useState<OnnxDepthMap | null>(null);
  const [isGeneratingMap, setIsGeneratingMap] = useState<boolean>(false);
  const [mapGenerationError, setMapGenerationError] = useState<string | null>(null);
  // --- End Lifted State ---

  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [settings, setSettings] = useState<AppSettings>({
    defaultUnit: 'metric',
    autoSave: true,
    theme: 'light',
    language: 'en',
    measurementHistoryLimit: 1000,
    cameraHeight: 2.5
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [calibrateMode,setCalibrateMode]=useState(false);

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
  }, []);

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
  }, [apiKey]);

  // Update App state when MapView camera changes
  const handleCameraChange = useCallback((params: CameraParams) => {
    const merged = {
      ...params,
      calibrationPitchOffsetDeg: settings.calibrationPitchOffsetDeg ?? 0,
      cameraHeight: params.cameraHeight ?? settings.cameraHeight ?? 2.5,
    };
    setCurrentCameraParams(merged);
  }, [settings.calibrationPitchOffsetDeg, settings.cameraHeight]);

  const handleCalibrateClick = useCallback((pixelY:number, viewH:number)=>{
     if(!currentCameraParams||!currentCameraParams.fov||currentCameraParams.pitch===undefined) {setCalibrateMode(false);return;}
     const verticalFov=currentCameraParams.fov;
     const center=viewH/2;
     const angle=((pixelY-center)/viewH)*verticalFov; // degrees
     const offset = -(currentCameraParams.pitch + angle);
     const newSettings={...settings, calibrationPitchOffsetDeg:offset};
     setSettings(newSettings);
     window.electronAPI?.invoke('save-settings',newSettings).catch(()=>{});
     setCalibrateMode(false);
     alert(`Calibration saved ΔPitch ${offset.toFixed(2)}°`);
  },[currentCameraParams,settings]);

  // Callback for when a place is selected in the SearchBox
  const handlePlaceSelected = (place: google.maps.places.PlaceResult) => {
    if (place.geometry?.location) {
      const newCoords = {
        lat: place.geometry.location.lat(),
        lng: place.geometry.location.lng(),
      };
      setTargetCoords(newCoords);
    }
  };

  // Callback for when raw coordinates are entered
  const handleCoordsEntered = (coords: Coordinates) => {
    setTargetCoords(coords);
  };

  // --- Depth Map Generation Logic (Lifted from MapView) ---
  const handleGenerateDepthMap = useCallback(async () => {
    if (!currentCameraParams || !apiKey || isGeneratingMap) {
      return;
    }

    setIsGeneratingMap(true);
    setMapGenerationError(null);
    setOnnxDepthMap(null);

    try {
      // Check cache first
      const cachedDepthMap = await getCachedDepthMap(currentCameraParams);
      if (cachedDepthMap) {
        console.log('[depth] Using cached depth map');
        setOnnxDepthMap(cachedDepthMap);
        setIsGeneratingMap(false);
        return;
      }

      const imgWidth = 640;
      const imgHeight = 640;

      const apiUrl = `https://maps.googleapis.com/maps/api/streetview?` +
                     `size=${imgWidth}x${imgHeight}&` +
                     (currentCameraParams.panoId ? `pano=${currentCameraParams.panoId}&` : `location=${currentCameraParams.lat},${currentCameraParams.lng}&`) +
                     `heading=${currentCameraParams.heading ?? 0}&` +
                     `pitch=${currentCameraParams.pitch ?? 0}&` +
                     `fov=${currentCameraParams.fov ?? 90}&` +
                     `key=${apiKey}`;

      const response = await rateLimitedFetch(apiUrl);
      
      if (!response.ok) {
        throw new Error(`Static API request failed: ${response.status} ${response.statusText}`);
      }

      const imageBlob = await response.blob();
      const reader = new FileReader();
      
      reader.readAsDataURL(imageBlob);
      reader.onloadend = async () => {
        const base64data = reader.result as string;
        if (!base64data) {
          throw new Error('Failed to convert image blob to Data URL');
        }
        
        if (!window.electronAPI?.invoke) {
          throw new Error('IPC invoke function not available. Please restart the application.');
        }

        const result: OnnxDepthMap | null = await window.electronAPI.invoke('infer-depth', base64data);
        
        if (!result?.data || !result?.width || !result?.height) {
          throw new Error('Main process failed to return valid depth map data.');
        }

        // Cache the result
        await cacheDepthMap(currentCameraParams, result);
        
        setOnnxDepthMap(result);
      };

      reader.onerror = () => {
        throw new Error('FileReader error reading image blob');
      };

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to generate depth map';
      setMapGenerationError(errorMessage);
    } finally {
      setIsGeneratingMap(false);
    }
  }, [currentCameraParams, apiKey, isGeneratingMap]);
  // --- End Depth Map Generation Logic ---

  // Add a new measurement to the list
  const handleMeasurementComplete = useCallback((newMeasurement: Measurement) => {
    setMeasurements(prev => {
      const updated = [...prev, newMeasurement];
      
      // Enforce measurement history limit
      if (updated.length > settings.measurementHistoryLimit) {
        return updated.slice(-settings.measurementHistoryLimit);
      }
      
      return updated;
    });
  }, [settings.measurementHistoryLimit]);

  const handleClearMeasurements = useCallback(async () => {
    setMeasurements([]);
    if (window.electronAPI?.invoke) {
      try {
        await window.electronAPI.invoke('clear-data');
      } catch (error) {
        // Silent error handling for production
      }
    }
  }, []);

  const handleDeleteMeasurement = useCallback((idToDelete: string) => {
    setMeasurements(prev => prev.filter(m => m.id !== idToDelete));
  }, []);

  const handleRenameMeasurement = useCallback((idToRename: string, newName: string) => {
    setMeasurements(prev => 
      prev.map(m => m.id === idToRename ? { ...m, name: newName } : m)
    );
  }, []);

  // Unit toggle handler
  const handleUnitToggle = useCallback(() => {
    const newUnit: 'metric' | 'imperial' = settings.defaultUnit === 'metric' ? 'imperial' : 'metric';
    const newSettings: AppSettings = { ...settings, defaultUnit: newUnit };
    setSettings(newSettings);
    
    // Save settings
    if (window.electronAPI?.invoke) {
      window.electronAPI.invoke('save-settings', newSettings).catch(() => {
        // Silent error handling for production
      });
    }
  }, [settings]);

  const handleSaveSettingsPanel = async (newSettings: AppSettings) => {
    setSettings(newSettings);
    if (window.electronAPI?.invoke) {
      try {
        await window.electronAPI.invoke('save-settings', newSettings);
      } catch {
        // silent
      }
    }
    setIsSettingsOpen(false);
  };

  const handleExportCSV = useCallback(async () => {
    if (measurements.length === 0) {
      alert("No measurements to export.");
      return;
    }
    
    const header = "ID,Timestamp,Label,Name,Distance (m),Start X,Start Y,End X,End Y";
    const rows = measurements.map(m => 
      `${m.id},${new Date(m.timestamp).toISOString()},${m.label},"${m.name || ''}",${m.distance.toFixed(3)},${m.startPoint.x},${m.startPoint.y},${m.endPoint.x},${m.endPoint.y}`
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
  },[calibrateMode]);

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
      <div className={styles.header}>
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
          <button style={{marginRight:10}} onClick={()=>setCalibrateMode(true)} disabled={!currentCameraParams || calibrateMode}>
            Calibrate Horizon
          </button>
        </Tooltip>
        {isApiLoaded ? (
          <SearchBox 
            onPlaceSelected={handlePlaceSelected} 
            onCoordsEntered={handleCoordsEntered}
          />
        ) : (
          <div className={styles.loadingPlaceholder} style={{height: 'auto', width: '400px'}}>Loading Search...</div>
        )}
      </div>

      {isSettingsOpen && (
        <SettingsPanel
          initial={settings}
          onSave={handleSaveSettingsPanel}
          onClose={() => setIsSettingsOpen(false)}
        />
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
                         onChange={(e) => handleRenameMeasurement(m.id, e.target.value)}
                         className={styles.nameInput}
                         title="Rename Measurement"
                       />
                       <span className={styles.measurementDetails}>
                           {m.label}: {m.distance.toFixed(2)}{m.unit === 'metric' ? 'm' : 'ft'}
                       </span>
                       <button 
                         onClick={() => handleDeleteMeasurement(m.id)}
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
              <MeasurementTool 
                cameraParams={currentCameraParams}
                onMeasurementComplete={handleMeasurementComplete}
                measurements={measurements}
                onnxDepthMap={onnxDepthMap}
                currentUnit={settings.defaultUnit}
              />
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
