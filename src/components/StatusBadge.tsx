import { StyleSheet, Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/Icon';
import { colors, iconSize, radii, spacing, typography, type BadgeTone } from '@/theme';

type StatusBadgeProps = {
  label: string;
  tone: BadgeTone;
};

const toneStyles: Record<BadgeTone, { backgroundColor: string; color: string; icon: IconName }> = {
  success: { backgroundColor: colors.successSurface, color: colors.successGreen, icon: 'activity' },
  warning: { backgroundColor: colors.warningSurface, color: colors.warningText, icon: 'alert' },
  alert: { backgroundColor: colors.alertSurface, color: colors.alertRed, icon: 'flame' },
  info: { backgroundColor: colors.infoSurface, color: colors.infoBlue, icon: 'info' },
  offline: { backgroundColor: colors.offlineSurface, color: colors.offline, icon: 'offline' },
  neutral: { backgroundColor: colors.surfaceSecondary, color: colors.neutral700, icon: 'unknown' },
};

export function StatusBadge({ label, tone }: StatusBadgeProps) {
  const toneStyle = toneStyles[tone];

  return (
    <View
      accessibilityLabel={label}
      style={[styles.badge, { backgroundColor: toneStyle.backgroundColor }]}
    >
      <Icon color={toneStyle.color} name={toneStyle.icon} size={iconSize.sm} />
      <Text style={[styles.label, { color: toneStyle.color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: radii.chip,
    flexDirection: 'row',
    gap: 4,
    minHeight: 28,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  label: {
    ...typography.meta,
    flexShrink: 1,
  },
});
