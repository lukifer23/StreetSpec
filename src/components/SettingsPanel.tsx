import React, { useState } from 'react';
import styles from './SettingsPanel.module.css';
import { AppSettings } from '../types/common';

interface Props {
  initial: AppSettings;
  onSave: (settings: AppSettings) => void;
  onClose: () => void;
}

const SettingsPanel: React.FC<Props> = ({ initial, onSave, onClose }) => {
  const [form, setForm] = useState<AppSettings>({ ...initial });

  const handleChange = (key: keyof AppSettings, value: any) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const handleSubmit = () => {
    onSave(form);
  };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <h2>Settings</h2>

        <div className={styles.field}>
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

        <div className={styles.field}>
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

        <div className={styles.field}>
          <label htmlFor="gpu">Use GPU (if available)</label>
          <input
            id="gpu"
            type="checkbox"
            checked={!!form.useGPU}
            onChange={e => handleChange('useGPU', e.target.checked)}
            title="Enable ONNX GPU acceleration if supported"
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="cameraHeight">Camera Height (m)</label>
          <input
            id="cameraHeight"
            type="number"
            min={0}
            step={0.1}
            value={form.cameraHeight ?? 2.5}
            onChange={e => handleChange('cameraHeight', parseFloat(e.target.value))}
            title="Default camera height in meters"
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="depthScale">Depth Scale</label>
          <input
            id="depthScale"
            type="number"
            step={0.01}
            value={form.depthScale ?? 1}
            onChange={e => handleChange('depthScale', parseFloat(e.target.value))}
            title="Multiply raw depth values by this factor"
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="depthBias">Depth Bias (m)</label>
          <input
            id="depthBias"
            type="number"
            step={0.01}
            value={form.depthBias ?? 0}
            onChange={e => handleChange('depthBias', parseFloat(e.target.value))}
            title="Add this bias after scaling depth values"
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="kernel">Depth Kernel Size</label>
          <select
            id="kernel"
            value={form.depthKernelSize ?? 5}
            onChange={e => handleChange('depthKernelSize', parseInt(e.target.value, 10) as 3|5|7)}
            title="Neighborhood size for robust depth sampling"
          >
            <option value={3}>3</option>
            <option value={5}>5</option>
            <option value={7}>7</option>
          </select>
        </div>

        <div className={styles.field}>
          <label htmlFor="bilinear">Use Bilinear Sampling</label>
          <input
            id="bilinear"
            type="checkbox"
            checked={form.depthUseBilinear ?? true}
            onChange={e => handleChange('depthUseBilinear', e.target.checked)}
            title="Use bilinear interpolation for sub-pixel depth"
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="edgeThresh">Depth Edge Reject Threshold</label>
          <input
            id="edgeThresh"
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={form.depthEdgeRejectThreshold ?? 0.35}
            onChange={e => handleChange('depthEdgeRejectThreshold', parseFloat(e.target.value))}
            title="Reject samples with strong depth gradients (0..1)"
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="history">Measurement History Limit</label>
          <input
            id="history"
            type="number"
            min={10}
            max={10000}
            value={form.measurementHistoryLimit}
            onChange={e => handleChange('measurementHistoryLimit', parseInt(e.target.value, 10))}
            title="Maximum number of measurements to store"
          />
        </div>

        <div className={styles.actions}>
          <button className={styles.secondary} onClick={onClose}>Cancel</button>
          <button className={styles.primary} onClick={handleSubmit}>Save</button>
        </div>
      </div>
    </div>
  );
};

export default SettingsPanel; 