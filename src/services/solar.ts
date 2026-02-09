import { AppSettings } from '../types/common';

export interface SolarBuildingInsights {
  name: string;
  center: {
    latitude: number;
    longitude: number;
  };
  boundingBox: {
    sw: { latitude: number; longitude: number };
    ne: { latitude: number; longitude: number };
  };
  imageryDate: string;
  imageryProcessedDate: string;
  postalCode: string;
  administrativeArea: string;
  statisticalArea: string;
  regionCode: string;
  solarPotential: {
    maxArrayPanelsCount: number;
    maxArrayAreaMeters2: number;
    maxSunshineHoursPerYear: number;
    carbonOffsetFactorKgPerMwh: number;
    wholeRoofStats: {
      areaMeters2: number;
      sunshineQuantiles: number[];
      groundAreaMeters2: number;
    };
    buildingStats: {
      areaMeters2: number;
      sunshineQuantiles: number[];
      groundAreaMeters2: number;
    };
    roofSegmentStats: Array<{
      pitchDegrees: number;
      azimuthDegrees: number;
      stats: {
        areaMeters2: number;
        sunshineQuantiles: number[];
        groundAreaMeters2: number;
      };
      center: {
        latitude: number;
        longitude: number;
      };
      boundingBox: {
        sw: { latitude: number; longitude: number };
        ne: { latitude: number; longitude: number };
      };
      planeHeightAtCenterMeters: number;
    }>;
  };
}

export async function fetchBuildingInsights(
  lat: number,
  lng: number,
  apiKey: string
): Promise<SolarBuildingInsights | null> {
  const url = `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${lat}&location.longitude=${lng}&requiredQuality=HIGH&key=${apiKey}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
        if (response.status === 404) {
            console.log('No building found at this location (Solar API).');
            return null; // Normal case for empty/street areas
        }
        const errorText = await response.text();
        console.warn(`Solar API Error ${response.status}: ${errorText}`);
        return null;
    }

    const data = await response.json();
    return data as SolarBuildingInsights;
  } catch (error) {
    console.error('Failed to fetch building insights:', error);
    return null;
  }
}
