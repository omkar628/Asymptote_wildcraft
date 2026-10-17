/**
 * Sensitivity rules kept in step with backend/fire_model.py.
 * The spread polygons themselves come from POST /api/fire/scenario.
 */

export const MODEL_VERSION = 'wildcraft-screen-1';
export const SPREAD_LABEL = 'Illustrative spread scenario — not an operational forecast';
export const FORECAST_STEPS = [0, 1, 3, 6, 12, 24] as const;
export const SENSOR_ALERT_METERS = 2000;
export const SENSOR_STALE_MS = 60_000;
const VEGETATION_GAP = 0.85;
const TERRAIN_GAP = 0.85;

export type SensitivityFactor = {
  name: string;
  points: number | null;
  reading: string;
  note: string;
};

export type SensitivityResult = {
  score: number | null;
  band: string | null;
  color: string | null;
  confidence: number;
  factors: SensitivityFactor[];
  missing: string[];
  uncertainty: string;
  modelVersion: string;
};

export type SensitivityInputs = {
  temperatureC: number | null;
  humidityPct: number | null;
  precipitationMm: number | null;
  windKmh: number | null;
  soilMoisture: number | null;
  firmsKnown: boolean;
  hotspotCount: number;
  firmsDistanceM: number | null;
  sensorLocated: boolean;
  sensorFresh: boolean;
  sensorAlert: boolean;
  rainWindowMm: number | null;
};

const UNAVAILABLE = [
  'Vegetation and NDVI are not connected. Sentinel-2 is not queried.',
  'Fuel moisture is not connected.',
  'Slope and aspect are not connected. No digital elevation model is loaded.',
];

