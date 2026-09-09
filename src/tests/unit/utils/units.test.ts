import { UNIT_CONVERSIONS } from '../../../types/common';
import { convertAreaToDisplay, convertVolumeToDisplay } from '../../../utils/units';

test('uses the exact international foot for length, area and volume', () => {
  expect(UNIT_CONVERSIONS.metersToFeet(0.3048)).toBe(1);
  expect(UNIT_CONVERSIONS.metersToInches(0.0254)).toBe(1);
  expect(convertAreaToDisplay(0.3048 ** 2, 'imperial').value).toBeCloseTo(1, 14);
  expect(convertVolumeToDisplay(0.3048 ** 3, 'imperial').value).toBeCloseTo(1, 14);
  for (const meters of [0, 0.001, 12.34, 1e6]) {
    expect(UNIT_CONVERSIONS.feetToMeters(UNIT_CONVERSIONS.metersToFeet(meters))).toBeCloseTo(meters, 8);
  }
});
