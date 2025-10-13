import { getAreaDisplayValues, getVolumeDisplayValues } from '../../utils/measurementDisplay';
import { formatPrimaryLine, formatSecondaryLine, getDisplayValue } from '../../components/MeasurementSidebar';
import type { Measurement } from '../../types/common';

describe('measurement display consistency', () => {
  it('keeps area measurement previews, storage, and formatting aligned', () => {
    const areaSquareMeters = 12.34;
    const perimeterMeters = 15.67;
    const unit: 'metric' | 'imperial' = 'imperial';

    const { area: areaDisplay, perimeter: perimeterDisplay } = getAreaDisplayValues(
      areaSquareMeters,
      perimeterMeters,
      unit
    );

    expect(areaDisplay.value).toBeDefined();
    expect(perimeterDisplay.value).toBeDefined();

    const previewAreaValue = areaDisplay.value!;
    const previewPerimeterValue = perimeterDisplay.value!;

    const measurement: Measurement = {
      id: 'area-test',
      kind: 'area',
      label: 'Area (4 points)',
      startPoint: { x: 0, y: 0 },
      endPoint: { x: 10, y: 10 },
      distance: previewAreaValue,
      unit,
      panoId: 'pano',
      cameraParams: undefined,
      confidence: 0.8,
      source: 'area',
      areaSquareMeters,
      perimeterMeters,
      points: [],
      timestamp: 1_700_000_000_000,
    };

    expect(measurement.distance).toBeCloseTo(previewAreaValue, 6);

    const primaryLine = formatPrimaryLine(measurement);
    expect(primaryLine).toContain(previewAreaValue.toFixed(2));
    expect(primaryLine).toContain(areaDisplay.unitLabel);

    const secondaryLine = formatSecondaryLine(measurement);
    expect(secondaryLine).toBeDefined();
    expect(secondaryLine).toContain(previewPerimeterValue.toFixed(2));
    expect(secondaryLine).toContain(perimeterDisplay.unitLabel);

    const exportDisplay = getDisplayValue(measurement);
    expect(exportDisplay.value).toBeDefined();
    expect(exportDisplay.value).toBeCloseTo(previewAreaValue, 6);
    expect(exportDisplay.unitLabel).toBe(areaDisplay.unitLabel);
  });

  it('keeps volume measurement previews, storage, and formatting aligned', () => {
    const volumeCubicMeters = 18.75;
    const dimensionsMeters = { length: 3.5, width: 2.75, height: 1.95 };
    const unit: 'metric' | 'imperial' = 'imperial';

    const { volume: volumeDisplay, dimensions: dimensionsDisplay } = getVolumeDisplayValues(
      volumeCubicMeters,
      dimensionsMeters,
      unit
    );

    expect(volumeDisplay.value).toBeDefined();
    expect(dimensionsDisplay.length.value).toBeDefined();
    expect(dimensionsDisplay.width.value).toBeDefined();
    expect(dimensionsDisplay.height.value).toBeDefined();

    const previewVolumeValue = volumeDisplay.value!;
    const lengthValue = dimensionsDisplay.length.value!;
    const widthValue = dimensionsDisplay.width.value!;
    const heightValue = dimensionsDisplay.height.value!;

    const dimensionLabel = `${lengthValue.toFixed(1)} x ${widthValue.toFixed(1)} x ${heightValue.toFixed(1)} ${dimensionsDisplay.length.unitLabel}`;

    const measurement: Measurement = {
      id: 'volume-test',
      kind: 'volume',
      label: `Volume (${dimensionLabel})`,
      startPoint: { x: 0, y: 0 },
      endPoint: { x: 10, y: 10 },
      distance: previewVolumeValue,
      unit,
      panoId: 'pano',
      cameraParams: undefined,
      confidence: 0.8,
      source: 'volume',
      volumeCubicMeters,
      areaSquareMeters: dimensionsMeters.length * dimensionsMeters.width,
      dimensionsMeters,
      metadata: { heightMeters: dimensionsMeters.height },
      points: [],
      timestamp: 1_700_000_000_001,
    };

    expect(measurement.distance).toBeCloseTo(previewVolumeValue, 6);

    const primaryLine = formatPrimaryLine(measurement);
    expect(primaryLine).toContain(previewVolumeValue.toFixed(2));
    expect(primaryLine).toContain(volumeDisplay.unitLabel);

    const secondaryLine = formatSecondaryLine(measurement);
    expect(secondaryLine).toBeDefined();
    expect(secondaryLine).toContain(lengthValue.toFixed(1));
    expect(secondaryLine).toContain(widthValue.toFixed(1));
    expect(secondaryLine).toContain(heightValue.toFixed(1));
    expect(secondaryLine).toContain(dimensionsDisplay.length.unitLabel);

    const exportDisplay = getDisplayValue(measurement);
    expect(exportDisplay.value).toBeDefined();
    expect(exportDisplay.value).toBeCloseTo(previewVolumeValue, 6);
    expect(exportDisplay.unitLabel).toBe(volumeDisplay.unitLabel);
  });
});
