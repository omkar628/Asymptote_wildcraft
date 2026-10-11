import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppHeader } from '@/components/AppHeader';
import { Icon } from '@/components/Icon';
import { ScreenFrame } from '@/components/ScreenFrame';
import { useTabBarInset } from '@/components/useTabBarInset';
import { getSensorById, getSensorCatalog } from '@/features/catalog/sensorCatalog';
import { colors, iconSize, spacing, typography } from '@/theme';
import { formatSampleTime } from '@/utils/formatSampleTime';

export function AlertsScreen() {
  const bottomInset = useTabBarInset();
  const catalog = getSensorCatalog();

  return (
    <ScreenFrame
      header={
        <AppHeader
          statusHint={catalog.overview.snapshot.connectionHint}
          statusLabel="Demo"
          title="Alerts"
        />
      }
    >
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomInset }]}>
        <Text style={styles.count}>
          {catalog.alerts.length}
          <Text style={styles.countLabel}> on file</Text>
        </Text>
        {catalog.alerts.length === 0 ? (
          <Text style={styles.empty}>No alerts on file</Text>
        ) : (
          <View style={styles.list}>
            {catalog.alerts.map((alert, index) => {
              const sensor = getSensorById(alert.nodeId);
              const critical = alert.severity === 'critical';
              return (
                <Pressable
                  key={alert.id}
                  accessibilityRole="button"
                  onPress={() => {
                    router.push({ pathname: '/alert/[id]', params: { id: alert.id } });
                  }}
                  style={({ pressed }) => [
                    styles.row,
                    index > 0 && styles.rowBorder,
                    pressed && styles.pressed,
                  ]}
                >
                  <Icon
                    color={critical ? colors.alertRed : colors.warningAmber}
                    name={critical ? 'flame' : 'alert'}
                    size={iconSize.md}
                  />
                  <View style={styles.copy}>
                    <Text numberOfLines={1} style={styles.title}>
                      {sensor?.name ?? alert.nodeId}
                    </Text>
                    <Text numberOfLines={1} style={styles.meta}>
                      {(sensor?.id ?? alert.nodeId).replace('MOCK-', '')} ·{' '}
                      {formatSampleTime(alert.observedAt)}
                    </Text>
                  </View>
                  <View style={[styles.chip, critical ? styles.chipCritical : styles.chipWarning]}>
                    <Text style={[styles.chipText, critical ? styles.textCritical : styles.textWarning]}>
                      {critical ? 'Critical' : 'Warning'}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.md,
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.sm,
  },
  count: {
    ...typography.value,
    color: colors.neutral950,
    fontVariant: ['tabular-nums'],
  },
  countLabel: {
    ...typography.meta,
    color: colors.neutral700,
    fontWeight: '500',
  },
  empty: {
    ...typography.bodyStrong,
    color: colors.neutral700,
  },
  list: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    overflow: 'hidden',
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 72,
    paddingHorizontal: spacing.md,
  },
  rowBorder: {
    borderTopColor: colors.neutral300,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  copy: {
    flex: 1,
  },
  title: {
    ...typography.bodyStrong,
    color: colors.neutral950,
  },
  meta: {
    color: colors.neutral700,
    fontSize: 12,
  },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  chipCritical: {
    backgroundColor: colors.alertSurface,
  },
  chipWarning: {
    backgroundColor: colors.warningSurface,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  textCritical: {
    color: colors.alertRed,
  },
  textWarning: {
    color: colors.warningText,
  },
  pressed: {
    opacity: 0.75,
  },
});
