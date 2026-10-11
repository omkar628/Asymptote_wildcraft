import { StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing, typography } from '@/theme';

type ConnectionStatusChipProps = {
  label: string;
  hint: string;
};

export function ConnectionStatusChip({ label, hint }: ConnectionStatusChipProps) {
  return (
    <View
      accessibilityLabel={`${label}. ${hint}`}
      accessibilityRole="text"
      style={styles.chip}
    >
      <View style={styles.dot} />
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.chip,
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 32,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  dot: {
    backgroundColor: colors.warningAmber,
    borderRadius: radii.marker,
    height: 8,
    width: 8,
  },
  label: {
    ...typography.meta,
    color: colors.forest900,
  },
});
