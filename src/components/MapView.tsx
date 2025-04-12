/// <reference types="@types/google.maps" />
import React, { useEffect, useRef, useState } from 'react';
import { CameraParams, OnnxDepthMap } from '../types/common';
import { calculateFov } from '../services/geometry';

// Define interfaces
interface MapViewProps {
  apiKey: string;
  targetCoords: { lat: number; lng: number } | null;
  onCameraChange: (params: CameraParams) => void;
  showDepthMapOverlay: boolean;
  depthMapOverlayUrl: string | null;
  isGeneratingMap: boolean;
  mapGenerationError: string | null;
  onnxDepthMap: OnnxDepthMap | null;
  onGenerateDepthMap: () => void;
  isMeasurementActive: boolean;
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
  apiKey,
  targetCoords,
  onCameraChange,
  showDepthMapOverlay,
  depthMapOverlayUrl,
  isGeneratingMap,
  mapGenerationError,
  onnxDepthMap,
  onGenerateDepthMap,
  isMeasurementActive
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const streetViewRef = useRef<google.maps.StreetViewPanorama | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [currentCameraParams, setCurrentCameraParams] = useState<CameraParams | null>(null);

  // Initialization Effect
  useEffect(() => {
    if (isInitialized || !mapContainerRef.current || typeof window.google === 'undefined' || typeof window.google.maps === 'undefined') {
      console.log("[MapView] Initialization check failed or already initialized.");
      return;
    }
    console.log("MapView: Attempting StreetViewPanorama initialization...");
    try {
      const initialPosition = { lat: targetCoords?.lat ?? DEFAULT_LAT, lng: targetCoords?.lng ?? DEFAULT_LNG };
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
      console.log("MapView: StreetViewPanorama instance created successfully.");

    } catch (error) {
      console.error("MapView: Error during StreetViewPanorama initialization:", error);
    }
  }, [isInitialized, targetCoords]);

  // Effect for Handling Prop Position Changes
  useEffect(() => {
    if (streetViewRef.current && targetCoords?.lat !== undefined && targetCoords?.lng !== undefined) {
      const currentPosition = streetViewRef.current.getPosition();
      if (currentPosition?.lat() !== targetCoords.lat || currentPosition?.lng() !== targetCoords.lng) {
        console.log(`MapView: Updating position via props to ${targetCoords.lat}, ${targetCoords.lng}`);
        streetViewRef.current.setPosition({ lat: targetCoords.lat, lng: targetCoords.lng });
      }
    }
  }, [targetCoords]);

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
      onCameraChange(newParams); // Use the required prop callback
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
  }, [isInitialized, onCameraChange]); // Depend on the prop callback

  // Effect to control clickToGo based on measurement state
  useEffect(() => {
    if (streetViewRef.current) {
      const clickable = !isMeasurementActive;
      console.log(`[MapView] Setting clickToGo via effect: ${clickable}`);
      streetViewRef.current.setOptions({ clickToGo: clickable });
    }
  }, [isMeasurementActive]); // Trigger when measurement active state changes

  // Refactored Effect for Drawing Depth Map Overlay using PNG Data URL
  useEffect(() => {
    if (!overlayCanvasRef.current || !mapContainerRef.current) return;
    const canvas = overlayCanvasRef.current;
    const ctx = canvas.getContext('2d');
    const container = mapContainerRef.current;

    if (!ctx) return;

    // Match canvas size to container size
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;

    if (showDepthMapOverlay && depthMapOverlayUrl) {
      console.log("[MapView] Rendering depth map overlay from URL...");
      const img = new Image();
      img.onload = () => {
        // Clear canvas before drawing
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // Draw the loaded image scaled to fit the canvas
        // Set transparency before drawing
        ctx.globalAlpha = 0.7; // Adjust transparency (0.0 to 1.0)
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        ctx.globalAlpha = 1.0; // Reset alpha
        console.log("[MapView] Depth map overlay rendered from URL.");
      };
      img.onerror = (err) => {
        console.error("[MapView] Error loading depth map overlay image:", err);
        ctx.clearRect(0, 0, canvas.width, canvas.height); // Clear on error
      };
      img.src = depthMapOverlayUrl; // Set the source to the PNG Data URL
    } else {
      // Clear canvas if overlay is hidden or no URL
      console.log("[MapView] Clearing depth map overlay.");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, [depthMapOverlayUrl, showDepthMapOverlay]); // Rerun when URL or toggle changes

  // --- UI Indicator for Depth Map Generation (Uses props now) ---
  const GenStatusIndicator = () => {
      let text = 'ML Depth: ';
      let color = '#eee';
      if (isGeneratingMap) { // Use prop
        text += 'Generating...';
        color = 'orange';
      } else if (mapGenerationError) { // Use prop
        text += `Error (${mapGenerationError})`;
        color = 'red';
      } else if (onnxDepthMap) { // Use prop
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
          zIndex: 100 // Ensure it's above map elements
        }}>
          {text}
        </div>
      );
    };
    // --- End UI Indicator ---

  return (
    <div 
      ref={mapContainerRef} 
      id="map-container" 
      style={{ width: '100%', height: '100%', position: 'relative', backgroundColor: '#eee' }}
    >
      {/* Overlay Canvas */} 
      <canvas
        ref={overlayCanvasRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%', // Let CSS handle display size
          height: '100%', // Let CSS handle display size
          pointerEvents: 'none', // Allow clicks to pass through to the map
          zIndex: 50, // Below controls, above map tiles
          opacity: 0.7 // Adjust overall opacity if needed
        }}
      />

      {isInitialized && (
        <>
          {/* Button to trigger generation (calls prop function) */} 
          <button 
            onClick={onGenerateDepthMap} // Call prop function
            disabled={isGeneratingMap || !currentCameraParams} // Disable based on prop and local params
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

          {/* Status Indicator */} 
          <GenStatusIndicator />
        </>
      )}
      {!isInitialized && <div style={{ padding: '20px', color: 'black' }}>Initializing Map...</div>}
    </div>
  );
};

export default MapView; 