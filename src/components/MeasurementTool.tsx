import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type {
  Point,
  Measurement,
  CameraParams,
  OnnxDepthMap,
  DecodedDepthData,
  Vector3,
} from '../types/common';
import { estimateDistanceToPoint, calculateEstimatedHeight } from '../services/measurementLogic';
import { calibrationManager } from '../services/depthCalibration';
import { screenToWorld, estimateGroundPlaneIntersection, screenToWorldWithDepth } from '../services/geometry';
import { distance3D } from '../utils/math';
import { ErrorBoundary } from './ErrorBoundary';
import { convertLengthToDisplay } from '../utils/units';
import styles from './MeasurementTool.module.css';

import { useRootStore } from '../stores/rootStore';
import { pushNotification } from '../stores/notificationStore';

type MeasurementPhase = 'idle' | 'placingStart' | 'placingEnd';

import { UnifiedCache, cacheRegistry } from '../utils/cacheManager';

// Height calculation cache (shared across renders)
interface HeightCacheEntry {
  text: string;
  x: number;
  y: number;
}

class HeightCalculationCache {
  private cache = new UnifiedCache<HeightCacheEntry>({
    name: 'measurement-height',
    maxSize: 50,
    evictionStrategy: 'lru'
  });
  private lastStartPoint: Point | null = null;

  constructor() {
    cacheRegistry.register('measurement-height', this.cache);
  }

  get(key: string, currentStartPoint: Point | null): HeightCacheEntry | null {
    if (currentStartPoint !== this.lastStartPoint) {
      this.cache.clear();
      this.lastStartPoint = currentStartPoint;
    }
    return this.cache.get(key);
  }

  set(key: string, value: HeightCacheEntry): void {
    this.cache.set(key, value);
  }
}

