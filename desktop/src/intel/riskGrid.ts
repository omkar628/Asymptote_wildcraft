import type { BBox } from './areas';

export const METERS_PER_DEGREE_LAT = 111_320;
export const MAX_GRID_CELLS = 6000;

export type GridCell = {
  id: string;
  row: number;
  col: number;
  west: number;
  south: number;
  east: number;
  north: number;
  centerLat: number;
  centerLon: number;
};

export type RiskFactor = {
  name: string;
  reading: string;
  points: number | null;
  note: string;
};

export type RiskResult = {
  score: number | null;
  band: string | null;
  color: string | null;
  range: string | null;
  weatherScore: number | null;
  hotspotScore: number | null;
  factors: RiskFactor[];
  uncertainty: string;
};

export type ScoredCell = GridCell & { risk: RiskResult };

export type WeatherInputs = {
  temperatureC: number | null;
  humidityPct: number | null;
  precipitationMm: number | null;
  windKmh: number | null;
};

export type HotspotPoint = { latitude: number; longitude: number };

const TEMP_NOTE = '0 at or below 28 °C, 15 at or above 42 °C.';
const HUMID_NOTE = '0 at or above 70%, 15 at or below 30%.';
const RAIN_NOTE = '15 at 0 mm, 0 at or above 2 mm.';
const WIND_NOTE = '0 at or below 8 km/h, 15 at or above 40 km/h.';
const SAMPLE_NOTE = 'Weather is one Open-Meteo sample for the selected point, not a measurement inside this cell.';
const ABSENCE_NOTE = 'No FIRMS detections are in the current response. Absence is not a safety finding.';
const WEATHER_MISSING = 'Weather was unavailable, so the score uses only nearby FIRMS detections.';
const FIRMS_MISSING = 'FIRMS was unavailable, so the score uses only the sampled weather.';
const BOTH_MISSING = 'Weather and FIRMS were unavailable, so this cell is not scored.';

export function metersPerDegreeLon(latDeg: number): number {
  return METERS_PER_DEGREE_LAT * Math.cos((latDeg * Math.PI) / 180);
}

export function intersectBounds(a: BBox, b: BBox): BBox | null {
  const west = Math.max(a.west, b.west);
  const south = Math.max(a.south, b.south);
  const east = Math.min(a.east, b.east);
  const north = Math.min(a.north, b.north);
  if (west >= east || south >= north) return null;
  return { west, south, east, north };
}

export function buildCells(bounds: BBox, cellMeters: number, refLat: number, maxCells = MAX_GRID_CELLS): {
  cells: GridCell[];
  estimated: number;
  truncated: boolean;
} {
  if (!(cellMeters > 0) || !Number.isFinite(refLat)) {
    return { cells: [], estimated: 0, truncated: false };
  }
  const mLon = metersPerDegreeLon(refLat);
  if (!(mLon > 1)) return { cells: [], estimated: 0, truncated: false };
  const col0 = Math.floor((bounds.west * mLon) / cellMeters);
  const col1 = Math.floor((bounds.east * mLon - 1e-6) / cellMeters);
  const row0 = Math.floor((bounds.south * METERS_PER_DEGREE_LAT) / cellMeters);
  const row1 = Math.floor((bounds.north * METERS_PER_DEGREE_LAT - 1e-6) / cellMeters);
  const estimated = col1 >= col0 && row1 >= row0 ? (col1 - col0 + 1) * (row1 - row0 + 1) : 0;
  if (estimated <= 0 || estimated > maxCells) {
    return { cells: [], estimated, truncated: estimated > maxCells };
  }
  const cells: GridCell[] = [];
  for (let row = row0; row <= row1; row += 1) {
    const south = (row * cellMeters) / METERS_PER_DEGREE_LAT;
    const north = ((row + 1) * cellMeters) / METERS_PER_DEGREE_LAT;
    for (let col = col0; col <= col1; col += 1) {
      const west = (col * cellMeters) / mLon;
      const east = ((col + 1) * cellMeters) / mLon;
      cells.push({
        id: `${row}:${col}`,
        row,
        col,
        west,
        south,
        east,
        north,
        centerLat: (south + north) / 2,
        centerLon: (west + east) / 2,
      });
    }
  }
  return { cells, estimated, truncated: false };
}

