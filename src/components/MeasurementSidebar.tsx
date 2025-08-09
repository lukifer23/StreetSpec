import React, { useCallback } from 'react';
import { useRootStore, useMeasurementActions, useSettingsActions } from '../stores/rootStore';
import styles from './MeasurementSidebar.module.css';

const MeasurementSidebar: React.FC = () => {
  const { measurements, settings } = useRootStore();
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
      alert("No measurements to export.");
      return;
    }
    
    const header = "ID,Timestamp,Label,Name,Distance (m),Start X,Start Y,End X,End Y";
    const rows = measurements.map(m => 
      `${m.id},${new Date(m.timestamp).toISOString()},${m.label},"${m.name || ''}",${m.distance.toFixed(3)},${m.startPoint.x},${m.startPoint.y},${m.endPoint.x},${m.endPoint.y}`
    );
    const csvContent = `${header}\n${rows.join('\n')}`;

    try {
      if (window.electronAPI && typeof window.electronAPI.invoke === 'function') {
        const filePath = await window.electronAPI.invoke('csv-export', csvContent);
        if (filePath) {
          alert(`Measurements exported successfully to: ${filePath}`);
        }
      } else {
        alert("Export failed: Cannot communicate with the main process.");
      }
    } catch (error) {
      alert(`Export failed: ${error}`);
    }
  }, [measurements]);

  return (
    <div className={styles.sidebar}>
      <div className={styles.sidebarHeader}>
        <h4>Measurements</h4>
        <div className={styles.sidebarControls}>
          <button 
            onClick={handleUnitToggle} 
            className={styles.unitToggle}
            title={`Toggle units (${settings.defaultUnit === 'metric' ? 'Imperial' : 'Metric'})`}
          >
            {settings.defaultUnit === 'metric' ? 'm/ft' : 'ft/m'}
          </button>
          {measurements.length > 0 && (
            <>
              <button 
                onClick={handleExportCSV} 
                className={styles.sidebarButton} 
                title="Export as CSV (Ctrl+E)"
              >
                Export
              </button>
              <button 
                onClick={handleClearMeasurements} 
                className={`${styles.sidebarButton} ${styles.dangerButton}`} 
                title="Clear All Measurements (Ctrl+Shift+Delete)"
              >
                Clear All
              </button>
            </>
          )}
        </div>
      </div>

      {measurements.length === 0 ? (
        <div className={styles.noMeasurements}> 
          No measurements yet.
        </div> 
      ) : (
        <ul className={styles.measurementList}>
          {measurements.map(m => (
            <li key={m.id} className={styles.measurementItem}>
              <input 
                type="text" 
                placeholder="Add Name..." 
                value={m.name || ''} 
                onChange={(e) => renameMeasurement(m.id, e.target.value)}
                className={styles.nameInput}
                title="Rename Measurement"
              />
              <span className={styles.measurementDetails}>
                {m.label}: {m.distance.toFixed(2)}{m.unit === 'metric' ? 'm' : 'ft'}
              </span>
              <button 
                onClick={() => deleteMeasurement(m.id)}
                className={styles.deleteButton}
                title="Delete Measurement"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      
      <div className={styles.sidebarFooter}>
        <div>PoleCheck Desktop v0.0.1</div>
        <div className={styles.shortcuts}>
          <span>M: Measure</span>
          <span>U: Toggle Units</span>
          <span>Ctrl+E: Export</span>
        </div>
      </div>
    </div>
  );
};

export default MeasurementSidebar;
