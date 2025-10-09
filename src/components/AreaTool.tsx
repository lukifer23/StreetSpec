import React, { useState, useEffect, useCallback } from 'react';
import { useRootStore } from '../stores/rootStore';
import type { Point, Measurement, UNIT_CONVERSIONS } from '../types/common';
import { screenToWorld, estimateGroundPlaneIntersection, calculateDistance3D } from '../services/geometry';
import styles from './AreaTool.module.css';

interface AreaPoint extends Point {
  id: string;
  worldPoint?: { x: number; y: number; z: number };
}

// Calculate polygon area using the shoelace formula
function calculatePolygonArea(points: { x: number; y: number; z: number }[]): number {
  if (points.length < 3) return 0;

  let area = 0;
  const n = points.length;

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += points[i].x * points[j].z;
    area -= points[j].x * points[i].z;
  }

  return Math.abs(area) / 2;
}

// Calculate perimeter of polygon
function calculatePolygonPerimeter(points: { x: number; y: number; z: number }[]): number {
  if (points.length < 2) return 0;

  let perimeter = 0;
  const n = points.length;

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    perimeter += calculateDistance3D(points[i], points[j]);
  }

  return perimeter;
}

const AreaTool: React.FC = () => {
  const { currentCameraParams: cameraParams } = useRootStore();
  const { isAreaToolActive, setIsAreaToolActive } = useRootStore();
  const { addMeasurement, settings } = useRootStore();

  const [points, setPoints] = useState<AreaPoint[]>([]);
  const [area, setArea] = useState(0);
  const [perimeter, setPerimeter] = useState(0);

  // Handle canvas clicks to add points
  const handleCanvasClick = useCallback((event: MouseEvent) => {
    if (!isAreaToolActive || !cameraParams) return;

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
      const newPoint: AreaPoint = {
        id: `point-${Date.now()}-${Math.random()}`,
        x,
        y,
        worldPoint
      };

      setPoints(prev => [...prev, newPoint]);
    }
  }, [isAreaToolActive, cameraParams]);

  // Calculate area and perimeter when points change
  useEffect(() => {
    if (points.length < 3) {
      setArea(0);
      setPerimeter(0);
      return;
    }

    const worldPoints = points.map(p => p.worldPoint!).filter(Boolean);
    if (worldPoints.length < 3) {
      setArea(0);
      setPerimeter(0);
      return;
    }

    const calculatedArea = calculatePolygonArea(worldPoints);
    const calculatedPerimeter = calculatePolygonPerimeter(worldPoints);

    setArea(calculatedArea);
    setPerimeter(calculatedPerimeter);
  }, [points]);

  // Add event listeners when tool is active
  useEffect(() => {
    if (isAreaToolActive) {
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
  }, [isAreaToolActive, handleCanvasClick]);

  // Complete the measurement
  const handleCompleteMeasurement = useCallback(() => {
    if (points.length >= 3 && area > 0) {
      // Create area measurement object
      const areaMeasurement: Omit<Measurement, 'id' | 'timestamp' | 'name'> = {
        label: `Area (${points.length} points)`,
        startPoint: points[0],
        endPoint: points[points.length - 1],
        distanceMeters: area, // Using distance field to store area
        distance: settings.defaultUnit === 'imperial'
          ? area * 10.764 // Square meters to square feet
          : area,
        unit: settings.defaultUnit,
        panoId: cameraParams?.panoId ?? cameraParams?.pano,
        cameraParams: cameraParams,
        confidence: 0.7, // Area measurements are moderately reliable
        source: 'area',
        error: points.length < 3 ? 'Need at least 3 points for area measurement' : undefined
      };

      addMeasurement(areaMeasurement);

      // Reset tool
      setPoints([]);
      setArea(0);
      setPerimeter(0);
    }
  }, [points, area, settings.defaultUnit, cameraParams, addMeasurement]);

  // Cancel measurement
  const handleCancel = useCallback(() => {
    setPoints([]);
    setArea(0);
    setPerimeter(0);
  }, []);

  // Close tool
  const handleClose = useCallback(() => {
    handleCancel();
    setIsAreaToolActive(false);
  }, [handleCancel, setIsAreaToolActive]);

  if (!isAreaToolActive) return null;

  const displayArea = settings.defaultUnit === 'imperial'
    ? area * 10.764 // Square meters to square feet
    : area;
  const displayPerimeter = settings.defaultUnit === 'imperial'
    ? UNIT_CONVERSIONS.metersToFeet(perimeter)
    : perimeter;
  const areaUnit = settings.defaultUnit === 'imperial' ? 'sq ft' : 'sq m';
  const perimeterUnit = settings.defaultUnit === 'imperial' ? 'ft' : 'm';

  return (
    <div className={styles['areaTool']}>
      <div className={styles['toolHeader']}>
        <h3>Area Measurement Tool</h3>
        <button onClick={handleClose} className={styles['closeButton']}>×</button>
      </div>

      <div className={styles['toolContent']}>
        <div className={styles['instructions']}>
          <p><strong>Instructions:</strong></p>
          <p>Click on the map to define the corners of the area you want to measure.</p>
          <p>Add at least 3 points to create an area measurement.</p>
        </div>

        <div className={styles['measurementInfo']}>
          <div className={styles['pointsCount']}>
            Points: {points.length}
          </div>

          {area > 0 && (
            <div className={styles['areaInfo']}>
              <div className={styles['areaValue']}>
                Area: {displayArea.toFixed(2)} {areaUnit}
              </div>
              <div className={styles['perimeterValue']}>
                Perimeter: {displayPerimeter.toFixed(2)} {perimeterUnit}
              </div>
            </div>
          )}
        </div>

        <div className={styles['controls']}>
          <button
            onClick={handleCompleteMeasurement}
            disabled={points.length < 3}
            className={styles['completeButton']}
          >
            Complete Area Measurement
          </button>
          <button onClick={handleCancel} className={styles['cancelButton']}>
            Clear Points
          </button>
        </div>

        {cameraParams && (
          <div className={styles['cameraInfo']}>
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

export default AreaTool;