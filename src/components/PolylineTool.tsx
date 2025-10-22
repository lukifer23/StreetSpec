import React, { useState, useEffect, useCallback } from 'react';
import { useRootStore } from '../stores/rootStore';
import { UNIT_CONVERSIONS } from '../types/common';
import type { Point, Measurement } from '../types/common';
import { screenToWorld, estimateGroundPlaneIntersection, calculateDistance3D, screenToWorldWithDepth } from '../services/geometry';
import { estimateDistanceToPoint } from '../services/measurementLogic';
import styles from './PolylineTool.module.css';

interface PolylinePoint extends Point {
  id: string;
  worldPoint?: { x: number; y: number; z: number };
  worldSource?: 'planes' | 'ground' | 'onnx';
}

const PolylineTool: React.FC = () => {
  const cameraParams = useRootStore((state) => state.currentCameraParams);
  const isPolylineToolActive = useRootStore((state) => state.isPolylineToolActive);
  const setIsPolylineToolActive = useRootStore((state) => state.setIsPolylineToolActive);
  const addMeasurement = useRootStore((state) => state.addMeasurement);
  const settings = useRootStore((state) => state.settings);
  const defaultUnit = settings.defaultUnit;
  const depthData = useRootStore((state) => state.depthData);

  const [points, setPoints] = useState<PolylinePoint[]>([]);
  const [, setIsMeasuring] = useState(false);
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

    let worldPoint = undefined as PolylinePoint['worldPoint'] | undefined;
    let worldSource: PolylinePoint['worldSource'] = undefined;

    if (depthData) {
      const depthWorld = screenToWorldWithDepth({ x, y }, cameraParams, viewWidth, viewHeight, depthData);
      if (depthWorld) {
        worldPoint = depthWorld;
        worldSource = 'planes';
      }
    }

    if (!worldPoint) {
      const onnx = useRootStore.getState().onnxDepthMap;
      if (onnx && cameraParams) {
        const d = estimateDistanceToPoint(x, y, viewWidth, viewHeight, cameraParams, onnx);
        if (d && Number.isFinite(d) && d > 0) {
          const dir = screenToWorld({ x, y }, cameraParams, viewWidth, viewHeight);
          worldPoint = { x: dir.x * d, y: dir.y * d, z: dir.z * d };
          worldSource = 'onnx';
        }
      }
    }

    if (!worldPoint) {
      const directionVector = screenToWorld({ x, y }, cameraParams, viewWidth, viewHeight);
      const groundPoint = estimateGroundPlaneIntersection(directionVector, cameraParams);
      if (groundPoint) {
        worldPoint = groundPoint;
        worldSource = 'ground';
      }
    }

    if (worldPoint) {
      const newPoint: PolylinePoint = {
        id: `point-${Date.now()}-${Math.random()}`,
        x,
        y,
        worldPoint,
        worldSource
      };

      setPoints(prev => [...prev, newPoint]);
      setIsMeasuring(true);
    }
  }, [isPolylineToolActive, cameraParams, depthData]);

  // Calculate distances when points change
  useEffect(() => {
    if (points.length < 2) {
      setTotalDistance(0);
      setSegmentDistances([]);
      return;
    }

    // Filter out points without worldPoint
    const validPoints = points.filter(p => p.worldPoint != null);
    if (validPoints.length < 2) {
      setTotalDistance(0);
      setSegmentDistances([]);
      return;
    }

    const distances: number[] = [];
    let total = 0;

    for (let i = 1; i < validPoints.length; i++) {
      const prevWorldPoint = validPoints[i - 1].worldPoint!;
      const currentWorldPoint = validPoints[i].worldPoint!;
      const distance = calculateDistance3D(prevWorldPoint, currentWorldPoint);
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
    return undefined;
  }, [isPolylineToolActive, handleCanvasClick]);

  // Complete the measurement
  const handleCompleteMeasurement = useCallback(() => {
    if (points.length >= 2 && totalDistance > 0) {
      // Create measurement object
      const planesBackedCount = points.filter((point) => point.worldSource === 'planes').length;
      const confidence =
        planesBackedCount === points.length
          ? 0.85
          : planesBackedCount > 0
            ? 0.75
            : 0.6;

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
        confidence,
        source: 'polyline',
        points: points.map(({ x, y }) => ({ x, y })),
        metadata: {
          segmentDistancesMeters: segmentDistances,
          worldPointsMeters: points.map((point) => point.worldPoint),
          pointSources: points.map((point) => point.worldSource ?? 'ground'),
        },
        error: points.length < 2 ? 'Need at least 2 points for measurement' : undefined
      };

      addMeasurement(measurement);

      // Reset tool
      setPoints([]);
      setIsMeasuring(false);
      setTotalDistance(0);
      setSegmentDistances([]);
    }
  }, [points, totalDistance, segmentDistances, defaultUnit, cameraParams, addMeasurement]);

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