// Memoized canvas drawing component
const MeasurementCanvas = React.memo<{
  measurements: Measurement[];
  phase: MeasurementPhase;
  startPoint: Point | null;
  currentMousePos: Point | null;
  cameraParams: CameraParams | null;
  onnxDepthMap: OnnxDepthMap | null;
  depthData: DecodedDepthData | null;
  defaultUnit: string;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  overlayRef: React.RefObject<HTMLDivElement>;
}>(({ 
  measurements,
  phase,
  startPoint,
  currentMousePos,
  cameraParams,
  onnxDepthMap,
  depthData,
  defaultUnit,
  canvasRef,
  overlayRef
}) => {
  const heightCacheRef = useRef(new HeightCalculationCache());

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d', { alpha: false, desynchronized: true });
    const overlay = overlayRef.current;

    if (!context || !canvas || !overlay) return;

    const newWidth = overlay.offsetWidth;
    const newHeight = overlay.offsetHeight;
    
    // Only resize if dimensions changed
    if (canvas.width !== newWidth || canvas.height !== newHeight) {
      canvas.width = newWidth;
      canvas.height = newHeight;
    }

    // Use willReadFrequently: false for better performance
    context.clearRect(0, 0, canvas.width, canvas.height);

    // Draw existing measurements
    context.strokeStyle = '#ff00ff';
    context.fillStyle = '#ff00ff';
    context.lineWidth = 2;
    context.font = '12px Arial';
    context.textAlign = 'center';
    context.textBaseline = 'bottom';

    // Batch draw operations for better performance
    context.save();
    
    // Draw all measurement lines first
    context.strokeStyle = '#ff00ff';
    context.lineWidth = 2;
    context.beginPath();
    measurements.forEach(m => {
      if (m.kind !== 'distance' || !m.startPoint || !m.endPoint) return;
      context.moveTo(m.startPoint.x, m.startPoint.y);
      context.lineTo(m.endPoint.x, m.endPoint.y);
    });
    context.stroke();

    // Draw all measurement points
    context.fillStyle = '#ff00ff';
    measurements.forEach(m => {
      if (m.kind !== 'distance' || !m.startPoint || !m.endPoint) return;
      context.beginPath();
      context.arc(m.startPoint.x, m.startPoint.y, 5, 0, 2 * Math.PI);
      context.fill();
      context.beginPath();
      context.arc(m.endPoint.x, m.endPoint.y, 5, 0, 2 * Math.PI);
      context.fill();
    });

    // Draw all labels
    context.fillStyle = 'white';
    context.shadowColor = 'black';
    context.shadowBlur = 4;
    context.font = '12px Arial';
    context.textAlign = 'center';
    context.textBaseline = 'bottom';
    
    measurements.forEach(m => {
      if (m.kind !== 'distance' || !m.startPoint || !m.endPoint) return;
      const midX = (m.startPoint.x + m.endPoint.x) / 2;
      const midY = (m.startPoint.y + m.endPoint.y) / 2;
      const unitLabel = m.unit === 'metric' ? 'm' : 'ft';
      const distanceText = m.distance !== undefined ? m.distance.toFixed(2) : 'N/A';
      context.fillText(`${m.label}: ${distanceText}${unitLabel}`, midX + 10, midY);
    });
    
    context.shadowBlur = 0;
    context.restore();

    // Draw current measurement
    context.strokeStyle = '#00ffff';
    context.fillStyle = '#00ffff';
    context.lineWidth = 2;
    const pointRadius = 6; // Increased for better visibility

    if (startPoint) {
      // Draw outer glow for start point
      context.shadowColor = '#00ffff';
      context.shadowBlur = 10;
      context.beginPath();
      context.arc(startPoint.x, startPoint.y, pointRadius + 2, 0, Math.PI * 2);
      context.fill();

      // Draw inner point
      context.shadowBlur = 0;
      context.fillStyle = '#ffffff';
      context.beginPath();
      context.arc(startPoint.x, startPoint.y, pointRadius - 1, 0, Math.PI * 2);
      context.fill();

      // Reset shadow for line drawing
      context.shadowBlur = 0;
    }

    if (phase === 'placingEnd' && startPoint && currentMousePos) {
      // Draw measurement line with dashed style
      context.setLineDash([8, 4]);
      context.lineWidth = 3;
      context.strokeStyle = '#00ffff';
      context.beginPath();
      context.moveTo(startPoint.x, startPoint.y);
      context.lineTo(currentMousePos.x, currentMousePos.y);
      context.stroke();
      context.setLineDash([]);

      // Reset line width
      context.lineWidth = 2;

      // Draw end point with glow effect
      context.shadowColor = '#00ffff';
      context.shadowBlur = 8;
      context.fillStyle = '#00ffff';
      context.beginPath();
      context.arc(currentMousePos.x, currentMousePos.y, pointRadius + 1, 0, Math.PI * 2);
      context.fill();

      // Draw inner point
      context.shadowBlur = 0;
      context.fillStyle = '#ffffff';
      context.beginPath();
      context.arc(currentMousePos.x, currentMousePos.y, pointRadius - 1, 0, Math.PI * 2);
      context.fill();

      // Provisional height estimation (memoized to avoid recalculation on every frame)
      const viewWidth = overlay.offsetWidth;
      const viewHeight = overlay.offsetHeight;
      
      // Use a simple cache key based on mouse position (rounded to avoid excessive recalculation)
      const cacheKey = `${Math.round(currentMousePos.x / 5)}_${Math.round(currentMousePos.y / 5)}_${startPoint.x}_${startPoint.y}`;
      let cachedHeight = heightCacheRef.current.get(cacheKey, startPoint);

      if (!cachedHeight && cameraParams) {
        let distanceToBase: number | null = null;

        if (onnxDepthMap) {
          distanceToBase = estimateDistanceToPoint(
            startPoint.x,
            startPoint.y,
            viewWidth,
            viewHeight,
            cameraParams,
            onnxDepthMap
          );
        }

        if (distanceToBase === null) {
          const dir = screenToWorld(startPoint, cameraParams, viewWidth, viewHeight);
          const wp = estimateGroundPlaneIntersection(dir, cameraParams);
          if (wp) {
            distanceToBase = distance3D({ x: 0, y: 0, z: 0 }, wp);
          }
        }

        const estimatedHeight = calculateEstimatedHeight(
          startPoint,
          currentMousePos,
          viewWidth,
          viewHeight,
          cameraParams,
          depthData,
          distanceToBase
        );

        if (estimatedHeight !== null) {
          const { value: finalDistance, unitLabel } = convertLengthToDisplay(estimatedHeight, defaultUnit as 'metric' | 'imperial');

          if (finalDistance !== undefined) {
            const text = `${finalDistance.toFixed(2)}${unitLabel}`;
            cachedHeight = { text, x: currentMousePos.x, y: currentMousePos.y };
            heightCacheRef.current.set(cacheKey, cachedHeight);
          }
        }
      }

      if (cachedHeight) {
        const textMetrics = context.measureText(cachedHeight.text);
        const padding = 8;

        context.fillStyle = 'rgba(0, 0, 0, 0.8)';
        context.fillRect(
          cachedHeight.x + 15,
          cachedHeight.y - 25,
          textMetrics.width + padding * 2,
          20
        );

        // Draw text with better styling
        context.fillStyle = 'white';
        context.font = 'bold 14px Arial';
        context.shadowColor = 'black';
        context.shadowBlur = 2;
        context.fillText(
          cachedHeight.text,
          cachedHeight.x + 15 + padding,
          cachedHeight.y - 10
        );

        // Reset styling
        context.shadowBlur = 0;
        context.fillStyle = '#00ffff';
        context.font = '12px Arial';
      }
    }
  }, [
    measurements,
    phase,
    startPoint,
    currentMousePos,
    cameraParams,
    onnxDepthMap,
    depthData,
    defaultUnit,
    canvasRef,
    overlayRef,
  ]);

  // Optimize canvas redraws with RAF and debouncing
  const drawCanvasRef = useRef<() => void>(drawCanvas);
  drawCanvasRef.current = drawCanvas;

  useEffect(() => {
    let rafId: number | null = null;
    let lastDrawTime = 0;
    const minDrawInterval = 16; // ~60fps max

    // Capture canvas element reference to avoid stale closure in cleanup
    const canvasElement = canvasRef.current;

    const scheduleDraw = () => {
      const now = performance.now();
      const timeSinceLastDraw = now - lastDrawTime;

      if (timeSinceLastDraw >= minDrawInterval) {
        // Draw immediately if enough time has passed
        drawCanvasRef.current();
        lastDrawTime = now;
      } else {
        // Schedule for next frame
        if (rafId === null) {
          rafId = requestAnimationFrame(() => {
            drawCanvasRef.current();
            lastDrawTime = performance.now();
            rafId = null;
          });
        }
      }
    };

    // Initial draw
    scheduleDraw();

    // Listen for resize events with debouncing
    let resizeTimeout: ReturnType<typeof setTimeout> | null = null;
    const handleResize = () => {
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        scheduleDraw();
        resizeTimeout = null;
      }, 150);
    };

    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      if (resizeTimeout) clearTimeout(resizeTimeout);
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      // Use captured canvas element reference
      if (canvasElement) {
        const context = canvasElement.getContext('2d');
        if (context) {
          context.clearRect(0, 0, canvasElement.width, canvasElement.height);
          canvasElement.width = 0;
          canvasElement.height = 0;
        }
      }
    };
  }, [measurements, phase, startPoint, currentMousePos, cameraParams, onnxDepthMap, depthData, defaultUnit, canvasRef]);

  return <canvas ref={canvasRef} className={styles['measurementCanvas']} />;
});

