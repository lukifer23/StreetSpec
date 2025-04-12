import React, { useState, useEffect, useCallback } from 'react';
import { Loader } from '@googlemaps/js-api-loader';
import MapView from './components/MapView';
import SearchBox from './components/SearchBox';
import MeasurementTool from './components/MeasurementTool';
import { Coordinates, CameraParams, Measurement, OnnxDepthMap, MeasurementPhase } from './types/common';
import styles from './App.module.css';
import './App.css';
import SettingsPanel from './components/SettingsPanel';

// Initial load flag to prevent saving empty array on first render
let hasLoadedMeasurements = false;

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
  const [depthMapOverlayUrl, setDepthMapOverlayUrl] = useState<string | null>(null);
  const [isGeneratingMap, setIsGeneratingMap] = useState<boolean>(false);
  const [mapGenerationError, setMapGenerationError] = useState<string | null>(null);
  // --- End Lifted State ---

  const [measurements, setMeasurements] = useState<Measurement[]>([]); // State for measurements
  const [showDepthMapOverlay, setShowDepthMapOverlay] = useState<boolean>(false); // State for visualization toggle
  const [fovOverride, setFovOverride] = useState<number | null>(null); // State for FOV override
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false); // State for settings panel visibility
  const [baseImageData, setBaseImageData] = useState<ImageBitmap | null>(null); // Store fetched image for processing

  // --- Lifted Measurement State ---
  const [measurementPhase, setMeasurementPhase] = useState<MeasurementPhase>('idle');
  const measurementIsActive = measurementPhase !== 'idle';
  // --- End Lifted State ---

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

  // Load Measurements on Mount
  useEffect(() => {
    const load = async () => {
      if (window.electronAPI && typeof window.electronAPI.invoke === 'function') {
        try {
          console.log("[App] Requesting to load measurements from main process...");
          const loadedMeasurements = await window.electronAPI.invoke('load-measurements');
          if (Array.isArray(loadedMeasurements)) {
            // Add basic validation if needed (e.g., check structure of loaded items)
            setMeasurements(loadedMeasurements);
            console.log(`[App] Loaded ${loadedMeasurements.length} measurements.`);
          } else {
            console.error("[App] Received invalid data type when loading measurements:", loadedMeasurements);
            setMeasurements([]); // Default to empty on invalid data
          }
        } catch (error) {
          console.error("[App] Error invoking load-measurements:", error);
          setMeasurements([]); // Default to empty on error
        }
      } else {
        console.warn("[App] Electron API not available, cannot load measurements.");
        // Handle case where API isn't available (e.g., running in browser?)
      }
      hasLoadedMeasurements = true; // Set flag after attempting load
    };
    load();
  }, []); // Empty dependency array ensures this runs only once on mount

  // Save Measurements on Change (after initial load)
  useEffect(() => {
    const save = async () => {
      if (!hasLoadedMeasurements) return; // Don't save until initial load attempt is done

      if (window.electronAPI && typeof window.electronAPI.invoke === 'function') {
        try {
          console.log(`[App] Requesting to save ${measurements.length} measurements...`);
          await window.electronAPI.invoke('save-measurements', measurements);
        } catch (error) {
          console.error("[App] Error invoking save-measurements:", error);
        }
      } else {
        console.warn("[App] Electron API not available, cannot save measurements.");
      }
    };
    save();
  }, [measurements]); // Run whenever the measurements array changes

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
    setDepthMapOverlayUrl(null);
    setBaseImageData(null); // Clear previous image data

    console.log("[App] Generating depth map with params:", currentCameraParams);

    // Match Street View image size with model's expected input
    const imgWidth = 518;
    const imgHeight = 518;

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
      
      // Create ImageBitmap for efficient drawing and processing
      const imageBitmap = await createImageBitmap(imageBlob);
      setBaseImageData(imageBitmap); // Store the bitmap
      console.log(`[App] Created ImageBitmap: ${imageBitmap.width}x${imageBitmap.height}`);

      // Convert to Data URL *after* creating bitmap for sending via IPC
      const reader = new FileReader();
      reader.readAsDataURL(imageBlob);
      reader.onloadend = async () => {
          const base64data = reader.result as string;
          if (!base64data) {
              // No need to throw, just log error, as bitmap is primary data now
              console.error('Failed to convert image blob to Data URL for IPC');
          } else {
            console.log("[App] Converted static image to Data URL for IPC (length:", base64data.length, ")");
            // Send to main process for inference (as before)
            if (window.electronAPI && typeof window.electronAPI.invoke === 'function') {
                console.log("[App] Sending image data to main process for inference...");
                try {
                    // Expect the new object structure
                    const result: { pngDataUrl: string; depthData: number[]; width: number; height: number } | null = await window.electronAPI.invoke('infer-depth', base64data);
                    
                    if (result && result.pngDataUrl && result.depthData && result.width && result.height) {
                        // Create the OnnxDepthMap object for calculations
                        const depthMapForState: OnnxDepthMap = {
                             data: result.depthData,
                             width: result.width,
                             height: result.height
                        };
                        console.log(`[App] Received ONNX depth map: ${result.width}x${result.height}, data length: ${result.depthData.length}`);
                        setOnnxDepthMap(depthMapForState); // Set numerical data state
                        setDepthMapOverlayUrl(result.pngDataUrl); // Set overlay image URL state
                    } else {
                        // Clear both states if data is invalid
                        setOnnxDepthMap(null);
                        setDepthMapOverlayUrl(null);
                        throw new Error('Main process failed to return valid depth map data.');
                    }
                } catch (ipcError) {
                   console.error("[App] Error during IPC invoke('infer-depth'):", ipcError);
                   setMapGenerationError('IPC Error: Failed to get depth map from main process.');
                   setBaseImageData(null); // Clear image if inference fails
                   setOnnxDepthMap(null); // Clear depth map state on error
                   setDepthMapOverlayUrl(null); // Clear overlay URL state on error
                }
            } else {
                console.error('IPC invoke function not available.');
                setMapGenerationError('Error: Cannot communicate with backend for depth inference.');
                setBaseImageData(null); // Clear image if IPC not available
            }
          }
      };
      reader.onerror = () => {
          console.error('FileReader error reading image blob for Data URL conversion');
          // Don't necessarily clear bitmap here, could still be useful
      };

    } catch (error: any) {
      console.error("[App] Error generating depth map:", error);
      setMapGenerationError(error.message || 'Failed to generate depth map');
      setBaseImageData(null); // Clear image on general error
    } finally {
      setIsGeneratingMap(false);
    }

  }, [currentCameraParams, apiKey, isGeneratingMap]);
  // --- End Depth Map Generation Logic ---

  // Add a new measurement to the list
  const handleMeasurementComplete = useCallback((newMeasurement: Measurement) => {
      console.log("App received completed measurement:", newMeasurement);
      setMeasurements(prev => [...prev, newMeasurement]);
      // Save logic moved to useEffect [measurements]
  }, []);

  const handleClearMeasurements = useCallback(() => {
      setMeasurements([]);
      // Save logic moved to useEffect [measurements]
  }, []);

  const handleDeleteMeasurement = useCallback((idToDelete: string) => {
      setMeasurements(prev => prev.filter(m => m.id !== idToDelete));
      // Save logic moved to useEffect [measurements]
  }, []);

  const handleMeasurementNameChange = useCallback((idToRename: string, newName: string) => {
      setMeasurements(prev => 
          prev.map(m => m.id === idToRename ? { ...m, name: newName } : m)
      );
      // Save logic moved to useEffect [measurements]
  }, []);

  // --- Export Handlers ---

  const handleExportCSV = useCallback(() => {
    if (measurements.length === 0) {
      alert("No measurements to export.");
      return;
    }
    
    const csvContent = measurements.map(m => {
      const row = [
        m.id,
        m.name || 'Untitled',
        m.label,
        m.distance?.toFixed(2) || '0.00',
        m.unit === 'metric' ? (m.label === 'Area' ? 'm²' : 'm') : (m.label === 'Area' ? 'ft²' : 'ft')
      ];
      return row.join(',');
    }).join('\n');

    const header = 'id,name,type,value,unit\n';
    const blob = new Blob([header + csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'measurements.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [measurements]);

  const handleExportJSON = useCallback(() => {
    if (measurements.length === 0) {
      alert("No measurements to export.");
      return;
    }
    
    const jsonContent = JSON.stringify(measurements, null, 2);
    const blob = new Blob([jsonContent], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'measurements.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [measurements]);

  const handleExportKML = async () => {
     if (measurements.length === 0) {
      alert("No measurements to export.");
      return;
    }
    
    // Basic KML structure
    let kmlContent = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    kmlContent += `<kml xmlns="http://www.opengis.net/kml/2.2">\n`;
    kmlContent += `  <Document>\n`;
    kmlContent += `    <name>PoleCheck Measurements</name>\n`;

    measurements.forEach(m => {
      kmlContent += `    <Placemark>\n`;
      kmlContent += `      <name>${m.name || m.label} (${m.id.substring(0, 6)})</name>\n`;
      kmlContent += `      <description><![CDATA[
        Label: ${m.label}<br/>
        Value: ${m.distance?.toFixed(2) ?? 'N/A'} ${m.unit === 'metric' ? (m.label === 'Area' ? 'm²' : 'm') : (m.label === 'Area' ? 'ft²' : 'ft')}<br/>
        Timestamp: ${new Date(m.timestamp).toISOString()}<br/>
        Pano ID: ${m.panoId ?? 'N/A'}<br/>
        Start Confidence: ${m.startPointConfidence ?? 'N/A'}<br/>
        End Confidence: ${m.endPointConfidence ?? 'N/A'}<br/>
        <hr/>
        Camera Latitude: ${m.cameraParams?.lat ?? 'N/A'}<br/>
        Camera Longitude: ${m.cameraParams?.lng ?? 'N/A'}<br/>
        Camera Heading: ${m.cameraParams?.heading?.toFixed(1) ?? 'N/A'}<br/>
        Camera Pitch: ${m.cameraParams?.pitch?.toFixed(1) ?? 'N/A'}<br/>
        Camera FOV: ${m.cameraParams?.fov?.toFixed(1) ?? 'N/A'}<br/>
      ]]></description>\n`;

      // Add camera viewpoint as a Point
      if (m.cameraParams?.lat && m.cameraParams?.lng) {
         kmlContent += `      <Point>\n`;
         kmlContent += `        <coordinates>${m.cameraParams.lng},${m.cameraParams.lat},0</coordinates>\n`; // KML: Lng,Lat,Alt
         kmlContent += `      </Point>\n`;
      }
      // TODO: Add LineString/Polygon for measurement points when Lat/Lng/Alt are calculated
      kmlContent += `    </Placemark>\n`;
    });

    kmlContent += `  </Document>\n`;
    kmlContent += `</kml>\n`;

    await triggerExport(kmlContent, 'kml');
  };

  // Helper function to call the backend export
  const triggerExport = async (content: string, type: 'csv' | 'geojson' | 'kml') => {
     try {
          if (window.electronAPI && typeof window.electronAPI.invoke === 'function') {
              const filePath = await window.electronAPI.invoke('export-file', { content, type });
              if (filePath) {
                  alert(`Data exported successfully as ${type.toUpperCase()} to: ${filePath}`);
              } else {
                  console.log(`${type.toUpperCase()} export cancelled or failed in main process.`);
              }
          } else {
              console.error("Export failed: IPC channel not available.");
              alert("Export failed: Cannot communicate with the main process.");
          }
      } catch (error) {
          console.error(`Error during ${type.toUpperCase()} export invocation:`, error);
          alert(`Export failed: ${error}`);
      }
  };
  
  // --- End Export Handlers ---

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
        <button 
          onClick={() => setIsSettingsOpen(true)}
          className={styles.settingsButton}
          title="Open Settings"
        >
          ⚙️ Settings
        </button>
      </div>

      {isSettingsOpen && (
        <SettingsPanel 
          currentOverride={fovOverride}
          onOverrideChange={setFovOverride}
          onClose={() => setIsSettingsOpen(false)}
        />
      )}

      <div className={styles.mainContent}>
        <div className={styles.sidebar}>
          <div className={styles.sidebarHeader}>
            <h4>Measurements</h4>
            <div className={styles.exportButtonGroup}>
              <button
                className={styles.sidebarButton}
                onClick={handleExportCSV}
                disabled={measurements.length === 0}
              >
                Export CSV
              </button>
              <button
                className={styles.sidebarButton}
                onClick={handleExportJSON}
                disabled={measurements.length === 0}
              >
                Export JSON
              </button>
            </div>
            <button
              className={`${styles.sidebarButton} ${styles.dangerButton}`}
              onClick={handleClearMeasurements}
              disabled={measurements.length === 0}
            >
              Clear All
            </button>
          </div>

          {measurements.length === 0 ? (
            <div className={styles.noMeasurements}>
              No measurements yet
            </div>
          ) : (
            <ul className={styles.measurementList}>
              {measurements.map((measurement, index) => (
                <li key={measurement.id} className={styles.measurementItem}>
                  <input
                    type="text"
                    className={styles.nameInput}
                    value={measurement.name}
                    onChange={(e) => handleMeasurementNameChange(measurement.id, e.target.value)}
                    placeholder="Measurement name"
                  />
                  <div className={styles.measurementDetails}>
                    {measurement.label}: {measurement.distance !== undefined ? `${measurement.distance.toFixed(2)}${measurement.unit === 'metric' ? (measurement.label === 'Area' ? 'm²' : 'm') : (measurement.label === 'Area' ? 'ft²' : 'ft')}` : 'N/A'}
                  </div>
                  <button
                    className={styles.deleteButton}
                    onClick={() => handleDeleteMeasurement(measurement.id)}
                    title="Delete measurement"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          
          <div className={styles.sidebarFooter}>
            {measurements.length} measurement{measurements.length !== 1 ? 's' : ''}
          </div>
        </div>
        
        <div className={styles.mapArea}>
          {isApiLoaded ? (
            <>
              <div className={styles.mapControls}> 
                  {onnxDepthMap && (
                    <button 
                      onClick={() => setShowDepthMapOverlay(prev => !prev)}
                      className={`${styles.sidebarButton} ${showDepthMapOverlay ? styles.activeButton : ''}`}
                      title={showDepthMapOverlay ? "Hide Depth Map Overlay" : "Show Depth Map Overlay"}
                    >
                      {showDepthMapOverlay ? 'Hide Depth' : 'Show Depth'}
                    </button>
                  )}
              </div>

              <MapView 
                apiKey={apiKey} 
                targetCoords={targetCoords}
                onCameraChange={handleCameraChange}
                showDepthMapOverlay={showDepthMapOverlay}
                depthMapOverlayUrl={depthMapOverlayUrl}
                isGeneratingMap={isGeneratingMap}
                mapGenerationError={mapGenerationError}
                onnxDepthMap={onnxDepthMap}
                onGenerateDepthMap={handleGenerateDepthMap}
                isMeasurementActive={measurementIsActive}
              />
              <MeasurementTool 
                measurementPhase={measurementPhase}
                setMeasurementPhase={setMeasurementPhase}
                measurementIsActive={measurementIsActive}
                onnxDepthMap={onnxDepthMap}
                baseImageData={baseImageData}
                onMeasurementComplete={handleMeasurementComplete}
                cameraParams={currentCameraParams}
                fovOverride={fovOverride}
                measurements={measurements}
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
