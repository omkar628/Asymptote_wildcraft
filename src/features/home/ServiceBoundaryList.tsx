import { StyleSheet, Text, View } from 'react-native';

import type { HomeOverview } from '@/features/home/loadHomeOverview';
import { colors, spacing, typography } from '@/theme';

type ServiceBoundaryListProps = {
  overview: HomeOverview;
};

export function ServiceBoundaryList({ overview }: ServiceBoundaryListProps) {
  const rows = [
    ['Map', overview.map.detail],
    ['Database', overview.database.detail],
    ['Sync', overview.sync.detail],
    ['GPS', overview.location.detail],
    ['Alarm', overview.alarm.detail],
  ] as const;

  return (
    <View accessibilityRole="summary" style={styles.block}>
      <Text style={styles.title}>Services not active</Text>
      {rows.map(([name, detail]) => (
        <Text key={name} style={styles.row}>
          <Text style={styles.name}>{name}. </Text>
          {detail}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  title: {
    ...typography.sectionTitle,
    color: colors.neutral950,
    fontSize: 16,
  },
  row: {
    ...typography.meta,
    color: colors.neutral700,
    fontWeight: '400',
  },
  name: {
    ...typography.meta,
    color: colors.forest900,
  },
});