MeasurementCanvas.displayName = 'MeasurementCanvas';

// Memoized status indicator component
const StatusIndicator = React.memo<{
  phase: MeasurementPhase;
  startPoint: Point | null;
}>(({ phase, startPoint }) => {
  const statusStyle = useMemo(() => ({
    position: 'absolute' as const,
    bottom: '20px',
    left: '10px',
    color: 'white',
    backgroundColor: 'rgba(0,0,0,0.8)',
    padding: '8px 12px',
    borderRadius: '6px',
    fontSize: '0.9em',
    fontWeight: 'bold',
    pointerEvents: 'none' as const,
    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
    border: '2px solid rgba(0,255,255,0.5)',
    minWidth: '250px'
  }), []);

  const stepStyle = useMemo(() => ({
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '4px'
  }), []);

  const message = useMemo(() => {
    return !startPoint
      ? 'Step 1: Click the BASE of the object you want to measure'
      : 'Step 2: Click the TOP of the object to complete measurement';
  }, [startPoint]);

  if (phase === 'idle') return null;

  return (
    <div style={statusStyle} role="status" aria-live="polite">
      <div style={stepStyle}>
        <div style={{
          width: '12px',
          height: '12px',
          borderRadius: '50%',
          backgroundColor: startPoint ? '#00ff00' : '#ffff00',
          boxShadow: '0 0 6px rgba(255,255,0,0.8)'
        }} />
        <span>{message}</span>
      </div>
      <div style={{ fontSize: '0.8em', opacity: 0.8 }}>
        Press <kbd style={{
          backgroundColor: 'rgba(255,255,255,0.2)',
          padding: '2px 4px',
          borderRadius: '3px',
          fontSize: '0.9em'
        }}>Esc</kbd> to cancel
      </div>
    </div>
  );
});

StatusIndicator.displayName = 'StatusIndicator';

