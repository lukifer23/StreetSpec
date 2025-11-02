/// <reference types="@types/google.maps" />
import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import type { CameraParams } from '../types/common';
import { calculateFov } from '../services/geometry';
import { ErrorBoundary } from './ErrorBoundary';

import { useRootStore } from '../stores/rootStore';
import { depthPrefetchService } from '../services/depthPrefetch';
import { useShallow } from 'zustand/react/shallow';

// Default coords
const DEFAULT_LAT = 40.7580;
const DEFAULT_LNG = -73.9855;

type RootStoreState = ReturnType<typeof useRootStore.getState>;

const selectCameraParams = (state: RootStoreState) => state.currentCameraParams;

const selectCameraHudSettings = (state: RootStoreState) => ({
  showDebugOverlay: state.settings.showDebugOverlay ?? false,
  calibrationPitchOffsetDeg: state.settings.calibrationPitchOffsetDeg ?? 0,
  cameraHeight: state.settings.cameraHeight ?? 2.5,
  depthScale: state.settings.depthScale ?? 1,
  depthBias: state.settings.depthBias ?? 0,
});

const selectTargetCoords = (state: RootStoreState) => state.targetCoords;

const selectOnnxDepthMap = (state: RootStoreState) => state.onnxDepthMap;

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

// Progress tracking for depth generation
interface DepthGenerationProgress {
  stage: 'fetching' | 'processing' | 'complete';
  quality?: 'low' | 'medium' | 'high';
  progress?: number; // 0-100
}

