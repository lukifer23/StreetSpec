import React, { useEffect, useRef, useState } from 'react';
import { CameraParams } from '../types/common'; // Import CameraParams type
import { calculateFov } from '../services/geometry'; // Import calculateFov

// Define interfaces for the data we expect to manage
interface MapViewProps {
  lat?: number; // Receive lat directly
  lng?: number; // Receive lng directly
  onCameraParamsChange?: (params: CameraParams) => void;
}

// Default coords (Times Square)
const DEFAULT_LAT = 40.7580;
const DEFAULT_LNG = -73.9855;

// Utility function for debouncing
function debounce<F extends (...args: any[]) => any>(func: F, waitFor: number) {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return (...args: Parameters<F>): void => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => func(...args), waitFor);
  };
}

const DEBOUNCE_TIME = 250; // milliseconds

const MapView: React.FC<MapViewProps> = ({ lat, lng, onCameraParamsChange }) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const streetViewRef = useRef<google.maps.StreetViewPanorama | null>(null); 
  const mapRef = useRef<google.maps.Map | null>(null); // Keep map ref if needed later
  const [isInitialized, setIsInitialized] = useState(false); 
  const [currentCameraParams, setCurrentCameraParams] = useState<CameraParams>({}); 

  // Initialization Effect
  useEffect(() => {
    if (isInitialized || streetViewRef.current || !mapContainerRef.current || !window.google || !window.google.maps) {
      return; 
    }

    // Removed setTimeout wrapper
    console.log("MapView: Attempting StreetViewPanorama initialization...");
    try {
      const initialPosition = { lat: lat ?? DEFAULT_LAT, lng: lng ?? DEFAULT_LNG };
      const panorama = new google.maps.StreetViewPanorama(
        mapContainerRef.current,
        {
          position: initialPosition,
          pov: { heading: 0, pitch: 0 },
          zoom: 1, // Back to zoom 1
          visible: true,
          motionTracking: false, 
          motionTrackingControl: false,
          addressControl: false, linksControl: true,
          fullscreenControl: false, enableCloseButton: false,
        }
      );
      streetViewRef.current = panorama;
      
      // Optional linked map (keep for potential future use)
      const mapInstance = new google.maps.Map(document.createElement('div'), {
          center: initialPosition, zoom: 16, streetViewControl: false,
      });
      mapInstance.setStreetView(panorama);
      mapRef.current = mapInstance;
      
      setIsInitialized(true);
      console.log("MapView: StreetViewPanorama instance created successfully.");
    } catch (error) {
      console.error("MapView: Error during StreetViewPanorama initialization:", error);
    }
  }, [isInitialized, lat, lng]);

  // Effect for Handling Prop Position Changes
  useEffect(() => {
    if (streetViewRef.current && lat !== undefined && lng !== undefined) {
      const currentPosition = streetViewRef.current.getPosition();
      if (currentPosition?.lat() !== lat || currentPosition?.lng() !== lng) {
        console.log(`MapView: Updating position via props to ${lat}, ${lng}`);
        streetViewRef.current.setPosition({ lat, lng });
      }
    }
  }, [lat, lng]);

  // Effect for Subscribing to Panorama Events
  useEffect(() => {
    if (!streetViewRef.current) return;

    console.log("MapView: Adding event listeners.");
    const svInstance = streetViewRef.current;
    const listeners: google.maps.MapsEventListener[] = [];

    const updateLogic = () => {
      const position = svInstance.getPosition();
      const pov = svInstance.getPov();
      const zoom = svInstance.getZoom();
      const panoId = svInstance.getPano();
      
      // Calculate FOV using the imported function
      const fov = calculateFov(zoom);

      const newParams: CameraParams = { // Use CameraParams type directly
        panoId: panoId ?? undefined,
        lat: position?.lat() ?? undefined,
        lng: position?.lng() ?? undefined,
        heading: pov?.heading ?? undefined,
        pitch: pov?.pitch ?? undefined,
        zoom: zoom ?? undefined,
        fov: fov, // Add calculated FOV
      };
      
      // Update state only if params actually changed (optional optimization)
      setCurrentCameraParams(prev => {
          // Basic check to prevent unnecessary updates if object is identical
          if (JSON.stringify(prev) !== JSON.stringify(newParams)) {
              return newParams;
          }
          return prev;
      });

      if (onCameraParamsChange) {
        onCameraParamsChange(newParams);
      }
      console.log("Camera Params Updated (Debounced):", newParams);
    };

    const debouncedUpdateParams = debounce(updateLogic, DEBOUNCE_TIME);

    listeners.push(svInstance.addListener('pano_changed', debouncedUpdateParams));
    listeners.push(svInstance.addListener('position_changed', debouncedUpdateParams));
    listeners.push(svInstance.addListener('pov_changed', debouncedUpdateParams));
    listeners.push(svInstance.addListener('zoom_changed', debouncedUpdateParams));

    updateLogic(); // Initial fetch

    return () => {
      console.log("MapView: Removing event listeners.");
      listeners.forEach(listener => listener.remove());
    };
  }, [isInitialized, onCameraParamsChange]);

  return (
    <div 
      ref={mapContainerRef} 
      id="map-container" 
      style={{ width: '100%', height: '100%', position: 'relative', backgroundColor: 'lightblue' }}
    >
      {!isInitialized && <div style={{ padding: '20px', color: 'black' }}>Initializing Map...</div>}
    </div>
  );
};

export default MapView; 