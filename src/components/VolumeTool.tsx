import React, { useState, useEffect, useCallback } from 'react';
import { useRootStore } from '../stores/rootStore';
import type { Point, Measurement, UNIT_CONVERSIONS } from '../types/common';
import { screenToWorld, estimateGroundPlaneIntersection, calculateDistance3D } from '../services/geometry';
import styles from './VolumeTool.module.css';

interface VolumePoint extends Point {
  id: string;
  worldPoint?: { x: number; y: number; z: number };
}

// Calculate volume of rectangular prism defined by two opposite corners
function calculateRectangularVolume(
  corner1: { x: number; y: number; z: number },
  corner2: { x: number; y: number; z: number },
  height: number = 3 // Default height in meters
): { volume: number; dimensions: { length: number; width: number; height: number } } {
  const length = Math.abs(corner2.x - corner1.x);
  const width = Math.abs(corner2.z - corner1.z);
  const volume = length * width * height;

  return {
    volume,
    dimensions: { length, width, height }
  };
}

const VolumeTool: React.FC = () => {
  const { currentCameraParams: cameraParams } = useRootStore();
  const { isVolumeToolActive, setIsVolumeToolActive } = useRootStore();
  const { addMeasurement, settings } = useRootStore();

  const [points, setPoints] = useState<VolumePoint[]>([]);
  const [volume, setVolume] = useState(0);
  const [dimensions, setDimensions] = useState({ length: 0, width: 0, height: 3 });
  const [height, setHeight] = useState(3); // Default height in meters

  // Handle canvas clicks to add points
  const handleCanvasClick = useCallback((event: MouseEvent) => {
    if (!isVolumeToolActive || !cameraParams || points.length >= 2) return;

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
      const newPoint: VolumePoint = {
        id: `point-${Date.now()}-${Math.random()}`,
        x,
        y,
        worldPoint
      };

      setPoints(prev => [...prev, newPoint]);
    }
  }, [isVolumeToolActive, cameraParams, points.length]);

  // Calculate volume when points or height change
  useEffect(() => {
    if (points.length < 2) {
      setVolume(0);
      setDimensions({ length: 0, width: 0, height });
      return;
    }

    const worldPoints = points.map(p => p.worldPoint!).filter(Boolean);
    if (worldPoints.length < 2) {
      setVolume(0);
      setDimensions({ length: 0, width: 0, height });
      return;
    }

    const result = calculateRectangularVolume(worldPoints[0], worldPoints[1], height);
    setVolume(result.volume);
    setDimensions(result.dimensions);
  }, [points, height]);

  // Add event listeners when tool is active
  useEffect(() => {
    if (isVolumeToolActive) {
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
  }, [isVolumeToolActive, handleCanvasClick]);

  // Complete the measurement
  const handleCompleteMeasurement = useCallback(() => {
    if (points.length >= 2 && volume > 0) {
      // Create volume measurement object
      const volumeMeasurement: Omit<Measurement, 'id' | 'timestamp' | 'name'> = {
        kind: 'volume',
        label: `Volume (${dimensions.length.toFixed(1)}m x ${dimensions.width.toFixed(1)}m x ${dimensions.height.toFixed(1)}m)`,
        startPoint: points[0],
        endPoint: points[1],
        distance: settings.defaultUnit === 'imperial'
          ? volume * 35.315 // Cubic meters to cubic feet
          : volume,
        unit: settings.defaultUnit,
        panoId: cameraParams?.panoId ?? cameraParams?.pano,
        cameraParams: cameraParams,
        confidence: 0.6, // Volume measurements are less reliable
        source: 'volume',
        volumeCubicMeters: volume,
        areaSquareMeters: dimensions.length * dimensions.width,
        dimensionsMeters: { ...dimensions },
        points: points.map(({ x, y }) => ({ x, y })),
        metadata: {
          heightMeters: height,
          worldPointsMeters: points.map((p) => p.worldPoint).filter(Boolean),
        },
        error: points.length < 2 ? 'Need 2 points for volume measurement' : undefined
      };

      addMeasurement(volumeMeasurement);

      // Reset tool
      setPoints([]);
      setVolume(0);
      setDimensions({ length: 0, width: 0, height: 3 });
      setHeight(3);
    }
  }, [points, volume, dimensions, settings.defaultUnit, cameraParams, addMeasurement]);

  // Cancel measurement
  const handleCancel = useCallback(() => {
    setPoints([]);
    setVolume(0);
    setDimensions({ length: 0, width: 0, height: 3 });
    setHeight(3);
  }, []);

  // Close tool
  const handleClose = useCallback(() => {
    handleCancel();
    setIsVolumeToolActive(false);
  }, [handleCancel, setIsVolumeToolActive]);

  if (!isVolumeToolActive) return null;

  const displayVolume = settings.defaultUnit === 'imperial'
    ? volume * 35.315 // Cubic meters to cubic feet
    : volume;
  const volumeUnit = settings.defaultUnit === 'imperial' ? 'cu ft' : 'cu m';
  const lengthUnit = settings.defaultUnit === 'imperial' ? 'ft' : 'm';

  return (
    <div className={styles['volumeTool']}>
      <div className={styles['toolHeader']}>
        <h3>Volume Measurement Tool</h3>
        <button onClick={handleClose} className={styles['closeButton']}>Close</button>
      </div>

      <div className={styles['toolContent']}>
        <div className={styles['instructions']}>
          <p><strong>Instructions:</strong></p>
          <p>Click two opposite corners of the rectangular area to measure.</p>
          <p>Adjust the height below for 3D volume calculation.</p>
        </div>

        <div className={styles['heightControl']}>
          <label>
            Height: {settings.defaultUnit === 'imperial' ? (height * 3.281).toFixed(1) : height.toFixed(1)} {lengthUnit}
          </label>
          <input
            type="range"
            min="0.5"
            max="20"
            step="0.5"
            value={height}
            onChange={(e) => setHeight(parseFloat(e.target.value))}
            className={styles['heightSlider']}
          />
        </div>

        <div className={styles['measurementInfo']}>
          <div className={styles['pointsCount']}>
            Points: {points.length}/2
          </div>

          {volume > 0 && (
            <div className={styles['volumeInfo']}>
              <div className={styles['volumeValue']}>
                Volume: {displayVolume.toFixed(2)} {volumeUnit}
              </div>
              <div className={styles['dimensions']}>
                Dimensions: {dimensions.length.toFixed(1)} x {dimensions.width.toFixed(1)} x {dimensions.height.toFixed(1)} {lengthUnit === 'm' ? 'm' : 'ft'}
              </div>
            </div>
          )}
        </div>

        <div className={styles['controls']}>
          <button
            onClick={handleCompleteMeasurement}
            disabled={points.length < 2}
            className={styles['completeButton']}
          >
            Complete Volume Measurement
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

export default VolumeTool;
