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