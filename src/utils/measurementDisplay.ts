import type { Measurement } from '../types/common';
import {
  convertAreaToDisplay,
  convertLengthToDisplay,
  convertVolumeToDisplay,
  type UnitSystem,
} from './units';

export type MeasurementDisplayValue = {
  value?: number;
  unitLabel: string;
  unitSystem: UnitSystem;
};

export const hasFiniteValue = (value: number | null | undefined): value is number =>
  value !== null && value !== undefined && Number.isFinite(value);

export const getActiveUnitSystem = (
  baseValue: number | null | undefined,
  measurementUnit: UnitSystem,
  defaultUnit: UnitSystem
): UnitSystem => (hasFiniteValue(baseValue) ? defaultUnit : measurementUnit);

export const getLengthDisplay = (
  measurement: Measurement,
  defaultUnit: UnitSystem,
  baseValue: number | null | undefined,
  fallbackValue?: number | null
): MeasurementDisplayValue => {
  const unitSystem = getActiveUnitSystem(baseValue, measurement.unit, defaultUnit);
  const converted = convertLengthToDisplay(baseValue, unitSystem);
  if (!hasFiniteValue(baseValue) && hasFiniteValue(fallbackValue)) {
    return { value: fallbackValue, unitLabel: converted.unitLabel, unitSystem };
  }
  return { ...converted, unitSystem };
};

export const getAreaDisplay = (
  measurement: Measurement,
  defaultUnit: UnitSystem,
  baseValue: number | null | undefined
): MeasurementDisplayValue => {
  const unitSystem = getActiveUnitSystem(baseValue, measurement.unit, defaultUnit);
  const converted = convertAreaToDisplay(baseValue, unitSystem);
  return { ...converted, unitSystem };
};

export const getVolumeDisplay = (
  measurement: Measurement,
  defaultUnit: UnitSystem,
  baseValue: number | null | undefined
): MeasurementDisplayValue => {
  const unitSystem = getActiveUnitSystem(baseValue, measurement.unit, defaultUnit);
  const converted = convertVolumeToDisplay(baseValue, unitSystem);
  return { ...converted, unitSystem };
};

export const getDisplayValue = (
  measurement: Measurement,
  defaultUnit: UnitSystem
): MeasurementDisplayValue => {
  switch (measurement.kind) {
    case 'distance':
    case 'polyline':
      return getLengthDisplay(
        measurement,
        defaultUnit,
        measurement.distanceMeters,
        measurement.distance
      );
    case 'area':
      return getAreaDisplay(measurement, defaultUnit, measurement.areaSquareMeters);
    case 'volume':
      return getVolumeDisplay(measurement, defaultUnit, measurement.volumeCubicMeters);
    default:
      return {
        value: undefined,
        unitLabel: measurement.unit === 'imperial' ? 'imperial' : 'metric',
        unitSystem: measurement.unit,
      };
  }
};

export const getSegmentSummary = (measurement: Measurement): string => {
  const meta = measurement.metadata as { segmentDistancesMeters?: unknown } | undefined;
  const segments = meta?.segmentDistancesMeters;
  if (!Array.isArray(segments) || segments.length === 0) {
    return '';
  }
  return segments
    .map((segment) => (typeof segment === 'number' && Number.isFinite(segment) ? segment.toFixed(3) : ''))
    .filter(Boolean)
    .join('|');
};

export const escapeCsvValue = (value: string): string => `"${value.replace(/"/g, '""')}"`;

export const formatCsvRow = (
  values: Array<string | number | boolean | null | undefined>
): string => values.map((value) => escapeCsvValue(String(value ?? ''))).join(',');
