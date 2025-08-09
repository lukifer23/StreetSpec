import React from 'react';
import { useRootStore } from '../stores/rootStore';
import styles from './AreaTool.module.css';

const AreaTool: React.FC = () => {
  const { currentCameraParams: cameraParams } = useRootStore();
  const { isAreaToolActive, setIsAreaToolActive } = useRootStore();

  if (!isAreaToolActive) return null;

  return (
    <div className={styles.areaTool}>
      <div className={styles.toolHeader}>
        <h3>Area Measurement Tool</h3>
        <button 
          onClick={() => setIsAreaToolActive(false)}
          className={styles.closeButton}
        >
          ×
        </button>
      </div>
      
      <div className={styles.toolContent}>
        <p>Area measurement tool is active.</p>
        <p>Click and drag to measure areas.</p>
        
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

export default AreaTool;