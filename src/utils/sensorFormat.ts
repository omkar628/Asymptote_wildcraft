import { formatSampleTime } from '@/utils/formatSampleTime';

export function formatMeasurement(value: number, decimals: number): string {
  if (!Number.isFinite(value)) {
    return '—';
  }
  return value.toFixed(decimals);
}

export function formatRaw(value: number): string {
  if (!Number.isFinite(value)) {
    return '—';
  }
  if (Math.abs(value - Math.round(value)) < 1e-6) {
    return String(Math.round(value));
  }
  return value.toFixed(2);
}

export function formatPacketTime(iso: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/.exec(iso);
  if (!match) {
    return formatSampleTime(iso);
  }
  const zone = iso.endsWith('+05:30') ? ' IST' : '';
  return `${match[1]} ${match[2]}${zone}`;
}

/** Age of a packet since this phone accepted it, independent of the collector clock. */
export function formatElapsed(deltaMs: number): string {
  if (!Number.isFinite(deltaMs)) {
    return 'Unknown time';
  }
  if (deltaMs < 5000) {
    return 'Just now';
  }
  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours} h ago`;
}

export function formatAge(iso: string, nowMs: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) {
    return 'Unknown time';
  }
  const delta = nowMs - then;
  if (delta < 0) {
    return 'Phone clock is behind this timestamp';
  }
  if (delta >= 48 * 60 * 60 * 1000) {
    return formatPacketTime(iso);
  }
  return formatElapsed(delta);
}

export function isStale(iso: string, nowMs: number, staleAfterMs: number): boolean {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) {
    return false;
  }
  return nowMs - then > staleAfterMs;
}
