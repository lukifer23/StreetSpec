import React, { useState, useRef, useEffect } from 'react';
import { Point, CameraParams, Measurement, OnnxDepthMap, ConfidenceLevel } from '../types/common';
import { estimateDistanceToPoint, calculateEstimatedHeight } from '../services/measurementLogic';
import { unprojectPointWithOnnxDepth, calculateDistance3D, estimateDepthConfidence, calculateAreaFromScreenPoints } from '../services/geometry';
import { createEdgeMap, findClosestEdge, EdgeMap } from '../services/imageProcessing';
import { v4 as uuidv4 } from 'uuid';
import styles from './MeasurementTool.module.css';

interface MeasurementToolProps {
  cameraParams: CameraParams | null;
  onnxDepthMap: OnnxDepthMap | null;
  onMeasurementComplete: (measurement: Measurement) => void;
  measurements: Measurement[];
  fovOverride: number | null;
  baseImageData: ImageBitmap | null;
  measurementPhase: MeasurementPhase;
  setMeasurementPhase: React.Dispatch<React.SetStateAction<MeasurementPhase>>;
  measurementIsActive: boolean;
}

type MeasurementPhase = 'idle' | 'placingHeightStart' | 'placingHeightEnd' | 'placingDistStart' | 'placingDistEnd' | 'placingAreaPoints' | 'placingAreaLastPoint';
type MeasurementMode = 'Height' | '3D Distance' | 'Area';

const getConfidenceColor = (confidence?: ConfidenceLevel): string => {
  switch (confidence) {
    case 'High': return 'lime';
    case 'Medium': return 'yellow';
    case 'Low': return 'red';
    default: return 'gray'; // Unknown or undefined
  }
};

