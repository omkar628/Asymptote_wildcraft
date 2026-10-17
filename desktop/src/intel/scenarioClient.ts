import { HttpError, requestJson } from '../services/http';

export type ScenarioStep = {
  hour: number;
  polygon: Array<[number, number]> | null;
  bearingDeg: number | null;
  rateKmh: number | null;
  downwindKm: number | null;
  upwindKm: number | null;
  crosswindKm: number | null;
  confidence: number | null;
  notes: string[];
};

export type SpreadScenario = {
  modelVersion: string;
  label: string;
  message: string;
  assumptions: string[];
  ignition: { lat: number; lon: number; kind: string } | null;
  steps: ScenarioStep[];
  fuelConnected: boolean;
  terrainConnected: boolean;
};

export type ScenarioSample = {
  hour_offset: number;
  wind_kmh: number | null;
  wind_from_deg: number | null;
  temperature_c: number | null;
  humidity_pct: number | null;
  precip_mm: number | null;
  sensor_alert: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export async function loadScenario(
  base: string,
  body: {
    ignition: { lat: number; lon: number; kind: 'firms' | 'hypothetical' } | null;
    forecastHours: number;
    samples: ScenarioSample[];
  },
): Promise<SpreadScenario> {
  if (!base) {
    throw new HttpError('Set the sensor backend URL in Settings before requesting a spread scenario.');
  }
  const trimmed = base.endsWith('/') ? base : `${base}/`;
  const url = new URL('api/fire/scenario', trimmed).toString();
  const payload = await requestJson(url, 20000, {
    method: 'POST',
    body: JSON.stringify({
      ignition: body.ignition,
      forecast_hours: body.forecastHours,
      samples: body.samples,
      fuel_modifier: null,
      slope_modifier: null,
    }),
  });
  const row = asRecord(payload);
  if (!row || !Array.isArray(row.steps)) {
    throw new HttpError('The spread response did not include time steps.');
  }
  const ignition = asRecord(row.ignition);
  return {
    modelVersion: typeof row.model_version === 'string' ? row.model_version : 'wildcraft-screen-1',
    label: typeof row.label === 'string' ? row.label : 'Illustrative spread scenario — not an operational forecast',
    message: typeof row.message === 'string' ? row.message : '',
    assumptions: Array.isArray(row.assumptions) ? row.assumptions.filter((item): item is string => typeof item === 'string') : [],
    ignition:
      ignition && asNumber(ignition.lat) !== null && asNumber(ignition.lon) !== null
        ? { lat: asNumber(ignition.lat) as number, lon: asNumber(ignition.lon) as number, kind: typeof ignition.kind === 'string' ? ignition.kind : 'hypothetical' }
        : null,
    fuelConnected: row.fuel_connected === true,
    terrainConnected: row.terrain_connected === true,
    steps: row.steps.map((item) => {
      const step = asRecord(item) ?? {};
      const polygon = asRecord(step.polygon);
      const coordinates = polygon && Array.isArray(polygon.coordinates) ? polygon.coordinates[0] : null;
      const ring = Array.isArray(coordinates)
        ? coordinates
            .map((pair) => (Array.isArray(pair) && pair.length >= 2 ? ([Number(pair[1]), Number(pair[0])] as [number, number]) : null))
            .filter((pair): pair is [number, number] => pair !== null && Number.isFinite(pair[0]) && Number.isFinite(pair[1]))
        : null;
      const axes = asRecord(step.axes_km);
      return {
        hour: asNumber(step.hour) ?? 0,
        polygon: ring && ring.length > 3 ? ring : null,
        bearingDeg: asNumber(step.bearing_deg),
        rateKmh: asNumber(step.rate_kmh),
        downwindKm: axes ? asNumber(axes.downwind_km) : null,
        upwindKm: axes ? asNumber(axes.upwind_km) : null,
        crosswindKm: axes ? asNumber(axes.crosswind_km) : null,
        confidence: asNumber(step.confidence),
        notes: Array.isArray(step.notes) ? step.notes.filter((note): note is string => typeof note === 'string') : [],
      };
    }),
  };
}