// Memoized status indicator component with enhanced progress feedback
export const GenStatusIndicator = React.memo<{
  isGeneratingMap: boolean;
  mapGenerationError: string | null;
  onnxDepthMap: any;
  progress?: DepthGenerationProgress;
}>(({ isGeneratingMap, mapGenerationError, onnxDepthMap, progress }) => {
  const [progressPercent, setProgressPercent] = React.useState(0);

  // Simulate progress based on stage
  React.useEffect(() => {
    if (!isGeneratingMap) {
      setProgressPercent(0);
      return;
    }

    let interval: ReturnType<typeof setInterval> | null = null;
    
    if (progress?.stage === 'fetching') {
      // Fetching: 0-40%
      let current = 0;
      interval = setInterval(() => {
        current = Math.min(40, current + 2);
        setProgressPercent(current);
        if (current >= 40) {
          if (interval) clearInterval(interval);
        }
      }, 100);
    } else if (progress?.stage === 'processing') {
      // Processing: 40-90%
      let current = 40;
      interval = setInterval(() => {
        current = Math.min(90, current + 3);
        setProgressPercent(current);
        if (current >= 90) {
          if (interval) clearInterval(interval);
        }
      }, 150);
    } else if (progress?.stage === 'complete') {
      setProgressPercent(100);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isGeneratingMap, progress?.stage]);

  const message = useMemo(() => {
    if (isGeneratingMap) {
      const qualityLabel = progress?.quality ? ` (${progress.quality} quality)` : '';
      if (progress?.stage === 'fetching') {
        return `Fetching image${qualityLabel}...`;
      } else if (progress?.stage === 'processing') {
        return `Processing depth${qualityLabel}...`;
      }
      return `Generating depth map${qualityLabel}...`;
    } else if (mapGenerationError) {
      return `Error: ${mapGenerationError}`;
    } else if (onnxDepthMap) {
      return `✓ Depth map ready (${onnxDepthMap.width}x${onnxDepthMap.height})`;
    } else {
      return 'Depth map not generated';
    }
  }, [isGeneratingMap, mapGenerationError, onnxDepthMap, progress]);

  const statusIndicatorStyle = useMemo(() => ({
    position: 'absolute' as const,
    top: '10px',
    right: '10px',
    backgroundColor: mapGenerationError ? 'rgba(220, 53, 69, 0.9)' : 'rgba(0, 0, 0, 0.8)',
    color: '#fff',
    padding: '8px 12px',
    borderRadius: '6px',
    fontSize: '0.85em',
    zIndex: 100,
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: '6px',
    minWidth: '200px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
  }), [mapGenerationError]);

  const progressBarStyle = useMemo(() => ({
    width: '100%',
    height: '3px',
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: '2px',
    overflow: 'hidden' as const
  }), []);

  const progressFillStyle = useMemo(() => ({
    height: '100%',
    width: `${progressPercent}%`,
    backgroundColor: '#4CAF50',
    transition: 'width 0.3s ease',
    borderRadius: '2px'
  }), [progressPercent]);

  return (
    <div
      role="status"
      aria-live={isGeneratingMap ? 'assertive' : 'polite'}
      style={statusIndicatorStyle}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {isGeneratingMap && (
          <svg
            width="14"
            height="14"
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
        <span style={{ flex: 1 }}>{message}</span>
      </div>
      {isGeneratingMap && progressPercent > 0 && (
        <div style={progressBarStyle}>
          <div style={progressFillStyle} />
        </div>
      )}
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
  const cameraParams = useRootStore(selectCameraParams);
  const hudSettings = useRootStore(useShallow(selectCameraHudSettings));

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

  const {
    showDebugOverlay,
    calibrationPitchOffsetDeg,
    cameraHeight: defaultCameraHeight,
    depthScale,
    depthBias,
  } = hudSettings;

  const fov = cameraParams?.fov;
  const vFov = cameraParams?.vFov;
  const pitch = cameraParams?.pitch;
  const offset = calibrationPitchOffsetDeg;
  const camH = cameraParams?.cameraHeight ?? defaultCameraHeight;
  const scale = depthScale;
  const bias = depthBias;

  useEffect(() => {
    if (import.meta.env.DEV && cameraParams && showDebugOverlay) {
      console.debug('[CameraHUD] render snapshot', {
        fov,
        vFov,
        pitch,
        offset,
        camH,
        scale,
        bias,
      });
    }
  }, [cameraParams, showDebugOverlay, fov, vFov, pitch, offset, camH, scale, bias]);

  if (!cameraParams || !showDebugOverlay) return null;

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
  depthGenProgress?: DepthGenerationProgress;
}> = React.memo(({
  onCameraParamsChange,
  onCalibrateClick,
  depthGenProgress
}) => {
  // Use shallow comparison for better performance
  const targetCoords = useRootStore(selectTargetCoords);
  const isGeneratingMap = useRootStore((state) => state.isGeneratingMap);
  const mapGenerationError = useRootStore((state) => state.mapGenerationError);
  const calibrateMode = useRootStore((state) => state.calibrateMode);
  const onnxDepthMap = useRootStore(selectOnnxDepthMap);
  
  // Memoize derived values
  const hasDepthMap = useMemo(() => Boolean(onnxDepthMap), [onnxDepthMap]);

  const { lat, lng } = useMemo(() => ({
    lat: targetCoords?.lat,
    lng: targetCoords?.lng
  }), [targetCoords]);

  useEffect(() => {
    if (import.meta.env.DEV) {
      console.debug('[MapView] store slices updated', {
        targetCoords,
        isGeneratingMap,
        mapGenerationError,
        calibrateMode,
        hasDepthMap: Boolean(onnxDepthMap),
      });
    }
  }, [targetCoords, isGeneratingMap, mapGenerationError, calibrateMode, onnxDepthMap]);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const streetViewRef = useRef<google.maps.StreetViewPanorama | null>(null);
  const streetViewServiceRef = useRef<google.maps.StreetViewService | null>(null);
  const prefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isSizeReady, setIsSizeReady] = useState(false);

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
      const rawZoom = Number(svInstance.getZoom());
      const zoom = Number.isFinite(rawZoom) ? rawZoom : 1;
      const panoId = svInstance.getPano();
      const container = mapContainerRef.current;
      const width = container?.clientWidth ?? 0;
      const height = container?.clientHeight ?? 0;
      const safeHeight = height > 0 ? height : 1;
      const aspect = width > 0 ? width / safeHeight : 16 / 9;
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

  const clearPrefetchTimer = useCallback(() => {
    if (prefetchTimerRef.current) {
      clearTimeout(prefetchTimerRef.current);
      prefetchTimerRef.current = null;
    }
  }, []);

  const triggerPrefetch = useCallback(() => {
    if (!streetViewRef.current || !hasDepthMap || isGeneratingMap) return;

    const panorama = streetViewRef.current;
    if (!panorama) return;

    try {
      const currentPanoId = panorama.getPano();
      if (!currentPanoId) return;

      const links = panorama.getLinks();
      if (!links || links.length === 0) return;

      // Get adjacent pano IDs
      const adjacentPanoIds = links
        .filter((link): link is google.maps.StreetViewLink & { pano: string } => link != null && link.pano != null)
        .map(link => link.pano)
        .slice(0, 3); // Limit to first 3 adjacent panos

      if (adjacentPanoIds.length === 0) return;

      // Get API key from env
      const apiKey = import.meta.env['VITE_GOOGLE_MAPS_API_KEY'] || '';
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
      depthPrefetchService
        .prefetchAdjacent(
          currentPanoId,
          adjacentPanoIds,
          cameraParams,
          { maxConcurrent: 2, quality: 'medium', enableCache: true }
        )
        .catch(error => {
          // Silent failure - prefetching is optional
          console.warn('[MapView] Prefetch failed:', error);
        });
    } catch (error) {
      // Silent error handling
      console.warn('[MapView] Prefetch trigger error:', error);
    }
  }, [hasDepthMap, isGeneratingMap]);

  const schedulePrefetch = useCallback(() => {
    if (!isInitialized || !hasDepthMap || isGeneratingMap) return;

    clearPrefetchTimer();
    prefetchTimerRef.current = window.setTimeout(() => {
      triggerPrefetch();
    }, 1000) as any;
  }, [clearPrefetchTimer, hasDepthMap, isGeneratingMap, isInitialized, triggerPrefetch]);

  useEffect(() => {
    if (!hasDepthMap || isGeneratingMap) {
      clearPrefetchTimer();
    }
  }, [clearPrefetchTimer, hasDepthMap, isGeneratingMap]);

  useEffect(() => {
    if (isInitialized && hasDepthMap && !isGeneratingMap) {
      schedulePrefetch();
    }
  }, [hasDepthMap, isGeneratingMap, isInitialized, schedulePrefetch]);

  // Observe container size to avoid initializing Street View in a zero-sized element
  useEffect(() => {
    const el = mapContainerRef.current;
    if (!el) return;
    const hasSize = () => (el.clientWidth ?? 0) > 0 && (el.clientHeight ?? 0) > 0;
    setIsSizeReady(hasSize());
    const ro = new ResizeObserver(() => {
      const ready = hasSize();
      if (ready !== isSizeReady) {
        setIsSizeReady(ready);
      }
    });
    try {
      ro.observe(el);
    } catch {}
    return () => {
      try { ro.disconnect(); } catch {}
    };
  }, [isSizeReady]);

  // Initialization Effect
  useEffect(() => {
    if (
      isInitialized ||
      !mapContainerRef.current ||
      !isSizeReady ||
      typeof window.google === 'undefined' ||
      typeof window.google.maps === 'undefined'
    ) {
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
  }, [isInitialized, isSizeReady, streetViewOptions]);

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
    if (!streetViewRef.current || !isInitialized) return;
    const svInstance = streetViewRef.current;
    const listeners: Array<google.maps.MapsEventListener | null> = [];

    try {
      listeners.push(svInstance.addListener('pano_changed', debouncedUpdateParams));
      listeners.push(svInstance.addListener('position_changed', debouncedUpdateParams));
      listeners.push(svInstance.addListener('pov_changed', debouncedUpdateParams));
      listeners.push(svInstance.addListener('zoom_changed', debouncedUpdateParams));
      listeners.push(svInstance.addListener('pano_changed', schedulePrefetch));
      listeners.push(svInstance.addListener('links_changed', schedulePrefetch));
    } catch (e) {
      // In case Google Maps objects are not ready yet
      console.warn('[MapView] Failed to register listeners', e);
    }

    // Initial fetch
    debouncedUpdateParams();
    schedulePrefetch();

    return () => {
      for (const listener of listeners) {
        try {
          listener?.remove();
        } catch {
          // ignore cleanup errors
        }
      }
      clearPrefetchTimer();
    };
  }, [clearPrefetchTimer, debouncedUpdateParams, isInitialized, schedulePrefetch]);

  // Memoized container style
  const containerStyle = useMemo(() => ({
    position: 'relative' as const,
    width: '100%',
    height: '100%'
  }), []);

  const mapContainerStyle = useMemo(() => ({
    width: '100%',
    height: '100%',
    minHeight: 300
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
        {onCalibrateClick && (
          <CalibrationOverlay
            calibrateMode={calibrateMode}
            onCalibrateClick={onCalibrateClick}
          />
        )}
        <GenStatusIndicator
          isGeneratingMap={isGeneratingMap}
          mapGenerationError={mapGenerationError}
          onnxDepthMap={onnxDepthMap}
          progress={depthGenProgress}
        />
      </div>
    </ErrorBoundary>
  );
});

MapView.displayName = 'MapView';

export default MapView; 
