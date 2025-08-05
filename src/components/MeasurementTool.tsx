import React, { useState, useEffect, useRef, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Point, Measurement, CameraParams, OnnxDepthMap, UNIT_CONVERSIONS } from '../types/common';
import { estimateDistanceToPoint, calculateEstimatedHeight } from '../services/measurementLogic';
import { screenToWorld, estimateGroundPlaneIntersection, calculateDistance3D } from '../services/geometry';
import styles from './MeasurementTool.module.css';

interface MeasurementToolProps {
  cameraParams: CameraParams | null;
  onnxDepthMap: OnnxDepthMap | null;
  onMeasurementComplete: (measurement: Measurement) => void;
  measurements: Measurement[];
  currentUnit?: 'metric' | 'imperial';
}

type MeasurementPhase = 'idle' | 'placingStart' | 'placingEnd';

const MeasurementTool: React.FC<MeasurementToolProps> = ({ 
  cameraParams, 
  onnxDepthMap, 
  onMeasurementComplete, 
  measurements,
  currentUnit = 'metric'
}) => {
  const [phase, setPhase] = useState<MeasurementPhase>('idle');
  const [startPoint, setStartPoint] = useState<Point | null>(null);
  const [currentMousePos, setCurrentMousePos] = useState<Point | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const getClickCoords = (event: React.MouseEvent<HTMLDivElement>): Point | null => {
    const rect = overlayRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  };

  const handleOverlayClick = (event: React.MouseEvent<HTMLDivElement>) => {
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
        // If we're in placingEnd but no startPoint, start a new measurement
        console.log('[measure] No startPoint in placingEnd, starting new measurement');
        setStartPoint(coords);
      }
    }
  };

  const completeMeasurement = useCallback((startPoint: Point, coords: Point) => {
    console.log('[measure] completeMeasurement called with:', { startPoint, coords, cameraParams: !!cameraParams, onnxDepthMap: !!onnxDepthMap });
    
    if (!cameraParams) {
      console.log('[measure] No camera params, resetting');
      setStartPoint(null);
      setPhase('idle');
      return;
    }

    const viewWidth = overlayRef.current?.offsetWidth || 640;
    const viewHeight = overlayRef.current?.offsetHeight || 640;
    console.log('[measure] View dimensions:', { viewWidth, viewHeight });

    // Try to get distance using depth map first
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
      console.log('[measure] Depth map distance:', distanceToBase);
    }

    if (distanceToBase === null) {
      // fallback to ground plane
      const dir = screenToWorld(startPoint, cameraParams, viewWidth, viewHeight);
      const wp = estimateGroundPlaneIntersection(dir, cameraParams);
      if (wp) {
        distanceToBase = calculateDistance3D({x:0,y:0,z:0}, wp);
        console.log('[measure] fallback ground-plane distance', distanceToBase);
      } else {
        console.warn('[measure] unable to get ground-plane fallback');
      }
    } else {
      console.log('[measure] kernel depth distance', distanceToBase);
    }

    if (distanceToBase === null) {
      console.log('[measure] No distance calculated, resetting');
      setStartPoint(null);
      setPhase('idle');
      return;
    }

    // Determine distance to the top point as well
    let distanceToTop: number | null = null;

    if (onnxDepthMap) {
      distanceToTop = estimateDistanceToPoint(
        coords.x,
        coords.y,
        viewWidth,
        viewHeight,
        cameraParams,
        onnxDepthMap
      );
      console.log('[measure] Depth map top distance:', distanceToTop);
    }

    if (distanceToTop === null) {
      const dirTop = screenToWorld(coords, cameraParams, viewWidth, viewHeight);
      const wpTop = estimateGroundPlaneIntersection(dirTop, cameraParams);
      if (wpTop) {
        distanceToTop = calculateDistance3D({ x: 0, y: 0, z: 0 }, wpTop);
        console.log('[measure] fallback ground-plane top distance', distanceToTop);
      } else {
        console.warn('[measure] unable to get ground-plane fallback for top');
      }
    }

    const estimatedHeight = calculateEstimatedHeight(
      startPoint.y,
      coords.y,
      viewHeight,
      cameraParams,
      distanceToBase,
      distanceToTop
    );
    console.log('[measure] Estimated height:', estimatedHeight);

    if (estimatedHeight !== null) {
      // Convert to imperial if needed
      const finalDistance = currentUnit === 'imperial' 
        ? UNIT_CONVERSIONS.metersToFeet(estimatedHeight)
        : estimatedHeight;

      const newMeasurement: Measurement = {
        id: uuidv4(),
        label: 'Est. Height',
        distance: finalDistance,
        startPoint: startPoint,
        endPoint: coords,
        unit: currentUnit,
        timestamp: Date.now(),
      };
      console.log('[measure] Creating measurement:', newMeasurement);
      onMeasurementComplete(newMeasurement);
    }

    console.log('[measure] Resetting measurement state');
    setStartPoint(null);
    setCurrentMousePos(null);
    setPhase('idle');
  }, [cameraParams, onnxDepthMap, currentUnit, onMeasurementComplete]);

  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (phase === 'placingEnd') {
      const coords = getClickCoords(event);
      setCurrentMousePos(coords);
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    const overlay = overlayRef.current;

    if (!context || !canvas || !overlay) return;

    canvas.width = overlay.offsetWidth;
    canvas.height = overlay.offsetHeight;

    context.clearRect(0, 0, canvas.width, canvas.height);

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
    }

  }, [phase, startPoint, currentMousePos, measurements]);

  const startMeasurement = useCallback(() => {
    console.log('[measure] startMeasurement called');
    if (!cameraParams) {
      alert("Camera parameters not yet available. Please wait a moment.");
      return;
    }
    setPhase('placingEnd');
    setStartPoint(null);
    setCurrentMousePos(null);
  }, [cameraParams]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'm' && phase === 'idle') {
        startMeasurement();
      } else if (event.key === 'Escape' && phase !== 'idle') {
        setPhase('idle');
        setStartPoint(null);
        setCurrentMousePos(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [phase, startMeasurement]);

  return (
    <div 
      ref={overlayRef}
      className={`${styles.overlay} ${phase !== 'idle' ? styles.overlayActive : ''}`}
      onClick={handleOverlayClick}
      onMouseMove={handleMouseMove}
      role="button"
      tabIndex={0}
      aria-label="Measurement overlay - click to place measurement points"
    >
        {phase === 'idle' && (
            <button 
                onClick={(e) => { e.stopPropagation(); startMeasurement(); }} 
                disabled={!cameraParams || !onnxDepthMap}
                title={!cameraParams ? "Waiting for camera parameters..." : !onnxDepthMap ? "Generate Depth Map first!" : "Start Height Estimation (M)"}
                style={{ 
                    position: 'absolute', 
                    bottom: '20px', 
                    left: '50%', 
                    transform: 'translateX(-50%)', 
                    zIndex: 10, 
                    padding: '10px 15px',
                    cursor: (cameraParams && onnxDepthMap) ? 'pointer' : 'not-allowed',
                    pointerEvents: 'auto'
                }}
            >
                {!cameraParams ? 'Waiting for Camera...' : !onnxDepthMap ? 'Depth Map Needed' : 'Estimate Height (M)'}
            </button>
        )}
        {phase !== 'idle' && (
            <div style={{ 
                position: 'absolute', 
                bottom: '20px', 
                left: '10px', 
                color: 'white', 
                backgroundColor: 'rgba(0,0,0,0.6)', 
                padding: '5px 10px',
                borderRadius: '4px',
                fontSize: '0.9em',
                pointerEvents: 'none'
             }}
             role="status"
             aria-live="polite"
            >
                {!startPoint ? 'Click object BASE' : 'Click object TOP'} (Esc to cancel)
            </div>
        )}
        
        <canvas ref={canvasRef} className={styles.measurementCanvas} />
    </div>
  );
};

export default MeasurementTool;