const MeasurementTool: React.FC<MeasurementToolProps> = ({ 
  cameraParams, 
  onnxDepthMap, 
  onMeasurementComplete, 
  measurements, 
  fovOverride, 
  baseImageData, 
  measurementPhase,
  setMeasurementPhase,
  measurementIsActive
}) => {
  const [mode, setMode] = useState<MeasurementMode>('Height');
  const [startPoint, setStartPoint] = useState<Point | null>(null);
  const [currentMousePos, setCurrentMousePos] = useState<Point | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [startPointConfidence, setStartPointConfidence] = useState<ConfidenceLevel>('Unknown');
  const [endPointConfidence, setEndPointConfidence] = useState<ConfidenceLevel>('Unknown');
  const [edgeMap, setEdgeMap] = useState<EdgeMap | null>(null);
  const [snappedPoint, setSnappedPoint] = useState<Point | null>(null);
  const [currentPolygonPoints, setCurrentPolygonPoints] = useState<Point[]>([]);
  const [currentPointConfidence, setCurrentPointConfidence] = useState<ConfidenceLevel>('Unknown');

  const isPlacingPoint = measurementPhase === 'placingHeightEnd' || measurementPhase === 'placingDistEnd' || measurementPhase === 'placingAreaLastPoint';
  const isPlacingArea = measurementPhase === 'placingAreaPoints' || measurementPhase === 'placingAreaLastPoint';

  useEffect(() => {
    if (baseImageData) {
      console.log("[MeasurementTool] Base image data updated, creating edge map...");
      const map = createEdgeMap(baseImageData);
      setEdgeMap(map);
    } else {
      setEdgeMap(null);
    }
  }, [baseImageData]);

  const getClickCoords = (event: React.MouseEvent<HTMLDivElement>): Point | null => {
    if (!overlayRef.current) return null;
    const rect = overlayRef.current.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  };

  const handleOverlayClick = (event: React.MouseEvent<HTMLDivElement>) => {
    console.log("[MeasurementTool] handleOverlayClick triggered!");
    event.stopPropagation();
    event.preventDefault();

    if (!cameraParams || !measurementIsActive) {
      if (!cameraParams) console.warn("Cannot place point: Camera parameters not available yet.");
      return;
    }

    const clickCoords = getClickCoords(event);
    const coords = snappedPoint ?? clickCoords;
    
    if (!coords) return;
    const viewHeight = overlayRef.current?.offsetHeight;
    const viewWidth = overlayRef.current?.offsetWidth;
    
    const canEstimateConfidence = viewWidth && viewHeight && onnxDepthMap;

    if (mode === 'Height') {
      if (measurementPhase === 'placingHeightStart') {
        console.log("[Height] Base Point Placed:", coords);
        setStartPoint(coords);
        const confidence = canEstimateConfidence ? estimateDepthConfidence(coords, onnxDepthMap!, viewWidth!, viewHeight!) : 'Unknown';
        setStartPointConfidence(confidence);
        console.log(`[Height] Base Point Confidence: ${confidence}`);
        setMeasurementPhase('placingHeightEnd');
        setCurrentMousePos(coords);
      } else if (measurementPhase === 'placingHeightEnd') {
        console.log("[Height] Top Point Placed:", coords);
        const confidence = canEstimateConfidence ? estimateDepthConfidence(coords, onnxDepthMap!, viewWidth!, viewHeight!) : 'Unknown';
        setEndPointConfidence(confidence);
        console.log(`[Height] Top Point Confidence: ${confidence}`);
        if (startPoint) {
          if (!viewWidth || !viewHeight) {
              console.error("[Height] Overlay dimensions not available for calculation.");
              resetMeasurementState();
              return;
          }
          const distanceToBase = estimateDistanceToPoint(
            startPoint.x,
            startPoint.y,
            viewWidth,
            viewHeight,
            cameraParams,
            onnxDepthMap
          );
  
          if (distanceToBase === null) {
            console.error("Could not estimate distance to base point for height. Check depth map.");
            resetMeasurementState();
            return;
          }
  
          const estimatedHeight = calculateEstimatedHeight(
            startPoint.y, 
            coords.y,
            viewHeight,
            cameraParams, 
            distanceToBase,
            fovOverride
          );
  
          if (estimatedHeight !== null) {
            const newMeasurement: Measurement = {
              id: uuidv4(),
              label: 'Height',
              points: [startPoint, coords],
              distance: estimatedHeight,
              startPoint: startPoint,
              endPoint: coords,
              unit: 'metric',
              timestamp: Date.now(),
              panoId: cameraParams.panoId,
              cameraParams: cameraParams,
              startPointConfidence: startPointConfidence,
              endPointConfidence: confidence,
            };
            console.log("Created Height Measurement:", newMeasurement);
            onMeasurementComplete(newMeasurement);
          } else {
             console.error("Failed to calculate estimated height.");
          }
        }
        resetMeasurementState();
      }
    } else if (mode === '3D Distance') {
      if (measurementPhase === 'placingDistStart') {
        console.log("[3D Dist] First Point Placed:", coords);
        setStartPoint(coords);
        const confidence = canEstimateConfidence ? estimateDepthConfidence(coords, onnxDepthMap!, viewWidth!, viewHeight!) : 'Unknown';
        setStartPointConfidence(confidence);
        console.log(`[3D Dist] First Point Confidence: ${confidence}`);
        setMeasurementPhase('placingDistEnd');
        setCurrentMousePos(coords);
      } else if (measurementPhase === 'placingDistEnd') {
        console.log("[3D Dist] Second Point Placed:", coords);
        const confidence = canEstimateConfidence ? estimateDepthConfidence(coords, onnxDepthMap!, viewWidth!, viewHeight!) : 'Unknown';
        setEndPointConfidence(confidence);
        console.log(`[3D Dist] Second Point Confidence: ${confidence}`);
        if (startPoint && onnxDepthMap && cameraParams) {
          if (!viewWidth || !viewHeight) {
              console.error("[3D Dist] Overlay dimensions not available for calculation.");
              resetMeasurementState();
              return;
          }
          const point1_3D = unprojectPointWithOnnxDepth(startPoint, cameraParams, viewWidth, viewHeight, onnxDepthMap, fovOverride);
          const point2_3D = unprojectPointWithOnnxDepth(coords, cameraParams, viewWidth, viewHeight, onnxDepthMap, fovOverride);

          if (point1_3D && point2_3D) {
            const distance3D = calculateDistance3D(point1_3D, point2_3D);
            const newMeasurement: Measurement = {
              id: uuidv4(),
              label: '3D Distance',
              points: [startPoint, coords],
              distance: distance3D,
              startPoint: startPoint,
              endPoint: coords,
              unit: 'metric',
              timestamp: Date.now(),
              panoId: cameraParams.panoId,
              cameraParams: cameraParams,
              startPointConfidence: startPointConfidence,
              endPointConfidence: confidence,
            };
            console.log("Created 3D Distance Measurement:", newMeasurement);
            onMeasurementComplete(newMeasurement);
          } else {
            console.error("Failed to unproject one or both points for 3D distance measurement. Check depth map.");
          }
        }
        resetMeasurementState();
      }
    } else if (mode === 'Area') {
      const confidence = canEstimateConfidence ? estimateDepthConfidence(coords, onnxDepthMap!, viewWidth!, viewHeight!) : 'Unknown';
      setCurrentPointConfidence(confidence);
      console.log(`[Area] Point ${currentPolygonPoints.length + 1} Placed: (${coords.x}, ${coords.y}), Confidence: ${confidence}`);

      if (measurementPhase === 'placingAreaPoints') {
        const startPt = currentPolygonPoints[0];
        const closingRadius = 15;
        if (currentPolygonPoints.length >= 2 && startPt) {
          const dx = coords.x - startPt.x;
          const dy = coords.y - startPt.y;
          if ((dx * dx + dy * dy) < (closingRadius * closingRadius)) {
            console.log("[Area] Polygon closed by clicking near start.");
            finalizeAreaMeasurement();
            return;
          }
        }
        setCurrentPolygonPoints(prev => [...prev, coords]);
        setMeasurementPhase('placingAreaLastPoint');
        setCurrentMousePos(coords);
      } else if (measurementPhase === 'placingAreaLastPoint') {
        const startPt = currentPolygonPoints[0];
        const closingRadius = 15;
        if (currentPolygonPoints.length >= 2 && startPt) {
          const dx = coords.x - startPt.x;
          const dy = coords.y - startPt.y;
          if ((dx * dx + dy * dy) < (closingRadius * closingRadius)) {
            console.log("[Area] Polygon closed by clicking near start.");
            finalizeAreaMeasurement();
            return;
          }
        }
        setCurrentPolygonPoints(prev => [...prev, coords]);
        setCurrentMousePos(coords);
      }
    }
  };

  const finalizeAreaMeasurement = () => {
    if (currentPolygonPoints.length < 3) {
      console.warn("[Area] Need at least 3 points to measure area.");
      resetMeasurementState();
      return;
    }
    if (!cameraParams || !onnxDepthMap || !overlayRef.current) {
      console.error("[Area] Cannot finalize: Missing camera params, depth map, or overlay ref.");
      resetMeasurementState();
      return;
    }
    const viewHeight = overlayRef.current.offsetHeight;
    const viewWidth = overlayRef.current.offsetWidth;
    if (!viewHeight || !viewWidth) {
      console.error("[Area] Cannot finalize: Missing overlay dimensions.");
      resetMeasurementState();
      return;
    }

    console.log("[Area] Finalizing measurement with points:", currentPolygonPoints);
    
    const calculatedArea = calculateAreaFromScreenPoints(
      currentPolygonPoints,
      cameraParams,
      viewWidth,
      viewHeight,
      onnxDepthMap,
      fovOverride
    );
    
    console.log("[Area] Calculated Area:", calculatedArea);

    if (calculatedArea !== null) { 
      const newMeasurement: Measurement = {
        id: uuidv4(),
        label: 'Area',
        points: [...currentPolygonPoints],
        distance: calculatedArea,
        unit: 'metric',
        timestamp: Date.now(),
        panoId: cameraParams.panoId,
        cameraParams: cameraParams,
      };
      console.log("Created Area Measurement:", newMeasurement);
      onMeasurementComplete(newMeasurement);
    } else {
      console.error("Failed to calculate area (likely due to point unprojection failure).");
    }
    resetMeasurementState();
  };

  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!isPlacingPoint || !overlayRef.current) {
      setSnappedPoint(null);
      return;
    }

    const rawMousePos = getClickCoords(event);
    if (!rawMousePos) return;
    setCurrentMousePos(rawMousePos);

    if (edgeMap) {
      const searchRadius = 10;
      const closestEdge = findClosestEdge(rawMousePos, edgeMap, searchRadius);
      setSnappedPoint(closestEdge);
    } else {
      setSnappedPoint(null);
    }
  };

  const handleMouseLeave = () => {
    setCurrentMousePos(null);
    setSnappedPoint(null);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    const overlay = overlayRef.current;

    if (!context || !canvas || !overlay) return;

    canvas.width = overlay.offsetWidth;
    canvas.height = overlay.offsetHeight;

    context.clearRect(0, 0, canvas.width, canvas.height);

    measurements.forEach(m => {
      if (!m.points || m.points.length < 2) return;

      const displayStartPoint = m.startPoint ?? m.points[0];
      const displayEndPoint = m.endPoint ?? m.points[m.points.length - 1];

      context.fillStyle = getConfidenceColor(m.startPointConfidence);
      context.beginPath();
      context.arc(displayStartPoint.x, displayStartPoint.y, 5, 0, 2 * Math.PI);
      context.fill();

      context.fillStyle = getConfidenceColor(m.endPointConfidence);
      context.beginPath();
      context.arc(displayEndPoint.x, displayEndPoint.y, 5, 0, 2 * Math.PI);
      context.fill();

      if (m.label === 'Height' || m.label === '3D Distance') {
        context.strokeStyle = '#ff00ff';
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(displayStartPoint.x, displayStartPoint.y);
        context.lineTo(displayEndPoint.x, displayEndPoint.y);
        context.stroke();
      }

      if (m.distance !== undefined && m.distance !== null) {
        const midX = (displayStartPoint.x + displayEndPoint.x) / 2;
        const midY = (displayStartPoint.y + displayEndPoint.y) / 2;
        context.fillStyle = 'white';
        context.shadowColor = 'black';
        context.shadowBlur = 4;
        context.font = '12px Arial';
        context.textAlign = 'center';
        context.textBaseline = 'bottom';
        context.fillText(`${m.label}: ${m.distance.toFixed(2)}${m.unit === 'metric' ? 'm²' : 'ft²'}`, midX + 10, midY);
        context.shadowBlur = 0;
      }
    });

    context.strokeStyle = '#00ffff';
    context.fillStyle = '#00ffff';
    context.lineWidth = 2;
    const pointRadius = 4;

    if (startPoint) {
      context.fillStyle = getConfidenceColor(startPointConfidence);
      context.beginPath();
      context.arc(startPoint.x, startPoint.y, pointRadius, 0, Math.PI * 2);
      context.fill();
    }

    if (isPlacingPoint && startPoint && currentMousePos) {
      context.strokeStyle = '#00ffff';
      context.beginPath();
      context.moveTo(startPoint.x, startPoint.y);
      context.lineTo(currentMousePos.x, currentMousePos.y);
      context.setLineDash([5, 5]);
      context.stroke();
      context.setLineDash([]);

      const previewPoint = snappedPoint ?? currentMousePos;
      context.fillStyle = snappedPoint ? 'lime' : 'gray';
      context.beginPath();
      context.arc(previewPoint.x, previewPoint.y, pointRadius, 0, Math.PI * 2);
      context.fill();

      if (snappedPoint) {
        context.strokeStyle = 'lime';
        context.lineWidth = 1;
        context.beginPath();
        context.arc(snappedPoint.x, snappedPoint.y, pointRadius + 3, 0, Math.PI * 2);
        context.stroke();
      }
    }

    if (isPlacingArea) {
        currentPolygonPoints.forEach((p, index) => {
            context.fillStyle = index === 0 ? 'cyan' : 'lime'; 
            context.beginPath();
            context.arc(p.x, p.y, pointRadius + 1, 0, Math.PI * 2);
            context.fill();
        });
    }

    if (isPlacingArea && currentPolygonPoints.length > 0 && currentMousePos) {
      const lastPoint = currentPolygonPoints[currentPolygonPoints.length - 1];
      const previewPoint = snappedPoint ?? currentMousePos;

      context.strokeStyle = '#00ffff';
      context.setLineDash([5, 5]);
      
      context.beginPath();
      context.moveTo(lastPoint.x, lastPoint.y);
      context.lineTo(previewPoint.x, previewPoint.y);
      context.stroke();

      if (currentPolygonPoints.length >= 2) {
        context.beginPath();
        context.moveTo(previewPoint.x, previewPoint.y);
        context.lineTo(currentPolygonPoints[0].x, currentPolygonPoints[0].y);
        context.stroke();
      }
      context.setLineDash([]);

      context.fillStyle = snappedPoint ? getConfidenceColor(currentPointConfidence) : 'gray'; 
      context.beginPath();
      context.arc(previewPoint.x, previewPoint.y, pointRadius, 0, Math.PI * 2);
      context.fill();
      if (snappedPoint) {
        context.strokeStyle = getConfidenceColor(currentPointConfidence);
        context.lineWidth = 1;
        context.beginPath();
        context.arc(snappedPoint.x, snappedPoint.y, pointRadius + 3, 0, Math.PI * 2);
        context.stroke();
      }
    }

  }, [measurementPhase, startPoint, currentMousePos, measurements, mode, startPointConfidence, endPointConfidence, snappedPoint, isPlacingPoint, isPlacingArea, currentPolygonPoints, currentPointConfidence]);

  const startMeasurement = () => {
    if (!cameraParams || !onnxDepthMap) {
      alert( !cameraParams ? "Camera parameters not available." : "Generate Depth Map first.");
      return;
    }
    
    if (mode === 'Height') {
      console.log("Starting Height estimation...");
      setMeasurementPhase('placingHeightStart');
    } else if (mode === '3D Distance') {
      console.log("Starting 3D Distance measurement...");
      setMeasurementPhase('placingDistStart');
    } else {
      console.log("Starting Area measurement...");
      setMeasurementPhase('placingAreaPoints');
    }
    setStartPoint(null);
    setCurrentMousePos(null);
    setStartPointConfidence('Unknown');
    setEndPointConfidence('Unknown');
    setCurrentPolygonPoints([]);
    setCurrentPointConfidence('Unknown');
  };

  const resetMeasurementState = (resetMode = true) => {
      setMeasurementPhase('idle');
      setStartPoint(null);
      setCurrentMousePos(null);
      setStartPointConfidence('Unknown');
      setEndPointConfidence('Unknown');
      setCurrentPolygonPoints([]);
      setCurrentPointConfidence('Unknown');
      if (resetMode) setMode('Height');
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && measurementIsActive) {
        console.log("Measurement cancelled by Escape key.");
        resetMeasurementState();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [measurementIsActive]);

  const getPromptText = () => {
      switch (measurementPhase) {
          case 'placingHeightStart': return 'Click object BASE';
          case 'placingHeightEnd': return 'Click object TOP';
          case 'placingDistStart': return 'Click FIRST point';
          case 'placingDistEnd': return 'Click SECOND point';
          case 'placingAreaPoints': return 'Click FIRST polygon point';
          case 'placingAreaLastPoint': return 'Click NEXT point or near START to finish';
          default: return '';
      }
  };

  return (
    <div 
      ref={overlayRef}
      className={`${styles.overlay} ${measurementIsActive ? styles.overlayActive : ''} ${snappedPoint ? styles.snapCursor : ''}`}
      onClick={handleOverlayClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
        {!measurementIsActive && (
            <div className={styles.measurementButtonsContainer} >
                <button 
                  onClick={() => setMode('Height')} 
                  className={`${styles.modeButton} ${mode === 'Height' ? styles.activeMode : ''}`}
                  disabled={!cameraParams || !onnxDepthMap}
                >Height</button>
                <button 
                  onClick={() => setMode('3D Distance')} 
                  className={`${styles.modeButton} ${mode === '3D Distance' ? styles.activeMode : ''}`}
                  disabled={!cameraParams || !onnxDepthMap}
                >3D Distance</button>
                <button 
                  onClick={() => setMode('Area')} 
                  className={`${styles.modeButton} ${mode === 'Area' ? styles.activeMode : ''}`}
                  disabled={!cameraParams || !onnxDepthMap}
                >Area</button>

                <button 
                    onClick={(e) => { e.stopPropagation(); startMeasurement(); }} 
                    disabled={!cameraParams || !onnxDepthMap}
                    title={!cameraParams ? "Waiting for camera..." : !onnxDepthMap ? "Generate Depth Map first!" : `Start ${mode} Measurement`}
                    className={styles.startButton}
                >
                    Start {mode}
                </button>
            </div>
        )}
        
        {measurementIsActive && (
            <div className={styles.promptText}>
                {getPromptText()} (Esc to cancel)
            </div>
        )}
        
        <canvas ref={canvasRef} className={styles.measurementCanvas} />
    </div>
  );
};

export default MeasurementTool;