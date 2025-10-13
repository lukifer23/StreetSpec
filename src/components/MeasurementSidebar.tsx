import React, { useCallback } from 'react';
import { useRootStore, useMeasurementActions, useSettingsActions } from '../stores/rootStore';
import type { Measurement } from '../types/common';
import { convertLengthToDisplay, convertAreaToDisplay, convertVolumeToDisplay } from '../utils/units';
import { pushNotification } from '../stores/notificationStore';
import styles from './MeasurementSidebar.module.css';

export const formatPrimaryLine = (measurement: Measurement): string => {
  switch (measurement.kind) {
    case 'distance':
    case 'polyline': {
      const { value, unitLabel } = convertLengthToDisplay(measurement.distanceMeters, measurement.unit);
      const numeric = value !== undefined ? value.toFixed(2) : '--';
      return `${measurement.label}: ${numeric} ${unitLabel}`;
    }
    case 'area': {
      const { value, unitLabel } = convertAreaToDisplay(measurement.areaSquareMeters, measurement.unit);
      const numeric = value !== undefined ? value.toFixed(2) : '--';
      return `${measurement.label}: ${numeric} ${unitLabel}`;
    }
    case 'volume': {
      const { value, unitLabel } = convertVolumeToDisplay(measurement.volumeCubicMeters, measurement.unit);
      const numeric = value !== undefined ? value.toFixed(2) : '--';
      return `${measurement.label}: ${numeric} ${unitLabel}`;
    }
    default:
      return `${measurement.label}`;
  }
};

export const formatSecondaryLine = (measurement: Measurement): string | undefined => {
  const parts: string[] = [];

  if (measurement.kind === 'polyline' && measurement.points) {
    parts.push(`${measurement.points.length} points`);
  }

  if (measurement.kind === 'area' && Number.isFinite(measurement.perimeterMeters)) {
    const { value, unitLabel } = convertLengthToDisplay(measurement.perimeterMeters, measurement.unit);
    if (value !== undefined) {
      parts.push(`Perimeter ${value.toFixed(2)} ${unitLabel}`);
    }
  }

  if (measurement.kind === 'volume' && measurement.dimensionsMeters) {
    const { length, width, height } = measurement.dimensionsMeters;
    const lengthDisplay = convertLengthToDisplay(length, measurement.unit);
    const widthDisplay = convertLengthToDisplay(width, measurement.unit);
    const heightDisplay = convertLengthToDisplay(height, measurement.unit);
    if (
      lengthDisplay.value !== undefined &&
      widthDisplay.value !== undefined &&
      heightDisplay.value !== undefined
    ) {
      parts.push(
        `Dimensions ${lengthDisplay.value.toFixed(1)} x ${widthDisplay.value.toFixed(1)} x ${heightDisplay.value.toFixed(1)} ${lengthDisplay.unitLabel}`
      );
    }
  }

  if (Number.isFinite(measurement.confidence)) {
    parts.push(`Confidence ${Math.round((measurement.confidence ?? 0) * 100)}%`);
  }

  if (measurement.source) {
    parts.push(`Source ${measurement.source}`);
  }

  return parts.length > 0 ? parts.join(' | ') : undefined;
};

const escapeCsv = (value: string) => `"${value.replace(/"/g, '""')}"`;

export const getDisplayValue = (measurement: Measurement): { value?: number; unitLabel: string } => {
  switch (measurement.kind) {
    case 'distance':
    case 'polyline':
      return convertLengthToDisplay(measurement.distanceMeters, measurement.unit);
    case 'area':
      return convertAreaToDisplay(measurement.areaSquareMeters, measurement.unit);
    case 'volume':
      return convertVolumeToDisplay(measurement.volumeCubicMeters, measurement.unit);
    default:
      return { value: undefined, unitLabel: measurement.unit === 'imperial' ? 'imperial' : 'metric' };
  }
};

const getSegmentSummary = (measurement: Measurement) => {
  const meta = measurement.metadata as { segmentDistancesMeters?: unknown } | undefined;
  const segments = meta?.segmentDistancesMeters;
  if (!Array.isArray(segments) || segments.length === 0) {
    return '';
  }
  return segments
    .map((segment) => (typeof segment === 'number' && Number.isFinite(segment) ? segment.toFixed(3) : ''))
    .filter(Boolean)
    .join('|');
};

