/// <reference types="@types/google.maps" />
import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import type { CameraParams } from '../types/common';
import { calculateFov } from '../services/geometry';
import { ErrorBoundary } from './ErrorBoundary';

import { useRootStore } from '../stores/rootStore';
import { depthPrefetchService } from '../services/depthPrefetch';

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

// Memoized status indicator component
export const GenStatusIndicator = React.memo<{
  isGeneratingMap: boolean;
  mapGenerationError: string | null;
  onnxDepthMap: any;
}>(({ isGeneratingMap, mapGenerationError, onnxDepthMap }) => {
  const message = useMemo(() => {
    if (isGeneratingMap) {
      return 'Generating depth map...';
    } else if (mapGenerationError) {
      return `Error generating depth map: ${mapGenerationError}`;
    } else if (onnxDepthMap) {
      return `Depth map ready (${onnxDepthMap.width}x${onnxDepthMap.height})`;
    } else {
      return 'Depth map not generated';
    }
  }, [isGeneratingMap, mapGenerationError, onnxDepthMap]);

  const statusIndicatorStyle = useMemo(() => ({
    position: 'absolute' as const,
    top: '10px',
    right: '10px',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    color: '#fff',
    padding: '4px 8px',
    borderRadius: '4px',
    fontSize: '0.8em',
    zIndex: 100,
    display: 'flex' as const,
    alignItems: 'center' as const,
    gap: '4px'
  }), []);

  return (
    <div
      role="status"
      aria-live={isGeneratingMap ? 'assertive' : 'polite'}
      style={statusIndicatorStyle}
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
});

GenStatusIndicator.displayName = 'GenStatusIndicator';

// Memoized calibration overlay component
const CalibrationOverlay = React.memo<{
  calibrateMode: boolean;
  onCalibrateClick: (pixelY: number, viewportH: number) => void;
}>(({ calibrateMode, onCalibrateClick }) => {
  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const y = e.clientY - rect.top;
    onCalibrateClick(y, rect.height);
  }, [onCalibrateClick]);

  const instructionStyle = useMemo(() => ({
    position: 'absolute' as const,
    top: 10,
    left: '50%',
    transform: 'translateX(-50%)',
    background: 'rgba(0,0,0,0.6)',
    color: '#fff',
    padding: '4px 8px',
    borderRadius: 4,
    zIndex: 21,
    fontSize: 12
  }), []);

  const overlayStyle = useMemo(() => ({
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    cursor: 'crosshair' as const,
    zIndex: 20
  }), []);

  if (!calibrateMode) return null;

  return (
    <>
      <div style={instructionStyle}>
        Click exactly where the sky meets the ground so we can match the camera tilt using its vertical FOV (Esc to cancel)
      </div>
      <div style={overlayStyle} onClick={handleClick} />
    </>
  );
});

CalibrationOverlay.displayName = 'CalibrationOverlay';

const CameraHUD = React.memo(() => {
  const { currentCameraParams } = useRootStore();
  const { settings } = useRootStore();

  const hudStyle = useMemo(() => ({
    position: 'absolute' as const,
    top: '10px',
    left: '10px',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    color: '#fff',
    padding: '6px 8px',
    borderRadius: '4px',
    fontSize: '12px',
    zIndex: 101,
    lineHeight: 1.4
  }), []);

  if (!currentCameraParams || !settings.showDebugOverlay) return null;
  const { fov, vFov, pitch } = currentCameraParams;
  const offset = settings.calibrationPitchOffsetDeg ?? 0;
  const camH = currentCameraParams.cameraHeight ?? settings.cameraHeight ?? 2.5;
  const scale = settings.depthScale ?? 1;
  const bias = settings.depthBias ?? 0;

  return (
    <div style={hudStyle} aria-label="Camera HUD">
      <div>hFOV: {fov?.toFixed(1) ?? '--'} deg  vFOV: {vFov?.toFixed(1) ?? '--'} deg</div>
      <div>Pitch: {pitch?.toFixed(2) ?? '--'} deg  Cal Offset: {offset.toFixed(2)} deg</div>
      <div>CamH: {camH.toFixed(2)} m  Depth: scale {scale.toFixed(3)} bias {bias.toFixed(3)}</div>
    </div>
  );
});

CameraHUD.displayName = 'CameraHUD';

