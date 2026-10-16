import { HttpError, requestJson } from '../services/http';
import type { BBox } from './areas';

export const FIRMS_PRODUCTS = [
  { id: 'VIIRS_SNPP_NRT', label: 'VIIRS Suomi-NPP near real-time' },
  { id: 'VIIRS_NOAA20_NRT', label: 'VIIRS NOAA-20 near real-time' },
  { id: 'VIIRS_NOAA21_NRT', label: 'VIIRS NOAA-21 near real-time' },
  { id: 'MODIS_NRT', label: 'MODIS near real-time' },
] as const;

export type Hotspot = {
  latitude: number;
  longitude: number;
  acqDate: string | null;
  acqTime: string | null;
  confidence: string | null;
  satellite: string | null;
  instrument: string | null;
  frp: number | null;
  daynight: string | null;
  brightness: number | null;
};

export type FirmsPayload = {
  product: string;
  productLabel: string;
  retrievedAt: string;
  days: number;
  date: string | null;
  requests: number;
  count: number;
  cached: boolean;
  note: string;
  hotspots: Hotspot[];
};

export type FirmsQuery = {
  area: BBox;
  days: number;
  product: string;
  date: string | null;
};

export type FirmsSourceStatus = {
  configured: boolean;
  products: Array<{ id: string; label: string }>;
  documentation: string;
};

const CACHE_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; payload: FirmsPayload }>();

function apiUrl(base: string, path: string): string {
  const trimmed = base.endsWith('/') ? base : `${base}/`;
  return new URL(path.replace(/^\//, ''), trimmed).toString();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function hotspotIdentity(hotspot: Hotspot): string {
  return `${hotspot.latitude},${hotspot.longitude},${hotspot.acqDate ?? ''},${hotspot.acqTime ?? ''},${hotspot.satellite ?? ''}`;
}

export function confidenceColor(confidence: string | null): string {
  if (!confidence) return '#5c6b73';
  const text = confidence.toLowerCase();
  if (text === 'high' || text === 'h') return '#c4473a';
  if (text === 'nominal' || text === 'n') return '#e08a2c';
  if (text === 'low' || text === 'l') return '#d6c24a';
  const value = Number(confidence);
  if (Number.isFinite(value)) {
    if (value >= 80) return '#c4473a';
    if (value >= 50) return '#e08a2c';
    return '#d6c24a';
  }
  return '#5c6b73';
}

function parseHotspot(value: unknown): Hotspot | null {
  const row = asRecord(value);
  if (!row) return null;
  const latitude = asNumber(row.latitude);
  const longitude = asNumber(row.longitude);
  if (latitude === null || longitude === null) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return {
    latitude,
    longitude,
    acqDate: asText(row.acq_date),
    acqTime: asText(row.acq_time),
    confidence: asText(row.confidence),
    satellite: asText(row.satellite),
    instrument: asText(row.instrument),
    frp: asNumber(row.frp),
    daynight: asText(row.daynight),
    brightness: asNumber(row.brightness),
  };
}

function parsePayload(value: unknown): FirmsPayload {
  const row = asRecord(value);
  if (!row || !Array.isArray(row.hotspots)) {
    throw new HttpError('NASA FIRMS response did not match the hotspot table.');
  }
  const hotspots = row.hotspots.map(parseHotspot).filter((item): item is Hotspot => item !== null);
  return {
    product: asText(row.product) ?? 'FIRMS',
    productLabel: asText(row.product_label) ?? asText(row.product) ?? 'FIRMS',
    retrievedAt: asText(row.retrieved_at) ?? new Date().toISOString(),
    days: asNumber(row.days) ?? 1,
    date: asText(row.date),
    requests: asNumber(row.requests) ?? 1,
    count: hotspots.length,
    cached: row.cached === true,
    note: asText(row.note) ?? 'These are satellite detections, not confirmed fire perimeters.',
    hotspots,
  };
}

export function firmsErrorMessage(error: unknown): { status: 'error' | 'unconfigured'; message: string } {
  const text = error instanceof Error ? error.message : 'NASA FIRMS request failed.';
  if (text.toLowerCase().includes('not configured')) {
    return { status: 'unconfigured', message: text };
  }
  if (text.includes('404')) {
    return {
      status: 'error',
      message: 'The running sensor API has no FIRMS route. Restart that one backend process, then refresh.',
    };
  }
  return { status: 'error', message: text };
}

export async function loadFirmsStatus(base: string): Promise<FirmsSourceStatus | null> {
  if (!base) return null;
  try {
    const body = await requestJson(apiUrl(base, '/api/firms/status'), 15000);
    const row = asRecord(body);
    if (!row) return null;
    const products = Array.isArray(row.products)
      ? row.products
          .map((item) => {
            const record = asRecord(item);
            if (!record || typeof record.id !== 'string' || typeof record.label !== 'string') return null;
            return { id: record.id, label: record.label };
          })
          .filter((item): item is { id: string; label: string } => item !== null)
      : [];
    return {
      configured: row.configured === true,
      products,
      documentation: asText(row.documentation) ?? 'https://firms.modaps.eosdis.nasa.gov/api/area/',
    };
  } catch {
    return null;
  }
}

export async function loadHotspots(base: string, query: FirmsQuery, refresh = false): Promise<FirmsPayload> {
  if (!base) {
    throw new HttpError('Set the sensor backend URL in Settings before requesting FIRMS.');
  }
  const key = JSON.stringify(query);
  const hit = cache.get(key);
  if (!refresh && hit && Date.now() - hit.at < CACHE_MS) {
    return { ...hit.payload, cached: true };
  }
  const params = new URLSearchParams({
    west: String(query.area.west),
    south: String(query.area.south),
    east: String(query.area.east),
    north: String(query.area.north),
    days: String(query.days),
    product: query.product,
  });
  if (query.date) params.set('date', query.date);
  if (refresh) params.set('refresh', 'true');
  const body = await requestJson(`${apiUrl(base, '/api/firms/hotspots')}?${params.toString()}`, 50000);
  const payload = parsePayload(body);
  cache.set(key, { at: Date.now(), payload });
  return payload;
}
