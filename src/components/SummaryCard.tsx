import { StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing, typography, type BadgeTone } from '@/theme';

type SummaryCardProps = {
  label: string;
  value: string;
  detail: string;
  tone: BadgeTone;
};

const accent: Record<BadgeTone, string> = {
  success: colors.successGreen,
  warning: colors.warningAmber,
  alert: colors.alertRed,
  info: colors.infoBlue,
  offline: colors.neutral700,
  neutral: colors.forest700,
};

export function SummaryCard({ label, value, detail, tone }: SummaryCardProps) {
  return (
    <View accessibilityLabel={`${label}: ${value}. ${detail}`} style={styles.card}>
      <View style={[styles.accent, { backgroundColor: accent[tone] }]} />
      <Text style={styles.value}>{value}</Text>
      <View style={styles.copy}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.detail}>{detail}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    backgroundColor: colors.canvas,
    borderColor: colors.neutral300,
    borderRadius: radii.card,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 72,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  accent: {
    borderRadius: radii.marker,
    height: 10,
    width: 10,
  },
  value: {
    ...typography.value,
    color: colors.neutral950,
    minWidth: 28,
  },
  copy: {
    flex: 1,
    gap: 2,
  },
  label: {
    ...typography.bodyStrong,
    color: colors.neutral950,
  },
  detail: {
    ...typography.meta,
    color: colors.neutral700,
    fontWeight: '400',
  },
});
