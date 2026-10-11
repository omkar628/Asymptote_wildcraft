import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '@/theme';

type MetricReadoutProps = {
  label: string;
  unit: string;
  value: number | null;
  compact?: boolean;
};

export function MetricReadout({ label, unit, value, compact = false }: MetricReadoutProps) {
  const missing = value == null;
  const unitText = unit ? ` ${unit}` : '';

  return (
    <View
      accessibilityLabel={missing ? `${label} not reported` : `${label} ${value}${unitText}`}
      style={styles.box}
    >
      <Text style={styles.value}>{missing ? '—' : String(value)}</Text>
      <Text style={styles.label}>
        {label}
        {unit ? ` ${unit}` : ''}
      </Text>
      {compact ? null : (
        <Text style={styles.state}>{missing ? 'Not reported' : 'Recorded'}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  value: {
    ...typography.metric,
    color: colors.neutral950,
    fontVariant: ['tabular-nums'],
  },
  label: {
    ...typography.meta,
    color: colors.neutral950,
  },
  state: {
    ...typography.meta,
    color: colors.neutral700,
    fontWeight: '400',
  },
});
