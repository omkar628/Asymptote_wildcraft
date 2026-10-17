import type { GasAlarm } from '../../shared/types';
import { GAS_THRESHOLD, gasAlarmTriggered } from '../services/gasAlarm';
import { formatPacketTime, formatRaw } from '../services/format';

type GasAlarmBannerProps = {
  alarm: GasAlarm | null;
  ackError: string | null;
  onAcknowledge: () => void;
};

function rawText(value: number | null): string {
  return value == null ? '—' : formatRaw(value);
}

function stateLabel(alarm: GasAlarm | null, bothHigh: boolean): string {
  if (!alarm) {
    return 'Gas alarm status not reported';
  }
  if (alarm.state === 'SENSOR_DATA_STALE') {
    return 'Sensor data stale';
  }
  if (alarm.state === 'INCOMPLETE' || alarm.reading_status === 'missing') {
    return 'Incomplete sensor data';
  }
  if (bothHigh && alarm.state === 'ALARM_ACTIVE') {
    return `BOTH GAS SENSORS ABOVE ${GAS_THRESHOLD}`;
  }
  if (bothHigh && alarm.state === 'ACKNOWLEDGED') {
    return `Acknowledged. BOTH GAS SENSORS ABOVE ${GAS_THRESHOLD}`;
  }
  if (alarm.state === 'ACKNOWLEDGED') {
    return 'Acknowledged, reading still high';
  }
  return 'Below the combined gas threshold';
}

function triggeredText(alarm: GasAlarm): string {
  if (alarm.triggered_sensors.length === 0) {
    return 'None';
  }
  return alarm.triggered_sensors
    .map((name) => `${name === 'mq9' ? 'MQ9' : 'MQ135'} raw ${rawText(name === 'mq9' ? alarm.mq9_raw : alarm.mq135_raw)}`)
    .join(' and ');
}

export function GasAlarmBanner({ alarm, ackError, onAcknowledge }: GasAlarmBannerProps) {
  const bothHigh = Boolean(
    alarm && alarm.reading_status === 'valid' && gasAlarmTriggered(alarm.mq135_raw, alarm.mq9_raw),
  );
  const active = Boolean(alarm?.state === 'ALARM_ACTIVE' && bothHigh);
  const tone = active ? 'alarm' : alarm?.state === 'NORMAL' ? 'info' : 'warn';
  const canAcknowledge = Boolean(
    alarm &&
      alarm.event_id &&
      !alarm.acknowledged_at &&
      (alarm.state === 'ALARM_ACTIVE' || alarm.state === 'SENSOR_DATA_STALE'),
  );

  return (
    <section className={`banner ${tone}`} role={active ? 'alert' : 'status'}>
      <strong>{stateLabel(alarm, bothHigh)}</strong>
      <p>MQ135 raw {alarm ? rawText(alarm.mq135_raw) : '—'} · MQ9 raw {alarm ? rawText(alarm.mq9_raw) : '—'}</p>
      <p>Threshold {GAS_THRESHOLD} raw, both sensors</p>
      <p className="muted">
        The alarm starts only when MQ135 and MQ9 are both strictly above {GAS_THRESHOLD} at the same time.
        Exactly {GAS_THRESHOLD} does not count. One high sensor does not start the alarm. It ends when both
        readings are present and at least one is at or below {GAS_THRESHOLD}. Missing or stale readings are
        not treated as zero and are not proof the environment is safe. These are raw sensor units, not ppm.
      </p>
      <p>Triggered: {alarm ? triggeredText(alarm) : '—'}</p>
      <p>Began: {alarm?.started_at ? formatPacketTime(alarm.started_at) : '—'}</p>
      <p>
        {alarm
          ? alarm.detail
          : 'The sensor backend has not reported gas-alarm status. Missing status is not a normal condition.'}
      </p>
      {canAcknowledge ? (
        <button className="button" type="button" onClick={onAcknowledge}>
          Acknowledge Alarm
        </button>
      ) : null}
      {ackError ? <p>{ackError}</p> : null}
    </section>
  );
}
