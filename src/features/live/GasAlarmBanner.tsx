import { StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { GAS_THRESHOLD, gasAlarmTriggered, type GasAlarm } from '@/services/sensors/gasAlarm';
import { colors, radii, spacing, typography } from '@/theme';
import { formatPacketTime, formatRaw } from '@/utils/sensorFormat';

type GasAlarmBannerProps = {
  alarm: GasAlarm | null;
  acknowledging: boolean;
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
    .map((name) => {
      const value = name === 'mq9' ? alarm.mq9_raw : alarm.mq135_raw;
      return `${name === 'mq9' ? 'MQ9' : 'MQ135'} raw ${rawText(value)}`;
    })
    .join(' and ');
}

export function GasAlarmBanner({ alarm, acknowledging, ackError, onAcknowledge }: GasAlarmBannerProps) {
  const bothHigh = Boolean(
    alarm && alarm.reading_status === 'valid' && gasAlarmTriggered(alarm.mq135_raw, alarm.mq9_raw),
  );
  const active = Boolean(alarm?.state === 'ALARM_ACTIVE' && bothHigh);
  const canAcknowledge = Boolean(
    alarm &&
      alarm.event_id &&
      !alarm.acknowledged_at &&
      (alarm.state === 'ALARM_ACTIVE' || alarm.state === 'SENSOR_DATA_STALE'),
  );
  const tone = active ? styles.alarm : alarm?.state === 'NORMAL' ? styles.quiet : styles.warn;

  return (
    <View accessibilityLiveRegion={active ? 'assertive' : 'polite'} style={[styles.card, tone]}>
      <Text style={styles.kicker}>MQ raw alarm</Text>
      <Text style={styles.title}>{stateLabel(alarm, bothHigh)}</Text>
      <Text style={styles.row}>MQ135 raw {alarm ? rawText(alarm.mq135_raw) : '—'}</Text>
      <Text style={styles.row}>MQ9 raw {alarm ? rawText(alarm.mq9_raw) : '—'}</Text>
      <Text style={styles.row}>Threshold {GAS_THRESHOLD} raw, both sensors</Text>
      <Text style={styles.meta}>
        The alarm starts only when MQ135 and MQ9 are both strictly above {GAS_THRESHOLD} at the same time.
        Exactly {GAS_THRESHOLD} does not count. One high sensor does not start the alarm. It ends when both
        readings are present and at least one is at or below {GAS_THRESHOLD}. Missing or stale readings are
        not treated as zero and are not proof the environment is safe. These are raw sensor units, not ppm.
      </Text>
      <Text style={styles.row}>Triggered {alarm ? triggeredText(alarm) : '—'}</Text>
      <Text style={styles.row}>Began {alarm?.started_at ? formatPacketTime(alarm.started_at) : '—'}</Text>
      <Text style={styles.body}>
        {alarm
          ? alarm.detail
          : 'The sensor backend has not reported gas-alarm status. Missing status is not a normal condition.'}
      </Text>
      <Text style={styles.meta}>
        Sound and vibration run while this app is open. A closed or backgrounded app does not keep the live sensor connection.
      </Text>
      {canAcknowledge ? (
        <PrimaryButton
          accessibilityHint="Stops the sound and vibration. A reading that is still above the threshold stays high."
          label={acknowledging ? 'Acknowledging…' : 'Acknowledge Alarm'}
          onPress={acknowledging ? () => undefined : onAcknowledge}
        />
      ) : null}
      {ackError ? <Text style={styles.error}>{ackError}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.card,
    gap: spacing.xs,
    padding: spacing.md,
  },
  alarm: {
    backgroundColor: colors.alertSurface,
    borderColor: colors.alertRed,
    borderWidth: 2,
  },
  warn: {
    backgroundColor: colors.warningSurface,
  },
  quiet: {
    backgroundColor: colors.surface,
  },
  kicker: {
    ...typography.meta,
    color: colors.neutral700,
    textTransform: 'uppercase',
  },
  title: {
    ...typography.sectionTitle,
    color: colors.neutral950,
  },
  row: {
    ...typography.bodyStrong,
    color: colors.neutral950,
  },
  body: {
    ...typography.body,
    color: colors.neutral950,
  },
  meta: {
    ...typography.meta,
    color: colors.neutral700,
  },
  error: {
    ...typography.meta,
    color: colors.alertRed,
  },
});
