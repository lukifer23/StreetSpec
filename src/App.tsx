import React, { useState, useEffect, useCallback } from 'react';
import { Loader } from '@googlemaps/js-api-loader';
import MapView from './components/MapView';
import SearchBox from './components/SearchBox';
import MeasurementTool from './components/MeasurementTool';
import { Coordinates, CameraParams, Measurement, OnnxDepthMap } from './types/common';
import styles from './App.module.css';
import './App.css';

function App() {
  // State to hold the target coordinates for the map
  const [targetCoords, setTargetCoords] = useState<Coordinates | null>(null);
  // State to hold the API key (ensure it's loaded safely)
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
  const [isApiLoaded, setIsApiLoaded] = useState(false); // State for API load status
  const [error, setError] = useState<string | null>(null); // State for errors
  
  // --- State Lifted from MapView ---
  const [currentCameraParams, setCurrentCameraParams] = useState<CameraParams | null>(null);
  const [onnxDepthMap, setOnnxDepthMap] = useState<OnnxDepthMap | null>(null);
  const [isGeneratingMap, setIsGeneratingMap] = useState<boolean>(false);
  const [mapGenerationError, setMapGenerationError] = useState<string | null>(null);
  // --- End Lifted State ---

  const [measurements, setMeasurements] = useState<Measurement[]>([]); // State for measurements

  // Load Google Maps API
  useEffect(() => {
    if (!apiKey) {
      console.error("API Key is missing!");
      setError("Error: Google Maps API Key is missing. Please check your .env file.");
      return;
    }
    setError(null); // Clear previous errors
    const loader = new Loader({
      apiKey: apiKey,
      version: "quarterly",
      libraries: ["places", "geometry"]
    });

    loader.load().then(() => {
      console.log("Google Maps API loaded successfully");
      setIsApiLoaded(true);
    }).catch(e => {
      console.error("Error loading Google Maps API:", e);
      setError("Failed to load Google Maps. Please check the console and API Key.");
    });

    // No cleanup needed for the loader itself
  }, [apiKey]); // Re-run if API key changes (though it shouldn't)

  // Update App state when MapView camera changes
  const handleCameraChange = useCallback((params: CameraParams) => {
    // console.log('App received camera params:', params);
    setCurrentCameraParams(params);
  }, []);

  // Callback for when a place is selected in the SearchBox
  const handlePlaceSelected = (place: google.maps.places.PlaceResult) => {
    if (place.geometry?.location) {
      const newCoords = {
        lat: place.geometry.location.lat(),
        lng: place.geometry.location.lng(),
      };
      console.log("Setting new map coordinates from Place:", newCoords);
      setTargetCoords(newCoords);
    } else {
      console.error("Selected place has no geometry:", place);
    }
  };

  // Callback for when raw coordinates are entered
  const handleCoordsEntered = (coords: Coordinates) => {
    console.log("Setting new map coordinates from Input:", coords);
    setTargetCoords(coords);
  };

  // --- Depth Map Generation Logic (Lifted from MapView) ---
  const handleGenerateDepthMap = useCallback(async () => {
    if (!currentCameraParams || !apiKey || isGeneratingMap) {
      console.warn("[App] Cannot generate depth map: Params/API Key missing or already generating.");
      return;
    }

    setIsGeneratingMap(true);
    setMapGenerationError(null);
    setOnnxDepthMap(null); // Clear previous map

    console.log("[App] Generating depth map with params:", currentCameraParams);

    const imgWidth = 640; 
    const imgHeight = 640;

    const apiUrl = `https://maps.googleapis.com/maps/api/streetview?` +
                   `size=${imgWidth}x${imgHeight}&` +
                   (currentCameraParams.panoId ? `pano=${currentCameraParams.panoId}&` : `location=${currentCameraParams.lat},${currentCameraParams.lng}&`) +
                   `heading=${currentCameraParams.heading ?? 0}&` +
                   `pitch=${currentCameraParams.pitch ?? 0}&` +
                   `fov=${currentCameraParams.fov ?? 90}&` +
                   `key=${apiKey}`;

    try {
      console.log("[App] Fetching static image from:", apiUrl);
      const response = await fetch(apiUrl);
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
          console.log("[App] Converted static image to Data URL (length:", base64data.length, ")");
          
          if (window.electronAPI && typeof window.electronAPI.invoke === 'function') {
              console.log("[App] Sending image data to main process for inference...");
              const result: OnnxDepthMap | null = await window.electronAPI.invoke('infer-depth', base64data);
              if (result && result.data && result.width && result.height) {
                  console.log(`[App] Received ONNX depth map: ${result.width}x${result.height}, data length: ${result.data.length}`);
                  setOnnxDepthMap(result);
              } else {
                  throw new Error('Main process failed to return valid depth map data.');
              }
          } else {
               throw new Error('IPC invoke function not available.');
          }
      };
      reader.onerror = () => {
          throw new Error('FileReader error reading image blob');
      };

    } catch (error: any) {
      console.error("[App] Error generating depth map:", error);
      setMapGenerationError(error.message || 'Failed to generate depth map');
    } finally {
      setIsGeneratingMap(false);
    }

  }, [currentCameraParams, apiKey, isGeneratingMap]);
  // --- End Depth Map Generation Logic ---

  // Add a new measurement to the list
  const handleMeasurementComplete = useCallback((newMeasurement: Measurement) => {
      console.log("App received completed measurement:", newMeasurement);
      setMeasurements(prev => [...prev, newMeasurement]);
      // TODO: Save to persistent storage (Phase 3)
  }, []);

  const handleClearMeasurements = useCallback(() => {
      setMeasurements([]);
      // TODO: Clear from persistent storage
  }, []);

  const handleDeleteMeasurement = useCallback((idToDelete: string) => {
      setMeasurements(prev => prev.filter(m => m.id !== idToDelete));
      // TODO: Delete from persistent storage
  }, []);

  const handleRenameMeasurement = useCallback((idToRename: string, newName: string) => {
      setMeasurements(prev => 
          prev.map(m => m.id === idToRename ? { ...m, name: newName } : m)
      );
       // TODO: Update in persistent storage
  }, []);

  const handleExportCSV = async () => {
      if (measurements.length === 0) {
          alert("No measurements to export.");
          return;
      }
      // Basic CSV formatting (can be improved)
      const header = "ID,Timestamp,Label,Name,Distance (m),Start X,Start Y,End X,End Y";
      const rows = measurements.map(m => 
          `${m.id},${new Date(m.timestamp).toISOString()},${m.label},"${m.name || ''}",${m.distance.toFixed(3)},${m.startPoint.x},${m.startPoint.y},${m.endPoint.x},${m.endPoint.y}`
      );
      const csvContent = `${header}\n${rows.join('\n')}`;

      try {
          if (window.electronAPI && typeof window.electronAPI.invoke === 'function') {
              const filePath = await window.electronAPI.invoke('export-to-csv', csvContent);
              if (filePath) {
                  alert(`Measurements exported successfully to: ${filePath}`);
              } else {
                  // Handle cancellation or error in main process (e.g., user cancelled save dialog)
                  console.log("CSV export cancelled or failed in main process.");
              }
          } else {
              console.error("Export failed: IPC channel not available.");
              alert("Export failed: Cannot communicate with the main process.");
          }
      } catch (error) {
          console.error("Error during CSV export invocation:", error);
          alert(`Export failed: ${error}`);
      }
  };

  // Display error state
  if (error) {
    return <div className={styles.loadingPlaceholder}>{error}</div>;
  }

  return (
    <div className={styles.appContainer}>
      <div className={styles.header}>
        {isApiLoaded ? (
          <SearchBox 
            onPlaceSelected={handlePlaceSelected} 
            onCoordsEntered={handleCoordsEntered}
          />
        ) : (
          <div className={styles.loadingPlaceholder} style={{height: 'auto', width: '400px'}}>Loading Search...</div>
        )}
      </div>

      <div className={styles.mainContent}>
        <div className={styles.sidebar}>
          <div className={styles.sidebarHeader}>
            <h4>Measurements</h4>
            {measurements.length > 0 && (
              <>
                 <button onClick={handleExportCSV} className={styles.sidebarButton} title="Export as CSV">Export</button>
                 <button onClick={handleClearMeasurements} className={`${styles.sidebarButton} ${styles.dangerButton}`} title="Clear All Measurements">Clear All</button>
              </>
            )}
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
            PoleCheck Desktop v0.0.1
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
              />
              <MeasurementTool 
                cameraParams={currentCameraParams}
                onMeasurementComplete={handleMeasurementComplete}
                measurements={measurements}
                onnxDepthMap={onnxDepthMap}
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
