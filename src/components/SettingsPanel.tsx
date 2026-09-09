import React, { useState, useEffect, useRef } from 'react';
import styles from './SettingsPanel.module.css';
import type { AppSettings } from '../types/common';

interface Props {
  initial: AppSettings;
  onSave: (settings: AppSettings) => void;
  onClose: () => void;
}

const SettingsPanel: React.FC<Props> = ({ initial, onSave, onClose }) => {
  const dialogRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>('input, select, button')?.focus();
    return () => previous?.focus();
  }, []);
  const [form, setForm] = useState<AppSettings>({ ...initial });

  const handleChange = (key: keyof AppSettings, value: any) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const handleSubmit = () => {
    onSave(form);
  };

  return (
    <div className={styles['backdrop']} onClick={onClose}>
      <form ref={dialogRef} className={styles['modal']} role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={e => e.stopPropagation()} onSubmit={e => { e.preventDefault(); handleSubmit(); }} onKeyDown={e => {
        if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
        if (e.key === 'Tab') {
          const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('input, select, button') ?? []);
          const first = controls[0], last = controls[controls.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
        }
      }}>
        <h2 id="settings-title">Settings</h2>

        <div className={styles['field']}>
          <label htmlFor="apiKey">Google Maps API Key</label>
          <input
            id="apiKey"
            type="password"
            value={form.googleMapsApiKey ?? ''}
            onChange={e => handleChange('googleMapsApiKey', e.target.value)}
            placeholder="Paste your API key here"
            title="Your personal Google Maps API Key (requires Maps JS, Street View, and Solar APIs enabled)"
          />
          <div className={styles['hint']}>
            Required for Street View, depth data, and building insights.
          </div>
        </div>

        <div className={styles['field']}>
          <label htmlFor="unit">Default Unit</label>
          <select
            id="unit"
            value={form.defaultUnit}
            onChange={e => handleChange('defaultUnit', e.target.value as 'metric' | 'imperial')}
            title="Select default measurement unit"
          >
            <option value="metric">Metric (m)</option>
            <option value="imperial">Imperial (ft)</option>
          </select>
        </div>

        <div className={styles['field']}>
          <label htmlFor="theme">Theme</label>
          <select
            id="theme"
            value={form.theme}
            onChange={e => handleChange('theme', e.target.value as 'light' | 'dark' | 'system')}
            title="Select application theme"
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="system">System</option>
          </select>
        </div>

        <div className={styles['field']}>
          <label htmlFor="gpu">Use GPU (if available)</label>
          <input
            id="gpu"
            type="checkbox"
            checked={!!form.useGPU}
            onChange={e => handleChange('useGPU', e.target.checked)}
            title="Enable ONNX GPU acceleration if supported"
          />
        </div>

        <div className={styles['field']}>
          <label htmlFor="cameraHeight">Camera Height (m)</label>
          <input
            id="cameraHeight"
            max={100}
            type="number" required
            min={0.1}
            step={0.1}
            value={form.cameraHeight ?? 2.5}
            onChange={e => handleChange('cameraHeight', parseFloat(e.target.value))}
            title="Default camera height in meters"
          />
        </div>

        <div className={styles['field']}>
          <label htmlFor="depthScale">Depth Scale</label>
          <input
            id="depthScale"
            min={0.1}
            max={10}
            type="number" required
            step={0.01}
            value={form.depthScale ?? 1}
            onChange={e => handleChange('depthScale', parseFloat(e.target.value))}
            title="Multiply raw depth values by this factor"
          />
        </div>

        <div className={styles['field']}>
          <label htmlFor="depthBias">Depth Bias (m)</label>
          <input
            id="depthBias"
            min={-1000}
            max={1000}
            type="number" required
            step={0.01}
            value={form.depthBias ?? 0}
            onChange={e => handleChange('depthBias', parseFloat(e.target.value))}
            title="Add this bias after scaling depth values"
          />
        </div>

        <div className={styles['field']}>
          <label htmlFor="depthApiMaxRetries">Street View Depth Retries</label>
          <input
            id="depthApiMaxRetries"
            type="number" min={1}
            max={10}
            step={1}
            value={form.depthApiMaxRetries ?? 5}
            onChange={e => {
              const parsed = parseInt(e.target.value, 10);
              const clamped = Number.isNaN(parsed) ? 1 : Math.min(10, Math.max(1, parsed));
              handleChange('depthApiMaxRetries', clamped);
            }}
            title="Maximum Street View depth API retry attempts before failing"
          />
        </div>

        <div className={styles['field']}>
          <label htmlFor="depthQuality">Depth Quality</label>
          <select
            id="depthQuality"
            value={form.depthQuality ?? 'high'}
            onChange={e => handleChange('depthQuality', e.target.value as 'low' | 'medium' | 'high')}
            title="Image resolution for depth estimation - lower quality is faster but less accurate"
          >
            <option value="low">Low (320 px longest side)</option>
            <option value="medium">Medium (480 px longest side)</option>
            <option value="high">High (640 px longest side)</option>
          </select>
        </div>

        <div className={styles['field']}>
          <label htmlFor="enableDepthCache">Enable Depth Caching</label>
          <input
            id="enableDepthCache"
            type="checkbox"
            checked={form.enableDepthCache ?? true}
            onChange={e => handleChange('enableDepthCache', e.target.checked)}
            title="Cache depth maps for faster loading of previously visited locations"
          />
        </div>

        <div className={styles['hint']}>
          The app stops requesting Street View depth data after the configured number of retries to avoid exceeding Google API limits.
        </div>

        {form.autoCalibrateDepth && (
          <div className={styles['field']}>
            <div className={styles['hint']}>
              Auto-calibration will continuously fit ONNX depth to plane-based distances when available and may adjust scale/bias.
            </div>
          </div>
        )}

        <div className={styles['field']}>
          <label htmlFor="kernel">Depth Kernel Size</label>
          <select
            id="kernel"
            value={form.depthKernelSize ?? 5}
            onChange={e => handleChange('depthKernelSize', parseInt(e.target.value, 10) as 3 | 5 | 7)}
            title="Neighborhood size for robust depth sampling"
          >
            <option value={3}>3</option>
            <option value={5}>5</option>
            <option value={7}>7</option>
          </select>
        </div>

        <div className={styles['field']}>
          <label htmlFor="bilinear">Use Bilinear Sampling</label>
          <input
            id="bilinear"
            type="checkbox"
            checked={form.depthUseBilinear ?? true}
            onChange={e => handleChange('depthUseBilinear', e.target.checked)}
            title="Use bilinear interpolation for sub-pixel depth"
          />
        </div>

        <div className={styles['field']}>
          <label htmlFor="edgeThresh">Depth Edge Reject Threshold</label>
          <input
            id="edgeThresh"
            type="number" min={0}
            max={1}
            step={0.05}
            value={form.depthEdgeRejectThreshold ?? 0.35}
            onChange={e => handleChange('depthEdgeRejectThreshold', parseFloat(e.target.value))}
            title="Reject samples with strong depth gradients (0..1)"
          />
        </div>

        <div className={styles['field']}>
          <label htmlFor="history">Measurement History Limit</label>
          <input
            id="history"
            type="number" min={10}
            max={10000}
            value={form.measurementHistoryLimit}
            onChange={e => handleChange('measurementHistoryLimit', parseInt(e.target.value, 10))}
            title="Maximum number of measurements to store"
          />
        </div>

        <div className={styles['field']}>
          <label htmlFor="autoCal">Auto-calibrate Depth (experimental)</label>
          <input
            id="autoCal"
            type="checkbox"
            checked={!!form.autoCalibrateDepth}
            onChange={e => handleChange('autoCalibrateDepth', e.target.checked)}
            title="Continuously fit ONNX depth to plane-based distances"
          />
        </div>

        <div className={styles['field']}>
          <label htmlFor="debugOverlay">Show Debug Overlay</label>
          <input
            id="debugOverlay"
            type="checkbox"
            checked={!!form.showDebugOverlay}
            onChange={e => handleChange('showDebugOverlay', e.target.checked)}
            title="Display camera and calibration HUD"
          />
        </div>

        <div className={styles['actions']}>
          <button type="button" className={styles['secondary']} onClick={onClose}>Cancel</button>
          <button type="submit" className={styles['primary']}>Save</button>
        </div>
      </form>
    </div>
  );
};

export default SettingsPanel; 
