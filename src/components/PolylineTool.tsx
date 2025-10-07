import React, { useState, useEffect, useCallback } from 'react';
import { useRootStore } from '../stores/rootStore';
import { Point, Measurement, UNIT_CONVERSIONS } from '../types/common';
import { screenToWorld, estimateGroundPlaneIntersection, calculateDistance3D } from '../services/geometry';
import styles from './PolylineTool.module.css';

interface PolylinePoint extends Point {
  id: string;
  worldPoint?: { x: number; y: number; z: number };
}

const PolylineTool: React.FC = () => {
  const { currentCameraParams: cameraParams } = useRootStore();
  const { isPolylineToolActive, setIsPolylineToolActive } = useRootStore();
  const { addMeasurement, settings } = useRootStore();

  const [points, setPoints] = useState<PolylinePoint[]>([]);
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [totalDistance, setTotalDistance] = useState(0);
  const [segmentDistances, setSegmentDistances] = useState<number[]>([]);

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

    const directionVector = screenToWorld({ x, y }, cameraParams, viewWidth, viewHeight);
    const worldPoint = estimateGroundPlaneIntersection(directionVector, cameraParams);

    if (worldPoint) {
      const newPoint: PolylinePoint = {
        id: `point-${Date.now()}-${Math.random()}`,
        x,
        y,
        worldPoint
      };

      setPoints(prev => [...prev, newPoint]);
      setIsMeasuring(true);
    }
  }, [isPolylineToolActive, cameraParams]);

  // Calculate distances when points change
  useEffect(() => {
    if (points.length < 2) {
      setTotalDistance(0);
      setSegmentDistances([]);
      return;
    }

    const distances: number[] = [];
    let total = 0;

    for (let i = 1; i < points.length; i++) {
      const prevPoint = points[i - 1].worldPoint!;
      const currentPoint = points[i].worldPoint!;
      const distance = calculateDistance3D(prevPoint, currentPoint);
      distances.push(distance);
      total += distance;
    }

    setSegmentDistances(distances);
    setTotalDistance(total);
  }, [points]);

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
  }, [isPolylineToolActive, handleCanvasClick]);

  // Complete the measurement
  const handleCompleteMeasurement = useCallback(() => {
    if (points.length >= 2 && totalDistance > 0) {
      // Create measurement object
      const measurement: Omit<Measurement, 'id' | 'timestamp' | 'name'> = {
        label: `Polyline (${points.length} points)`,
        startPoint: points[0],
        endPoint: points[points.length - 1],
        distanceMeters: totalDistance,
        distance: settings.defaultUnit === 'imperial'
          ? UNIT_CONVERSIONS.metersToFeet(totalDistance)
          : totalDistance,
        unit: settings.defaultUnit,
        panoId: cameraParams?.panoId ?? cameraParams?.pano,
        cameraParams: cameraParams,
        confidence: 0.8, // Polyline measurements are generally reliable
        source: 'polyline',
        error: points.length < 2 ? 'Need at least 2 points for measurement' : undefined
      };

      addMeasurement(measurement);

      // Reset tool
      setPoints([]);
      setIsMeasuring(false);
      setTotalDistance(0);
      setSegmentDistances([]);
    }
  }, [points, totalDistance, settings.defaultUnit, cameraParams, addMeasurement]);

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

  const displayDistance = settings.defaultUnit === 'imperial'
    ? UNIT_CONVERSIONS.metersToFeet(totalDistance)
    : totalDistance;
  const unitLabel = settings.defaultUnit === 'imperial' ? 'ft' : 'm';

  return (
    <div className={styles.polylineTool}>
      <div className={styles.toolHeader}>
        <h3>Polyline Measurement Tool</h3>
        <button onClick={handleClose} className={styles.closeButton}>×</button>
      </div>

      <div className={styles.toolContent}>
        <div className={styles.instructions}>
          <p><strong>Instructions:</strong></p>
          <p>Click on the map to add points to your measurement path.</p>
          <p>Add at least 2 points to create a measurement.</p>
        </div>

        <div className={styles.measurementInfo}>
          <div className={styles.pointsCount}>
            Points: {points.length}
          </div>

          {totalDistance > 0 && (
            <div className={styles.distanceInfo}>
              <div className={styles.totalDistance}>
                Total Distance: {displayDistance.toFixed(2)} {unitLabel}
              </div>

              {segmentDistances.length > 0 && (
                <div className={styles.segments}>
                  <h4>Segments:</h4>
                  <ul>
                    {segmentDistances.map((distance, index) => {
                      const segmentDistance = settings.defaultUnit === 'imperial'
                        ? UNIT_CONVERSIONS.metersToFeet(distance)
                        : distance;
                      return (
                        <li key={index}>
                          Point {index + 1} → Point {index + 2}: {segmentDistance.toFixed(2)} {unitLabel}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <div className={styles.controls}>
          <button
            onClick={handleCompleteMeasurement}
            disabled={points.length < 2}
            className={styles.completeButton}
          >
            Complete Measurement
          </button>
          <button onClick={handleCancel} className={styles.cancelButton}>
            Clear Points
          </button>
        </div>

        {cameraParams && (
          <div className={styles.cameraInfo}>
            <h4>Camera Parameters:</h4>
            <ul>
              <li>Heading: {cameraParams.heading?.toFixed(2)}°</li>
              <li>Pitch: {cameraParams.pitch?.toFixed(2)}°</li>
              <li>Zoom: {cameraParams.zoom?.toFixed(2)}</li>
              <li>FOV: {cameraParams.fov?.toFixed(2)}°</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};

export default PolylineTool;
