/**
 * HTTP client for the laptop sensor API.
 * The phone never opens a serial port.
 */

import { httpStatusApiMessage, timedOutApiMessage, unreachableApiMessage } from '@/services/sensors/apiBase';
import { API_TIMEOUT_MS, HISTORY_LIMIT } from '@/services/sensors/sensorConfig';
import type {
  AlertSource,
  LaptopThresholds,
  PreliminaryAlert,
  SensorReading,
  SensorStatusPayload,
  SerialLinkState,
  SerialStatus,
} from '@/types/liveSensor';

export class SensorApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SensorApiError';
  }
}

const SERIAL_STATES = new Set<SerialLinkState>([
  'connecting',
  'connected',
  'reconnecting',
  'disconnected',
  'disabled',
  'unknown',
]);

const ALERT_SOURCES = new Set<AlertSource>(['threshold', 'model', 'external']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function parseReading(value: unknown): SensorReading | null {
  if (!isRecord(value) || value.source !== 'serial') {
    return null;
  }
  if (typeof value.timestamp !== 'string' || value.timestamp.trim() === '') {
    return null;
  }
  if (
    !isFiniteNumber(value.temp_c) ||
    !isFiniteNumber(value.humidity_percent) ||
    !isFiniteNumber(value.mq135_raw) ||
    !isFiniteNumber(value.mq9_raw)
  ) {
    return null;
  }
  if (value.rssi_dbm !== null && !isFiniteNumber(value.rssi_dbm)) {
    return null;
  }
  return {
    timestamp: value.timestamp,
    temp_c: value.temp_c,
    humidity_percent: value.humidity_percent,
    mq135_raw: value.mq135_raw,
    mq9_raw: value.mq9_raw,
    rssi_dbm: value.rssi_dbm,
    source: 'serial',
  };
}

export function parseAlert(value: unknown): PreliminaryAlert | null {
  if (!isRecord(value)) {
    return null;
  }
  if (typeof value.id !== 'string' || typeof value.title !== 'string' || typeof value.detail !== 'string') {
    return null;
  }
  if (typeof value.source !== 'string' || !ALERT_SOURCES.has(value.source as AlertSource)) {
    return null;
  }
  if (value.scope !== 'laptop' && value.scope !== 'phone') {
    return null;
  }
  if (value.severity !== 'warning' && value.severity !== 'critical') {
    return null;
  }
  return {
    id: value.id,
    source: value.source as AlertSource,
    scope: value.scope,
    title: value.title,
    detail: value.detail,
    severity: value.severity,
  };
}

function parseAlerts(value: unknown): PreliminaryAlert[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const alerts: PreliminaryAlert[] = [];
  for (const item of value) {
    const alert = parseAlert(item);
    if (alert) {
      alerts.push(alert);
    }
  }
  return alerts;
}

export function parseSerialStatus(value: unknown): SerialStatus | null {
  if (!isRecord(value) || typeof value.state !== 'string') {
    return null;
  }
  if (typeof value.connected !== 'boolean' || typeof value.port !== 'string' || !isFiniteNumber(value.baud_rate)) {
    return null;
  }
  if (value.last_error !== null && typeof value.last_error !== 'string') {
    return null;
  }
  const state = SERIAL_STATES.has(value.state as SerialLinkState) ? (value.state as SerialLinkState) : 'unknown';
  return {
    state,
    rawState: value.state,
    connected: value.connected,
    port: value.port,
    baudRate: value.baud_rate,
    lastError: value.last_error,
  };
}

function parseThresholds(value: unknown): LaptopThresholds | null {
  if (!isRecord(value)) {
    return null;
  }
  const keys = [
    'temp_c_high',
    'humidity_percent_low',
    'mq135_raw_high',
    'mq9_raw_high',
    'rssi_dbm_low',
  ] as const;
  const parsed = {} as LaptopThresholds;
  for (const key of keys) {
    const item = value[key];
    if (item === null) {
      parsed[key] = null;
    } else if (isFiniteNumber(item)) {
      parsed[key] = item;
    } else {
      return null;
    }
  }
  return parsed;
}

export type LatestPayload = {
  reading: SensorReading | null;
  empty: boolean;
};

export function parseLatest(value: unknown): LatestPayload | null {
  if (!isRecord(value) || typeof value.empty !== 'boolean') {
    return null;
  }
  if (value.reading === null) {
    return value.empty ? { reading: null, empty: true } : null;
  }
  const reading = parseReading(value.reading);
  if (!reading || value.empty) {
    return null;
  }
  return { reading, empty: false };
}

export type HistoryPayload = {
  readings: SensorReading[];
  count: number;
};

export function parseHistory(value: unknown): HistoryPayload | null {
  if (!isRecord(value) || !Array.isArray(value.readings) || !isFiniteNumber(value.count)) {
    return null;
  }
  const readings: SensorReading[] = [];
  for (const item of value.readings) {
    const reading = parseReading(item);
    if (!reading) {
      return null;
    }
    readings.push(reading);
  }
  if (value.count !== readings.length) {
    return null;
  }
  return { readings, count: readings.length };
}

export function parseStatus(value: unknown): SensorStatusPayload | null {
  if (!isRecord(value) || value.api !== 'running') {
    return null;
  }
  const serial = parseSerialStatus(value.serial);
  const thresholds = parseThresholds(value.thresholds);
  const preliminaryAlerts = parseAlerts(value.preliminary_alerts);
  if (!serial || !thresholds || !preliminaryAlerts || !isFiniteNumber(value.stored_readings)) {
    return null;
  }
  if (value.latest_reading_at !== null && typeof value.latest_reading_at !== 'string') {
    return null;
  }
  return {
    api: 'running',
    serial,
    latestReadingAt: value.latest_reading_at,
    storedReadings: value.stored_readings,
    thresholds,
    preliminaryAlerts,
  };
}

export type SensorSocketMessage =
  | {
      type: 'snapshot';
      latest: SensorReading | null;
      serial: SerialStatus;
      preliminaryAlerts: PreliminaryAlert[];
      synthetic: false;
    }
  | {
      type: 'reading';
      reading: SensorReading;
      preliminaryAlerts: PreliminaryAlert[];
      alertsChanged: boolean;
      synthetic: false;
    }
  | {
      type: 'synthetic';
    }
  | {
      type: 'status';
      serial: SerialStatus;
      synthetic: boolean;
    };

export function parseSocketMessage(raw: string): SensorSocketMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value) || typeof value.type !== 'string') {
    return null;
  }
  if (value.type === 'reading' && value.synthetic === true) {
    return { type: 'synthetic' };
  }
  if (value.type === 'snapshot') {
    const serial = parseSerialStatus(value.serial);
    const preliminaryAlerts = parseAlerts(value.preliminary_alerts);
    if (!serial || !preliminaryAlerts || value.synthetic !== false) {
      return null;
    }
    if (value.latest === null) {
      return { type: 'snapshot', latest: null, serial, preliminaryAlerts, synthetic: false };
    }
    const latest = parseReading(value.latest);
    if (!latest) {
      return null;
    }
    return { type: 'snapshot', latest, serial, preliminaryAlerts, synthetic: false };
  }
  if (value.type === 'reading') {
    const reading = parseReading(value.reading);
    const preliminaryAlerts = parseAlerts(value.preliminary_alerts);
    if (
      !reading ||
      !preliminaryAlerts ||
      typeof value.alerts_changed !== 'boolean' ||
      value.synthetic !== false
    ) {
      return null;
    }
    return {
      type: 'reading',
      reading,
      preliminaryAlerts,
      alertsChanged: value.alerts_changed,
      synthetic: false,
    };
  }
  if (value.type === 'status') {
    const serial = parseSerialStatus(value.serial);
    if (!serial || typeof value.synthetic !== 'boolean') {
      return null;
    }
    return { type: 'status', serial, synthetic: value.synthetic };
  }
  return null;
}

