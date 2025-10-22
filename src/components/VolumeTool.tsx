import React, { useState, useEffect, useCallback } from 'react';
import { useRootStore } from '../stores/rootStore';
import type { Point, Measurement } from '../types/common';
import { screenToWorld, estimateGroundPlaneIntersection, screenToWorldWithDepth } from '../services/geometry';
import { estimateDistanceToPoint } from '../services/measurementLogic';
import { convertAreaToDisplay, convertLengthToDisplay, convertVolumeToDisplay } from '../utils/units';
import { analyzeVolumeBase, MINIMUM_BASE_AREA } from '../utils/volumeBase';
import type { VolumeBaseAnalysis } from '../utils/volumeBase';
import styles from './VolumeTool.module.css';

interface VolumePoint extends Point {
  id: string;
  worldPoint?: { x: number; y: number; z: number };
  worldSource?: 'planes' | 'ground';
}

const VolumeTool: React.FC = () => {
  const cameraParams = useRootStore((state) => state.currentCameraParams);
  const isVolumeToolActive = useRootStore((state) => state.isVolumeToolActive);
  const setIsVolumeToolActive = useRootStore((state) => state.setIsVolumeToolActive);
  const addMeasurement = useRootStore((state) => state.addMeasurement);
  const defaultUnit = useRootStore((state) => state.settings.defaultUnit);
  const depthData = useRootStore((state) => state.depthData);

  const [points, setPoints] = useState<VolumePoint[]>([]);
  const [volume, setVolume] = useState(0);
  const [dimensions, setDimensions] = useState({ length: 0, width: 0, height: 3 });
  const [height, setHeight] = useState(3); // Default height in meters
  const [baseAnalysis, setBaseAnalysis] = useState<VolumeBaseAnalysis | null>(null);
  const [baseArea, setBaseArea] = useState(0);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Handle canvas clicks to add points
  const handleCanvasClick = useCallback((event: MouseEvent) => {
    if (!isVolumeToolActive || !cameraParams) return;

    // Get click position relative to the MapView canvas
    const mapView = document.querySelector('[data-testid="map-view"]') as HTMLElement;
    if (!mapView) return;

    const rect = mapView.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    // Convert screen coordinates to world coordinates
    const viewWidth = rect.width;
    const viewHeight = rect.height;

    let worldPoint = undefined as VolumePoint['worldPoint'] | undefined;
    let worldSource: VolumePoint['worldSource'] = undefined;

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
      const newPoint: VolumePoint = {
        id: `point-${Date.now()}-${Math.random()}`,
        x,
        y,
        worldPoint,
        worldSource
      };

      setPoints(prev => [...prev, newPoint]);
    }
  }, [isVolumeToolActive, cameraParams, depthData]);

  // Calculate volume when points or height change
  useEffect(() => {
    if (points.length === 0) {
      setBaseAnalysis(null);
      setBaseArea(0);
      setVolume(0);
      setDimensions({ length: 0, width: 0, height });
      setValidationError(null);
      return;
    }

    const worldPoints = points
      .map((p) => p.worldPoint)
      .filter((p): p is { x: number; y: number; z: number } => Boolean(p));

    if (points.length < 3) {
      setBaseAnalysis(null);
      setBaseArea(0);
      setVolume(0);
      setDimensions({ length: 0, width: 0, height });
      setValidationError('Add at least three ground points to define the base polygon.');
      return;
    }

    if (worldPoints.length < 3) {
      setBaseAnalysis(null);
      setBaseArea(0);
      setVolume(0);
      setDimensions({ length: 0, width: 0, height });
      setValidationError('Unable to resolve ground coordinates for all points. Try selecting different points.');
      return;
    }

    const analysis = analyzeVolumeBase(worldPoints, cameraParams?.heading);

    if (!analysis || analysis.area < MINIMUM_BASE_AREA) {
      setBaseAnalysis(null);
      setBaseArea(0);
      setVolume(0);
      setDimensions({ length: 0, width: 0, height });
      setValidationError('Base polygon is too small or degenerate. Adjust the points and try again.');
      return;
    }

    setBaseAnalysis(analysis);
    setBaseArea(analysis.area);
    setDimensions({ length: analysis.length, width: analysis.width, height });
    setVolume(analysis.area * height);
    setValidationError(null);
  }, [points, height, cameraParams?.heading]);

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
    return undefined;
  }, [isVolumeToolActive, handleCanvasClick]);

  // Complete the measurement
  const handleCompleteMeasurement = useCallback(() => {
    if (!baseAnalysis || volume <= 0) {
      return;
    }

    const worldPoints = points
      .map((p) => p.worldPoint)
      .filter((p): p is { x: number; y: number; z: number } => Boolean(p));

    if (worldPoints.length < 3) {
      return;
    }

    const planesBackedCount = points.filter((point) => point.worldSource === 'planes').length;
    const confidence =
      planesBackedCount === points.length
        ? 0.72
        : planesBackedCount > 0
          ? 0.62
          : 0.48;

    const { value: displayVolumeValue } = convertVolumeToDisplay(volume, defaultUnit);
    const baseOrientationDegrees = (baseAnalysis.orientationRadians * 180) / Math.PI;
    const headingDegrees = cameraParams?.heading;

    const volumeMeasurement: Omit<Measurement, 'id' | 'timestamp' | 'name'> = {
      kind: 'volume',
      label: `Volume (base ${baseAnalysis.length.toFixed(1)}m × ${baseAnalysis.width.toFixed(1)}m, height ${height.toFixed(1)}m)`,
      startPoint: points[0]!,
      endPoint: points[points.length - 1]!,
      distance: displayVolumeValue ?? volume,
      unit: defaultUnit,
      panoId: cameraParams?.panoId ?? cameraParams?.pano,
      cameraParams: cameraParams || undefined,
      confidence,
      source: 'volume',
      volumeCubicMeters: volume,
      areaSquareMeters: baseArea,
      dimensionsMeters: { length: baseAnalysis.length, width: baseAnalysis.width, height },
      points: points.map(({ x, y }) => ({ x, y })),
      metadata: {
        heightMeters: height,
        baseAreaSquareMeters: baseArea,
        baseOrientationRadians: baseAnalysis.orientationRadians,
        baseOrientationDegrees,
        baseCentroidGroundFrameMeters: baseAnalysis.centroid,
        basePolygonWorldMeters: worldPoints,
        basePolygonGroundFrameMeters: baseAnalysis.projectedPoints,
        worldPointsMeters: worldPoints,
        headingDegreesAtCapture: headingDegrees,
        pointSources: points.map((point) => point.worldSource ?? 'ground'),
      },
      error: points.length < 3 ? 'Need at least three points for volume measurement' : undefined,
    };

    addMeasurement(volumeMeasurement);

    setPoints([]);
    setVolume(0);
    setDimensions({ length: 0, width: 0, height: 3 });
    setHeight(3);
    setBaseAnalysis(null);
    setBaseArea(0);
    setValidationError(null);
  }, [
    baseAnalysis,
    volume,
    points,
    defaultUnit,
    cameraParams,
    addMeasurement,
    height,
    baseArea,
  ]);

  // Cancel measurement
  const handleCancel = useCallback(() => {
    setPoints([]);
    setVolume(0);
    setDimensions({ length: 0, width: 0, height: 3 });
    setHeight(3);
    setBaseAnalysis(null);
    setBaseArea(0);
    setValidationError(null);
  }, []);

  // Close tool
  const handleClose = useCallback(() => {
    handleCancel();
    setIsVolumeToolActive(false);
  }, [handleCancel, setIsVolumeToolActive]);

  if (!isVolumeToolActive) return null;

  const { value: displayVolumeValue, unitLabel: volumeUnit } = convertVolumeToDisplay(volume, defaultUnit);
  const { value: displayHeightValue, unitLabel: lengthUnit } = convertLengthToDisplay(height, defaultUnit);
  const { value: displayLengthValue } = convertLengthToDisplay(dimensions.length, defaultUnit);
  const { value: displayWidthValue } = convertLengthToDisplay(dimensions.width, defaultUnit);
  const { value: displayDimensionHeightValue } = convertLengthToDisplay(dimensions.height, defaultUnit);
  const { value: displayBaseAreaValue, unitLabel: areaUnit } = convertAreaToDisplay(baseArea, defaultUnit);
  const canComplete = Boolean(baseAnalysis && volume > 0);

  return (
    <div className={styles['volumeTool']}>
      <div className={styles['toolHeader']}>
        <h3>Volume Measurement Tool</h3>
        <button onClick={handleClose} className={styles['closeButton']}>Close</button>
      </div>

      <div className={styles['toolContent']}>
        <div className={styles['instructions']}>
          <p><strong>Instructions:</strong></p>
          <p>Click to add ground points outlining the base footprint (minimum of three points).</p>
          <p>Adjust the height slider to extrude the polygon into a volume.</p>
        </div>

        <div className={styles['heightControl']}>
          <label>
            Height: {displayHeightValue !== undefined ? displayHeightValue.toFixed(1) : '--'} {lengthUnit}
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
            Points: {points.length}
          </div>

          {validationError && (
            <div className={styles['validationMessage']}>
              {validationError}
            </div>
          )}

          {volume > 0 && displayVolumeValue !== undefined && displayLengthValue !== undefined && displayWidthValue !== undefined && displayDimensionHeightValue !== undefined && displayBaseAreaValue !== undefined && (
            <div className={styles['volumeInfo']}>
              <div className={styles['volumeValue']}>
                Volume: {displayVolumeValue.toFixed(2)} {volumeUnit}
              </div>
              <div className={styles['dimensions']}>
                Base dimensions: {displayLengthValue.toFixed(1)} × {displayWidthValue.toFixed(1)} {lengthUnit}
              </div>
              <div className={styles['baseArea']}>
                Base area: {displayBaseAreaValue.toFixed(2)} {areaUnit}
              </div>
              <div className={styles['heightValue']}>
                Height: {displayDimensionHeightValue.toFixed(1)} {lengthUnit}
              </div>
            </div>
          )}
        </div>

        <div className={styles['controls']}>
          <button
            onClick={handleCompleteMeasurement}
            disabled={!canComplete}
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
