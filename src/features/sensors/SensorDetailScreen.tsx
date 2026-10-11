import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppHeader } from '@/components/AppHeader';
import { Icon } from '@/components/Icon';
import { ScreenFrame } from '@/components/ScreenFrame';
import { SecondaryButton } from '@/components/SecondaryButton';
import { StatusBadge } from '@/components/StatusBadge';
import { getAlertForSensor, getSensorById } from '@/features/catalog/sensorCatalog';
import { colors, iconSize, spacing, typography } from '@/theme';
import { nodeStatusBadge } from '@/theme/status';
import { formatCoordinate, formatSampleTime } from '@/utils/formatSampleTime';
import { oneParam } from '@/utils/routeParams';

export function SensorDetailScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const sensor = getSensorById(oneParam(params.id) ?? '');

  if (!sensor) {
    return (
      <ScreenFrame header={<AppHeader onBack={() => router.back()} title="Sensor" />}>
        <View style={styles.missing}>
          <Text style={styles.missingTitle}>Not in catalog</Text>
          <SecondaryButton label="Go back" onPress={() => router.back()} />
        </View>
      </ScreenFrame>
    );
  }

  const badge = nodeStatusBadge[sensor.communicationStatus];
  const alert = getAlertForSensor(sensor.id);
  const anyReading = [
    sensor.telemetry.temperatureC,
    sensor.telemetry.humidityPercent,
    sensor.telemetry.smokeIndex,
    sensor.telemetry.batteryPercent,
  ].some((value) => value != null);

  return (
    <ScreenFrame
      header={
        <AppHeader
          onBack={() => router.back()}
          subtitle={sensor.id.replace('MOCK-', '')}
          title={sensor.name}
        />
      }
    >
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: spacing.xl + insets.bottom }]}>
        <View style={styles.identity}>
          <StatusBadge label={badge.label} tone={badge.tone} />
          <Text style={styles.meta}>{formatSampleTime(sensor.lastHeardAt)}</Text>
        </View>

        <View style={styles.metrics}>
          <Reading icon="temperature" label="°C" value={sensor.telemetry.temperatureC} />
          <Reading icon="humidity" label="Humidity" value={sensor.telemetry.humidityPercent} />
          <Reading icon="flame" label="Smoke" value={sensor.telemetry.smokeIndex} />
          <Reading icon="battery" label="Battery" value={sensor.telemetry.batteryPercent} />
        </View>
        {anyReading ? null : <Text style={styles.note}>Not reported</Text>}

        <View style={styles.facts}>
          <Fact label="Type" value={sensor.nodeType} />
          <Fact label="Zone" value={sensor.zoneLabel} />
          <Fact label="Position" value={formatCoordinate(sensor.latitude, sensor.longitude)} />
          <Fact label="Communication" value={badge.label} />
        </View>
        <Text style={styles.note}>{sensor.statusNote}</Text>
        <Text style={styles.note}>
          {sensor.readingsHistory == null
            ? 'No history'
            : sensor.readingsHistory.length === 0
              ? 'No points'
              : `${sensor.readingsHistory.length} stored points`}
        </Text>
        {sensor.readingsHistory?.map((point) => (
          <Text key={point.at} style={styles.point}>
            {formatSampleTime(point.at)} · {point.temperatureC ?? '—'}° · {point.humidityPercent ?? '—'}%
          </Text>
        ))}

        {alert ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              router.push({ pathname: '/alert/[id]', params: { id: alert.id } });
            }}
            style={({ pressed }) => [styles.link, pressed && styles.pressed]}
          >
            <Icon
              color={alert.severity === 'critical' ? colors.alertRed : colors.warningAmber}
              name={alert.severity === 'critical' ? 'flame' : 'alert'}
              size={iconSize.md}
            />
            <Text style={styles.linkLabel}>Open demonstration alert</Text>
          </Pressable>
        ) : (
          <Text style={styles.note}>No linked alert</Text>
        )}

        <Pressable
          accessibilityRole="button"
          onPress={() => {
            router.push({ pathname: '/map', params: { sensor: sensor.id } });
          }}
          style={({ pressed }) => [styles.mapButton, pressed && styles.pressed]}
        >
          <Icon color={colors.accentLime} name="map" size={iconSize.sm} />
          <Text style={styles.mapLabel}>View on map</Text>
        </Pressable>
      </ScrollView>
    </ScreenFrame>
  );
}

function Reading({
  icon,
  label,
  value,
}: {
  icon: 'temperature' | 'humidity' | 'flame' | 'battery';
  label: string;
  value: number | null;
}) {
  return (
    <View style={styles.reading}>
      <Icon color={colors.forest700} name={icon} size={iconSize.sm} />
      <Text style={styles.readingValue}>{value == null ? '—' : value}</Text>
      <Text style={styles.readingLabel}>{label}</Text>
    </View>
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
    justifyContent: 'space-between',
  },
  meta: {
    color: colors.neutral700,
    fontSize: 13,
  },
  metrics: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: spacing.sm,
  },
  reading: {
    gap: 2,
    padding: spacing.sm,
    width: '50%',
  },
  readingValue: {
    color: colors.neutral950,
    fontSize: 22,
    fontVariant: ['tabular-nums'],
    fontWeight: '700',
  },
  readingLabel: {
    color: colors.neutral700,
    fontSize: 12,
    fontWeight: '600',
  },
  facts: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.md,
  },
  fact: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 36,
    gap: spacing.md,
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
    textTransform: 'capitalize',
  },
  note: {
    color: colors.neutral700,
    fontSize: 13,
  },
  point: {
    color: colors.neutral950,
    fontSize: 14,
    fontVariant: ['tabular-nums'],
  },
  link: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 48,
  },
  linkLabel: {
    ...typography.bodyStrong,
    color: colors.forest900,
  },
  mapButton: {
    alignItems: 'center',
    backgroundColor: colors.forest900,
    borderRadius: 12,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 52,
  },
  mapLabel: {
    color: colors.accentLime,
    fontSize: 16,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.78,
  },
});
