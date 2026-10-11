import { StyleSheet, Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/Icon';
import { colors, iconSize, radii, spacing, typography } from '@/theme';

type SensorMetricCardProps = {
  icon: IconName;
  label: string;
  value: string;
  unit: string;
  note: string;
  wide?: boolean;
  compact?: boolean;
  dense?: boolean;
};

export function SensorMetricCard({
  icon,
  label,
  value,
  unit,
  note,
  wide = false,
  compact = false,
  dense = false,
}: SensorMetricCardProps) {
  return (
    <View
      accessibilityLabel={`${label} ${value} ${unit}. ${note}`}
      style={[styles.card, wide && styles.wide, dense && styles.dense]}
    >
      <View style={styles.titleRow}>
        <Icon color={colors.forest700} name={icon} size={iconSize.sm} />
        <Text style={styles.label}>{label}</Text>
      </View>
      <Text maxFontSizeMultiplier={1.4} style={[styles.value, compact && styles.compactValue]}>
        {value}
        {unit ? <Text style={styles.unit}> {unit}</Text> : null}
      </Text>
      <Text numberOfLines={2} style={styles.note}>
        {note}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    flexBasis: '47%',
    flexGrow: 1,
    gap: spacing.xs,
    minHeight: 112,
    padding: spacing.md,
  },
  wide: {
    flexBasis: '100%',
  },
  dense: {
    minHeight: 88,
    padding: spacing.sm,
  },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  label: {
    ...typography.meta,
    color: colors.neutral950,
    flex: 1,
  },
  value: {
    ...typography.value,
    color: colors.neutral950,
    fontVariant: ['tabular-nums'],
  },
  compactValue: {
    fontSize: 18,
    lineHeight: 24,
  },
  unit: {
    ...typography.meta,
    color: colors.neutral700,
  },
  note: {
    ...typography.meta,
    color: colors.neutral700,
    fontWeight: '400',
  },
});
