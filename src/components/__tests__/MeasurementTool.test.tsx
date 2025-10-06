import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import MeasurementTool from '../MeasurementTool';
import { useRootStore } from '../../stores/rootStore';
import type { CameraParams, DecodedDepthData } from '../../types/common';

const mockCameraParams: CameraParams = { heading: 0 };
const mockDepthData: DecodedDepthData = {
  planes: [],
  indices: new Uint8Array([0]),
  width: 1,
  height: 1,
};

describe('MeasurementTool interactions', () => {
  let alertSpy: jest.SpyInstance;
  const originalGetContext = HTMLCanvasElement.prototype.getContext;

  beforeEach(() => {
    act(() => {
      useRootStore.getState().resetState();
      useRootStore.setState((state) => {
        state.currentCameraParams = null;
        state.settings.defaultUnit = 'metric';
      });
    });
    alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
    HTMLCanvasElement.prototype.getContext = jest.fn(() => ({
      clearRect: jest.fn(),
      beginPath: jest.fn(),
      arc: jest.fn(),
      fill: jest.fn(),
      stroke: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      setLineDash: jest.fn(),
      fillText: jest.fn(),
      closePath: jest.fn(),
      canvas: document.createElement('canvas'),
    })) as typeof HTMLCanvasElement.prototype.getContext;
  });

  afterEach(() => {
    alertSpy.mockRestore();
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  const prepareStore = (overrides: Partial<ReturnType<typeof useRootStore.getState>>) => {
    act(() => {
      useRootStore.setState((state) => {
        if (overrides.currentCameraParams !== undefined) {
          state.currentCameraParams = overrides.currentCameraParams as CameraParams | null;
        }
        if (overrides.isCalibrated !== undefined) {
          state.isCalibrated = overrides.isCalibrated as boolean;
        }
        if (overrides.onnxDepthMap !== undefined) {
          state.onnxDepthMap = overrides.onnxDepthMap as any;
        }
        if (overrides.depthData !== undefined) {
          state.depthData = overrides.depthData as DecodedDepthData | null;
        }
      });
    });
  };

  it('refuses keyboard activation when calibration is missing', () => {
    prepareStore({ currentCameraParams: mockCameraParams });
    render(<MeasurementTool />);

    fireEvent.keyDown(window, { key: 'm' });

    expect(alertSpy).toHaveBeenCalledWith('Calibrate the horizon before estimating height.');
    expect(screen.queryByText(/Step 1: Click object BASE/i)).not.toBeInTheDocument();
  });

  it('refuses keyboard activation when depth data is missing', () => {
    prepareStore({ currentCameraParams: mockCameraParams, isCalibrated: true });
    render(<MeasurementTool />);

    fireEvent.keyDown(window, { key: 'm' });

    expect(alertSpy).toHaveBeenCalledWith(
      'Depth data is required before estimating height. Generate or load a depth map first.'
    );
    expect(screen.queryByText(/Step 1: Click object BASE/i)).not.toBeInTheDocument();
  });

  it('activates measurement via keyboard when prerequisites are met', () => {
    prepareStore({
      currentCameraParams: mockCameraParams,
      isCalibrated: true,
      depthData: mockDepthData,
    });

    render(<MeasurementTool />);

    fireEvent.keyDown(window, { key: 'm' });

    const overlay = screen.getByTestId('measurement-overlay');
    expect(overlay).toHaveClass('overlayActive');
    expect(screen.getByText(/Step 1: Click object BASE/i)).toBeInTheDocument();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('ignores overlay clicks while idle until measurement is armed', () => {
    prepareStore({
      currentCameraParams: mockCameraParams,
      isCalibrated: true,
      depthData: mockDepthData,
    });

    render(<MeasurementTool />);

    const overlay = screen.getByTestId('measurement-overlay');
    fireEvent.click(overlay);

    expect(screen.queryByText(/Step 1: Click object BASE/i)).not.toBeInTheDocument();
  });

  it('captures overlay clicks after start button arms measurement', () => {
    prepareStore({
      currentCameraParams: mockCameraParams,
      isCalibrated: true,
      depthData: mockDepthData,
    });

    render(<MeasurementTool />);

    const overlay = screen.getByTestId('measurement-overlay');
    Object.defineProperty(overlay, 'getBoundingClientRect', {
      value: () => ({
        left: 0,
        top: 0,
        right: 100,
        bottom: 100,
        width: 100,
        height: 100,
        x: 0,
        y: 0,
        toJSON: () => {},
      }),
    });

    fireEvent.click(screen.getByRole('button', { name: /Estimate Height/i }));
    expect(screen.getByText(/Step 1: Click object BASE/i)).toBeInTheDocument();

    fireEvent.click(overlay);
    expect(screen.getByText(/Step 2: Click object TOP/i)).toBeInTheDocument();
  });
});