const MapView: React.FC<{
  onCameraParamsChange: (params: CameraParams) => void;
  onGenerateDepthMap: () => void;
  onCalibrateClick?: (pixelY: number, viewportH: number) => void;
}> = React.memo(({
  onCameraParamsChange,
  onCalibrateClick
}) => {
  const { targetCoords } = useRootStore();
  const { isGeneratingMap, mapGenerationError, calibrateMode } = useRootStore();
  const { onnxDepthMap } = useRootStore();

  const { lat, lng } = useMemo(() => ({
    lat: targetCoords?.lat,
    lng: targetCoords?.lng
  }), [targetCoords]);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const streetViewRef = useRef<google.maps.StreetViewPanorama | null>(null);
  const streetViewServiceRef = useRef<google.maps.StreetViewService | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  // Memoized initial position
  const initialPosition = useMemo(() => ({
    lat: lat ?? DEFAULT_LAT,
    lng: lng ?? DEFAULT_LNG
  }), [lat, lng]);

  // Memoized street view options
  const streetViewOptions = useMemo(() => ({
    position: initialPosition,
    pov: { heading: 0, pitch: 0 },
    zoom: 1,
    visible: true,
    motionTracking: false,
    motionTrackingControl: false,
    addressControl: false,
    linksControl: true,
    fullscreenControl: false,
    enableCloseButton: false,
  }), [initialPosition]);

  // Memoized debounced update function
  const debouncedUpdateParams = useMemo(
    () => debounce(() => {
      if (!streetViewRef.current) return;

      const svInstance = streetViewRef.current;
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
    }, 250),
    [onCameraParamsChange]
  );

  // Initialization Effect
  useEffect(() => {
    if (isInitialized || !mapContainerRef.current || typeof window.google === 'undefined' || typeof window.google.maps === 'undefined') {
      return;
    }
    try {
      const panorama = new google.maps.StreetViewPanorama(
        mapContainerRef.current!,
        streetViewOptions
      );
      streetViewRef.current = panorama;
      streetViewServiceRef.current = new google.maps.StreetViewService();
      setIsInitialized(true);
    } catch (error) {
      // Silent error handling for production
    }
  }, [isInitialized, streetViewOptions]);

  // Effect for Handling Prop Position Changes
  useEffect(() => {
    if (streetViewRef.current && lat !== undefined && lng !== undefined) {
      const currentPosition = streetViewRef.current.getPosition();
      if (currentPosition?.lat() !== lat || currentPosition?.lng() !== lng) {
        streetViewRef.current.setPosition({ lat, lng });
      }
    }
  }, [lat, lng]);

  // Effect for Subscribing to Panorama Events
  useEffect(() => {
    if (!streetViewRef.current) return;
    const svInstance = streetViewRef.current;
    const listeners: google.maps.MapsEventListener[] = [];

    listeners.push(svInstance.addListener('pano_changed', debouncedUpdateParams));
    listeners.push(svInstance.addListener('position_changed', debouncedUpdateParams));
    listeners.push(svInstance.addListener('pov_changed', debouncedUpdateParams));
    listeners.push(svInstance.addListener('zoom_changed', debouncedUpdateParams));

    // Initial fetch
    debouncedUpdateParams();

    return () => {
      listeners.forEach(listener => listener.remove());
    };
  }, [isInitialized, debouncedUpdateParams]);

  // Prefetch adjacent depth maps when panorama changes
  useEffect(() => {
    if (!streetViewRef.current || !isInitialized) return;
    
    const triggerPrefetch = () => {
      const panorama = streetViewRef.current;
      if (!panorama) return;

      try {
        const currentPanoId = panorama.getPano();
        if (!currentPanoId) return;

        const links = panorama.getLinks();
        if (!links || links.length === 0) return;

        // Get adjacent pano IDs
        const adjacentPanoIds = links
          .filter(link => link.pano)
          .map(link => link.pano!)
          .slice(0, 3); // Limit to first 3 adjacent panos

        if (adjacentPanoIds.length === 0) return;

        // Get API key from env
        const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
        if (!apiKey) return;

        // Get current camera params
        const pov = panorama.getPov();
        const position = panorama.getPosition();
        const zoom = panorama.getZoom();
        
        if (!pov || !position) return;

        const aspectRatio = mapContainerRef.current
          ? mapContainerRef.current.clientWidth / mapContainerRef.current.clientHeight
          : 16 / 9;
        const { hFov, vFov } = calculateFov(zoom, aspectRatio);

        const cameraParams: CameraParams = {
          panoId: currentPanoId,
          lat: position.lat(),
          lng: position.lng(),
          heading: pov.heading,
          pitch: pov.pitch,
          zoom: zoom ?? 1,
          fov: hFov,
          vFov: vFov
        };

        // Initialize and trigger prefetch
        depthPrefetchService.init(apiKey);
        depthPrefetchService.prefetchAdjacent(
          currentPanoId,
          adjacentPanoIds,
          cameraParams,
          { maxConcurrent: 2, quality: 'medium', enableCache: true }
        ).catch(error => {
          // Silent failure - prefetching is optional
          console.warn('[MapView] Prefetch failed:', error);
        });
      } catch (error) {
        // Silent error handling
        console.warn('[MapView] Prefetch trigger error:', error);
      }
    };

    // Debounce prefetch to avoid triggering too frequently
    const prefetchTimer = setTimeout(triggerPrefetch, 1000);

    return () => {
      clearTimeout(prefetchTimer);
    };
  }, [isInitialized]);

  // Memoized container style
  const containerStyle = useMemo(() => ({
    position: 'relative' as const,
    width: '100%',
    height: '100%'
  }), []);

  const mapContainerStyle = useMemo(() => ({
    width: '100%',
    height: '100%'
  }), []);

  return (
    <ErrorBoundary
      fallback={
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          padding: '20px',
          textAlign: 'center',
          backgroundColor: '#f8f9fa',
          borderRadius: '8px',
          color: '#6c757d'
        }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠</div>
          <h3 style={{ margin: '0 0 8px 0', color: '#495057' }}>Map Loading Error</h3>
          <p style={{ margin: '0 0 16px 0', maxWidth: '400px' }}>
            Unable to load Google Maps. This might be due to network issues or missing API key.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '8px 16px',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Retry
          </button>
        </div>
      }
    >
      <div style={containerStyle}>
        <div ref={mapContainerRef} data-testid="map-view" style={mapContainerStyle} />
        <CameraHUD />
        <CalibrationOverlay
          calibrateMode={calibrateMode}
          onCalibrateClick={onCalibrateClick}
        />
        <GenStatusIndicator
          isGeneratingMap={isGeneratingMap}
          mapGenerationError={mapGenerationError}
          onnxDepthMap={onnxDepthMap}
        />
      </div>
    </ErrorBoundary>
  );
});

MapView.displayName = 'MapView';

export default MapView; 
