import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type {
  Point,
  Measurement,
  CameraParams,
  OnnxDepthMap,
  DecodedDepthData,
} from '../types/common';
import { UNIT_CONVERSIONS } from '../types/common';
import { estimateDistanceToPoint, calculateEstimatedHeight } from '../services/measurementLogic';
import { calibrationManager } from '../services/depthCalibration';
import { invalidateDepthCacheForCalibration } from '../services/depth';
import { screenToWorld, estimateGroundPlaneIntersection, calculateDistance3D, screenToWorldWithDepth } from '../services/geometry';
import styles from './MeasurementTool.module.css';

import { useRootStore } from '../stores/rootStore';

type MeasurementPhase = 'idle' | 'placingStart' | 'placingEnd';

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
  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    const overlay = overlayRef.current;

    if (!context || !canvas || !overlay) return;

    canvas.width = overlay.offsetWidth;
    canvas.height = overlay.offsetHeight;

    context.clearRect(0, 0, canvas.width, canvas.height);

    // Draw existing measurements
    context.strokeStyle = '#ff00ff';
    context.fillStyle = '#ff00ff';
    context.lineWidth = 2;
    context.font = '12px Arial';
    context.textAlign = 'center';
    context.textBaseline = 'bottom';

    measurements.forEach(m => {
      if (!m.startPoint || !m.endPoint) return;

      context.beginPath();
      context.arc(m.startPoint.x, m.startPoint.y, 5, 0, 2 * Math.PI);
      context.fill();

      context.beginPath();
      context.arc(m.endPoint.x, m.endPoint.y, 5, 0, 2 * Math.PI);
      context.fill();

      context.beginPath();
      context.moveTo(m.startPoint.x, m.startPoint.y);
      context.lineTo(m.endPoint.x, m.endPoint.y);
      context.stroke();

      const midX = (m.startPoint.x + m.endPoint.x) / 2;
      const midY = (m.startPoint.y + m.endPoint.y) / 2;
      context.fillStyle = 'white';
      context.shadowColor = 'black';
      context.shadowBlur = 4;
      
      const unitLabel = m.unit === 'metric' ? 'm' : 'ft';
      context.fillText(`${m.label}: ${m.distance.toFixed(2)}${unitLabel}`, midX + 10, midY);
      context.shadowBlur = 0;
      context.fillStyle = '#ff00ff';
    });

    // Draw current measurement
    context.strokeStyle = '#00ffff';
    context.fillStyle = '#00ffff';
    context.lineWidth = 2;
    const pointRadius = 4;

    if (startPoint) {
      context.beginPath();
      context.arc(startPoint.x, startPoint.y, pointRadius, 0, Math.PI * 2);
      context.fill();
    }

    if (phase === 'placingEnd' && startPoint && currentMousePos) {
      context.beginPath();
      context.moveTo(startPoint.x, startPoint.y);
      context.lineTo(currentMousePos.x, currentMousePos.y);
      context.setLineDash([5, 5]);
      context.stroke();
      context.setLineDash([]);

      context.beginPath();
      context.arc(currentMousePos.x, currentMousePos.y, pointRadius, 0, Math.PI * 2);
      context.fill();

      // Provisional height estimation
      const viewWidth = overlay.offsetWidth;
      const viewHeight = overlay.offsetHeight;
      let distanceToBase: number | null = null;

      if (cameraParams) {
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
            distanceToBase = calculateDistance3D({ x: 0, y: 0, z: 0 }, wp);
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
          const finalDistance =
            defaultUnit === 'imperial'
              ? UNIT_CONVERSIONS.metersToFeet(estimatedHeight)
              : estimatedHeight;
          const unitLabel = defaultUnit === 'metric' ? 'm' : 'ft';

          context.fillStyle = 'white';
          context.shadowColor = 'black';
          context.shadowBlur = 4;
          context.fillText(
            `${finalDistance.toFixed(2)}${unitLabel}`,
            currentMousePos.x + 10,
            currentMousePos.y - 10
          );
          context.shadowBlur = 0;
          context.fillStyle = '#00ffff';
        }
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

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  return <canvas ref={canvasRef} className={styles.measurementCanvas} />;
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
    backgroundColor: 'rgba(0,0,0,0.6)',
    padding: '5px 10px',
    borderRadius: '4px',
    fontSize: '0.9em',
    pointerEvents: 'none' as const
  }), []);

  const message = useMemo(() => {
    return !startPoint ? 'Step 1: Click object BASE' : 'Step 2: Click object TOP';
  }, [startPoint]);

  if (phase === 'idle') return null;

  return (
    <div style={statusStyle} role="status" aria-live="polite">
      {message} (Esc to cancel)
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
  isGeneratingMap: boolean;
}>(({ phase, cameraParams, onnxDepthMap, depthData, isCalibrated, onStartMeasurement, isGeneratingMap }) => {
  const isDisabled =
    isGeneratingMap ||
    !cameraParams ||
    (!onnxDepthMap && !depthData) ||
    !isCalibrated;

  const buttonStyle = useMemo(() => ({
    position: 'absolute' as const,
    bottom: '20px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 10,
    padding: '10px 15px',
    cursor: isDisabled ? 'not-allowed' : 'pointer',
    pointerEvents: 'auto' as const
  }), [isDisabled]);

  const getTitle = useCallback(() => {
    if (!cameraParams) return "Waiting for camera parameters...";
    if (!onnxDepthMap && !depthData) return "Generate Depth Map first!";
    if (!isCalibrated) return "Calibrate horizon first!";
    if (isGeneratingMap) return 'Generating depth map...';
    return "Start Height Estimation (M)";
  }, [cameraParams, onnxDepthMap, depthData, isCalibrated, isGeneratingMap]);

  const getButtonText = useCallback(() => {
    if (!cameraParams) return 'Waiting for Camera...';
    if (!onnxDepthMap && !depthData) return 'Depth Data Needed';
    if (!isCalibrated) return 'Calibrate Horizon First';
    if (isGeneratingMap) return 'Generating Depth Map...';
    return 'Estimate Height (M)';
  }, [cameraParams, onnxDepthMap, depthData, isCalibrated, isGeneratingMap]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (phase === 'idle' && !isDisabled) {
      onStartMeasurement();
    }
  }, [phase, onStartMeasurement, isDisabled]);

  if (phase !== 'idle') return null;

  return (
    <button
      onClick={handleClick}
      disabled={isDisabled}
      title={getTitle()}
      style={buttonStyle}
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
  const setOnnxDepthMap = useRootStore((state) => state.setOnnxDepthMap);
  const depthData = useRootStore((state) => state.depthData);
  const updateSettings = useRootStore((state) => state.updateSettings);
  const isCalibrated = useRootStore((state) => state.isCalibrated);
  const onGenerateDepthMap = useRootStore((state) => state.onGenerateDepthMap);
  const isGeneratingMap = useRootStore((state) => state.isGeneratingMap);
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
    
    if (!currentCameraParams) {
      console.log('[measure] No camera params, resetting');
      setStartPoint(null);
      setPhase('idle');
      return;
    }

    const viewWidth = overlayRef.current?.offsetWidth || 640;
    const viewHeight = overlayRef.current?.offsetHeight || 640;
    console.log('[measure] View dimensions:', { viewWidth, viewHeight });

    // Distance estimates
    let distanceToBase: number | null = null;
    // Vertical height derived from Street View depth planes
    let planeHeight: number | null = null;
    let source: 'planes' | 'onnx' | 'ground' | undefined;
    let confidence = 0.0;

    // When Street View depth planes are available, compute world points directly
    if (depthData) {
      const worldStart = screenToWorldWithDepth(startPoint, currentCameraParams, viewWidth, viewHeight, depthData);
      const worldEnd = screenToWorldWithDepth(coords, currentCameraParams, viewWidth, viewHeight, depthData);
      if (worldStart && worldEnd) {
        // Use vertical component of world coordinates for height
        planeHeight = Math.abs(worldEnd.y - worldStart.y);
        distanceToBase = calculateDistance3D({ x: 0, y: 0, z: 0 }, worldStart);
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
                    void (async () => {
                      updateSettings({ depthScale: proposal.scale, depthBias: proposal.bias });
                      const newSettings = { ...useRootStore.getState().settings, depthScale: proposal.scale, depthBias: proposal.bias };
                      await invalidateDepthCacheForCalibration({
                        setOnnxDepthMap,
                        onGenerateDepthMap,
                      });
                      try {
                        await window.electronAPI?.invoke('save-settings', newSettings);
                      } catch {
                        // ignore persistence errors for auto calibration updates
                      }
                    })();
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

    if (distanceToBase === null) {
      // fallback to ground plane
      const dir = screenToWorld(startPoint, currentCameraParams, viewWidth, viewHeight);
      const wp = estimateGroundPlaneIntersection(dir, currentCameraParams);
      if (wp) {
        distanceToBase = calculateDistance3D({x:0,y:0,z:0}, wp);
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
      console.log('[measure] No distance calculated, resetting');
      setStartPoint(null);
      setPhase('idle');
      return;
    }

    // Height from ONNX depth
    let estimatedHeight: number | null = null;
    if (distanceToBase !== null) {
      estimatedHeight = calculateEstimatedHeight(
        startPoint,
        coords,
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
      console.log('[measure] No height calculated, resetting');
      setStartPoint(null);
      setPhase('idle');
      return;
    }

    // Convert to imperial if needed
    const finalDistance = defaultUnit === 'imperial'
      ? UNIT_CONVERSIONS.metersToFeet(finalHeight)
      : finalHeight;

    const newMeasurement: Omit<Measurement, 'id' | 'timestamp' | 'name'> = {
      label: 'Est. Height',
      distanceMeters: finalHeight,
      distance: finalDistance,
      startPoint: startPoint,
      endPoint: coords,
      unit: defaultUnit,
    };
    (newMeasurement as any).source = source;
    (newMeasurement as any).confidence = Math.min(1, Math.max(0, confidence));
    console.log('[measure] Creating measurement:', newMeasurement);
    addMeasurement(newMeasurement);

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
    setOnnxDepthMap,
    onGenerateDepthMap,
  ]);

  const handleOverlayClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    console.log('[measure] Click detected, phase:', phase);
    if (phase === 'idle') {
      const coords = getClickCoords(event);
      console.log('[measure] Starting measurement, coords:', coords);
      if (coords) {
        setStartPoint(coords);
        setPhase('placingEnd');
      }
    } else if (phase === 'placingStart') {
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
  }, [phase, startPoint, getClickCoords, completeMeasurement]);

  const handleMouseMove = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (phase === 'placingEnd') {
      const coords = getClickCoords(event);
      setCurrentMousePos(coords);
    }
  }, [phase, getClickCoords]);

  const startMeasurement = useCallback(async () => {
    console.log('[measure] startMeasurement called');
    if (!currentCameraParams) {
      alert("Camera parameters not yet available. Please wait a moment.");
      return;
    }

    if (isGeneratingMap) {
      console.log('[measure] Depth map generation already in progress, deferring measurement start');
      return;
    }

    if (!onnxDepthMap && !depthData) {
      if (onGenerateDepthMap) {
        await onGenerateDepthMap();
      }
    }

    setPhase('placingEnd');
    setStartPoint(null);
    setCurrentMousePos(null);
  }, [currentCameraParams, onnxDepthMap, depthData, onGenerateDepthMap, isGeneratingMap]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'm' && phase === 'idle') {
        event.preventDefault();
        startMeasurement();
      } else if (event.key === 'Escape' && phase !== 'idle') {
        event.preventDefault();
        setPhase('idle');
        setStartPoint(null);
        setCurrentMousePos(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [phase, startMeasurement]);

  const overlayClassName = useMemo(() => 
    `${styles.overlay} ${phase !== 'idle' ? styles.overlayActive : ''}`, 
    [phase]
  );

  return (
    <div 
      ref={overlayRef}
      className={overlayClassName}
      onClick={handleOverlayClick}
      onMouseMove={handleMouseMove}
      role="button"
      tabIndex={0}
      aria-label="Measurement overlay - click to place measurement points"
    >
      <StartButton
        phase={phase}
        cameraParams={currentCameraParams}
        onnxDepthMap={onnxDepthMap}
        depthData={depthData}
        isCalibrated={isCalibrated}
        onStartMeasurement={startMeasurement}
        isGeneratingMap={isGeneratingMap}
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
  );
};

export default React.memo(MeasurementTool);
