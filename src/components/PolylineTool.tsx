import React from 'react';
import { useRootStore } from '../stores/rootStore';
import styles from './PolylineTool.module.css';

const PolylineTool: React.FC = () => {
  const { currentCameraParams: cameraParams } = useRootStore();
  const { isPolylineToolActive, setIsPolylineToolActive } = useRootStore();

  if (!isPolylineToolActive) return null;

  return (
    <div className={styles.polylineTool}>
      <div className={styles.toolHeader}>
        <h3>Polyline Measurement Tool</h3>
        <button 
          onClick={() => setIsPolylineToolActive(false)}
          className={styles.closeButton}
        >
          ×
        </button>
      </div>
      
      <div className={styles.toolContent}>
        <p>Polyline measurement tool is active.</p>
        <p>Click to create a polyline path.</p>
        
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
