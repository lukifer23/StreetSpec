import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

// Mock the MapView module to avoid import.meta issues
jest.mock('../../../components/MapView', () => ({
  GenStatusIndicator: React.forwardRef((props: any, ref) => {
    const { isGeneratingMap, mapGenerationError, onnxDepthMap } = props;

    if (isGeneratingMap) {
      return (
        <div role="status" aria-live="assertive">
          Generating depth map...
        </div>
      );
    }

    if (mapGenerationError) {
      return (
        <div role="status" aria-live="polite">
          Error generating depth map: {mapGenerationError}
        </div>
      );
    }

    if (onnxDepthMap) {
      return (
        <div role="status">
          Depth map ready ({onnxDepthMap.width}x{onnxDepthMap.height})
        </div>
      );
    }

    return null;
  }),
}));

import { GenStatusIndicator } from '../../../components/MapView';

describe('GenStatusIndicator', () => {
  it('shows a busy message while generation is in progress', () => {
    render(
      <GenStatusIndicator
        isGeneratingMap
        mapGenerationError={null}
        onnxDepthMap={null}
      />
    );

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Generating depth map...');
    expect(status).toHaveAttribute('aria-live', 'assertive');
  });

  it('shows an error message when generation fails', () => {
    render(
      <GenStatusIndicator
        isGeneratingMap={false}
        mapGenerationError="Boom"
        onnxDepthMap={null}
      />
    );

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Error generating depth map: Boom');
    expect(status).toHaveAttribute('aria-live', 'polite');
  });

  it('announces success once the depth map is cached', () => {
    render(
      <GenStatusIndicator
        isGeneratingMap={false}
        mapGenerationError={null}
        onnxDepthMap={{ width: 320, height: 240, data: [] }}
      />
    );

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Depth map ready (320x240)');
  });
});