function finite(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function bandFor(score: number): { band: string; color: string } {
  if (score <= 24) return { band: 'Lower sensitivity', color: '#2f7d46' };
  if (score <= 49) return { band: 'Moderate sensitivity', color: '#d6c24a' };
  if (score <= 74) return { band: 'High sensitivity', color: '#e08a2c' };
  return { band: 'Very high sensitivity', color: '#c4473a' };
}

export function temperaturePoints(celsius: number | null): number | null {
  const value = finite(celsius);
  if (value === null) return null;
  if (value <= 30) return 0;
  if (value >= 42) return 16;
  return (16 * (value - 30)) / 12;
}

export function humidityPoints(percent: number | null): number | null {
  const value = finite(percent);
  if (value === null) return null;
  if (value >= 65) return 0;
  if (value <= 25) return 16;
  return (16 * (65 - value)) / 40;
}

export function precipitationPoints(mm: number | null): number | null {
  const value = finite(mm);
  if (value === null) return null;
  if (value >= 2) return 0;
  if (value <= 0) return 14;
  return 14 * (1 - value / 2);
}

export function windPoints(kmh: number | null): number | null {
  const value = finite(kmh);
  if (value === null) return null;
  if (value <= 10) return 0;
  if (value >= 40) return 14;
  return (14 * (value - 10)) / 30;
}

export function soilMoisturePoints(cubic: number | null): number | null {
  const value = finite(cubic);
  if (value === null) return null;
  if (value >= 0.35) return 0;
  if (value <= 0.1) return 10;
  return (10 * (0.35 - value)) / 0.25;
}

export function firmsProximityPoints(distanceM: number | null, firmsKnown: boolean, hotspotCount: number): number | null {
  if (!firmsKnown) return null;
  if (hotspotCount <= 0 || distanceM === null) return 0;
  const distance = finite(distanceM);
  if (distance === null) return null;
  if (distance <= 1000) return 12;
  if (distance <= 3000) return 8;
  if (distance <= 8000) return 4;
  return 0;
}

export function sensorAlertPoints(located: boolean, fresh: boolean, alert: boolean): number | null {
  if (!located || !fresh) return null;
  return alert ? 8 : 0;
}

export function rainWindowPoints(sumMm: number | null): number | null {
  const value = finite(sumMm);
  if (value === null) return null;
  if (value < 20) return 10;
  if (value < 50) return 5;
  return 0;
}

export function forecastSteps(forecastHours: number): number[] {
  const hours = Math.trunc(forecastHours);
  if (hours < 1) return [0];
  return FORECAST_STEPS.filter((step) => step <= hours);
}

export function rawMqAlert(mq9: number | null, mq135: number | null): boolean {
  const first = finite(mq9);
  const second = finite(mq135);
  return (first !== null && first > 650) || (second !== null && second > 650);
}

export function sensorIsFresh(timestamp: string | null, nowMs: number): boolean {
  if (!timestamp) return false;
  const then = Date.parse(timestamp);
  if (!Number.isFinite(then)) return false;
  return nowMs - then <= SENSOR_STALE_MS && nowMs - then >= 0;
}

function reading(value: number | null, unit: string): string {
  const number = finite(value);
  return number === null ? 'Unavailable' : `${number.toFixed(2)} ${unit}`;
}

function factor(name: string, points: number | null, text: string, note: string): SensitivityFactor {
  return { name, points: points === null ? null : Math.round(points * 100) / 100, reading: text, note };
}

const WEIGHTS: Record<string, number> = {
  Temperature: 16,
  'Relative humidity': 16,
  'Recent precipitation': 14,
  'Wind speed': 14,
  'Soil moisture': 10,
  'FIRMS proximity': 12,
  'Sensor alert': 8,
  '30-day rain sum': 10,
};

export function sensitivityScore(input: SensitivityInputs): SensitivityResult {
  const factors = [
    factor('Temperature', temperaturePoints(input.temperatureC), reading(input.temperatureC, '°C'), '0 at or below 30 °C, 16 at or above 42 °C.'),
    factor('Relative humidity', humidityPoints(input.humidityPct), reading(input.humidityPct, '%'), '0 at or above 65%, 16 at or below 25%.'),
    factor(
      'Recent precipitation',
      precipitationPoints(input.precipitationMm),
      reading(input.precipitationMm, 'mm'),
      '14 at 0 mm, 0 at or above 2 mm. This is Open-Meteo precipitation, not vegetation dryness.',
    ),
    factor('Wind speed', windPoints(input.windKmh), reading(input.windKmh, 'km/h'), '0 at or below 10 km/h, 14 at or above 40 km/h.'),
    factor(
      'Soil moisture',
      soilMoisturePoints(input.soilMoisture),
      reading(input.soilMoisture, 'm³/m³'),
      '10 at or below 0.10, 0 at or above 0.35. This is not fuel moisture.',
    ),
    factor(
      'FIRMS proximity',
      firmsProximityPoints(input.firmsDistanceM, input.firmsKnown, input.hotspotCount),
      input.firmsKnown ? (input.firmsDistanceM === null ? `${input.hotspotCount} detections` : `${Math.round(input.firmsDistanceM)} m`) : 'Unavailable',
      '12 within 1 km, 8 within 3 km, 4 within 8 km, otherwise 0 when FIRMS responded. A missing FIRMS response is not zero.',
    ),
    factor(
      'Sensor alert',
      sensorAlertPoints(input.sensorLocated, input.sensorFresh, input.sensorAlert),
      !input.sensorLocated ? 'Not assigned to this cell' : !input.sensorFresh ? 'Stale' : input.sensorAlert ? 'Raw MQ above 650' : 'Raw MQ at or below 650',
      '8 points only when a configured sensor coordinate falls in this cell, the packet is fresh, and MQ9 or MQ135 is strictly above 650 raw.',
    ),
    factor(
      '30-day rain sum',
      rainWindowPoints(input.rainWindowMm),
      reading(input.rainWindowMm, 'mm'),
      '10 below 20 mm, 5 below 50 mm, 0 at or above 50 mm. One Open-Meteo archive sample, not a cell measurement.',
    ),
  ];
  const present = factors.filter((item) => item.points !== null);
  const missing = factors.filter((item) => item.points === null).map((item) => item.name);
  if (present.length === 0) {
    return {
      score: null,
      band: null,
      color: null,
      confidence: 0,
      factors,
      missing: [...missing, ...UNAVAILABLE],
      uncertainty: 'No connected sensitivity input was available, so this cell is not scored.',
      modelVersion: MODEL_VERSION,
    };
  }
  const presentWeight = factors.reduce((sum, item) => (item.points === null ? sum : sum + (WEIGHTS[item.name] ?? 0)), 0);
  const score = Math.max(0, Math.min(100, Math.round(present.reduce((sum, item) => sum + (item.points ?? 0), 0))));
  const confidence = Math.round((presentWeight / 100) * VEGETATION_GAP * TERRAIN_GAP * 1000) / 1000;
  const colored = bandFor(score);
  return {
    score,
    band: confidence < 0.45 ? `${colored.band} · incomplete` : colored.band,
    color: colored.color,
    confidence,
    factors,
    missing: [...missing, ...UNAVAILABLE],
    uncertainty: 'Initial screening tool. It is not validated against local fire history. Missing inputs reduce confidence and are not filled in.',
    modelVersion: MODEL_VERSION,
  };
}

export function spreadIntensity(distanceM: number, maxM: number, inside: boolean): number | null {
  if (!inside || !(maxM > 0)) return null;
  return Math.max(0, Math.min(1, 1 - distanceM / maxM));
}
