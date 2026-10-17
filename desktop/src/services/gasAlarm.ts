import type { GasAlarm, GasReadingStatus, GasSensorName } from '../../shared/types';

/** Raw MQ9 / MQ135 alarm from the sensor backend. The desktop does not open COM6. */

export const GAS_THRESHOLD = 750;

function finiteRaw(value: number | null): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Both sensors must be strictly above 750. Missing values are not treated as zero. */
export function gasAlarmTriggered(mq135Value: number | null, mq9Value: number | null): boolean {
  if (!finiteRaw(mq135Value) || !finiteRaw(mq9Value)) {
    return false;
  }
  const mq135High = mq135Value > GAS_THRESHOLD;
  const mq9High = mq9Value > GAS_THRESHOLD;
  const alarmTriggered = mq135High && mq9High;
  return alarmTriggered;
}

export type { GasAlarm, GasAlarmState, GasReadingStatus, GasSensorName } from '../../shared/types';

const GAS_ALARM_STATES = [
  'NORMAL',
  'ALARM_ACTIVE',
  'ACKNOWLEDGED',
  'SENSOR_DATA_STALE',
  'INCOMPLETE',
] as const;

const STATES = new Set<string>(GAS_ALARM_STATES);
const READING_STATUSES = new Set<string>(['valid', 'incomplete', 'stale', 'missing']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function rawOrNull(value: unknown): number | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return undefined;
}

function textOrNull(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  return undefined;
}

export function parseGasAlarm(value: unknown): GasAlarm | null {
  if (!isRecord(value) || typeof value.state !== 'string' || !STATES.has(value.state)) {
    return null;
  }
  if (typeof value.activation_threshold !== 'number' || !Number.isFinite(value.activation_threshold)) {
    return null;
  }
  if (typeof value.recovery_threshold !== 'number' || !Number.isFinite(value.recovery_threshold)) {
    return null;
  }
  if (value.units !== 'raw') {
    return null;
  }
  const mq9 = rawOrNull(value.mq9_raw);
  const mq135 = rawOrNull(value.mq135_raw);
  if (mq9 === undefined || mq135 === undefined) {
    return null;
  }
  if (typeof value.mq9_above !== 'boolean' || typeof value.mq135_above !== 'boolean') {
    return null;
  }
  if (!Array.isArray(value.triggered_sensors)) {
    return null;
  }
  const triggered: GasSensorName[] = [];
  for (const name of value.triggered_sensors) {
    if (name !== 'mq9' && name !== 'mq135') {
      return null;
    }
    triggered.push(name);
  }
  const eventId = textOrNull(value.event_id);
  const startedAt = textOrNull(value.started_at);
  const acknowledgedAt = textOrNull(value.acknowledged_at);
  if (eventId === undefined || startedAt === undefined || acknowledgedAt === undefined) {
    return null;
  }
  if (typeof value.reading_status !== 'string' || !READING_STATUSES.has(value.reading_status)) {
    return null;
  }
  if (typeof value.safe_to_treat_as_normal !== 'boolean' || typeof value.detail !== 'string') {
    return null;
  }
  if (typeof value.link_down !== 'boolean') {
    return null;
  }
  return {
    state: value.state as GasAlarm['state'],
    activation_threshold: value.activation_threshold,
    recovery_threshold: value.recovery_threshold,
    units: 'raw',
    mq9_raw: mq9,
    mq135_raw: mq135,
    mq9_above: value.mq9_above,
    mq135_above: value.mq135_above,
    triggered_sensors: triggered,
    event_id: eventId,
    started_at: startedAt,
    acknowledged_at: acknowledgedAt,
    reading_status: value.reading_status as GasReadingStatus,
    safe_to_treat_as_normal: value.safe_to_treat_as_normal,
    detail: value.detail,
    link_down: value.link_down,
  };
}

export function readGasAlarmField(record: Record<string, unknown>): GasAlarm | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(record, 'gas_alarm')) {
    return undefined;
  }
  if (record.gas_alarm == null) {
    return null;
  }
  return parseGasAlarm(record.gas_alarm);
}

export function shouldStartGasCue(announcedEventId: string | null, alarm: GasAlarm | null): string | null {
  if (!alarm || alarm.state !== 'ALARM_ACTIVE' || !alarm.event_id) {
    return null;
  }
  if (alarm.reading_status !== 'valid') {
    return null;
  }
  if (!gasAlarmTriggered(alarm.mq135_raw, alarm.mq9_raw)) {
    return null;
  }
  if (alarm.event_id === announcedEventId) {
    return null;
  }
  return alarm.event_id;
}
