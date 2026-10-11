import { HISTORY_MEMORY_CAP } from '@/services/sensors/sensorConfig';
import type { SensorReading } from '@/types/liveSensor';

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

export function newerReading(current: SensorReading | null, incoming: SensorReading | null): SensorReading | null {
  if (!incoming) {
    return current;
  }
  if (!current) {
    return incoming;
  }
  return current.timestamp > incoming.timestamp ? current : incoming;
}
