import type { SensorReading } from '../../shared/types';

export const HISTORY_MEMORY_CAP = 180;

export function sameReading(left: SensorReading, right: SensorReading): boolean {
  return (
    left.timestamp === right.timestamp &&
    left.temp_c === right.temp_c &&
    left.humidity_percent === right.humidity_percent &&
    left.mq135_raw === right.mq135_raw &&
    left.mq9_raw === right.mq9_raw &&
    left.rssi_dbm === right.rssi_dbm
  );
}

export function capReadings(readings: readonly SensorReading[]): SensorReading[] {
  if (readings.length <= HISTORY_MEMORY_CAP) {
    return [...readings];
  }
  return readings.slice(readings.length - HISTORY_MEMORY_CAP);
}

export function appendReading(current: readonly SensorReading[], reading: SensorReading): SensorReading[] {
  if (current.some((item) => sameReading(item, reading))) {
    return [...current];
  }
  return capReadings([...current, reading]);
}

export function replaceWithFetched(
  fetched: readonly SensorReading[],
  live: readonly SensorReading[],
): SensorReading[] {
  const merged = [...fetched];
  for (const row of live) {
    if (!merged.some((item) => sameReading(item, row))) {
      merged.push(row);
    }
  }
  merged.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  return capReadings(merged);
}

export function acceptPolledLatest(
  current: SensorReading | null,
  receivedAtMs: number | null,
  reading: SensorReading | null,
  requestStartedAtMs: number,
): { reading: SensorReading | null; receivedAtMs: number | null; changed: boolean } {
  if (!reading) {
    return { reading: current, receivedAtMs, changed: false };
  }
  if (receivedAtMs != null && receivedAtMs >= requestStartedAtMs) {
    return { reading: current, receivedAtMs, changed: false };
  }
  if (current && reading.timestamp <= current.timestamp) {
    return { reading: current, receivedAtMs, changed: false };
  }
  return { reading, receivedAtMs: Date.now(), changed: true };
}
