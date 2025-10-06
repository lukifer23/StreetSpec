import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
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
    expect(status).toHaveTextContent('Generating depth map…');
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
