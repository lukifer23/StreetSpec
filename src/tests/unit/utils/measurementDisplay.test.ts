import {
  formatCsvRow,
  getAreaDisplay,
  getDisplayValue,
  getLengthDisplay,
  getSegmentSummary,
  getVolumeDisplay,
  type MeasurementDisplayValue,
} from '../../../utils/measurementDisplay';
import type { Measurement } from '../../../types/common';

describe('measurementDisplay utilities', () => {
  const createMeasurement = (overrides: Partial<Measurement> = {}): Measurement => ({
    id: 'measurement-1',
    kind: 'distance',
    label: 'Test Measurement',
    startPoint: { x: 0, y: 0 },
    endPoint: { x: 0, y: 0 },
    unit: 'metric',
    timestamp: 0,
    ...overrides,
  });

  it('converts lengths using the active unit system', () => {
    const measurement = createMeasurement({ unit: 'imperial', distanceMeters: 10 });

    const display = getLengthDisplay(measurement, 'metric', measurement.distanceMeters);

    expect(display).toEqual<MeasurementDisplayValue>({
      value: 10,
      unitLabel: 'm',
      unitSystem: 'metric',
    });
  });

  it('uses fallback length values when base values are unavailable', () => {
    const measurement = createMeasurement({ unit: 'imperial', distance: 25 });

    const display = getLengthDisplay(measurement, 'metric', null, measurement.distance);

    expect(display.value).toBe(25);
    expect(display.unitLabel).toBe('ft');
    expect(display.unitSystem).toBe('imperial');
  });

  it('converts areas to the display unit system', () => {
    const measurement = createMeasurement({
      kind: 'area',
      areaSquareMeters: 5,
    });

    const display = getAreaDisplay(measurement, 'imperial', measurement.areaSquareMeters);

    expect(display.unitSystem).toBe('imperial');
    expect(display.unitLabel).toBe('sq ft');
    expect(display.value).toBeCloseTo(53.8195520835486, 10);
  });

  it('converts volumes to the display unit system', () => {
    const measurement = createMeasurement({
      kind: 'volume',
      volumeCubicMeters: 2,
    });

    const display = getVolumeDisplay(measurement, 'imperial', measurement.volumeCubicMeters);

    expect(display.unitSystem).toBe('imperial');
    expect(display.unitLabel).toBe('cu ft');
    expect(display.value).toBeCloseTo(70.6293334429772, 10);
  });

  it('summarizes segment distances when available', () => {
    const measurement = createMeasurement({
      metadata: { segmentDistancesMeters: [1, 2.5, 'skip', 3.456] },
    });

    expect(getSegmentSummary(measurement)).toBe('1.000|2.500|3.456');
  });

  it('returns an empty summary when no segments exist', () => {
    const measurement = createMeasurement();

    expect(getSegmentSummary(measurement)).toBe('');
  });

  it('formats CSV rows with proper escaping', () => {
    const row = formatCsvRow(['Simple', 'He said "hi"', 42, null, undefined]);

    expect(row).toBe('"Simple","He said ""hi""","42","",""');
  });

  it('delegates display selection based on measurement kind', () => {
    const measurement = createMeasurement({
      kind: 'distance',
      unit: 'imperial',
      distanceMeters: 3,
    });

    const display = getDisplayValue(measurement, 'imperial');

    expect(display.unitSystem).toBe('imperial');
    expect(display.unitLabel).toBe('ft');
    expect(display.value).toBeCloseTo(9.84252, 5);
  });
});
