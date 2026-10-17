import type { GasAlarm } from '@/services/sensors/gasAlarm';

/** Live NodeMCU receiver data. This is separate from the demonstration catalog. */

export type SensorReading = {
  timestamp: string;
  temp_c: number;
  humidity_percent: number;
  mq135_raw: number;
  mq9_raw: number;
  rssi_dbm: number | null;
  source: 'serial';
};

/**
 * Later fire models or external detectors can use source "model" or "external".
 * The dashboard still labels those records as preliminary unless a separate
 * confirmed-incident flow exists.
 */
export type AlertSource = 'threshold' | 'model' | 'external';

export type PreliminaryAlert = {
  id: string;
  source: AlertSource;
  scope: 'laptop' | 'phone';
  title: string;
  detail: string;
  severity: 'warning' | 'critical';
};

export type SerialLinkState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'disabled'
  | 'unknown';

export type SerialStatus = {
  state: SerialLinkState;
  rawState: string;
  connected: boolean;
  port: string;
  baudRate: number;
  lastError: string | null;
};

export type LaptopThresholds = {
  temp_c_high: number | null;
  humidity_percent_low: number | null;
  mq135_raw_high: number | null;
  mq9_raw_high: number | null;
  rssi_dbm_low: number | null;
};

export type PhoneThresholds = {
  tempCHigh: number | null;
  humidityPercentLow: number | null;
  mq135RawHigh: number | null;
  mq9RawHigh: number | null;
  rssiDbmLow: number | null;
};

export type DashboardLinkState = 'Connected' | 'Connecting' | 'Disconnected' | 'No data received';

export type SocketPhase = 'connecting' | 'connected' | 'disconnected';

export type SensorStatusPayload = {
  api: 'running';
  serial: SerialStatus;
  latestReadingAt: string | null;
  storedReadings: number;
  thresholds: LaptopThresholds;
  preliminaryAlerts: PreliminaryAlert[];
  gasAlarm?: GasAlarm | null;
};
