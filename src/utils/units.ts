import { UNIT_CONVERSIONS } from '../types/common';

export type UnitSystem = 'metric' | 'imperial';
export type LengthUnit = 'm' | 'ft';
export type AreaUnit = 'sq m' | 'sq ft';
export type VolumeUnit = 'cu m' | 'cu ft';

/**
 * Unit conversion constants
 */
export const UNIT_CONVERSIONS_CONSTANTS = {
  SQUARE_METERS_TO_SQUARE_FEET: 10.7639,
  CUBIC_METERS_TO_CUBIC_FEET: 35.3147,
} as const;

/**
 * Convert length from meters to display value with appropriate unit
 */
export function convertLengthToDisplay(
  meters: number | undefined | null,
  unitSystem: UnitSystem
): { value: number | undefined; unitLabel: LengthUnit } {
  if (!Number.isFinite(meters) || meters === null || meters === undefined) {
    return { value: undefined, unitLabel: unitSystem === 'imperial' ? 'ft' : 'm' };
  }

  if (unitSystem === 'imperial') {
    return {
      value: UNIT_CONVERSIONS.metersToFeet(meters),
      unitLabel: 'ft'
    };
  }

  return { value: meters, unitLabel: 'm' };
}

/**
 * Convert area from square meters to display value with appropriate unit
 */
export function convertAreaToDisplay(
  squareMeters: number | undefined | null,
  unitSystem: UnitSystem
): { value: number | undefined; unitLabel: AreaUnit } {
  if (!Number.isFinite(squareMeters) || squareMeters === null || squareMeters === undefined) {
    return { value: undefined, unitLabel: unitSystem === 'imperial' ? 'sq ft' : 'sq m' };
  }

  if (unitSystem === 'imperial') {
    return {
      value: squareMeters * UNIT_CONVERSIONS_CONSTANTS.SQUARE_METERS_TO_SQUARE_FEET,
      unitLabel: 'sq ft'
    };
  }

  return { value: squareMeters, unitLabel: 'sq m' };
}

/**
 * Convert volume from cubic meters to display value with appropriate unit
 */
export function convertVolumeToDisplay(
  cubicMeters: number | undefined | null,
  unitSystem: UnitSystem
): { value: number | undefined; unitLabel: VolumeUnit } {
  if (!Number.isFinite(cubicMeters) || cubicMeters === null || cubicMeters === undefined) {
    return { value: undefined, unitLabel: unitSystem === 'imperial' ? 'cu ft' : 'cu m' };
  }

  if (unitSystem === 'imperial') {
    return {
      value: cubicMeters * UNIT_CONVERSIONS_CONSTANTS.CUBIC_METERS_TO_CUBIC_FEET,
      unitLabel: 'cu ft'
    };
  }

  return { value: cubicMeters, unitLabel: 'cu m' };
}

/**
 * Format a length value for display
 */
export function formatLength(
  meters: number | undefined | null,
  unitSystem: UnitSystem,
  precision: number = 2
): string {
  const { value, unitLabel } = convertLengthToDisplay(meters, unitSystem);

  if (value === undefined) {
    return `-- ${unitLabel}`;
  }

  return `${value.toFixed(precision)} ${unitLabel}`;
}

/**
 * Format an area value for display
 */
export function formatArea(
  squareMeters: number | undefined | null,
  unitSystem: UnitSystem,
  precision: number = 2
): string {
  const { value, unitLabel } = convertAreaToDisplay(squareMeters, unitSystem);

  if (value === undefined) {
    return `-- ${unitLabel}`;
  }

  return `${value.toFixed(precision)} ${unitLabel}`;
}

/**
 * Format a volume value for display
 */
export function formatVolume(
  cubicMeters: number | undefined | null,
  unitSystem: UnitSystem,
  precision: number = 2
): string {
  const { value, unitLabel } = convertVolumeToDisplay(cubicMeters, unitSystem);

  if (value === undefined) {
    return `-- ${unitLabel}`;
  }

  return `${value.toFixed(precision)} ${unitLabel}`;
}

/**
 * Get the appropriate unit label for a given measurement type and unit system
 */
export function getUnitLabel(
  measurementType: 'length' | 'area' | 'volume',
  unitSystem: UnitSystem
): LengthUnit | AreaUnit | VolumeUnit {
  switch (measurementType) {
    case 'area':
      return unitSystem === 'imperial' ? 'sq ft' : 'sq m';
    case 'volume':
      return unitSystem === 'imperial' ? 'cu ft' : 'cu m';
    default:
      return unitSystem === 'imperial' ? 'ft' : 'm';
  }
}

/**
 * Validate if a numeric value is suitable for measurement display
 */
export function isValidMeasurementValue(value: number | undefined | null): boolean {
  return value !== undefined && value !== null && Number.isFinite(value) && value >= 0;
}