export function clampFactor(value: number): number {
  return Math.min(15, Math.max(0, value));
}

export function temperatureFactor(celsius: number | null): number | null {
  if (celsius === null || !Number.isFinite(celsius)) return null;
  if (celsius <= 28) return 0;
  if (celsius >= 42) return 15;
  return clampFactor((15 * (celsius - 28)) / 14);
}

export function humidityFactor(percent: number | null): number | null {
  if (percent === null || !Number.isFinite(percent)) return null;
  if (percent >= 70) return 0;
  if (percent <= 30) return 15;
  return clampFactor((15 * (70 - percent)) / 40);
}

export function precipitationFactor(mm: number | null): number | null {
  if (mm === null || !Number.isFinite(mm)) return null;
  if (mm >= 2) return 0;
  if (mm <= 0) return 15;
  return clampFactor(15 * (1 - mm / 2));
}

export function windFactor(kmh: number | null): number | null {
  if (kmh === null || !Number.isFinite(kmh)) return null;
  if (kmh <= 8) return 0;
  if (kmh >= 40) return 15;
  return clampFactor((15 * (kmh - 8)) / 32);
}

export function hotspotFactor(distanceM: number): number {
  if (distanceM <= 0) return 40;
  if (distanceM <= 1000) return 30;
  if (distanceM <= 3000) return 18;
  if (distanceM <= 8000) return 8;
  return 0;
}

export function riskBand(score: number): { label: string; color: string; range: string } {
  if (score <= 24) return { label: 'Low', color: '#2f7d46', range: '0–24' };
  if (score <= 49) return { label: 'Moderate', color: '#d6c24a', range: '25–49' };
  if (score <= 74) return { label: 'High', color: '#e08a2c', range: '50–74' };
  return { label: 'Very high', color: '#c4473a', range: '75–100' };
}

export function distanceToCellMeters(lat: number, lon: number, cell: GridCell, refLat: number): number {
  if (lon >= cell.west && lon <= cell.east && lat >= cell.south && lat <= cell.north) return 0;
  const mLon = metersPerDegreeLon(refLat);
  const x = lon * mLon;
  const y = lat * METERS_PER_DEGREE_LAT;
  const nearestX = Math.min(Math.max(x, cell.west * mLon), cell.east * mLon);
  const nearestY = Math.min(Math.max(y, cell.south * METERS_PER_DEGREE_LAT), cell.north * METERS_PER_DEGREE_LAT);
  return Math.hypot(x - nearestX, y - nearestY);
}

export function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number, refLat: number): number {
  const mLon = metersPerDegreeLon(refLat);
  return Math.hypot((lon2 - lon1) * mLon, (lat2 - lat1) * METERS_PER_DEGREE_LAT);
}

function reading(value: number | null, digits: number, unit: string): string {
  return value === null ? 'Not in the response' : `${value.toFixed(digits)} ${unit}`;
}

function weatherFactors(weather: WeatherInputs | null, weatherKnown: boolean): RiskFactor[] {
  if (!weatherKnown || !weather) {
    return [
      { name: 'Temperature', reading: 'Unavailable', points: null, note: TEMP_NOTE },
      { name: 'Relative humidity', reading: 'Unavailable', points: null, note: HUMID_NOTE },
      { name: 'Precipitation', reading: 'Unavailable', points: null, note: RAIN_NOTE },
      { name: 'Wind speed', reading: 'Unavailable', points: null, note: WIND_NOTE },
    ];
  }
  return [
    { name: 'Temperature', reading: reading(weather.temperatureC, 1, '°C'), points: temperatureFactor(weather.temperatureC), note: TEMP_NOTE },
    { name: 'Relative humidity', reading: reading(weather.humidityPct, 0, '%'), points: humidityFactor(weather.humidityPct), note: HUMID_NOTE },
    { name: 'Precipitation', reading: reading(weather.precipitationMm, 2, 'mm'), points: precipitationFactor(weather.precipitationMm), note: RAIN_NOTE },
    { name: 'Wind speed', reading: reading(weather.windKmh, 1, 'km/h'), points: windFactor(weather.windKmh), note: WIND_NOTE },
  ];
}

