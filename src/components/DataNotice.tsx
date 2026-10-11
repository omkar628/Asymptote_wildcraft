import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '@/theme';

type DataNoticeProps = {
  message: string;
};

export function DataNotice({ message }: DataNoticeProps) {
  return (
    <View accessibilityRole="summary" style={styles.notice}>
      <Text style={styles.message}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    backgroundColor: colors.warningSurface,
    borderBottomColor: colors.warningAmber,
    borderBottomWidth: 1,
    paddingHorizontal: spacing.screen,
    paddingVertical: spacing.sm,
  },
  message: {
    ...typography.meta,
    color: colors.neutral950,
    fontWeight: '400',
  },
});