// Memoized start button component
const StartButton = React.memo<{
  phase: MeasurementPhase;
  cameraParams: CameraParams | null;
  onnxDepthMap: OnnxDepthMap | null;
  depthData: DecodedDepthData | null;
  isCalibrated: boolean;
  onStartMeasurement: () => void;
}>(({ phase, cameraParams, onnxDepthMap, depthData, isCalibrated, onStartMeasurement }) => {
  const buttonStyle = useMemo(() => ({
    position: 'absolute' as const,
    bottom: '20px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 10,
    padding: '12px 20px',
    fontSize: '14px',
    fontWeight: 'bold',
    borderRadius: '8px',
    border: '2px solid',
    cursor: (cameraParams && (onnxDepthMap || depthData)) ? 'pointer' : 'not-allowed',
    pointerEvents: 'auto' as const,
    transition: 'all 0.2s ease',
    minWidth: '140px',
    textAlign: 'center' as const
  } as React.CSSProperties), [cameraParams, onnxDepthMap, depthData]);

  const isDisabled = !cameraParams || (!onnxDepthMap && !depthData);
  
  const getTitle = useCallback(() => {
    if (!cameraParams) return "Waiting for camera parameters...";
    if (!onnxDepthMap && !depthData) return "Generate Depth Map first!";
    if (!isCalibrated) return "Optional: calibrate horizon for best accuracy. Start anyway.";
    return "Start Height Estimation (M)";
  }, [cameraParams, onnxDepthMap, depthData, isCalibrated]);

  const getButtonText = useCallback(() => {
    if (!cameraParams) return 'Waiting for Camera...';
    if (!onnxDepthMap && !depthData) return 'Generate Depth Map';
    return isCalibrated ? 'Estimate Height (M)' : 'Estimate Height (Uncalibrated)';
  }, [cameraParams, onnxDepthMap, depthData, isCalibrated]);

  const getButtonStyles = useCallback(() => {
    const baseStyles = { ...buttonStyle };

    if (isDisabled) {
      baseStyles.backgroundColor = '#6c757d';
      baseStyles.borderColor = '#5a6268';
      baseStyles.color = '#adb5bd';
    } else {
      baseStyles.backgroundColor = '#007bff';
      baseStyles.borderColor = '#0056b3';
      baseStyles.color = 'white';

      // Add hover effect
      if (cameraParams && (onnxDepthMap || depthData)) {
        (baseStyles as any).boxShadow = '0 4px 12px rgba(0,123,255,0.3)';
      }
    }

    return baseStyles;
  }, [buttonStyle, isDisabled, cameraParams, onnxDepthMap, depthData]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (phase === 'idle') {
      onStartMeasurement();
    }
  }, [phase, onStartMeasurement]);

  if (phase !== 'idle') return null;

  return (
    <button
      onClick={handleClick}
      disabled={isDisabled}
      title={getTitle()}
      style={getButtonStyles()}
      aria-label={getTitle()}
      role="button"
    >
      {getButtonText()}
    </button>
  );
});

StartButton.displayName = 'StartButton';

