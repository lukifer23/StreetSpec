import MapView from './components/MapView';
import MeasurementTool from './components/MeasurementTool';
import SettingsPanel from './components/SettingsPanel';
import ProjectPanel from './components/ProjectPanel';
import PolylineTool from './components/PolylineTool';
import AreaTool from './components/AreaTool';
import VolumeTool from './components/VolumeTool';
import MeasurementSidebar from './components/MeasurementSidebar';
import SearchBox from './components/SearchBox';
import Notifications from './components/Notifications';
import { Tooltip } from './components/Tooltip';
import { AppLayout } from './components/AppLayout';
import { useAppLogic } from './hooks/useAppLogic';
import styles from './App.module.css';
import './App.css';

function App() {
  const apiKey = import.meta.env['VITE_GOOGLE_MAPS_API_KEY'] || '';

  const {
    // State
    isApiLoaded,
    isCalibrated,
    depthFetchStatus,

    // Handlers
    handleCameraChange,
    handleCalibrateClick,
    handleAutoCalibrate,
    handleGenerateDepthMap,
    handleSaveSettingsPanel,

    // Props for components
    settings,
    isSettingsOpen,
    isGeneratingMap,
    calibrateMode,
    error,
    mapGenerationError,
    isProjectPanelOpen,
    targetCoords,
    currentCameraParams,
    onnxDepthMap,

    // Actions
    setIsSettingsOpen,
    setCalibrateMode,
    setIsPolylineToolActive,
    setIsAreaToolActive,
    setIsVolumeToolActive,
    setIsProjectPanelOpen,
  } = useAppLogic(apiKey);

  // Display error state
  if (error) {
    return <div className={styles['loadingPlaceholder']}>{error}</div>;
  }

  return (
    <>
      <Notifications />
      <AppLayout
        header={
          <div className={styles['header']}>
            <Tooltip text="Manage projects and measurement history" position="bottom">
              <button
              style={{ marginRight: 10 }}
              onClick={() => setIsProjectPanelOpen(true)}
              title="Projects"
            >
              Projects
            </button>
          </Tooltip>
          <Tooltip text="Application settings and preferences" position="bottom">
            <button
              style={{ marginRight: 10 }}
              onClick={() => setIsSettingsOpen(true)}
              title="Settings"
            >
              Settings
            </button>
          </Tooltip>
          <Tooltip text="Generate depth map for current Street View location (Required for measurements)" position="bottom">
            <button style={{marginRight:10}} onClick={handleGenerateDepthMap} disabled={isGeneratingMap || !currentCameraParams}>
              {isGeneratingMap? 'Generating...' : 'Generate Depth Map'}
            </button>
          </Tooltip>
          <Tooltip text="Automatically detect the horizon using depth data for accurate measurements. Requires depth map to be generated first." position="bottom">
            <button style={{marginRight:10}} onClick={handleAutoCalibrate} disabled={!currentCameraParams || !onnxDepthMap} className={!isCalibrated ? styles['highlight'] : ''}>
              Auto-Calibrate
            </button>
          </Tooltip>
          <Tooltip text="Manually calibrate the horizon for accurate measurements. Click on the flat horizontal line where the sky meets the ground - like where the ocean meets the sky, or where a flat field meets the sky, or where distant mountains meet the sky. This tells the app what 'level' means in your view so measurements are accurate." position="bottom">
            <button style={{marginRight:10}} onClick={()=>setCalibrateMode(true)} disabled={!currentCameraParams || calibrateMode}>
              Manual Calibrate
            </button>
          </Tooltip>
          <Tooltip text="Measure distances along a path (P key)" position="bottom">
            <button style={{marginRight:10}} onClick={() => setIsPolylineToolActive(true)} disabled={!currentCameraParams || !isCalibrated}>
              Polyline Tool
            </button>
          </Tooltip>
          <Tooltip text="Measure area on the ground plane (A key)" position="bottom">
            <button style={{marginRight:10}} onClick={() => setIsAreaToolActive(true)} disabled={!currentCameraParams || !isCalibrated}>
              Area Tool
            </button>
          </Tooltip>
          <Tooltip text="Measure volume on the ground plane (V key)" position="bottom">
            <button style={{marginRight:10}} onClick={() => setIsVolumeToolActive(true)} disabled={!currentCameraParams || !isCalibrated}>
              Volume Tool
            </button>
          </Tooltip>
          {isApiLoaded ? (
            <SearchBox />
          ) : (
            <div className={styles['loadingPlaceholder']} style={{height: 'auto', width: '400px'}}>Loading Search...</div>
          )}
        </div>
      }
      sidebar={<MeasurementSidebar />}
      mapArea={
        <div className={styles['mapArea']}>
          {isApiLoaded ? (
            <>
              <MapView
                lat={targetCoords?.lat}
                lng={targetCoords?.lng}
                onCameraParamsChange={handleCameraChange}
                isGeneratingMap={isGeneratingMap}
                mapGenerationError={mapGenerationError}
                onnxDepthMap={onnxDepthMap}
                onGenerateDepthMap={handleGenerateDepthMap}
                calibrateMode={calibrateMode}
                onCalibrateClick={handleCalibrateClick}
              />
              <MeasurementTool />
              <PolylineTool />
              <AreaTool />
              <VolumeTool />
            </>
          ) : (
            <div className={styles['loadingPlaceholder']}>Loading Map...</div>
          )}
        </div>
      }
      calibrationNotification={
        currentCameraParams && settings.calibrationPitchOffsetDeg === 0 ? (
          <div className={styles['calibrationNotification']}>
            <p>For accurate measurements, please calibrate the horizon first.</p>
            <button onClick={() => setCalibrateMode(true)}>Calibrate Now</button>
          </div>
        ) : undefined
      }
      statusBanner={
        depthFetchStatus ? (
          <div
            className={`${styles['statusBanner']} ${
              depthFetchStatus.type === 'error'
                ? styles['statusBannerError']
                : depthFetchStatus.type === 'warning'
                  ? styles['statusBannerWarning']
                  : styles['statusBannerInfo']
            }`}
            role={depthFetchStatus.type === 'error' ? 'alert' : 'status'}
          >
            {depthFetchStatus.message}
          </div>
        ) : undefined
      }
    >
      {isProjectPanelOpen && <ProjectPanel onClose={() => setIsProjectPanelOpen(false)} />}
      {isSettingsOpen && (
        <SettingsPanel
          initial={settings}
          onSave={handleSaveSettingsPanel}
          onClose={() => setIsSettingsOpen(false)}
        />
      )}
    </AppLayout>
    </>
  );
}

export default App;
