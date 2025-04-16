import React, { useState, useRef, useEffect } from 'react';
import { Point, CameraParams, Measurement, OnnxDepthMap, ConfidenceLevel, SegmentationMask } from '../types/common';
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
  segmentationMask: SegmentationMask | null;
  measurementPhase: MeasurementPhase;
  setMeasurementPhase: React.Dispatch<React.SetStateAction<MeasurementPhase>>;
  measurementIsActive: boolean;
  scaleFactor: number;
  isCalibrating: boolean;
  setIsCalibrating: React.Dispatch<React.SetStateAction<boolean>>;
  onCalibrationApplied: () => void;
}

type MeasurementPhase = 'idle' | 'placingHeightStart' | 'placingHeightEnd' | 'placingDistStart' | 'placingDistEnd' | 'placingAreaPoints' | 'placingAreaLastPoint';
type CalibrationPhase = 'idle' | 'placingStart' | 'placingEnd'; // Calibration phases
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
  segmentationMask,
  measurementPhase,
  setMeasurementPhase,
  measurementIsActive,
  scaleFactor,
  isCalibrating,
  setIsCalibrating,
  onCalibrationApplied
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

  // Calibration State
  const [calibrationPhase, setCalibrationPhase] = useState<CalibrationPhase>('idle');
  const [knownDistance, setKnownDistance] = useState<string>('1'); // Default to 1 meter
  const [calibrationStartPoint, setCalibrationStartPoint] = useState<Point | null>(null);
  const [calibrationEndPoint, setCalibrationEndPoint] = useState<Point | null>(null); // Store end point for apply button

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

    if (!cameraParams || (!measurementIsActive && !isCalibrating)) { // Check calibration active too
      if (!cameraParams) console.warn("Cannot place point: Camera parameters not available yet.");
      return;
    }

    // --- Handle Calibration Clicks ---
    if (isCalibrating) {
        const clickCoords = getClickCoords(event);
        if (!clickCoords) return;

        if (calibrationPhase === 'placingStart') {
            console.log("[Calibration] Start Point Placed:", clickCoords);
            setCalibrationStartPoint(clickCoords);
            setCalibrationEndPoint(null); // Clear end point
            setCalibrationPhase('placingEnd');
            setCurrentMousePos(clickCoords); // Show line preview
        } else if (calibrationPhase === 'placingEnd') {
            console.log("[Calibration] End Point Placed:", clickCoords);
            setCalibrationEndPoint(clickCoords);
            // Don't reset phase here, wait for Apply button
            setCurrentMousePos(null); // Stop showing line preview
        }
        return; // Don't proceed to measurement logic if calibrating
    }
    // --- End Handle Calibration Clicks ---

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
        if (startPoint && onnxDepthMap && cameraParams && segmentationMask) {
          if (!viewWidth || !viewHeight) {
              console.error("[Height] Overlay dimensions not available for calculation.");
              resetMeasurementState();
              return;
          }
          const basePoint3D = unprojectPointWithOnnxDepth(startPoint, cameraParams, viewWidth, viewHeight, onnxDepthMap, segmentationMask, fovOverride);
          const topPoint3D = unprojectPointWithOnnxDepth(coords, cameraParams, viewWidth, viewHeight, onnxDepthMap, segmentationMask, fovOverride);

          if (basePoint3D && topPoint3D) {
            const estimatedHeight = Math.abs(topPoint3D.y - basePoint3D.y);
            console.log(`[Height] Unprojected Base: (${basePoint3D.x.toFixed(3)}, ${basePoint3D.y.toFixed(3)}, ${basePoint3D.z.toFixed(3)})`);
            console.log(`[Height] Unprojected Top: (${topPoint3D.x.toFixed(3)}, ${topPoint3D.y.toFixed(3)}, ${topPoint3D.z.toFixed(3)})`);
            console.log(`[Height] Calculated Height (Y-diff): ${estimatedHeight.toFixed(3)}m`);
            
            const scaledHeight = estimatedHeight * scaleFactor; // Apply scale factor
            console.log(`[Height] Scaled Height: ${scaledHeight.toFixed(3)}m (Factor: ${scaleFactor.toFixed(4)})`);

            const newMeasurement: Measurement = {
              id: uuidv4(),
              label: 'Height',
              points: [startPoint, coords],
              distance: scaledHeight, // Use scaled value
              startPoint: startPoint,
              endPoint: coords,
              unit: 'metric',
              timestamp: Date.now(),
              panoId: cameraParams.panoId,
              cameraParams: cameraParams,
              startPointConfidence: startPointConfidence,
              endPointConfidence: confidence,
            };
            console.log("Created Height Measurement (Revised Method):", newMeasurement);
            onMeasurementComplete(newMeasurement);
          } else {
             console.error("Failed to unproject base or top point for height measurement. Check depth map values at points.");
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
        if (startPoint && onnxDepthMap && cameraParams && segmentationMask) {
          if (!viewWidth || !viewHeight) {
              console.error("[3D Dist] Overlay dimensions not available for calculation.");
              resetMeasurementState();
              return;
          }
          const point1_3D = unprojectPointWithOnnxDepth(startPoint, cameraParams, viewWidth, viewHeight, onnxDepthMap, segmentationMask, fovOverride);
          const point2_3D = unprojectPointWithOnnxDepth(coords, cameraParams, viewWidth, viewHeight, onnxDepthMap, segmentationMask, fovOverride);

          if (point1_3D && point2_3D) {
            const distance3D = calculateDistance3D(point1_3D, point2_3D);
            const scaledDistance = distance3D * scaleFactor; // Apply scale factor
            console.log(`[3D Dist] Calculated Distance: ${distance3D.toFixed(3)}, Scaled Distance: ${scaledDistance.toFixed(3)} (Factor: ${scaleFactor.toFixed(4)})`);
            
            const newMeasurement: Measurement = {
              id: uuidv4(),
              label: '3D Distance',
              points: [startPoint, coords],
              distance: scaledDistance, // Use scaled value
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
      segmentationMask,
      fovOverride
    );
    
    console.log("[Area] Calculated Area:", calculatedArea);

    if (calculatedArea !== null) { 
      const scaledArea = calculatedArea * (scaleFactor * scaleFactor); // Apply factor squared for area
      console.log(`[Area] Scaled Area: ${scaledArea.toFixed(3)}m² (Factor: ${scaleFactor.toFixed(4)})`);
      const newMeasurement: Measurement = {
        id: uuidv4(),
        label: 'Area',
        points: [...currentPolygonPoints],
        distance: scaledArea, // Use scaled value
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

    // Draw Calibration Points & Line
    if (isCalibrating) {
        context.lineWidth = 2;
        const calPointRadius = 5;
        
        if (calibrationStartPoint) {
            context.strokeStyle = 'orange';
            context.fillStyle = 'orange';
            context.beginPath();
            context.arc(calibrationStartPoint.x, calibrationStartPoint.y, calPointRadius, 0, Math.PI * 2);
            context.stroke();
            context.fill();
        }
        if (calibrationEndPoint) {
            context.strokeStyle = 'red';
            context.fillStyle = 'red';
            context.beginPath();
            context.arc(calibrationEndPoint.x, calibrationEndPoint.y, calPointRadius, 0, Math.PI * 2);
            context.stroke();
            context.fill();
        }
        if (calibrationStartPoint && calibrationEndPoint) {
            context.strokeStyle = 'yellow';
            context.setLineDash([4, 4]);
            context.beginPath();
            context.moveTo(calibrationStartPoint.x, calibrationStartPoint.y);
            context.lineTo(calibrationEndPoint.x, calibrationEndPoint.y);
            context.stroke();
            context.setLineDash([]);
        }
        // Preview line during end point placement
        if (calibrationPhase === 'placingEnd' && calibrationStartPoint && currentMousePos && !calibrationEndPoint) {
            context.strokeStyle = 'yellow';
            context.setLineDash([4, 4]);
            context.beginPath();
            context.moveTo(calibrationStartPoint.x, calibrationStartPoint.y);
            context.lineTo(currentMousePos.x, currentMousePos.y);
            context.stroke();
            context.setLineDash([]);

            context.fillStyle = 'red'; // Preview end point
            context.beginPath();
            context.arc(currentMousePos.x, currentMousePos.y, calPointRadius, 0, Math.PI * 2);
            context.fill();
        }
    }

  }, [measurementPhase, startPoint, currentMousePos, measurements, mode, startPointConfidence, endPointConfidence, snappedPoint, isPlacingPoint, isPlacingArea, currentPolygonPoints, currentPointConfidence, isCalibrating, calibrationPhase, calibrationStartPoint, calibrationEndPoint]);

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

  // --- Calibration Handlers ---
  const startCalibration = () => {
    if (!cameraParams || !onnxDepthMap) {
        alert("Generate Depth Map first before calibrating.");
        return;
    }
    resetMeasurementState(false); // Reset measurement state but not mode
    setCalibrationPhase('placingStart');
    setCalibrationStartPoint(null);
    setCalibrationEndPoint(null);
    console.log("[Calibration] Started. Click to place the start point.");
  };

  const applyCalibration = async () => {
    if (!calibrationStartPoint || !calibrationEndPoint || !cameraParams || !onnxDepthMap || !overlayRef.current) {
        console.error("[Calibration] Cannot apply: Missing start/end points, camera params, depth map, or overlay ref.");
        return;
    }
    const knownDistNum = parseFloat(knownDistance);
    if (isNaN(knownDistNum) || knownDistNum <= 0) {
        alert("Please enter a valid positive number for the known distance.");
        return;
    }
    const viewWidth = overlayRef.current.offsetWidth;
    const viewHeight = overlayRef.current.offsetHeight;

    const p1_3D = unprojectPointWithOnnxDepth(calibrationStartPoint, cameraParams, viewWidth, viewHeight, onnxDepthMap, segmentationMask, fovOverride);
    const p2_3D = unprojectPointWithOnnxDepth(calibrationEndPoint, cameraParams, viewWidth, viewHeight, onnxDepthMap, segmentationMask, fovOverride);

    if (!p1_3D || !p2_3D) {
        console.error("[Calibration] Failed to unproject calibration points. Check depth map.");
        alert("Calibration Failed: Could not determine 3D position of calibration points.");
        return;
    }

    const calculatedDistance = calculateDistance3D(p1_3D, p2_3D);
    if (calculatedDistance <= 0) {
        console.error(`[Calibration] Calculated distance is zero or negative (${calculatedDistance}), cannot calculate factor.`);
        alert("Calibration Failed: Calculated distance between points is zero.");
        return;
    }

    // --- Add Sanity Check ---
    const distanceRatio = calculatedDistance / knownDistNum;
    const sanityCheckLowerBound = 0.1; // Allow calculated to be 10x smaller
    const sanityCheckUpperBound = 10.0; // Allow calculated to be 10x larger

    console.log(`[Calibration] Sanity Check: Known=${knownDistNum}, Calculated=${calculatedDistance.toFixed(4)}, Ratio=${distanceRatio.toFixed(4)}`);

    if (distanceRatio < sanityCheckLowerBound || distanceRatio > sanityCheckUpperBound) {
        const proceed = confirm(
            `Warning: The calculated distance (${calculatedDistance.toFixed(2)}m) seems significantly different from the known distance (${knownDistNum}m) you entered (Ratio: ${distanceRatio.toFixed(2)}). ` +
            `This might indicate inaccurate points selection or large depth map errors in this area. \n\n` +
            `Do you want to proceed with this calibration anyway?`
        );
        if (!proceed) {
            console.log("[Calibration] Sanity check failed and user chose not to proceed.");
            // Optionally reset parts of calibration state here if desired, or just return
            // Resetting points might be good:
            setCalibrationStartPoint(null);
            setCalibrationEndPoint(null);
            setCalibrationPhase('placingStart'); // Go back to placing start
            return; 
        }
        console.log("[Calibration] User chose to proceed despite sanity check warning.");
    }
    // --- End Sanity Check ---

    const newFactor = knownDistNum / calculatedDistance;
    console.log(`[Calibration] Known Dist: ${knownDistNum}, Calculated Dist: ${calculatedDistance.toFixed(4)}, New Factor: ${newFactor.toFixed(6)}`);

    // Save the new factor via IPC
    if (window.electronAPI && typeof window.electronAPI.invoke === 'function') {
        try {
            const success = await window.electronAPI.invoke('save-scale-factor', newFactor);
            if (success) {
                // Call the callback passed from App.tsx to trigger state refresh
                onCalibrationApplied();
                console.log("[Calibration] Scale factor saved successfully. Triggered App refresh.");
                // We no longer need the count here, alert is simpler
                alert(`Calibration factor ${newFactor.toFixed(4)} saved.`); 
            } else {
                console.error("[Calibration] Main process failed to save scale factor.");
                alert("Calibration Failed: Could not save the scale factor.");
            }
        } catch (error) {
            console.error("[Calibration] Error invoking save-scale-factor:", error);
            alert("Calibration Failed: Error communicating with the main process.");
        }
    } else {
         console.error("[Calibration] Electron API not available, cannot save scale factor.");
         alert("Calibration Failed: Cannot communicate with the backend.");
    }

    // Exit calibration mode and reset state
    setIsCalibrating(false); 
    resetCalibrationState();
  };

  const resetCalibrationState = () => {
    setCalibrationPhase('idle');
    setCalibrationStartPoint(null);
    setCalibrationEndPoint(null);
    setCurrentMousePos(null);
  };

  const cancelCalibration = () => {
    setIsCalibrating(false); 
    resetCalibrationState();
    console.log("[Calibration] Cancelled.");
  };

  // Reset calibration state if exiting calibration mode
  useEffect(() => {
    if (!isCalibrating) {
        resetCalibrationState();
    }
  }, [isCalibrating]);

  // --- Add/Remove overlayActive class based on measurement OR calibration activity ---
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;

    // Enable pointer events on the overlay if either a measurement 
    // or a calibration point placement is in progress.
    const shouldBeActive = measurementIsActive || (isCalibrating && (calibrationPhase === 'placingStart' || calibrationPhase === 'placingEnd'));

    if (shouldBeActive) {
        overlay.classList.add(styles.overlayActive);
        console.log("[OverlayEffect] Adding overlayActive class.");
    } else {
        overlay.classList.remove(styles.overlayActive);
        console.log("[OverlayEffect] Removing overlayActive class.");
    }
    // No cleanup function needed here, just applying class based on state
}, [measurementIsActive, isCalibrating, calibrationPhase]); // Depend on all relevant states

  // --- End Calibration Handlers ---

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
         if (measurementIsActive) {
            console.log("Measurement cancelled by Escape key.");
            resetMeasurementState();
         } else if (isCalibrating) {
            console.log("Calibration cancelled by Escape key.");
            cancelCalibration();
         }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [measurementIsActive, isCalibrating]); // Add isCalibrating dependency

  const getPromptText = () => {
    if (isCalibrating) {
        switch (calibrationPhase) {
            case 'placingStart': return 'Calibration: Click to place START point of known distance.';
            case 'placingEnd': return 'Calibration: Click to place END point of known distance.';
            default: return 'Calibration: Adjust known distance and click Apply.';
        }
    }
    // Existing measurement prompts...
    switch (measurementPhase) {
      case 'placingHeightStart': return 'Click to place base point for Height';
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
        {!measurementIsActive && !isCalibrating && (
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
        
        {isCalibrating && (
          <div className={styles.calibrationControls}>
            <h4>Scale Calibration</h4>
            <p>{getPromptText()}</p>
            <div className={styles.inputGroup}>
              <label htmlFor="knownDistance">Known Distance (meters):</label>
              <input 
                type="number"
                id="knownDistance"
                value={knownDistance}
                onChange={(e) => setKnownDistance(e.target.value)}
                min="0.01" 
                step="0.01"
              />
            </div>
            <button 
              onClick={(e) => { e.stopPropagation(); startCalibration(); }}
              disabled={calibrationPhase !== 'idle'} 
              className={styles.toolButton}
            >
              Start Placing Points
            </button>
            <button 
              onClick={(e) => { e.stopPropagation(); applyCalibration(); }}
              disabled={!calibrationStartPoint || !calibrationEndPoint || calibrationPhase !== 'placingEnd'}
              className={styles.toolButton}
            >
              Apply Calibration
            </button>
            <button 
              onClick={(e) => { e.stopPropagation(); cancelCalibration(); }}
              className={`${styles.toolButton} ${styles.dangerButton}`}
            >
              Cancel
            </button>
          </div>
        )}
        
        <canvas ref={canvasRef} className={styles.measurementCanvas} />
    </div>
  );
};

export default MeasurementTool;