function sumPoints(factors: RiskFactor[]): number | null {
  const present = factors.filter((factor) => factor.points !== null);
  if (present.length === 0) return null;
  return present.reduce((sum, factor) => sum + (factor.points ?? 0), 0);
}

export function scoreFromInputs(
  weather: WeatherInputs | null,
  weatherKnown: boolean,
  hotspotsKnown: boolean,
  hotspotCount: number,
  distanceM: number | null,
  absenceNote = ABSENCE_NOTE,
): RiskResult {
  const factors = weatherFactors(weather, weatherKnown);
  const weatherScore = weatherKnown ? sumPoints(factors) : null;
  const hotspotScore = hotspotsKnown ? hotspotFactor(distanceM ?? Number.POSITIVE_INFINITY) : null;
  const usableHotspot = hotspotsKnown ? hotspotScore : null;
  if (weatherScore === null && usableHotspot === null) {
    return {
      score: null,
      band: null,
      color: null,
      range: null,
      weatherScore: null,
      hotspotScore: null,
      factors,
      uncertainty: !weatherKnown && !hotspotsKnown ? BOTH_MISSING : 'The available inputs did not produce a score.',
    };
  }
  const score = Math.round(Math.min(100, (weatherScore ?? 0) + (usableHotspot ?? 0)));
  const band = riskBand(score);
  const parts = [SAMPLE_NOTE];
  if (!weatherKnown || weatherScore === null) parts[0] = WEATHER_MISSING;
  if (!hotspotsKnown) parts.push(FIRMS_MISSING);
  else if (hotspotCount === 0) parts.push(absenceNote);
  else parts.push('The hotspot term is the distance from this cell to the nearest returned detection.');
  return {
    score,
    band: band.label,
    color: band.color,
    range: band.range,
    weatherScore,
    hotspotScore: usableHotspot,
    factors,
    uncertainty: parts.join(' '),
  };
}

export function scoreGrid(
  cells: GridCell[],
  hotspots: HotspotPoint[],
  weather: WeatherInputs | null,
  weatherKnown: boolean,
  hotspotsKnown: boolean,
  refLat: number,
  absenceNote = ABSENCE_NOTE,
): ScoredCell[] {
  return cells.map((cell) => {
    let distanceM: number | null = null;
    if (hotspotsKnown && hotspots.length > 0) {
      distanceM = Number.POSITIVE_INFINITY;
      for (const hotspot of hotspots) {
        const distance = distanceToCellMeters(hotspot.latitude, hotspot.longitude, cell, refLat);
        if (distance < distanceM) distanceM = distance;
        if (distanceM === 0) break;
      }
    }
    return {
      ...cell,
      risk: scoreFromInputs(weather, weatherKnown, hotspotsKnown, hotspots.length, distanceM, absenceNote),
    };
  });
}

export function cellAt(lat: number, lon: number, cells: ScoredCell[]): ScoredCell | null {
  return cells.find((cell) => lon >= cell.west && lon <= cell.east && lat >= cell.south && lat <= cell.north) ?? null;
}

export function nearestHotspots<T extends HotspotPoint>(
  lat: number,
  lon: number,
  hotspots: T[],
  refLat: number,
  limit = 3,
): Array<{ hotspot: T; distanceM: number }> {
  return hotspots
    .map((hotspot) => ({ hotspot, distanceM: distanceMeters(lat, lon, hotspot.latitude, hotspot.longitude, refLat) }))
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, limit);
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export function hexAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
