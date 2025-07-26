import React, { useState, useRef, useEffect } from 'react';
import { Point, CameraParams, Measurement, OnnxDepthMap, UNIT_CONVERSIONS, DEFAULT_SHORTCUTS } from '../types/common';
import { estimateDistanceToPoint, calculateEstimatedHeight } from '../services/measurementLogic';
import { screenToWorld, estimateGroundPlaneIntersection, calculateDistance3D } from '../services/geometry';
import { v4 as uuidv4 } from 'uuid';
import styles from './MeasurementTool.module.css';

interface MeasurementToolProps {
  cameraParams: CameraParams | null;
  onnxDepthMap: OnnxDepthMap | null;
  onMeasurementComplete: (measurement: Measurement) => void;
  measurements: Measurement[];
  currentUnit?: 'metric' | 'imperial';
  onUnitToggle?: () => void;
}

type MeasurementPhase = 'idle' | 'placingStart' | 'placingEnd';

const MeasurementTool: React.FC<MeasurementToolProps> = ({ 
  cameraParams, 
  onnxDepthMap, 
  onMeasurementComplete, 
  measurements,
  currentUnit = 'metric',
  onUnitToggle
}) => {
  const [phase, setPhase] = useState<MeasurementPhase>('idle');
  const [startPoint, setStartPoint] = useState<Point | null>(null);
  const [endPoint, setEndPoint] = useState<Point | null>(null);
  const [currentMousePos, setCurrentMousePos] = useState<Point | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const isActive = phase !== 'idle';

  const getClickCoords = (event: React.MouseEvent<HTMLDivElement>): Point | null => {
    if (!overlayRef.current) return null;
    const rect = overlayRef.current.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  };

  const handleOverlayClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!cameraParams || !isActive) {
      return;
    }

    const coords = getClickCoords(event);
    if (!coords) return;

    if (phase === 'placingStart') {
      setStartPoint(coords);
      setPhase('placingEnd');
      setCurrentMousePos(coords);
      setEndPoint(null);
    } else if (phase === 'placingEnd') {
      setEndPoint(coords);
      setPhase('idle');
      setCurrentMousePos(null);

      if (startPoint) {
        const viewHeight = overlayRef.current?.offsetHeight;
        const viewWidth = overlayRef.current?.offsetWidth;
        
        if (!viewHeight || !viewWidth) {
          setStartPoint(null);
          setEndPoint(null);
          return;
        }

        let distanceToBase = estimateDistanceToPoint(
          startPoint.x,
          startPoint.y,
          viewWidth,
          viewHeight,
          cameraParams,
          onnxDepthMap
        );

        if (distanceToBase === null) {
          // fallback to ground plane
          const dir = screenToWorld(startPoint, cameraParams, viewWidth, viewHeight);
          const wp = estimateGroundPlaneIntersection(dir);
          if (wp) {
            distanceToBase = calculateDistance3D({x:0,y:0,z:0}, wp);
            // eslint-disable-next-line no-console
            console.log('[measure] fallback ground-plane distance', distanceToBase);
          } else {
            console.warn('[measure] unable to get ground-plane fallback');
          }
        } else {
          // eslint-disable-next-line no-console
          console.log('[measure] kernel depth distance', distanceToBase);
        }

        if (distanceToBase === null) {
          setStartPoint(null);
          setEndPoint(null);
          return;
        }

        const estimatedHeight = calculateEstimatedHeight(
          startPoint.y, 
          coords.y,
          viewHeight, 
          cameraParams, 
          distanceToBase
        );

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
          onMeasurementComplete(newMeasurement);
        }

      }
      setStartPoint(null);
      setEndPoint(null);
    }
  };

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

  const startMeasurement = () => {
    if (!cameraParams) {
      alert("Camera parameters not yet available. Please wait a moment.");
      return;
    }
    setPhase('placingStart');
    setStartPoint(null);
    setEndPoint(null);
    setCurrentMousePos(null);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Start measurement with 'm' key
      if (event.key === DEFAULT_SHORTCUTS.startMeasurement && !isActive) {
        event.preventDefault();
        startMeasurement();
        return;
      }

      // Cancel measurement with Escape
      if (event.key === DEFAULT_SHORTCUTS.cancelMeasurement && isActive) {
        event.preventDefault();
        setPhase('idle');
        setStartPoint(null);
        setEndPoint(null);
        setCurrentMousePos(null);
        return;
      }

      // Toggle unit with 'u' key
      if (event.key === DEFAULT_SHORTCUTS.toggleUnit && onUnitToggle) {
        event.preventDefault();
        onUnitToggle();
        return;
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActive, onUnitToggle]);

  return (
    <div 
      ref={overlayRef}
      className={`${styles.overlay} ${isActive ? styles.overlayActive : ''}`}
      onClick={handleOverlayClick}
      onMouseMove={handleMouseMove}
      role="button"
      tabIndex={0}
      aria-label="Measurement overlay - click to place measurement points"
    >
        {!isActive && (
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
        {isActive && (
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
                {phase === 'placingStart' ? 'Click object BASE' : 'Click object TOP'} (Esc to cancel)
            </div>
        )}
        
        <canvas ref={canvasRef} className={styles.measurementCanvas} />
    </div>
  );
};

export default MeasurementTool;