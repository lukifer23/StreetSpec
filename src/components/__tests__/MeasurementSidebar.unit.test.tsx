import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MeasurementSidebar from '../MeasurementSidebar';
import { useRootStore } from '../../stores/rootStore';
import type { Measurement } from '../../types/common';
import { convertLengthToDisplay } from '../../utils/units';

describe('MeasurementSidebar unit toggling', () => {
  beforeEach(() => {
    const invokeMock = window.electronAPI.invoke as jest.Mock;
    invokeMock.mockReset();
    invokeMock.mockImplementation(() => Promise.resolve(undefined));

    // Initialize store with default state first
    act(() => {
      useRootStore.setState({
        measurements: [],
        settings: {
          defaultUnit: 'metric',
          autoSave: true,
          theme: 'light',
          language: 'en',
          measurementHistoryLimit: 1000,
          useGPU: false,
          calibrationPitchOffsetDeg: 0,
          calibrationBiasByZoom: {},
          telemetryOptIn: false,
          depthScale: 1,
          depthBias: 0,
        },
        isSettingsOpen: false,
        isGeneratingMap: false,
        calibrateMode: false,
        error: null,
        mapGenerationError: null,
        isProjectPanelOpen: false,
        targetCoords: null,
        currentCameraParams: null,
        onnxDepthMap: null,
        depthData: null,
        currentProjectId: null,
        isCalibrated: false,
      });
    });
  });

  it('updates measurement display and CSV export when unit toggles', async () => {
    const measurement: Measurement = {
      id: 'measurement-1',
      kind: 'distance',
      label: 'Test Distance',
      name: '',
      startPoint: { x: 0, y: 0 },
      endPoint: { x: 0, y: 0 },
      distanceMeters: 10,
      distance: 10,
      unit: 'metric',
      timestamp: Date.now(),
    };

    const user = userEvent.setup();

    // Set measurements first
    act(() => {
      useRootStore.setState((state) => {
        state.measurements = [measurement];
      });
    });

    // Render component
    act(() => {
      render(<MeasurementSidebar />);
    });

    // Force a re-render by updating the store again
    act(() => {
      useRootStore.setState((state) => {
        state.measurements = [measurement];
      });
    });

    const metricDisplay = await screen.findByText(/Test Distance:/);
    expect(metricDisplay).toHaveTextContent('Test Distance: 10.00 m');

    const toggleButton = screen.getByRole('button', { name: /m\/ft/i });
    await user.click(toggleButton);

    const imperialConversion = convertLengthToDisplay(measurement.distanceMeters, 'imperial');
    if (imperialConversion.value === undefined) {
      throw new Error('Expected conversion to produce a numeric value');
    }
    const expectedImperialText = `Test Distance: ${imperialConversion.value.toFixed(2)} ${imperialConversion.unitLabel}`;

    await waitFor(() => {
      expect(screen.getByText(/Test Distance:/)).toHaveTextContent(expectedImperialText);
    });

    const invokeMock = window.electronAPI.invoke as jest.Mock;
    invokeMock.mockImplementation((channel) => {
      if (channel === 'csv-export') {
        return Promise.resolve('test.csv');
      }
      return Promise.resolve(undefined);
    });

    const exportButton = screen.getByRole('button', { name: /export/i });
    await user.click(exportButton);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('csv-export', expect.any(String));
    });

    const csvCall = invokeMock.mock.calls.find(([channel]) => channel === 'csv-export');
    expect(csvCall).toBeDefined();

    const csvContent = csvCall?.[1] as string;
    const rows = csvContent.split('\n');
    expect(rows.length).toBeGreaterThan(1);
    const dataRow = rows[1];
    const columns = dataRow.split(',').map((cell) => cell.replace(/^"|"$/g, ''));

    const expectedExportValue = imperialConversion.value.toFixed(3);
    expect(columns[5]).toBe(expectedExportValue);
    expect(columns[6]).toBe(imperialConversion.unitLabel);
    expect(columns[7]).toBe('imperial');
  });
});
