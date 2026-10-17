import { HttpError, requestJson } from '../services/http';

export type RainWindow = {
  sumMm: number | null;
  start: string;
  end: string;
  days: number;
  retrievedAt: string;
  sampleLat: number;
  sampleLon: number;
  error: string | null;
};

const cache = new Map<string, { at: number; value: RainWindow }>();
const CACHE_MS = 6 * 60 * 60 * 1000;

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function loadRainWindow(lat: number, lon: number, now = new Date()): Promise<RainWindow> {
  const endDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const startDate = new Date(endDate.getTime() - 29 * 24 * 60 * 60 * 1000);
  const start = isoDate(startDate);
  const end = isoDate(endDate);
  const sampleLat = Math.round(lat * 100) / 100;
  const sampleLon = Math.round(lon * 100) / 100;
  const key = `${sampleLat},${sampleLon},${start},${end}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const params = new URLSearchParams({
    latitude: String(sampleLat),
    longitude: String(sampleLon),
    start_date: start,
    end_date: end,
    daily: 'precipitation_sum',
    timezone: 'UTC',
  });
  try {
    const body = await requestJson(`https://archive-api.open-meteo.com/v1/archive?${params.toString()}`, 20000);
    const record = typeof body === 'object' && body !== null ? (body as { daily?: { precipitation_sum?: unknown } }) : null;
    const values = record?.daily?.precipitation_sum;
    const numbers = Array.isArray(values) ? values.filter((item): item is number => typeof item === 'number' && Number.isFinite(item)) : [];
    const value: RainWindow = {
      sumMm: numbers.length > 0 ? numbers.reduce((sum, item) => sum + item, 0) : null,
      start,
      end,
      days: numbers.length,
      retrievedAt: new Date().toISOString(),
      sampleLat,
      sampleLon,
      error: numbers.length > 0 ? null : 'Open-Meteo archive did not return precipitation sums.',
    };
    cache.set(key, { at: Date.now(), value });
    return value;
  } catch (error) {
    return {
      sumMm: null,
      start,
      end,
      days: 0,
      retrievedAt: new Date().toISOString(),
      sampleLat,
      sampleLon,
      error: error instanceof HttpError ? error.message : 'Open-Meteo archive request failed.',
    };
  }
}
