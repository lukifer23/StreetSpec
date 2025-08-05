/// <reference types="@types/google.maps" />
import React, { useEffect, useRef, useState } from 'react';
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
  calibrateMode?: boolean;
  onCalibrateClick?: (pixelY:number, viewportH:number)=>void;
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
  calibrateMode=false,
  onCalibrateClick
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const streetViewRef = useRef<google.maps.StreetViewPanorama | null>(null);
  const streetViewServiceRef = useRef<google.maps.StreetViewService | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

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
      streetViewServiceRef.current = new google.maps.StreetViewService();
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
      const container = mapContainerRef.current;
      const aspect = container ? container.clientWidth / container.clientHeight : 1;
      const { hFov, vFov } = calculateFov(zoom, aspect);

      const baseParams: CameraParams = {
        panoId: panoId ?? undefined,
        lat: position?.lat() ?? undefined,
        lng: position?.lng() ?? undefined,
        heading: pov?.heading ?? undefined,
        pitch: pov?.pitch ?? undefined,
        zoom: zoom ?? undefined,
        fov: hFov,
        vFov: vFov,
      };

      if (streetViewServiceRef.current && panoId) {
        streetViewServiceRef.current.getPanorama({ pano: panoId }, (data, status) => {
          let cameraHeight: number | undefined;
          if (status === google.maps.StreetViewStatus.OK) {
            cameraHeight = (data as any)?.location?.latLngAltitude?.altitude;
          }
          onCameraParamsChange({ ...baseParams, cameraHeight });
        });
      } else {
        onCameraParamsChange(baseParams);
      }
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
      let message: string;
      if (isGeneratingMap) {
        message = 'Generating depth map…';
      } else if (mapGenerationError) {
        message = `Error generating depth map: ${mapGenerationError}`;
      } else if (onnxDepthMap) {
        message = `Depth map ready (${onnxDepthMap.width}x${onnxDepthMap.height})`;
      } else {
        message = 'Depth map not generated';
      }

      return (
        <div
          role="status"
          aria-live={isGeneratingMap ? 'assertive' : 'polite'}
          style={{
            position: 'absolute',
            top: '10px',
            right: '10px',
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            color: '#fff',
            padding: '4px 8px',
            borderRadius: '4px',
            fontSize: '0.8em',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}
        >
          {isGeneratingMap && (
            <svg
              width="12"
              height="12"
              viewBox="0 0 38 38"
              stroke="#fff"
              aria-hidden="true"
            >
              <g fill="none" fillRule="evenodd">
                <circle cx="19" cy="19" r="18" strokeOpacity="0.25" />
                <path d="M37 19c0-9.94-8.06-18-18-18" stroke="#fff">
                  <animateTransform
                    attributeName="transform"
                    type="rotate"
                    from="0 19 19"
                    to="360 19 19"
                    dur="1s"
                    repeatCount="indefinite"
                  />
                </path>
              </g>
            </svg>
          )}
          {message}
        </div>
      );
    };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />
      {calibrateMode && (
        <div style={{position:'absolute',top:10,left:'50%',transform:'translateX(-50%)',background:'rgba(0,0,0,0.6)',color:'#fff',padding:'4px 8px',borderRadius:4,zIndex:21,fontSize:12}}>
          Click on the flat horizontal line where sky meets ground (Esc to cancel)
        </div>
      )}
      {calibrateMode && (
        <div
          style={{position:'absolute',top:0,left:0,right:0,bottom:0,cursor:'crosshair',zIndex:20}}
          onClick={e=>{
            const rect=(e.currentTarget as HTMLDivElement).getBoundingClientRect();
            const y=e.clientY-rect.top;
            onCalibrateClick?.(y,rect.height);
          }}
        />
      )}
      {/* Status indicator etc */}
      <GenStatusIndicator />
    </div>
  );
};

export default MapView; 
