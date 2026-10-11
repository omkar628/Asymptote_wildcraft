import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppHeader } from '@/components/AppHeader';
import { Icon } from '@/components/Icon';
import { ScreenFrame } from '@/components/ScreenFrame';
import { SecondaryButton } from '@/components/SecondaryButton';
import { getAlertById, getSensorById } from '@/features/catalog/sensorCatalog';
import { colors, iconSize, spacing, typography } from '@/theme';
import { formatCoordinate, formatSampleTime } from '@/utils/formatSampleTime';
import { oneParam } from '@/utils/routeParams';

export function AlertDetailScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const alert = getAlertById(oneParam(params.id) ?? '');
  const sensor = alert ? getSensorById(alert.nodeId) : null;

  if (!alert) {
    return (
      <ScreenFrame header={<AppHeader onBack={() => router.back()} title="Alert" />}>
        <View style={styles.missing}>
          <Text style={styles.missingTitle}>Not in catalog</Text>
          <SecondaryButton label="Go back" onPress={() => router.back()} />
        </View>
      </ScreenFrame>
    );
  }

  const critical = alert.severity === 'critical';

  return (
    <ScreenFrame
      header={<AppHeader onBack={() => router.back()} subtitle="Demonstration" title={critical ? 'Critical' : 'Warning'} />}
    >
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: spacing.xl + insets.bottom }]}>
        <View style={styles.identity}>
          <Icon
            color={critical ? colors.alertRed : colors.warningAmber}
            name={critical ? 'flame' : 'alert'}
            size={28}
          />
          <View style={styles.copy}>
            <Text style={styles.name}>{sensor?.name ?? 'Missing sensor'}</Text>
            <Text style={styles.meta}>{formatSampleTime(alert.observedAt)}</Text>
          </View>
          <View style={[styles.chip, critical ? styles.chipCritical : styles.chipWarning]}>
            <Text style={[styles.chipText, critical ? styles.textCritical : styles.textWarning]}>Demo</Text>
          </View>
        </View>

        <View style={styles.facts}>
          <Fact label="Sensor" value={(sensor?.id ?? alert.nodeId).replace('MOCK-', '')} />
          <Fact
            label="Position"
            value={sensor ? formatCoordinate(sensor.latitude, sensor.longitude) : 'No coordinates stored'}
          />
          <Fact label="Marker" value={alert.incidentType} />
        </View>
        <Text style={styles.note}>{alert.summary}</Text>
        <Text style={styles.note}>No status actions</Text>

        {sensor ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              router.push({ pathname: '/sensor/[id]', params: { id: sensor.id } });
            }}
            style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
          >
            <Text style={styles.primaryLabel}>Open sensor</Text>
          </Pressable>
        ) : null}
        {sensor ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              router.push({ pathname: '/map', params: { sensor: sensor.id } });
            }}
            style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
          >
            <Icon color={colors.accentLime} name="map" size={iconSize.sm} />
            <Text style={styles.secondaryLabel}>View on map</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </ScreenFrame>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.md,
    padding: spacing.screen,
  },
  missing: {
    gap: spacing.md,
    padding: spacing.screen,
  },
  missingTitle: {
    ...typography.sectionTitle,
    color: colors.neutral950,
  },
  identity: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  copy: {
    flex: 1,
  },
  name: {
    ...typography.sectionTitle,
    color: colors.neutral950,
  },
  meta: {
    color: colors.neutral700,
    fontSize: 13,
  },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 10,
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
  facts: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.md,
  },
  fact: {
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    minHeight: 36,
  },
  factLabel: {
    color: colors.neutral700,
    fontSize: 13,
  },
  factValue: {
    ...typography.bodyStrong,
    color: colors.neutral950,
    flexShrink: 1,
    textAlign: 'right',
  },
  note: {
    color: colors.neutral700,
    fontSize: 13,
  },
  primary: {
    alignItems: 'center',
    backgroundColor: colors.accentLime,
    borderRadius: 12,
    justifyContent: 'center',
    minHeight: 52,
  },
  primaryLabel: {
    color: colors.deepGreen,
    fontSize: 16,
    fontWeight: '700',
  },
  secondary: {
    alignItems: 'center',
    backgroundColor: colors.forest900,
    borderRadius: 12,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 52,
  },
  secondaryLabel: {
    color: colors.accentLime,
    fontSize: 16,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.78,
  },
});
