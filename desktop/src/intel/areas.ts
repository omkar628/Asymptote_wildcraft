export type BBox = {
  west: number;
  south: number;
  east: number;
  north: number;
};

/** Published NTCA location range for Tadoba-Andhari. This is a default view, not a surveyed boundary. */
export const TADOBA_RANGE: BBox = {
  west: 79.197222,
  south: 19.990833,
  east: 79.681667,
  north: 20.495556,
};

export const TADOBA_LABEL = 'Tadoba-Andhari published location range';

export function areaCenter(area: BBox): { lat: number; lon: number } {
  return {
    lat: (area.south + area.north) / 2,
    lon: (area.west + area.east) / 2,
  };
}

export function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function roundBox(area: BBox): BBox {
  return {
    west: round4(area.west),
    south: round4(area.south),
    east: round4(area.east),
    north: round4(area.north),
  };
}

export function parseCoordinate(latText: string, lonText: string): { lat: number; lon: number } | null {
  const lat = Number(latText);
  const lon = Number(lonText);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

export function boxFromCorners(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): { box: BBox | null; reason: string | null } {
  const west = Math.min(a.lon, b.lon);
  const east = Math.max(a.lon, b.lon);
  const south = Math.min(a.lat, b.lat);
  const north = Math.max(a.lat, b.lat);
  if (east - west > 10 || north - south > 10) {
    return { box: null, reason: 'That area is larger than 10 degrees on a side. FIRMS area requests are limited to that size.' };
  }
  if (east - west < 0.01 || north - south < 0.01) {
    return { box: null, reason: 'That area is smaller than 0.01 degrees. Click two corners farther apart.' };
  }
  return { box: { west, south, east, north }, reason: null };
}

export function formatCoord(lat: number, lon: number): string {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}
