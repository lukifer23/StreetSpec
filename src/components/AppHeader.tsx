import React from 'react';
import { useRootStore } from '../stores/rootStore';
import { useUIActions } from '../stores/rootStore';
import styles from './AppHeader.module.css';

// Tooltip component for better UX
const Tooltip: React.FC<{ text: string; children: React.ReactNode }> = ({ text, children }) => {
  const [isVisible, setIsVisible] = React.useState(false);

  return (
    <div 
      style={{ position: 'relative', display: 'inline-block' }}
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
    >
      {children}
      {isVisible && (
        <div style={{
          position: 'absolute',
          bottom: '100%',
          left: '50%',
          transform: 'translateX(-50%)',
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          color: 'white',
          padding: '8px 12px',
          borderRadius: '4px',
          fontSize: '12px',
          whiteSpace: 'nowrap',
          zIndex: 1000,
          marginBottom: '8px',
          pointerEvents: 'none'
        }}>
          {text}
          <div style={{
            position: 'absolute',
            top: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            border: '4px solid transparent',
            borderTopColor: 'rgba(0, 0, 0, 0.8)'
          }} />
        </div>
      )}
    </div>
  );
};

const AppHeader: React.FC = () => {
  const { isGeneratingMap, calibrateMode, isCalibrated, currentCameraParams } = useRootStore();
  const { setIsSettingsOpen, setIsProjectPanelOpen, setCalibrateMode, setIsPolylineToolActive, setIsAreaToolActive, setIsVolumeToolActive } = useUIActions();

  const handleGenerateDepthMap = React.useCallback(async () => {
    // This will be handled by the parent component
    // The actual implementation is in App.tsx
  }, []);

  return (
    <div className={styles.header}>
      <button
        style={{ marginRight: 10 }}
        onClick={() => setIsProjectPanelOpen(true)}
        title="Projects"
        className={styles.headerButton}
      >
        📁
      </button>
      
      <button
        style={{ marginRight: 10 }}
        onClick={() => setIsSettingsOpen(true)}
        title="Settings"
        className={styles.headerButton}
      >
        ⚙️
      </button>
      
      <Tooltip text="Generate depth map for current Street View location">
        <button 
          style={{marginRight:10}} 
          onClick={handleGenerateDepthMap} 
          disabled={isGeneratingMap || !currentCameraParams}
          className={styles.headerButton}
        > 
          {isGeneratingMap ? 'Generating...' : 'Generate Depth Map'} 
        </button>
      </Tooltip>
      
      <Tooltip text="Calibrate the horizon for accurate measurements. Click exactly where the sky meets the ground so the app can compute the correct pitch from the camera's vertical FOV and understand what 'level' means in your view.">
        <button 
          style={{marginRight:10}} 
          onClick={() => setCalibrateMode(true)} 
          disabled={!currentCameraParams || calibrateMode} 
          className={`${styles.headerButton} ${!isCalibrated ? styles.highlight : ''}`}
        >
          Calibrate Horizon
        </button>
      </Tooltip>
      
      <Tooltip text="Measure distances along a path">
        <button 
          style={{marginRight:10}} 
          onClick={() => setIsPolylineToolActive(true)} 
          disabled={!currentCameraParams || !isCalibrated}
          className={styles.headerButton}
        >
          Polyline Tool
        </button>
      </Tooltip>
      
      <Tooltip text="Measure area on the ground plane">
        <button 
          style={{marginRight:10}} 
          onClick={() => setIsAreaToolActive(true)} 
          disabled={!currentCameraParams || !isCalibrated}
          className={styles.headerButton}
        >
          Area Tool
        </button>
      </Tooltip>
      
      <Tooltip text="Measure volume on the ground plane">
        <button 
          style={{marginRight:10}} 
          onClick={() => setIsVolumeToolActive(true)} 
          disabled={!currentCameraParams || !isCalibrated}
          className={styles.headerButton}
        >
          Volume Tool
        </button>
      </Tooltip>
    </div>
  );
};

export default AppHeader;
