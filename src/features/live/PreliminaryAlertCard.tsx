import { StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { colors, iconSize, radii, spacing, typography } from '@/theme';
import type { LaptopThresholds, PreliminaryAlert } from '@/types/liveSensor';

type PreliminaryAlertCardProps = {
  alerts: readonly PreliminaryAlert[];
  laptopThresholds: LaptopThresholds | null;
};

function laptopSummary(thresholds: LaptopThresholds | null): string {
  if (!thresholds) {
    return 'Laptop thresholds: waiting for status.';
  }
  const parts: string[] = [];
  if (thresholds.temp_c_high != null) {
    parts.push(`Temperature ≥ ${thresholds.temp_c_high} °C`);
  }
  if (thresholds.humidity_percent_low != null) {
    parts.push(`Humidity ≤ ${thresholds.humidity_percent_low}%`);
  }
  if (thresholds.mq135_raw_high != null) {
    parts.push(`MQ135 raw ≥ ${thresholds.mq135_raw_high}`);
  }
  if (thresholds.mq9_raw_high != null) {
    parts.push(`MQ9 raw ≥ ${thresholds.mq9_raw_high}`);
  }
  if (thresholds.rssi_dbm_low != null) {
    parts.push(`RSSI ≤ ${thresholds.rssi_dbm_low} dBm`);
  }
  if (parts.length === 0) {
    return 'No laptop thresholds configured.';
  }
  return `Laptop thresholds: ${parts.join(' · ')}`;
}

export function PreliminaryAlertCard({ alerts, laptopThresholds }: PreliminaryAlertCardProps) {
  const active = alerts.length > 0;

  return (
    <View style={[styles.card, active ? styles.active : styles.quiet]}>
      <View style={styles.titleRow}>
        <Icon color={active ? colors.warningAmber : colors.forest700} name="alert" size={iconSize.md} />
        <Text style={styles.title}>Preliminary sensor alerts</Text>
      </View>
      <Text style={styles.body}>
        {active
          ? 'A configured threshold is met. This is not a confirmed fire and it is not an AI detection.'
          : 'No threshold is currently met. MQ135 and MQ9 raw values alone do not show that a fire is present.'}
      </Text>
      {alerts.map((alert) => (
        <View key={`${alert.scope}-${alert.id}`} style={styles.alert}>
          <Text style={styles.alertTitle}>
            {alert.title}
            {alert.scope === 'phone' ? ' · this phone' : ' · laptop'}
          </Text>
          <Text style={styles.body}>{alert.detail}</Text>
        </View>
      ))}
      <Text style={styles.meta}>{laptopSummary(laptopThresholds)}</Text>
      <Text style={styles.meta}>
        These notices stay separate from verified incidents. A validated model can be added later without treating raw gas readings as proof of fire.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.card,
    gap: spacing.sm,
    padding: spacing.md,
  },
  quiet: {
    backgroundColor: colors.surface,
  },
  active: {
    backgroundColor: colors.warningSurface,
    borderLeftColor: colors.warningAmber,
    borderLeftWidth: 4,
  },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  title: {
    ...typography.sectionTitle,
    color: colors.neutral950,
    flex: 1,
  },
  body: {
    ...typography.body,
    color: colors.neutral950,
  },
  alert: {
    gap: spacing.xs,
  },
  alertTitle: {
    ...typography.bodyStrong,
    color: colors.warningText,
  },
  meta: {
    ...typography.meta,
    color: colors.neutral700,
    fontWeight: '400',
  },
});
