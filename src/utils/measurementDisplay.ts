import { convertAreaToDisplay, convertLengthToDisplay, convertVolumeToDisplay } from './units';
import type { UnitSystem } from './units';

interface RectangularDimensions {
  length: number;
  width: number;
  height: number;
}

export function getAreaDisplayValues(
  areaSquareMeters: number,
  perimeterMeters: number,
  unitSystem: UnitSystem
) {
  const area = convertAreaToDisplay(areaSquareMeters, unitSystem);
  const perimeter = convertLengthToDisplay(perimeterMeters, unitSystem);

  return { area, perimeter };
}

export function getVolumeDisplayValues(
  volumeCubicMeters: number,
  dimensionsMeters: RectangularDimensions,
  unitSystem: UnitSystem
) {
  const volume = convertVolumeToDisplay(volumeCubicMeters, unitSystem);
  const length = convertLengthToDisplay(dimensionsMeters.length, unitSystem);
  const width = convertLengthToDisplay(dimensionsMeters.width, unitSystem);
  const height = convertLengthToDisplay(dimensionsMeters.height, unitSystem);

  return {
    volume,
    dimensions: {
      length,
      width,
      height,
    },
  };
}
