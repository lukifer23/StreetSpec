import React, { useState, useEffect } from 'react';
import styles from './SettingsPanel.module.css';

interface SettingsPanelProps {
  currentOverride: number | null;
  onOverrideChange: (value: number | null) => void;
  onClose: () => void;
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({ currentOverride, onOverrideChange, onClose }) => {
  const [inputValue, setInputValue] = useState<string>(currentOverride?.toString() ?? '');

  useEffect(() => {
    // Sync input value if prop changes from outside
    setInputValue(currentOverride?.toString() ?? '');
  }, [currentOverride]);

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(event.target.value);
  };

  const handleApply = () => {
    const numValue = parseFloat(inputValue);
    if (inputValue === '') {
        onOverrideChange(null); // Clear override if input is empty
    } else if (!isNaN(numValue) && numValue > 0 && numValue < 180) {
        onOverrideChange(numValue); // Apply valid override
    } else {
        alert("Invalid FOV value. Please enter a number between 0 and 180, or leave empty to disable override.");
        // Optionally revert input value to currentOverride
        // setInputValue(currentOverride?.toString() ?? ''); 
    }
  };

  const handleClear = () => {
      setInputValue('');
      onOverrideChange(null);
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.panel}>
        <h2>Settings</h2>
        <button onClick={onClose} className={styles.closeButton} title="Close Settings">✕</button>

        <div className={styles.settingItem}>
          <label htmlFor="fovOverrideInput">Manual FOV Override:</label>
          <div className={styles.inputGroup}>
            <input
              type="number"
              id="fovOverrideInput"
              value={inputValue}
              onChange={handleInputChange}
              placeholder="e.g., 90 (leave empty to disable)"
              className={styles.inputField}
              min="1"
              max="179"
              step="0.1"
            />
            <button onClick={handleApply} className={styles.applyButton}>Apply</button>
            <button onClick={handleClear} className={styles.clearButton} title="Clear Override">Clear</button>
          </div>
          <p className={styles.tooltip}>
            ❓ Overrides the Field of View (FOV) calculated from Street View zoom. 
            Use this if measurements seem consistently off due to an inaccurate automatic FOV. 
            Typical values are between 60 and 120 degrees. Leave empty to use automatic FOV.
          </p>
        </div>

        {/* Add more settings here later */}

      </div>
    </div>
  );
};

export default SettingsPanel; 