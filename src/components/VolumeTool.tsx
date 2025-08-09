import React from 'react';
import { useRootStore } from '../stores/rootStore';
import styles from './VolumeTool.module.css';

const VolumeTool: React.FC = () => {
  const { currentCameraParams: cameraParams } = useRootStore();
  const { isVolumeToolActive, setIsVolumeToolActive } = useRootStore();

  if (!isVolumeToolActive) return null;

  return (
    <div className={styles.volumeTool}>
      <div className={styles.toolHeader}>
        <h3>Volume Measurement Tool</h3>
        <button 
          onClick={() => setIsVolumeToolActive(false)}
          className={styles.closeButton}
        >
          ×
        </button>
      </div>
      
      <div className={styles.toolContent}>
        <p>Volume measurement tool is active.</p>
        <p>Click to define volume boundaries.</p>
        
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

export default VolumeTool;