async function requestJson(base: string, path: string): Promise<unknown> {
  const url = endpoint(base, path);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new SensorApiError(httpStatusApiMessage(base, response.status));
    }
    try {
      return await response.json();
    } catch {
      throw new SensorApiError(`The address ${base} did not return sensor data.`);
    }
  } catch (error) {
    if (error instanceof SensorApiError) {
      throw error;
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new SensorApiError(timedOutApiMessage(base));
    }
    console.warn(`[wildcraft] ${unreachableApiMessage(base)}`);
    throw new SensorApiError(unreachableApiMessage(base));
  } finally {
    clearTimeout(timer);
  }
}

function endpoint(base: string, path: string): string {
  const joiner = path.includes('?') ? '&' : '?';
  return `${base}${path}${joiner}fresh=${Date.now()}`;
}

export async function fetchLatest(base: string): Promise<LatestPayload> {
  const payload = parseLatest(await requestJson(base, '/api/sensors/latest'));
  if (!payload) {
    throw new SensorApiError('The latest-reading response was not valid.');
  }
  return payload;
}

export async function fetchHistory(base: string, limit = HISTORY_LIMIT): Promise<HistoryPayload> {
  const payload = parseHistory(
    await requestJson(base, `/api/sensors/history?limit=${encodeURIComponent(String(limit))}`),
  );
  if (!payload) {
    throw new SensorApiError('The history response was not valid.');
  }
  return payload;
}

export async function fetchStatus(base: string): Promise<SensorStatusPayload> {
  const payload = parseStatus(await requestJson(base, '/api/status'));
  if (!payload) {
    throw new SensorApiError('The status response was not valid.');
  }
  return payload;
}
