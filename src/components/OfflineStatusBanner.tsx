import { StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing, typography } from '@/theme';

type OfflineStatusBannerProps = {
  title: string;
  message: string;
};

export function OfflineStatusBanner({ title, message }: OfflineStatusBannerProps) {
  return (
    <View accessibilityRole="summary" style={styles.banner}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningAmber,
    borderRadius: radii.card,
    borderWidth: 1,
    gap: spacing.xs,
    marginHorizontal: spacing.screen,
    marginTop: spacing.md,
    paddingHorizontal: spacing.screen,
    paddingVertical: spacing.md,
  },
  title: {
    ...typography.bodyStrong,
    color: colors.warningText,
  },
  message: {
    ...typography.meta,
    color: colors.neutral950,
    fontWeight: '400',
  },
});
