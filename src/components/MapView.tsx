/// <reference types="@types/google.maps" />
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { CameraParams, OnnxDepthMap } from '../types/common';
import { calculateFov } from '../services/geometry';

// Define interfaces
interface MapViewProps {
  lat?: number;
  lng?: number;
  onCameraParamsChange: (params: CameraParams) => void;
  isGeneratingMap: boolean;
  mapGenerationError: string | null;
  onnxDepthMap: OnnxDepthMap | null;
  onGenerateDepthMap: () => void;
}

// Default coords
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

const MapView: React.FC<MapViewProps> = ({ 
  lat, 
  lng, 
  onCameraParamsChange,
  isGeneratingMap,
  mapGenerationError,
  onnxDepthMap,
  onGenerateDepthMap
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const streetViewRef = useRef<google.maps.StreetViewPanorama | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [currentCameraParams, setCurrentCameraParams] = useState<CameraParams | null>(null);

  // Initialization Effect
  useEffect(() => {
    if (isInitialized || !mapContainerRef.current || typeof window.google === 'undefined' || typeof window.google.maps === 'undefined') {
      return;
    }
    try {
      const initialPosition = { lat: lat ?? DEFAULT_LAT, lng: lng ?? DEFAULT_LNG };
      const panorama = new google.maps.StreetViewPanorama(
        mapContainerRef.current!,
        {
          position: initialPosition,
          pov: { heading: 0, pitch: 0 },
          zoom: 1,
          visible: true,
          motionTracking: false, 
          motionTrackingControl: false,
          addressControl: false, linksControl: true,
          fullscreenControl: false, enableCloseButton: false,
        }
      );
      streetViewRef.current = panorama;
      setIsInitialized(true);
    } catch (error) {
      // Silent error handling for production
    }
  }, [isInitialized, lat, lng]);

  // Effect for Handling Prop Position Changes
  useEffect(() => {
    if (streetViewRef.current && lat !== undefined && lng !== undefined) {
      const currentPosition = streetViewRef.current.getPosition();
      if (currentPosition?.lat() !== lat || currentPosition?.lng() !== lng) {
        streetViewRef.current.setPosition({ lat, lng });
      }
    }
  }, [lat, lng]);

  // Effect for Subscribing to Panorama Events (stores params locally and calls prop)
  useEffect(() => {
    if (!streetViewRef.current) return;
    const svInstance = streetViewRef.current;
    const listeners: google.maps.MapsEventListener[] = [];

    const updateLogic = () => {
      const position = svInstance.getPosition();
      const pov = svInstance.getPov();
      const zoom = svInstance.getZoom();
      const panoId = svInstance.getPano();
      const fov = calculateFov(zoom);

      const newParams: CameraParams = {
        panoId: panoId ?? undefined,
        lat: position?.lat() ?? undefined,
        lng: position?.lng() ?? undefined,
        heading: pov?.heading ?? undefined,
        pitch: pov?.pitch ?? undefined,
        zoom: zoom ?? undefined,
        fov: fov,
      };
      
      // Store locally to enable/disable button
      setCurrentCameraParams(newParams); 
      // Propagate up to App
      onCameraParamsChange(newParams);
    };

    const debouncedUpdateParams = debounce(updateLogic, 250); 
    listeners.push(svInstance.addListener('pano_changed', debouncedUpdateParams));
    listeners.push(svInstance.addListener('position_changed', debouncedUpdateParams));
    listeners.push(svInstance.addListener('pov_changed', debouncedUpdateParams));
    listeners.push(svInstance.addListener('zoom_changed', debouncedUpdateParams));
    updateLogic(); // Initial fetch
    return () => {
      listeners.forEach(listener => listener.remove());
    };
  }, [isInitialized, onCameraParamsChange]);

  // --- UI Indicator for Depth Map Generation (Uses props now) ---
  const GenStatusIndicator = () => {
      let text = 'ML Depth: ';
      let color = '#eee';
      if (isGeneratingMap) {
        text += 'Generating...';
        color = 'orange';
      } else if (mapGenerationError) {
        text += `Error (${mapGenerationError})`;
        color = 'red';
      } else if (onnxDepthMap) {
        text += `Ready (${onnxDepthMap.width}x${onnxDepthMap.height})`;
        color = 'lime';
      } else {
        text += 'Not Generated';
        color = '#aaa';
      }
  
      return (
        <div style={{
          position: 'absolute', 
          top: '10px', 
          right: '10px', 
          backgroundColor: 'rgba(0, 0, 0, 0.7)', 
          color: color,
          padding: '4px 8px',
          borderRadius: '4px',
          fontSize: '0.8em',
          zIndex: 100
        }}>
          {text}
        </div>
      );
    };

  return (
    <div 
      ref={mapContainerRef} 
      id="map-container" 
      style={{ width: '100%', height: '100%', position: 'relative', backgroundColor: '#eee' }}
    >
      {isInitialized && (
        <>
          <button 
            onClick={onGenerateDepthMap}
            disabled={isGeneratingMap || !currentCameraParams}
            style={{
              position: 'absolute', 
              top: '10px',
              left: '10px', 
              zIndex: 100, 
              padding: '5px 10px',
              cursor: (isGeneratingMap || !currentCameraParams) ? 'not-allowed' : 'pointer'
            }}
          >
            {isGeneratingMap ? 'Generating...' : 'Generate Depth Map'}
          </button>

          <GenStatusIndicator />
        </>
      )}
      {!isInitialized && <div style={{ padding: '20px', color: 'black' }}>Initializing Map...</div>}
    </div>
  );
};

export default MapView; 