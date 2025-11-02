import React, { useCallback } from 'react';
import { useRootStore, useMeasurementActions, useSettingsActions } from '../stores/rootStore';
import { useShallow } from 'zustand/react/shallow';
import type { Measurement } from '../types/common';
import { formatCsvRow, getDisplayValue, getLengthDisplay, getSegmentSummary } from '../utils/measurementDisplay';
import type { UnitSystem } from '../utils/units';
import { pushNotification } from '../stores/notificationStore';
import { FixedSizeList } from 'react-window';
import styles from './MeasurementSidebar.module.css';

const formatPrimaryLine = (measurement: Measurement, defaultUnit: UnitSystem): string => {
  switch (measurement.kind) {
    case 'distance':
    case 'polyline':
    case 'area':
    case 'volume': {
      const display = getDisplayValue(measurement, defaultUnit);
      const numeric = display.value !== undefined ? display.value.toFixed(2) : '--';
      return `${measurement.label}: ${numeric} ${display.unitLabel}`;
    }
    default:
      return `${measurement.label}`;
  }
};

const formatSecondaryLine = (measurement: Measurement, defaultUnit: UnitSystem): string | undefined => {
  const parts: string[] = [];

  if (measurement.kind === 'polyline' && measurement.points) {
    parts.push(`${measurement.points.length} points`);
  }

interface MeasurementItemProps {
  measurement: Measurement;
  defaultUnit: UnitSystem;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

const MeasurementItem: React.FC<MeasurementItemProps> = ({
  measurement,
  defaultUnit,
  onRename,
  onDelete
}) => {
  const secondary = formatSecondaryLine(measurement, defaultUnit);
  
  // Visual validation indicators
  const confidence = measurement.confidence ?? 0;
  const confidenceColor = confidence >= 0.7 ? '#28a745' : confidence >= 0.4 ? '#ffc107' : '#dc3545';
  const confidenceLabel = confidence >= 0.7 ? 'High' : confidence >= 0.4 ? 'Medium' : 'Low';

  return (
    <li className={styles['measurementItem']}>
      <input
        type="text"
        placeholder="Add Name..."
        value={measurement.name || ''}
        onChange={(event) => onRename(measurement.id, event.target.value)}
        className={styles['nameInput']}
        title="Rename Measurement"
        maxLength={100}
      />
      <div className={styles['measurementSummary']}>
        <div className={styles['measurementValue']}>
          {formatPrimaryLine(measurement, defaultUnit)}
          {measurement.confidence !== undefined && (
            <span 
              className={styles['confidenceBadge']}
              style={{ backgroundColor: confidenceColor }}
              title={`Confidence: ${confidenceLabel} (${Math.round(confidence * 100)}%)`}
            >
              {Math.round(confidence * 100)}%
            </span>
          )}
        </div>
        {secondary && <div className={styles['measurementMeta']}>{secondary}</div>}
      </div>
      <button
        onClick={() => {
          if (window.confirm('Delete this measurement?')) {
            onDelete(measurement.id);
          }
        }}
        className={styles['deleteButton']}
        title="Delete Measurement"
      >
        ×
      </button>
    </li>
  );
};

const formatSecondaryLine = (measurement: Measurement, defaultUnit: UnitSystem): string | undefined => {
  const parts: string[] = [];

  if (measurement.kind === 'polyline' && measurement.points) {
    parts.push(`${measurement.points.length} points`);
  }

  if (measurement.kind === 'area' && Number.isFinite(measurement.perimeterMeters)) {
    const display = getLengthDisplay(measurement, defaultUnit, measurement.perimeterMeters);
    if (display.value !== undefined) {
      parts.push(`Perimeter ${display.value.toFixed(2)} ${display.unitLabel}`);
    }
  }

  if (measurement.kind === 'volume' && measurement.dimensionsMeters) {
    const { length, width, height } = measurement.dimensionsMeters;
    const lengthDisplay = getLengthDisplay(measurement, defaultUnit, length);
    const widthDisplay = getLengthDisplay(measurement, defaultUnit, width);
    const heightDisplay = getLengthDisplay(measurement, defaultUnit, height);
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

  // Calibration state at time of capture
  const calOffset = measurement.cameraParams?.calibrationPitchOffsetDeg ?? 0;
  const isCalibrated = Math.abs(calOffset) > 1e-6;
  parts.push(isCalibrated ? `Cal ${calOffset.toFixed(2)}°` : 'Uncalibrated');

  return parts.length > 0 ? parts.join(' | ') : undefined;
};

const MeasurementSidebar: React.FC = () => {
  const { measurements, settings } = useRootStore(
    useShallow(
      (state) => ({
        measurements: state.measurements,
        settings: state.settings,
      })
    )
  );
  const { deleteMeasurement, renameMeasurement, clearMeasurements } = useMeasurementActions();
  const undoMeasurement = useRootStore((state) => state.undoMeasurement);
  const redoMeasurement = useRootStore((state) => state.redoMeasurement);
  const canUndo = useRootStore((state) => state.canUndo());
  const canRedo = useRootStore((state) => state.canRedo());
  const { toggleUnit } = useSettingsActions();
  const handleUnitToggle = useCallback(() => {
    toggleUnit();
    if (window.electronAPI?.invoke) {
      const updatedSettings = useRootStore.getState().settings;
      window.electronAPI.invoke('save-settings', updatedSettings).catch(() => {
        // Silent error handling for production
      });
    }
  }, [toggleUnit]);

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
      'Unit System',
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
      const display = getDisplayValue(m, settings.defaultUnit);
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
        display.unitSystem,
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

      return formatCsvRow(raw);
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
  }, [measurements, settings.defaultUnit]);

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
          <div className={styles['undoRedoControls']}>
            <button
              onClick={() => undoMeasurement()}
              disabled={!canUndo}
              className={styles['undoButton']}
              title="Undo (Ctrl+Z)"
            >
              ↶
            </button>
            <button
              onClick={() => redoMeasurement()}
              disabled={!canRedo}
              className={styles['redoButton']}
              title="Redo (Ctrl+Y)"
            >
              ↷
            </button>
          </div>
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
        <div className={styles['measurementList']}>
          <FixedSizeList
            height={400}
            itemCount={measurements.length}
            itemSize={80}
            itemData={{
              measurements,
              defaultUnit: settings.defaultUnit,
              onRename: renameMeasurement,
              onDelete: deleteMeasurement
            }}
            className={styles['virtualizedList']}
          >
            {({ index, style, data }) => (
              <div style={style}>
                <MeasurementItem
                  measurement={data.measurements[index]}
                  defaultUnit={data.defaultUnit}
                  onRename={data.onRename}
                  onDelete={data.onDelete}
                />
              </div>
            )}
          </FixedSizeList>
        </div>
      )}
      
      <div className={styles['sidebarFooter']}>
        <div>PoleCheck Desktop v0.0.1</div>
        <div className={styles['shortcuts']}>
          <span title="Start height measurement (M key)">M: Measure</span>
          <span title="Toggle measurement units (U key)">U: Units</span>
          <span title="Undo measurement change (Ctrl+Z)">Ctrl+Z: Undo</span>
          <span title="Redo measurement change (Ctrl+Y)">Ctrl+Y: Redo</span>
          <span title="Export measurements to CSV (Ctrl+E)">Ctrl+E: Export</span>
          <span title="Clear all measurements (Ctrl+Shift+Delete)">Ctrl+Shift+Del: Clear</span>
        </div>
      </div>
    </div>
  );
};

export default MeasurementSidebar;
