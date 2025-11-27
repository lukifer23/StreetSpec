import { useMemo } from 'react';
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
import { ErrorBoundary } from './components/ErrorBoundary';
import { useAppLogic } from './hooks/useAppLogic';
import { getStatusBannerPresentation } from './utils/statusBanner';
import { errorHandler } from './services/errorHandler';
import styles from './App.module.css';
import './App.css';

function App() {
  // Safely get API key with error handling
  let apiKey = '';
  try {
    apiKey = (import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY ||
             (window as any).electronAPI?.getEnv?.()?.VITE_GOOGLE_MAPS_API_KEY ||
             '';
  } catch (error) {
    console.error('Error accessing API key:', error);
    apiKey = '';
  }

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
    isProjectPanelOpen,
    currentCameraParams,
    onnxDepthMap,
    depthGenProgress,

    // Actions
    setIsSettingsOpen,
    setCalibrateMode,
    setIsPolylineToolActive,
    setIsAreaToolActive,
    setIsVolumeToolActive,
    setIsProjectPanelOpen,
  } = useAppLogic(apiKey);

  const bannerPresentation = useMemo(
    () => getStatusBannerPresentation(depthFetchStatus),
    [depthFetchStatus]
  );

  // Display error state
  if (error) {
    return <div className={styles['loadingPlaceholder']}>{error}</div>;
  }

  const statusBannerClass = bannerPresentation
    ? bannerPresentation.tone === 'error'
      ? styles['statusBannerError']
      : bannerPresentation.tone === 'warning'
        ? styles['statusBannerWarning']
        : styles['statusBannerInfo']
    : null;

  const statusBannerRole = bannerPresentation?.role ?? 'status';

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
            <button style={{ marginRight: 10 }} onClick={handleGenerateDepthMap} disabled={isGeneratingMap || !currentCameraParams}>
              {isGeneratingMap ? 'Generating...' : 'Generate Depth Map'}
            </button>
          </Tooltip>
          <Tooltip text="Auto-detect horizon using depth data (requires depth map)" position="bottom">
            <button style={{ marginRight: 10 }} onClick={handleAutoCalibrate} disabled={!currentCameraParams || !onnxDepthMap} className={!isCalibrated ? styles['highlight'] : ''}>
              Auto-Calibrate
            </button>
          </Tooltip>
          <Tooltip text="Manually calibrate by clicking the horizon line where sky meets ground" position="bottom">
            <button style={{ marginRight: 10 }} onClick={() => setCalibrateMode(true)} disabled={!currentCameraParams || calibrateMode}>
              Manual Calibrate
            </button>
          </Tooltip>
          <Tooltip text="Measure distances along a path (P key)" position="bottom">
            <button style={{ marginRight: 10 }} onClick={() => setIsPolylineToolActive(true)} disabled={!currentCameraParams || !isCalibrated}>
              Polyline Tool
            </button>
          </Tooltip>
          <Tooltip text="Measure area on the ground plane (A key)" position="bottom">
            <button style={{ marginRight: 10 }} onClick={() => setIsAreaToolActive(true)} disabled={!currentCameraParams || !isCalibrated}>
              Area Tool
            </button>
          </Tooltip>
          <Tooltip text="Measure volume on the ground plane (V key)" position="bottom">
            <button style={{ marginRight: 10 }} onClick={() => setIsVolumeToolActive(true)} disabled={!currentCameraParams || !isCalibrated}>
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
      sidebar={
        <ErrorBoundary
          onError={(error, errorInfo) => {
            errorHandler.handleError({
              id: `sidebar-${Date.now()}`,
              code: 'UI_RENDER_FAILED',
              message: error.message,
              userFriendlyMessage: 'Measurement sidebar error. Measurements may not display correctly.',
              severity: 'medium' as any,
              category: 'ui' as any,
              recoverable: true,
              timestamp: Date.now(),
              stack: error.stack,
              details: errorInfo
            });
          }}
          fallback={
            <div style={{ padding: '20px' }}>
              <p>Sidebar unavailable. Please reload the page.</p>
            </div>
          }
        >
          <MeasurementSidebar />
        </ErrorBoundary>
      }
      mapArea={
        <div className={styles['mapArea']}>
          {isApiLoaded ? (
            <ErrorBoundary
              onError={(error, errorInfo) => {
                errorHandler.handleError({
                  id: `mapview-${Date.now()}`,
                  code: 'UI_RENDER_FAILED',
                  message: error.message,
                  userFriendlyMessage: 'Map display error occurred. The map may not function correctly.',
                  severity: 'high' as any,
                  category: 'ui' as any,
                  recoverable: true,
                  timestamp: Date.now(),
                  stack: error.stack,
                  details: errorInfo
                });
              }}
              fallback={
                <div className={styles['loadingPlaceholder']}>
                  <p>Map display error. Please reload the page.</p>
                  <button onClick={() => window.location.reload()}>Reload</button>
                </div>
              }
            >
                      <ErrorBoundary
                        onError={(error, errorInfo) => {
                          errorHandler.handleError({
                            id: `mapview-${Date.now()}`,
                            code: 'UI_RENDER_FAILED',
                            message: error.message,
                            userFriendlyMessage: 'Map view error. Some features may be unavailable.',
                            severity: 'medium' as any,
                            category: 'ui' as any,
                            recoverable: true,
                            timestamp: Date.now(),
                            stack: error.stack,
                            details: errorInfo
                          });
                        }}
                      >
                        <MapView
                          onCameraParamsChange={handleCameraChange}
                          onGenerateDepthMap={handleGenerateDepthMap}
                          onCalibrateClick={handleCalibrateClick}
                          depthGenProgress={depthGenProgress}
                        />
                      </ErrorBoundary>
              <ErrorBoundary
                onError={(error, errorInfo) => {
                  errorHandler.handleError({
                    id: `measurement-${Date.now()}`,
                    code: 'MEASUREMENT_CALCULATION_FAILED',
                    message: error.message,
                    userFriendlyMessage: 'Measurement tool error. Please try again or restart the tool.',
                    severity: 'medium' as any,
                    category: 'measurement' as any,
                    recoverable: true,
                    timestamp: Date.now(),
                    stack: error.stack,
                    details: errorInfo
                  });
                }}
              >
                <MeasurementTool />
              </ErrorBoundary>
              <ErrorBoundary
                onError={(error) => {
                  console.warn('[App] Polyline tool error:', error);
                }}
              >
                <PolylineTool />
              </ErrorBoundary>
              <ErrorBoundary
                onError={(error) => {
                  console.warn('[App] Area tool error:', error);
                }}
              >
                <AreaTool />
              </ErrorBoundary>
              <ErrorBoundary
                onError={(error) => {
                  console.warn('[App] Volume tool error:', error);
                }}
              >
                <VolumeTool />
              </ErrorBoundary>
            </ErrorBoundary>
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
            className={`${styles['statusBanner']} ${statusBannerClass ?? styles['statusBannerInfo']}`}
            role={statusBannerRole}
          >
            {'message' in depthFetchStatus ? depthFetchStatus.message : `Status: ${depthFetchStatus.status}`}
          </div>
        ) : undefined
      }
    />
    {isProjectPanelOpen && <ProjectPanel onClose={() => setIsProjectPanelOpen(false)} />}
    {isSettingsOpen && (
      <SettingsPanel
        initial={settings}
        onSave={handleSaveSettingsPanel}
        onClose={() => setIsSettingsOpen(false)}
      />
    )}
    </>
  );
}

export default App;
