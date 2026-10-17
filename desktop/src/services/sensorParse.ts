import type {
  LaptopThresholds,
  PreliminaryAlert,
  SensorReading,
  SensorStatus,
  SerialLinkState,
  SerialStatus,
} from '../../shared/types';
import { readGasAlarmField, type GasAlarm } from './gasAlarm';

const SERIAL_STATES = new Set<SerialLinkState>([
  'connecting',
  'connected',
  'reconnecting',
  'disconnected',
  'disabled',
  'unknown',
]);

const ALERT_SOURCES = new Set(['threshold', 'model', 'external']);

export class SensorApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SensorApiError';
  }
}

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
  if (typeof value.source !== 'string' || !ALERT_SOURCES.has(value.source)) {
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
    source: value.source as PreliminaryAlert['source'],
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

export function parseLatest(value: unknown): SensorReading | null | undefined {
  if (!isRecord(value) || typeof value.empty !== 'boolean') {
    return undefined;
  }
  if (value.reading === null) {
    return value.empty ? null : undefined;
  }
  const reading = parseReading(value.reading);
  if (!reading || value.empty) {
    return undefined;
  }
  return reading;
}

export function parseHistory(value: unknown): SensorReading[] | null {
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
  return readings;
}

export function parseStatus(value: unknown): SensorStatus | null {
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
    gasAlarm: readGasAlarmField(value),
  };
}

export type SensorSocketMessage =
  | {
      type: 'snapshot';
      latest: SensorReading | null;
      serial: SerialStatus;
      preliminaryAlerts: PreliminaryAlert[];
      gasAlarm: GasAlarm | null | undefined;
    }
  | {
      type: 'reading';
      reading: SensorReading;
      preliminaryAlerts: PreliminaryAlert[];
      gasAlarm: GasAlarm | null | undefined;
    }
  | { type: 'gas_alarm'; gasAlarm: GasAlarm }
  | { type: 'status'; serial: SerialStatus; gasAlarm: GasAlarm | null | undefined }
  | { type: 'ignore' };

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
    return { type: 'ignore' };
  }
  if (value.type === 'snapshot') {
    const serial = parseSerialStatus(value.serial);
    const preliminaryAlerts = parseAlerts(value.preliminary_alerts);
    if (!serial || !preliminaryAlerts || value.synthetic === true) {
      return null;
    }
    const gasAlarm = readGasAlarmField(value);
    if (value.latest === null) {
      return { type: 'snapshot', latest: null, serial, preliminaryAlerts, gasAlarm };
    }
    const latest = parseReading(value.latest);
    if (!latest) {
      return null;
    }
    return { type: 'snapshot', latest, serial, preliminaryAlerts, gasAlarm };
  }
  if (value.type === 'gas_alarm') {
    const gasAlarm = readGasAlarmField(value);
    if (!gasAlarm) {
      return null;
    }
    return { type: 'gas_alarm', gasAlarm };
  }
  if (value.type === 'reading') {
    const reading = parseReading(value.reading);
    const preliminaryAlerts = parseAlerts(value.preliminary_alerts);
    if (!reading || !preliminaryAlerts || value.synthetic === true) {
      return null;
    }
    return { type: 'reading', reading, preliminaryAlerts, gasAlarm: readGasAlarmField(value) };
  }
  if (value.type === 'status') {
    const serial = parseSerialStatus(value.serial);
    if (!serial) {
      return null;
    }
    return { type: 'status', serial, gasAlarm: readGasAlarmField(value) };
  }
  return null;
}