const MeasurementSidebar: React.FC = () => {
  const { measurements, settings } = useRootStore(
    useCallback(
      (state) => ({
        measurements: state.measurements,
        settings: state.settings,
      }),
      []
    )
  );
  const { deleteMeasurement, renameMeasurement, clearMeasurements } = useMeasurementActions();
  const { toggleUnit } = useSettingsActions();
  const handleUnitToggle = useCallback(() => {
    toggleUnit();
    if (window.electronAPI?.invoke) {
      window.electronAPI.invoke('save-settings', settings).catch(() => {
        // Silent error handling for production
      });
    }
  }, [toggleUnit, settings]);

  const handleClearMeasurements = useCallback(async () => {
    clearMeasurements();
    if (window.electronAPI?.invoke) {
      try {
        await window.electronAPI.invoke('clear-data');
      } catch (error) {
        // Silent error handling for production
      }
    }
  }, [clearMeasurements]);

  const handleExportCSV = useCallback(async () => {
    if (measurements.length === 0) {
      pushNotification({
        kind: 'info',
        message: 'No measurements available to export.',
      });
      return;
    }
    
    const header = [
      'ID',
      'Timestamp',
      'Type',
      'Label',
      'Name',
      'Value',
      'Display Unit',
      'DistanceMeters',
      'AreaSquareMeters',
      'VolumeCubicMeters',
      'PerimeterMeters',
      'SegmentsMeters',
      'StartX',
      'StartY',
      'EndX',
      'EndY',
      'Source',
      'Confidence'
    ].join(',');
    const rows = measurements.map((m) => {
      const display = getDisplayValue(m);
      const valueString =
        display.value !== undefined && Number.isFinite(display.value)
          ? display.value.toFixed(3)
          : '';
      const segmentSummary = getSegmentSummary(m);

      const raw = [
        m.id,
        new Date(m.timestamp).toISOString(),
        m.kind,
        m.label,
        m.name ?? '',
        valueString,
        display.unitLabel,
        m.distanceMeters ?? '',
        m.areaSquareMeters ?? '',
        m.volumeCubicMeters ?? '',
        m.perimeterMeters ?? '',
        segmentSummary,
        m.startPoint.x,
        m.startPoint.y,
        m.endPoint.x,
        m.endPoint.y,
        m.source ?? '',
        m.confidence !== undefined ? m.confidence.toFixed(2) : ''
      ];

      return raw.map((value) => escapeCsv(String(value ?? ''))).join(',');
    });
    const csvContent = [header, ...rows].join('\n');

    try {
      if (window.electronAPI && typeof window.electronAPI.invoke === 'function') {
        const filePath = await window.electronAPI.invoke('csv-export', csvContent);
        if (filePath) {
          pushNotification({
            kind: 'success',
            title: 'Export complete',
            message: `Measurements saved to ${filePath}`,
            timeoutMs: 8000,
          });
        }
      } else {
        pushNotification({
          kind: 'error',
          title: 'Export failed',
          message: 'Unable to communicate with the main process.',
        });
      }
    } catch (error) {
      pushNotification({
        kind: 'error',
        title: 'Export failed',
        message: error instanceof Error ? error.message : 'Unexpected export error.',
      });
    }
  }, [measurements]);

  return (
    <div className={styles['sidebar']}>
      <div className={styles['sidebarHeader']}>
        <h4>Measurements</h4>
        <div className={styles['sidebarControls']}>
          <button 
            onClick={handleUnitToggle} 
            className={styles['unitToggle']}
            title={`Toggle units (${settings.defaultUnit === 'metric' ? 'Imperial' : 'Metric'})`}
          >
            {settings.defaultUnit === 'metric' ? 'm/ft' : 'ft/m'}
          </button>
          {measurements.length > 0 && (
            <>
              <button 
                onClick={handleExportCSV} 
                className={styles['sidebarButton']} 
                title="Export as CSV (Ctrl+E)"
              >
                Export
              </button>
              <button 
                onClick={handleClearMeasurements} 
                className={`${styles['sidebarButton']} ${styles['dangerButton']}`} 
                title="Clear All Measurements (Ctrl+Shift+Delete)"
              >
                Clear All
              </button>
            </>
          )}
        </div>
      </div>

      {measurements.length === 0 ? (
        <div className={styles['noMeasurements']}>
          No measurements yet.
        </div>
      ) : (
        <ul className={styles['measurementList']}>
          {measurements.map((measurement) => {
            const secondary = formatSecondaryLine(measurement);

            return (
              <li key={measurement.id} className={styles['measurementItem']}>
                <input
                  type="text"
                  placeholder="Add Name..."
                  value={measurement.name || ''}
                  onChange={(event) => renameMeasurement(measurement.id, event.target.value)}
                  className={styles['nameInput']}
                  title="Rename Measurement"
                />
                <div className={styles['measurementSummary']}>
                  <div className={styles['measurementValue']}>{formatPrimaryLine(measurement)}</div>
                  {secondary && <div className={styles['measurementMeta']}>{secondary}</div>}
                </div>
                <button
                  onClick={() => deleteMeasurement(measurement.id)}
                  className={styles['deleteButton']}
                  title="Delete Measurement"
                >
                  Delete
                </button>
              </li>
            );
          })}
        </ul>
      )}
      
      <div className={styles['sidebarFooter']}>
        <div>Street Spec Desktop v0.0.1</div>
        <div className={styles['shortcuts']}>
          <span title="Start height measurement (M key)">M: Measure</span>
          <span title="Toggle measurement units (U key)">U: Units</span>
          <span title="Export measurements to CSV (Ctrl+E)">Ctrl+E: Export</span>
          <span title="Clear all measurements (Ctrl+Shift+Delete)">Ctrl+Shift+Del: Clear</span>
        </div>
      </div>
    </div>
  );
};

export default MeasurementSidebar;
