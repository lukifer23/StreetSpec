import React, { useState, useEffect, useCallback } from 'react';
import { Loader } from '@googlemaps/js-api-loader';
import MapView from './components/MapView';
import SearchBox from './components/SearchBox';
import MeasurementTool from './components/MeasurementTool'; // Import MeasurementTool
import { Measurement, CameraParams, Coordinates } from '../types/common'; // Import types
import styles from './App.module.css'; // Import App CSS Module
// import './App.css'; // Remove or replace default CSS

function App() {
  // State to hold the target coordinates for the map
  const [targetCoords, setTargetCoords] = useState<Coordinates | null>(null);
  // State to hold the API key (ensure it's loaded safely)
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
  const [isApiLoaded, setIsApiLoaded] = useState(false); // State for API load status
  const [error, setError] = useState<string | null>(null); // State for errors
  const [currentCameraParams, setCurrentCameraParams] = useState<CameraParams | null>(null);
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

  // Add a new measurement to the list
  const handleMeasurementComplete = useCallback((newMeasurement: Measurement) => {
      console.log("App received completed measurement:", newMeasurement);
      setMeasurements(prev => [...prev, newMeasurement]);
      // TODO: Save to persistent storage (Phase 3)
  }, []);

  // Display error state
  if (error) {
    return <div className={styles.loadingPlaceholder}>{error}</div>;
  }

  return (
    <div className={styles.appContainer}> {/* Use CSS Module class */}
      {/* Header with Search Bar */}
      <div className={styles.header}> {/* Use CSS Module class */}
        {/* Conditionally render SearchBox only when API is loaded */}
        {isApiLoaded ? (
          <SearchBox 
            apiKey={apiKey} 
            onPlaceSelected={handlePlaceSelected} 
            onCoordsEntered={handleCoordsEntered}
          />
        ) : (
          <div className={styles.loadingPlaceholder} style={{height: 'auto', width: '400px'}}>Loading Search...</div>
        )}
        {/* Placeholder for future controls */}
      </div>

      {/* Main Content Area */}
      <div className={styles.mainContent}> {/* Use CSS Module class */}
        {/* Sidebar Area - Placeholder */}
        <div className={styles.sidebar}> {/* Use CSS Module class */}
          <h4>Measurements</h4>
          {/* TODO: Create MeasurementList component */}
          {measurements.length === 0 ? (
             <div style={{ flexGrow: 1, color: '#6c757d', textAlign: 'center', paddingTop: '50px' }}>
                No measurements yet.
             </div> 
          ) : (
             <ul style={{ listStyle: 'none', padding: 0, margin: 0, flexGrow: 1 }}>
                {measurements.map(m => (
                    <li key={m.id} style={{ marginBottom: '10px', fontSize: '0.9em', borderBottom: '1px solid #eee', paddingBottom: '5px'}}>
                        {m.label}: {m.distance.toFixed(2)}m
                        {/* Add delete button later */}
                    </li>
                ))}
             </ul>
          )}
          <div className={styles.sidebarFooter}>
            PoleCheck Desktop v0.0.1
          </div>
        </div>
        
        {/* Map View Area */}
        <div className={styles.mapArea}> {/* Use CSS Module class */}
          {/* Conditionally render MapView only when API is loaded */}
          {isApiLoaded ? (
            <>
              <MapView 
                // Remove key prop
                lat={targetCoords?.lat} // Pass lat directly
                lng={targetCoords?.lng} // Pass lng directly
                onCameraParamsChange={handleCameraChange} 
              />
              {/* Render MeasurementTool overlay */}
              <MeasurementTool 
                cameraParams={currentCameraParams}
                onMeasurementComplete={handleMeasurementComplete}
                measurements={measurements}
              />
            </>
          ) : (
            <div className={styles.loadingPlaceholder}>Loading Map...</div> // Placeholder while loading
          )}
          {/* Other overlays like MeasurementTool could go here positioned absolutely */} 
        </div>
      </div>
    </div>
  );
}

export default App;
