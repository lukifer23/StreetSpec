import React, { useState, useEffect, useCallback } from 'react';
import { useRootStore } from '../stores/rootStore';
import { UNIT_CONVERSIONS } from '../types/common';
import type { Point, Measurement } from '../types/common';
// Geometry functions imported via fusedWorldPoint
import { distance3D } from '../utils/math';
import { estimateDistanceToPoint, fusedWorldPoint } from '../services/measurementLogic';
import { validateMeasurementPlausibility } from '../utils/polygonValidation';
import styles from './PolylineTool.module.css';

interface PolylinePoint extends Point {
  id: string;
  worldPoint?: { x: number; y: number; z: number };
  worldSource?: 'planes' | 'ground' | 'onnx';
}

type ValidPolylinePoint = PolylinePoint & { worldPoint: NonNullable<PolylinePoint['worldPoint']> };

const PolylineTool: React.FC = () => {
  const cameraParams = useRootStore((state) => state.currentCameraParams);
  const isPolylineToolActive = useRootStore((state) => state.isPolylineToolActive);
  const setIsPolylineToolActive = useRootStore((state) => state.setIsPolylineToolActive);
  const addMeasurement = useRootStore((state) => state.addMeasurement);
  const settings = useRootStore((state) => state.settings);
  const defaultUnit = settings.defaultUnit;
  const depthData = useRootStore((state) => state.depthData);
  const onnxDepthMap = useRootStore((state) => state.onnxDepthMap);

  const [points, setPoints] = useState<PolylinePoint[]>([]);
  const [, setIsMeasuring] = useState(false);
  const [totalDistance, setTotalDistance] = useState(0);
  const [segmentDistances, setSegmentDistances] = useState<number[]>([]);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [measurementConfidence, setMeasurementConfidence] = useState(1.0);

  // Handle canvas clicks to add points
  const handleCanvasClick = useCallback((event: MouseEvent) => {
    if (!isPolylineToolActive || !cameraParams) return;

    // Get click position relative to the MapView canvas
    const mapView = document.querySelector('[data-testid="map-view"]') as HTMLElement;
    if (!mapView) return;

    const rect = mapView.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    // Convert screen coordinates to world coordinates
    const viewWidth = rect.width;
    const viewHeight = rect.height;

    // Use unified depth fusion for robust world point estimation
    const onnxDistance = onnxDepthMap && cameraParams 
      ? estimateDistanceToPoint(x, y, viewWidth, viewHeight, cameraParams, onnxDepthMap)
      : null;
    
    const fused = fusedWorldPoint(
      { x, y },
      viewWidth,
      viewHeight,
      cameraParams,
      depthData,
      onnxDistance,
      onnxDepthMap,
      {
        depthKernelSize: settings.depthKernelSize,
        depthUseBilinear: settings.depthUseBilinear,
        depthEdgeRejectThreshold: settings.depthEdgeRejectThreshold
      }
    );

    if (fused.world) {
      const newPoint: PolylinePoint = {
        id: `point-${Date.now()}-${Math.random()}`,
        x,
        y,
        worldPoint: fused.world,
        worldSource: fused.method
      };

      setPoints(prev => [...prev, newPoint]);
      setIsMeasuring(true);
    }
  }, [isPolylineToolActive, cameraParams, depthData, onnxDepthMap, settings]);

  // Calculate distances with validation when points change
  useEffect(() => {
    if (points.length < 2) {
      setTotalDistance(0);
      setSegmentDistances([]);
      setValidationError(null);
      setMeasurementConfidence(0);
      return;
    }

    // Filter out points without worldPoint
    const validPoints = points.filter((p): p is ValidPolylinePoint =>
      p.worldPoint != null
    ) as ValidPolylinePoint[];
    if (validPoints.length < 2) {
      setTotalDistance(0);
      setSegmentDistances([]);
      setValidationError('Unable to resolve world coordinates for all points');
      setMeasurementConfidence(0);
      return;
    }

    const worldPoints = validPoints.map(p => p.worldPoint);
    const distances: number[] = [];
    let total = 0;

    for (let i = 1; i < validPoints.length; i++) {
      const prevPoint = validPoints[i - 1];
      const currentPoint = validPoints[i];
      if (!prevPoint?.worldPoint || !currentPoint?.worldPoint) continue;
      
      const distance = distance3D(prevPoint.worldPoint, currentPoint.worldPoint);
      
      // Validate segment distance
      if (!Number.isFinite(distance) || distance < 0) {
        setValidationError(`Invalid segment distance at point ${i}`);
        setSegmentDistances([]);
        setTotalDistance(0);
        setMeasurementConfidence(0);
        return;
      }
      
      distances.push(distance);
      total += distance;
    }

    // Plausibility check
    const plausibility = validateMeasurementPlausibility(
      total,
      worldPoints,
      cameraParams || undefined
    );

    if (!plausibility.isValid) {
      setValidationError(plausibility.warnings.join('; '));
    } else {
      setValidationError(null);
    }

    // Calculate confidence based on point sources
    const planesBackedCount = validPoints.filter((p) => p.worldSource === 'planes').length;
    const onnxBackedCount = validPoints.filter((p) => p.worldSource === 'onnx').length;
    let baseConfidence = 0.5;
    if (planesBackedCount === validPoints.length) {
      baseConfidence = 0.85;
    } else if (planesBackedCount > validPoints.length * 0.5) {
      baseConfidence = 0.75;
    } else if (onnxBackedCount > validPoints.length * 0.5) {
      baseConfidence = 0.65;
    }
    
    const finalConfidence = baseConfidence * plausibility.confidenceMultiplier;

    setSegmentDistances(distances);
    setTotalDistance(total);
    setMeasurementConfidence(finalConfidence);
  }, [points, cameraParams]);

  // Add event listeners when tool is active
  useEffect(() => {
    if (isPolylineToolActive) {
      const handleClick = (event: MouseEvent) => {
        // Only handle clicks on the map area
        const target = event.target as HTMLElement;
        if (target.closest('[data-testid="map-view"]')) {
          handleCanvasClick(event);
        }
      };

      document.addEventListener('click', handleClick);
      return () => document.removeEventListener('click', handleClick);
    }
    return undefined;
  }, [isPolylineToolActive, handleCanvasClick]);

  // Complete the measurement
  const handleCompleteMeasurement = useCallback(() => {
    if (points.length >= 2 && totalDistance > 0 && !validationError) {
      const validPoints = points.filter((p): p is ValidPolylinePoint => p.worldPoint != null);
      const worldPoints = validPoints.map(p => p.worldPoint);

      // Final plausibility check
      const plausibility = validateMeasurementPlausibility(
        totalDistance,
        worldPoints,
        cameraParams || undefined
      );

      if (!plausibility.isValid) {
        setValidationError(plausibility.warnings.join('; '));
        return;
      }

      const measurement: Omit<Measurement, 'id' | 'timestamp' | 'name'> = {
        kind: 'polyline',
        label: `Polyline (${points.length} points)`,
        startPoint: points[0]!,
        endPoint: points[points.length - 1]!,
        distanceMeters: totalDistance,
        distance: defaultUnit === 'imperial'
          ? UNIT_CONVERSIONS.metersToFeet(totalDistance)
          : totalDistance,
        unit: defaultUnit,
        panoId: cameraParams?.panoId ?? cameraParams?.pano,
        cameraParams: cameraParams || undefined,
        confidence: measurementConfidence,
        source: 'polyline',
        points: points.map(({ x, y }) => ({ x, y })),
        metadata: {
          segmentDistancesMeters: segmentDistances,
          worldPointsMeters: worldPoints,
          pointSources: validPoints.map((point) => point.worldSource ?? 'ground'),
          validationWarnings: plausibility.warnings
        },
        error: validationError || undefined
      };

      addMeasurement(measurement);

      // Reset tool
      setPoints([]);
      setIsMeasuring(false);
      setTotalDistance(0);
      setSegmentDistances([]);
      setValidationError(null);
      setMeasurementConfidence(1.0);
    }
  }, [points, totalDistance, segmentDistances, defaultUnit, cameraParams, addMeasurement, validationError, measurementConfidence]);

  // Cancel measurement
  const handleCancel = useCallback(() => {
    setPoints([]);
    setIsMeasuring(false);
    setTotalDistance(0);
    setSegmentDistances([]);
  }, []);

  // Close tool
  const handleClose = useCallback(() => {
    handleCancel();
    setIsPolylineToolActive(false);
  }, [handleCancel, setIsPolylineToolActive]);

  if (!isPolylineToolActive) return null;

  const displayDistance = defaultUnit === 'imperial'
    ? UNIT_CONVERSIONS.metersToFeet(totalDistance)
    : totalDistance;
  const unitLabel = defaultUnit === 'imperial' ? 'ft' : 'm';

  return (
    <div className={styles['polylineTool']}>
      <div className={styles['toolHeader']}>
        <h3>Polyline Measurement Tool</h3>
        <button onClick={handleClose} className={styles['closeButton']}>Close</button>
      </div>

      <div className={styles['toolContent']}>
        <div className={styles['instructions']}>
          <p><strong>How to use:</strong></p>
          <p>- Click on the map to add waypoints to your measurement path.</p>
          <p>- Add at least 2 points to create a measurement.</p>
          <p>- Click "Complete Measurement" to save the polyline.</p>
          <p>- Press <kbd>Esc</kbd> to cancel and clear points.</p>
        </div>

        <div className={styles['measurementInfo']}>
          <div className={styles['pointsCount']}>
            Points: {points.length}
          </div>

          {totalDistance > 0 && (
            <div className={styles['distanceInfo']}>
              <div className={styles['totalDistance']}>
                Total Distance: {displayDistance.toFixed(2)} {unitLabel}
              </div>

              {segmentDistances.length > 0 && (
                <div className={styles['segments']}>
                  <h4>Segments:</h4>
                  <ul>
                    {segmentDistances.map((distance, index) => {
                      const segmentDistance = settings.defaultUnit === 'imperial'
                        ? UNIT_CONVERSIONS.metersToFeet(distance)
                        : distance;
                      return (
                        <li key={index}>
                          Point {index + 1} {'->'} Point {index + 2}: {segmentDistance.toFixed(2)} {unitLabel}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <div className={styles['controls']}>
          <button
            onClick={handleCompleteMeasurement}
            disabled={points.length < 2}
            className={styles['completeButton']}
          >
            Complete Measurement
          </button>
          <button onClick={handleCancel} className={styles['cancelButton']}>
            Clear Points
          </button>
        </div>

        {cameraParams && (
          <div className={styles['cameraInfo']}>
            <h4>Camera Parameters:</h4>
            <ul>
              <li>Heading: {cameraParams.heading?.toFixed(2)} deg</li>
              <li>Pitch: {cameraParams.pitch?.toFixed(2)} deg</li>
              <li>Zoom: {cameraParams.zoom?.toFixed(2)}</li>
              <li>FOV: {cameraParams.fov?.toFixed(2)} deg</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};

export default PolylineTool;



