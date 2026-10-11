import type { DashboardLinkState, SocketPhase } from '@/types/liveSensor';

export const HISTORY_LIMIT = 120;
export const HISTORY_MEMORY_CAP = 180;
export const STATUS_POLL_MS = 5000;
/** Freshness label only. This is not a fire threshold. */
export const STALE_AFTER_MS = 60_000;
export const API_TIMEOUT_MS = 8000;
export const STORAGE_KEY_BASE = 'tadoba.sensorApiBase';
export const STORAGE_KEY_THRESHOLDS = 'tadoba.sensorPhoneThresholds';
/** Physical-phone default. A saved address in the app replaces this. */
export const DEFAULT_API_BASE = 'http://10.236.143.146:8000';

export function bundledApiBase(): string {
  const value = process.env.EXPO_PUBLIC_SENSOR_API_BASE;
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || DEFAULT_API_BASE;
}

/** localhost on a phone is the phone, so it cannot be the laptop collector. */
export function isLoopbackApiBase(base: string): boolean {
  const host = base.replace(/^https?:\/\//i, '').split('/')[0]?.split(':')[0]?.toLowerCase() ?? '';
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

/** Accept an HTTP(S) base URL, or a WebSocket URL pasted from the setup notes. */
export function normalizeApiBase(input: string): string | null {
  let trimmed = input.trim();
  if (!trimmed) {
    return null;
  }
  if (/^wss:\/\//i.test(trimmed)) {
    trimmed = `https://${trimmed.slice(6)}`;
  } else if (/^ws:\/\//i.test(trimmed)) {
    trimmed = `http://${trimmed.slice(5)}`;
  }
  trimmed = trimmed.replace(/\/ws\/sensors$/i, '').replace(/\/+$/, '');
  if (!/^https?:\/\/[^/\s]+$/i.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export function websocketUrlFromBase(base: string): string {
  if (/^https:\/\//i.test(base)) {
    return `wss://${base.slice('https://'.length)}/ws/sensors`;
  }
  if (/^http:\/\//i.test(base)) {
    return `ws://${base.slice('http://'.length)}/ws/sensors`;
  }
  return '';
}

export function dashboardLinkState(input: {
  urlReady: boolean;
  urlConfigured: boolean;
  phase: SocketPhase;
  hasReading: boolean;
}): DashboardLinkState {
  if (!input.urlReady) {
    return 'Connecting';
  }
  if (!input.urlConfigured) {
    return 'Disconnected';
  }
  if (input.phase === 'connecting') {
    return 'Connecting';
  }
  if (input.phase === 'disconnected') {
    return 'Disconnected';
  }
  if (!input.hasReading) {
    return 'No data received';
  }
  return 'Connected';
}
