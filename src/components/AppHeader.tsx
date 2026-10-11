import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { colors, iconSize, minTouchTarget, spacing, typography } from '@/theme';

type AppHeaderProps = {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  statusLabel?: string;
  statusHint?: string;
};

export function AppHeader({ title, subtitle, onBack, statusLabel, statusHint }: AppHeaderProps) {
  return (
    <View style={styles.row}>
      {onBack ? (
        <Pressable
          accessibilityLabel="Go back"
          accessibilityRole="button"
          onPress={onBack}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
        >
          <Icon color={colors.forest900} name="back" size={iconSize.md} />
        </Pressable>
      ) : (
        <View style={styles.mark}>
          <Icon color={colors.forest900} name="trees" size={iconSize.sm} />
        </View>
      )}
      <View style={styles.copy}>
        <Text accessibilityRole="header" maxFontSizeMultiplier={1.3} numberOfLines={1} style={styles.title}>
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} style={styles.subtitle}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {statusLabel ? (
        <View accessibilityLabel={statusHint ?? statusLabel} style={styles.chip}>
          <Text style={styles.chipText}>{statusLabel}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    backgroundColor: colors.canvas,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 52,
    paddingHorizontal: spacing.screen,
    paddingBottom: spacing.sm,
  },
  back: {
    alignItems: 'center',
    height: minTouchTarget,
    justifyContent: 'center',
    width: minTouchTarget,
  },
  pressed: {
    opacity: 0.7,
  },
  mark: {
    alignItems: 'center',
    backgroundColor: colors.limeTint,
    borderRadius: 8,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  copy: {
    flex: 1,
  },
  title: {
    ...typography.sectionTitle,
    color: colors.neutral950,
  },
  subtitle: {
    ...typography.meta,
    color: colors.neutral700,
    fontWeight: '400',
  },
  chip: {
    backgroundColor: colors.limeTint,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  chipText: {
    color: colors.deepGreen,
    fontSize: 12,
    fontWeight: '700',
  },
});

