import { StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing, typography } from '@/theme';
import type { FireRiskAssessment, FireRiskLevel } from '@/services/sensors/fireRisk';

const levels: readonly FireRiskLevel[] = ['Low', 'Moderate', 'High', 'Critical'];

const tone: Record<FireRiskLevel, { color: string; surface: string }> = {
  Low: { color: colors.successGreen, surface: colors.successSurface },
  Moderate: { color: colors.warningAmber, surface: colors.warningSurface },
  High: { color: colors.alertRed, surface: colors.alertSurface },
  Critical: { color: colors.alertRed, surface: colors.alertSurface },
};

type FireRiskCardProps = {
  assessment: FireRiskAssessment;
};

export function FireRiskCard({ assessment }: FireRiskCardProps) {
  const active = assessment.level;
  const palette = active ? tone[active] : { color: colors.neutral700, surface: colors.surfaceSecondary };

  return (
    <View
      accessibilityLabel={
        active
          ? `Fire risk ${active}. ${assessment.reasons.join(' ')} ${assessment.disclaimer}`
          : `Fire risk unavailable. ${assessment.reasons.join(' ')}`
      }
      accessibilityRole="summary"
      style={[styles.card, { backgroundColor: palette.surface }]}
    >
      <Text style={styles.kicker}>Fire risk · preliminary</Text>
      <Text style={[styles.level, { color: palette.color }]}>{active ?? 'Unavailable'}</Text>
      <View style={styles.track}>
        {levels.map((level, index) => {
          const selected = active != null && index <= levels.indexOf(active);
          return (
            <View key={level} style={styles.segmentWrap}>
              <View
                style={[
                  styles.segment,
                  { backgroundColor: selected ? tone[level].color : colors.neutral300 },
                ]}
              />
              <Text style={[styles.segmentLabel, selected && { color: tone[level].color }]}>{level}</Text>
            </View>
          );
        })}
      </View>
      {assessment.reasons.map((reason) => (
        <Text key={reason} style={styles.reason}>
          {reason}
        </Text>
      ))}
      <Text style={styles.disclaimer}>{assessment.disclaimer}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.card,
    gap: spacing.xs,
    padding: spacing.md,
  },
  kicker: {
    ...typography.meta,
    color: colors.neutral700,
    fontWeight: '700',
  },
  level: {
    fontSize: 28,
    fontWeight: '700',
    lineHeight: 34,
  },
  track: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  segmentWrap: {
    flex: 1,
    gap: 4,
  },
  segment: {
    borderRadius: 999,
    height: 8,
  },
  segmentLabel: {
    color: colors.neutral700,
    fontSize: 11,
    fontWeight: '700',
  },
  reason: {
    ...typography.meta,
    color: colors.neutral950,
    fontWeight: '400',
  },
  disclaimer: {
    ...typography.meta,
    color: colors.neutral700,
    fontWeight: '400',
  },
});
