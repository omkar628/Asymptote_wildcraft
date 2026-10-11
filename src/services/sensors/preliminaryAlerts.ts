import type { PhoneThresholds, PreliminaryAlert, SensorReading } from '@/types/liveSensor';

export const emptyPhoneThresholds: PhoneThresholds = {
  tempCHigh: null,
  humidityPercentLow: null,
  mq135RawHigh: null,
  mq9RawHigh: null,
  rssiDbmLow: null,
};

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function parseStoredThresholds(raw: string | null): PhoneThresholds {
  if (!raw) {
    return emptyPhoneThresholds;
  }
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') {
      return emptyPhoneThresholds;
    }
    const record = value as Record<string, unknown>;
    return {
      tempCHigh: finiteOrNull(record.tempCHigh),
      humidityPercentLow: finiteOrNull(record.humidityPercentLow),
      mq135RawHigh: finiteOrNull(record.mq135RawHigh),
      mq9RawHigh: finiteOrNull(record.mq9RawHigh),
      rssiDbmLow: finiteOrNull(record.rssiDbmLow),
    };
  } catch {
    return emptyPhoneThresholds;
  }
}

export function serializeThresholds(thresholds: PhoneThresholds): string {
  return JSON.stringify(thresholds);
}

/** Empty input clears a rule. Any other non-numeric text is invalid. */
export function parseThresholdInput(raw: string): number | null | 'invalid' {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(trimmed)) {
    return 'invalid';
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    return 'invalid';
  }
  return value;
}

function formatThreshold(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return String(Math.round(value * 100) / 100);
}

function phoneAlert(id: string, title: string, detail: string): PreliminaryAlert {
  return {
    id,
    source: 'threshold',
    scope: 'phone',
    title,
    detail,
    severity: 'warning',
  };
}

/**
 * Phone-entered comparisons. Laptop rules arrive from the API already evaluated.
 * Neither path claims a confirmed fire.
 */
export function evaluatePhoneThresholds(
  reading: SensorReading,
  thresholds: PhoneThresholds,
): PreliminaryAlert[] {
  const alerts: PreliminaryAlert[] = [];
  if (thresholds.tempCHigh != null && reading.temp_c >= thresholds.tempCHigh) {
    alerts.push(
      phoneAlert(
        'temp_c_high',
        'Temperature threshold',
        `Temperature is at or above ${formatThreshold(thresholds.tempCHigh)} °C, the threshold entered on this phone. Preliminary sensor alert. This does not confirm a fire.`,
      ),
    );
  }
  if (thresholds.humidityPercentLow != null && reading.humidity_percent <= thresholds.humidityPercentLow) {
    alerts.push(
      phoneAlert(
        'humidity_percent_low',
        'Humidity threshold',
        `Relative humidity is at or below ${formatThreshold(thresholds.humidityPercentLow)}%, the threshold entered on this phone. Preliminary sensor alert. This does not confirm a fire.`,
      ),
    );
  }
  if (thresholds.mq135RawHigh != null && reading.mq135_raw >= thresholds.mq135RawHigh) {
    alerts.push(
      phoneAlert(
        'mq135_raw_high',
        'MQ135 raw threshold',
        `MQ135 raw reading is at or above ${formatThreshold(thresholds.mq135RawHigh)}, the threshold entered on this phone. This is a raw sensor value, not a gas concentration. Preliminary sensor alert. This does not confirm a fire.`,
      ),
    );
  }
  if (thresholds.mq9RawHigh != null && reading.mq9_raw >= thresholds.mq9RawHigh) {
    alerts.push(
      phoneAlert(
        'mq9_raw_high',
        'MQ9 raw threshold',
        `MQ9 raw reading is at or above ${formatThreshold(thresholds.mq9RawHigh)}, the threshold entered on this phone. This is a raw sensor value, not a gas concentration. Preliminary sensor alert. This does not confirm a fire.`,
      ),
    );
  }
  if (
    thresholds.rssiDbmLow != null &&
    reading.rssi_dbm != null &&
    reading.rssi_dbm <= thresholds.rssiDbmLow
  ) {
    alerts.push(
      phoneAlert(
        'rssi_dbm_low',
        'Signal threshold',
        `RSSI is at or below ${formatThreshold(thresholds.rssiDbmLow)} dBm, the threshold entered on this phone. This is a link-quality notice, not a fire alert.`,
      ),
    );
  }
  return alerts;
}