const MeasurementTool: React.FC = () => {
  const measurements = useRootStore((state) => state.measurements);
  const addMeasurement = useRootStore((state) => state.addMeasurement);
  const currentCameraParams = useRootStore((state) => state.currentCameraParams);
  const onnxDepthMap = useRootStore((state) => state.onnxDepthMap);
  const depthData = useRootStore((state) => state.depthData);
  const updateSettings = useRootStore((state) => state.updateSettings);
  const isCalibrated = useRootStore((state) => state.isCalibrated);
  const defaultUnit = useRootStore((state) => state.settings.defaultUnit);
  const autoCalibrateDepth = useRootStore((state) => state.settings.autoCalibrateDepth ?? false);
  const depthKernelSize = useRootStore((state) => state.settings.depthKernelSize ?? 5);
  const depthUseBilinear = useRootStore((state) => state.settings.depthUseBilinear ?? true);
  const depthEdgeRejectThreshold = useRootStore((state) => state.settings.depthEdgeRejectThreshold ?? 0.35);
  const depthScale = useRootStore((state) => state.settings.depthScale ?? 1);
  const depthBias = useRootStore((state) => state.settings.depthBias ?? 0);

  const [phase, setPhase] = useState<MeasurementPhase>('idle');
  const [startPoint, setStartPoint] = useState<Point | null>(null);
  const [currentMousePos, setCurrentMousePos] = useState<Point | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const applyCalTimerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingMousePosRef = useRef<Point | null>(null);

  const hasDepthSupport = useMemo(() => Boolean(onnxDepthMap || depthData), [onnxDepthMap, depthData]);
  const showEstimatePrompt = useMemo(
    () => phase === 'idle' && hasDepthSupport,
    [phase, hasDepthSupport]
  );

  const getClickCoords = useCallback((event: React.MouseEvent<HTMLDivElement>): Point | null => {
    const rect = overlayRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }, []);

  const completeMeasurement = useCallback((startPoint: Point, coords: Point) => {
    console.log('[measure] completeMeasurement called with:', { startPoint, coords, cameraParams: !!currentCameraParams, onnxDepthMap: !!onnxDepthMap });

    // Input validation
    if (!startPoint || !coords) {
      console.error('[measure] Invalid input points');
      pushNotification({
        kind: 'error',
        message: 'Invalid measurement points. Please try again.',
      });
      setStartPoint(null);
      setPhase('idle');
      return;
    }

    if (!currentCameraParams) {
      console.error('[measure] No camera params available');
      pushNotification({
        kind: 'error',
        message: 'Camera parameters not available. Please wait for the panorama to load completely.',
      });
      setStartPoint(null);
      setPhase('idle');
      return;
    }

    // Validate depth data availability
    if (!onnxDepthMap && !depthData) {
      console.error('[measure] No depth data available');
      pushNotification({
        kind: 'warning',
        message: 'Depth data is required for measurements. Generate a depth map first.',
      });
      setStartPoint(null);
      setPhase('idle');
      return;
    }

    const viewWidth = overlayRef.current?.offsetWidth || 640;
    const viewHeight = overlayRef.current?.offsetHeight || 640;
    console.log('[measure] View dimensions:', { viewWidth, viewHeight });

    // Enforce vertical snapping for calculation: keep X aligned with base
    const snappedEnd: Point = { x: startPoint.x, y: coords.y };

    // Distance estimates
    let distanceToBase: number | null = null;
    // Vertical height derived from Street View depth planes
    let planeHeight: number | null = null;
    let source: 'planes' | 'onnx' | 'ground' | undefined;
    let confidence = 0.0;

    let worldStart: Vector3 | null = null;
    let worldEnd: Vector3 | null = null;

    // When Street View depth planes are available, compute world points directly
    if (depthData) {
      worldStart = screenToWorldWithDepth(startPoint, currentCameraParams, viewWidth, viewHeight, depthData);
      worldEnd = screenToWorldWithDepth(snappedEnd, currentCameraParams, viewWidth, viewHeight, depthData);
      if (worldStart && worldEnd) {
        // Use vertical component of world coordinates for height
        planeHeight = Math.abs(worldEnd.y - worldStart.y);
        distanceToBase = distance3D({ x: 0, y: 0, z: 0 }, worldStart);
        console.log('[measure] plane vertical height:', planeHeight, 'base distance from planes:', distanceToBase);
        source = 'planes';
        // Higher confidence when planes succeed and distance is reasonable
        const distOk = distanceToBase > 0.5 && distanceToBase < 200;
        confidence = distOk ? 0.9 : 0.7;

        // Optional auto-calibration: compare ONNX predicted distance at base vs plane distance
        if (autoCalibrateDepth && onnxDepthMap) {
          const onnxDist = estimateDistanceToPoint(
            startPoint.x,
            startPoint.y,
            viewWidth,
            viewHeight,
            currentCameraParams,
            onnxDepthMap,
            {
              depthKernelSize: depthKernelSize as 3|5|7,
              depthUseBilinear,
              depthEdgeRejectThreshold,
            }
          );
          if (onnxDist && distanceToBase) {
            calibrationManager.addSample(onnxDist, distanceToBase);
            const proposal = calibrationManager.computeScaleBias();
            if (proposal) {
              const scaleDelta = Math.abs(depthScale - proposal.scale);
              const biasDelta = Math.abs(depthBias - proposal.bias);
              const shouldPropose = scaleDelta > 0.02 || biasDelta > 0.05;
              if (shouldPropose) {
                // One-time confirmation per session
                const confirmed = sessionStorage.getItem('autoCalConfirmed') === '1' || window.confirm(`Apply new depth calibration?\nScale: ${proposal.scale.toFixed(3)}  Bias: ${proposal.bias.toFixed(3)}`);
                if (!confirmed) {
                  // Remember decline only for this prompt occurrence
                } else {
                  sessionStorage.setItem('autoCalConfirmed', '1');
                  if (applyCalTimerRef.current) {
                    clearTimeout(applyCalTimerRef.current);
                  }
                  applyCalTimerRef.current = window.setTimeout(() => {
                    updateSettings({ depthScale: proposal.scale, depthBias: proposal.bias });
                    const newSettings = { ...useRootStore.getState().settings, depthScale: proposal.scale, depthBias: proposal.bias };
                    window.electronAPI?.invoke('save-settings', newSettings).catch(() => {});
                  }, 1500);
                }
              }
            }
          }
        }
      }
    }

    // Fall back to ONNX depth for distance to base
    if (distanceToBase === null && onnxDepthMap) {
      distanceToBase = estimateDistanceToPoint(
        startPoint.x,
        startPoint.y,
        viewWidth,
        viewHeight,
        currentCameraParams,
        onnxDepthMap,
        {
          depthKernelSize: depthKernelSize as 3|5|7,
          depthUseBilinear,
          depthEdgeRejectThreshold,
        }
      );
      console.log('[measure] Depth map distance:', distanceToBase);
      if (distanceToBase !== null) {
        source = 'onnx';
        const distOk = distanceToBase > 0.5 && distanceToBase < 200;
        confidence = Math.max(confidence, distOk ? 0.6 : 0.4);
      }
    }

    // Always compute a ground-plane base distance as a stable anchor
    try {
      if (currentCameraParams) {
        const dirBase = screenToWorld(startPoint, currentCameraParams, viewWidth, viewHeight);
        const wpBase = estimateGroundPlaneIntersection(dirBase, currentCameraParams);
        if (wpBase) {
          const gpDist = distance3D({ x: 0, y: 0, z: 0 }, wpBase);
          // Use ground-plane distance if primary estimate is missing or clearly unreasonable
          if (distanceToBase === null || !Number.isFinite(distanceToBase) || distanceToBase <= 0.1) {
            distanceToBase = gpDist;
          }
        }
      }
    } catch {}

    if (distanceToBase === null) {
      // fallback to ground plane
      const dir = screenToWorld(startPoint, currentCameraParams, viewWidth, viewHeight);
      const wp = estimateGroundPlaneIntersection(dir, currentCameraParams);
      if (wp) {
        distanceToBase = distance3D({x:0,y:0,z:0}, wp);
        console.log('[measure] fallback ground-plane distance', distanceToBase);
        source = 'ground';
        confidence = Math.max(confidence, 0.3);
      } else {
        console.warn('[measure] unable to get ground-plane fallback');
      }
    } else {
      console.log('[measure] kernel depth distance', distanceToBase);
    }

    if (distanceToBase === null && planeHeight === null) {
      console.error('[measure] No distance or height calculated');
      pushNotification({
        kind: 'error',
        message: 'Could not calculate measurement. Ensure both points are on visible surfaces and try again.',
      });
      setStartPoint(null);
      setPhase('idle');
      return;
    }

    // Height from ONNX depth
    let estimatedHeight: number | null = null;
    if (distanceToBase !== null) {
      estimatedHeight = calculateEstimatedHeight(
        startPoint,
        snappedEnd,
        viewWidth,
        viewHeight,
        currentCameraParams,
        depthData,
        distanceToBase
      );
      console.log('[measure] Estimated height:', estimatedHeight);
    }

    // Choose the most reliable height estimate
    let finalHeight: number | null = null;
    if (planeHeight !== null) {
      // Depth planes succeeded; prefer this direct measurement
      finalHeight = planeHeight;
      source = source ?? 'planes';
    } else {
      finalHeight = estimatedHeight;
    }

    if (finalHeight === null) {
      console.error('[measure] No height calculated');
      pushNotification({
        kind: 'error',
        title: 'Invalid Measurement',
        message: 'Could not calculate height. Ensure both points are on measurable surfaces.',
        timeoutMs: 5000
      });
      setStartPoint(null);
      setPhase('idle');
      return;
    }

    // Validate measurement results
    if (!Number.isFinite(finalHeight) || finalHeight <= 0) {
      console.error('[measure] Invalid height result:', finalHeight);
      pushNotification({
        kind: 'error',
        title: 'Invalid Measurement',
        message: 'Invalid measurement result. Please try different points.',
        timeoutMs: 5000
      });
      setStartPoint(null);
      setPhase('idle');
      return;
    }

    // Warn if confidence is low
    if (confidence < 0.3) {
      pushNotification({
        kind: 'warning',
        title: 'Low Confidence Measurement',
        message: `Measurement confidence is ${Math.round(confidence * 100)}%. Results may be inaccurate.`,
        timeoutMs: 5000
      });
    }

    // Check for unrealistic measurements (likely calibration issues)
    if (finalHeight > 1000) { // 1000m = ~3000ft
      console.warn('[measure] Unrealistic height detected:', finalHeight);
      pushNotification({
        kind: 'warning',
        message: 'Measurement result seems unrealistic. Please confirm your horizon calibration.',
      });
    }

    // Convert to display value
    const { value: finalDistance } = convertLengthToDisplay(finalHeight, defaultUnit as 'metric' | 'imperial');
    const measurementConfidence = Math.min(1, Math.max(0, confidence));

    const newMeasurement: Omit<Measurement, 'id' | 'timestamp' | 'name'> = {
      kind: 'distance',
      label: 'Est. Height',
      distanceMeters: finalHeight,
      distance: finalDistance ?? finalHeight,
      startPoint,
      endPoint: snappedEnd,
      unit: defaultUnit,
      panoId: currentCameraParams.panoId ?? currentCameraParams.pano,
      cameraParams: currentCameraParams,
      source: source ?? 'ground',
      confidence: measurementConfidence,
      metadata: {
        distanceToBase,
        planeHeight,
        estimatedHeight,
        baseWorld: worldStart,
        topWorld: worldEnd,
      },
    };
    console.log('[measure] Creating measurement:', newMeasurement);
    addMeasurement(newMeasurement);

    // Visual feedback: show success notification
    pushNotification({
      kind: 'success',
      title: 'Measurement Added',
      message: `${finalDistance?.toFixed(2) ?? finalHeight.toFixed(2)} ${defaultUnit === 'metric' ? 'm' : 'ft'} (confidence: ${Math.round(measurementConfidence * 100)}%)`,
      timeoutMs: 3000
    });

    console.log('[measure] Resetting measurement state');
    setStartPoint(null);
    setCurrentMousePos(null);
    setPhase('idle');
  }, [
    currentCameraParams,
    onnxDepthMap,
    depthData,
    defaultUnit,
    addMeasurement,
    autoCalibrateDepth,
    depthKernelSize,
    depthUseBilinear,
    depthEdgeRejectThreshold,
    depthScale,
    depthBias,
    updateSettings,
  ]);

  const handleOverlayClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    console.log('[measure] Click detected, phase:', phase);

    if (phase === 'idle') {
      console.log('[measure] Ignoring click while idle');
      return;
    }

    if (!hasDepthSupport) {
      console.log('[measure] Prerequisites missing, ignoring click');
      return;
    }

    if (phase === 'placingStart') {
      // Handle the first click when starting from button
      const coords = getClickCoords(event);
      console.log('[measure] First click (placingStart), coords:', coords);
      if (coords) {
        setStartPoint(coords);
        setPhase('placingEnd');
      }
    } else if (phase === 'placingEnd') {
      const coords = getClickCoords(event);
      console.log('[measure] Completing measurement, coords:', coords, 'startPoint:', startPoint);
      if (coords && startPoint) {
        completeMeasurement(startPoint, coords);
      } else if (coords && !startPoint) {
        // If we're in placingEnd but no startPoint, this is the first click
        console.log('[measure] First click in placingEnd, setting startPoint');
        setStartPoint(coords);
      }
    }
  }, [
    phase,
    startPoint,
    getClickCoords,
    completeMeasurement,
    hasDepthSupport
  ]);

  const handleMouseMove = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (phase === 'placingEnd') {
      const coords = getClickCoords(event);
      
      if (!coords) return;
      
      // Store pending position
      pendingMousePosRef.current = coords;
      
      // Cancel previous RAF if pending
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      
      // Schedule update on next animation frame
      rafRef.current = requestAnimationFrame(() => {
        const pending = pendingMousePosRef.current;
        if (pending) {
          setCurrentMousePos(pending);
          pendingMousePosRef.current = null;
        }
        rafRef.current = null;
      });
    }
  }, [phase, getClickCoords]);

  // Cleanup RAF on unmount or phase change
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [phase]);

  const startMeasurement = useCallback(() => {
    console.log('[measure] startMeasurement called');

    // Validate prerequisites with detailed error messages
    if (!currentCameraParams) {
      pushNotification({
        kind: 'info',
        message: 'Camera parameters not yet available. Please wait for the Street View panorama to load completely.',
      });
      return;
    }

    if (!hasDepthSupport) {
      pushNotification({
        kind: 'warning',
        message: 'Depth data is required. Generate a depth map for this location.',
      });
      return;
    }

    if (!isCalibrated) {
      pushNotification({
        kind: 'info',
        message: 'Measuring without horizon calibration. Results may be less accurate. You can calibrate anytime for best accuracy.',
      });
    }

    // Additional validation
    if (!currentCameraParams.panoId) {
      pushNotification({
        kind: 'error',
        message: 'Invalid panorama data. Please try a different location.',
      });
      return;
    }

    setPhase('placingStart');
    setStartPoint(null);
    setCurrentMousePos(null);
  }, [currentCameraParams, hasDepthSupport, isCalibrated]);

  // Undo/Redo functionality
  const undoMeasurement = useRootStore((state) => state.undoMeasurement);
  const redoMeasurement = useRootStore((state) => state.redoMeasurement);
  const canUndo = useRootStore((state) => state.canUndo());
  const canRedo = useRootStore((state) => state.canRedo());

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null): boolean => {
      const el = target as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
      if (el.isContentEditable) return true;
      if (el.getAttribute('role') === 'combobox') return true;
      return false;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const key = (event.key || '').toLowerCase();
      const isCtrlOrCmd = event.ctrlKey || event.metaKey;
      
      // Handle undo/redo (Ctrl+Z, Ctrl+Y or Ctrl+Shift+Z)
      if (isCtrlOrCmd && !isEditableTarget(event.target)) {
        if (key === 'z' && !event.shiftKey) {
          event.preventDefault();
          if (canUndo) {
            undoMeasurement();
          }
          return;
        } else if ((key === 'y' || (key === 'z' && event.shiftKey)) && canRedo) {
          event.preventDefault();
          redoMeasurement();
          return;
        }
      }

      // Ignore when typing in inputs or when modifiers are pressed (except for undo/redo above)
      if (isEditableTarget(event.target) || (isCtrlOrCmd && key !== 'z' && key !== 'y')) {
        return;
      }

      if (key === 'm' && phase === 'idle') {
        event.preventDefault();
        startMeasurement();
      } else if (key === 'escape' && phase !== 'idle') {
        event.preventDefault();
        setPhase('idle');
        setStartPoint(null);
        setCurrentMousePos(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [phase, startMeasurement, undoMeasurement, redoMeasurement, canUndo, canRedo]);

  const overlayClassName = useMemo(() =>
    `${styles['overlay']} ${phase !== 'idle' ? styles['overlayActive'] : ''}`,
    [phase]
  );

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
          <h3 style={{ margin: '0 0 8px 0', color: '#495057' }}>Measurement Tool Error</h3>
          <p style={{ margin: '0 0 16px 0', maxWidth: '400px' }}>
            The measurement tool encountered an error. Please try refreshing the page or contact support if the problem persists.
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
            Refresh Page
          </button>
        </div>
      }
    >
      <div
        ref={overlayRef}
        className={overlayClassName}
        onClick={handleOverlayClick}
        onMouseMove={handleMouseMove}
        role="button"
        tabIndex={0}
        aria-label="Measurement overlay - click to place measurement points"
        aria-disabled={phase === 'idle'}
        data-testid="measurement-overlay"
      >
        {showEstimatePrompt && (
          <div className={styles['estimatePrompt']} role="status" aria-live="polite">
            {isCalibrated
              ? 'Calibration complete! Press "Estimate Height" (or tap M) to begin measuring.'
              : 'Depth ready. For best accuracy, calibrate the horizon (optional). Press "Estimate Height" (or tap M) to start.'}
          </div>
        )}
        <StartButton
          phase={phase}
          cameraParams={currentCameraParams}
          onnxDepthMap={onnxDepthMap}
          depthData={depthData}
          isCalibrated={isCalibrated}
          onStartMeasurement={startMeasurement}
        />
        <StatusIndicator phase={phase} startPoint={startPoint} />
        <MeasurementCanvas
          measurements={measurements}
          phase={phase}
          startPoint={startPoint}
          currentMousePos={currentMousePos}
          cameraParams={currentCameraParams}
          onnxDepthMap={onnxDepthMap}
          depthData={depthData}
          defaultUnit={defaultUnit}
          canvasRef={canvasRef}
          overlayRef={overlayRef}
        />
      </div>
    </ErrorBoundary>
  );
};

export default React.memo(MeasurementTool);
