import { router } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppHeader } from '@/components/AppHeader';
import { Icon, type IconName } from '@/components/Icon';
import { ScreenFrame } from '@/components/ScreenFrame';
import { useTabBarInset } from '@/components/useTabBarInset';
import { countByStatus, getSensorCatalog } from '@/features/catalog/sensorCatalog';
import { BackendSettingsCard } from '@/features/live/BackendSettingsCard';
import { LiveConnectionStatus } from '@/features/live/LiveConnectionStatus';
import { SensorMetricCard } from '@/features/live/SensorMetricCard';
import { useLiveSensors } from '@/features/live/useLiveSensors';
import { GasAlarmBanner } from '@/features/live/GasAlarmBanner';
import { FireRiskCard } from '@/features/overview/FireRiskCard';
import { predictFireRisk } from '@/services/sensors/fireRisk';
import { colors, iconSize, spacing, typography } from '@/theme';
import { formatElapsed, formatMeasurement, formatPacketTime, formatRaw } from '@/utils/sensorFormat';
import { formatSampleTime } from '@/utils/formatSampleTime';

const mix = [
  { key: 'online' as const, label: 'Healthy', color: colors.successGreen },
  { key: 'warning' as const, label: 'Warning', color: colors.warningAmber },
  { key: 'critical' as const, label: 'Critical', color: colors.alertRed },
  { key: 'offline' as const, label: 'Offline', color: colors.offline },
  { key: 'unknown' as const, label: 'Unknown', color: colors.disabled },
];

export function OverviewScreen() {
  const bottomInset = useTabBarInset();
  const live = useLiveSensors();
  const catalog = getSensorCatalog();
  const counts = countByStatus(catalog.sensors);
  const values = {
    online: counts.healthy,
    warning: counts.warning,
    critical: counts.critical,
    offline: counts.offline,
    unknown: counts.unknown,
  };
  const total = catalog.sensors.length;
  const reading = live.latest;
  const assessment = predictFireRisk(reading, live.history);
  const receivedAge =
    live.liveReceivedAt == null ? null : formatElapsed(live.now - live.liveReceivedAt);
  const showRetry =
    Boolean(live.savedBase) && !live.loading && (live.link === 'Disconnected' || Boolean(live.errorText));
  const showSettings = !live.savedBase || live.link === 'Disconnected';
  const critical = catalog.alerts.find((alert) => alert.severity === 'critical');
  const recent = catalog.alerts.filter((alert) => alert.id !== critical?.id);
  const missing = 'No packet yet';

  return (
    <ScreenFrame
      header={
        <AppHeader
          statusHint={
            live.freshness === 'LIVE'
              ? 'Live receiver packets'
              : live.freshness === 'DISCONNECTED'
                ? 'Phone is not receiving packets'
                : live.freshness === 'STALE'
                  ? 'Packets have stopped'
                  : 'Waiting for a receiver packet'
          }
          statusLabel={live.freshness}
          title="Overview"
        />
      }
    >
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomInset }]}>
        <LiveConnectionStatus
          compact
          errorText={live.errorText}
          freshness={live.freshness}
          link={live.link}
          onRetry={showRetry ? live.retry : undefined}
          serial={live.serial}
        />
        <Text style={styles.updated}>
          {reading && receivedAge
            ? `Last packet received ${receivedAge} · packet ${formatPacketTime(reading.timestamp)}`
            : 'Last packet received: none yet'}
        </Text>
        {live.freshness === 'STALE' ? (
          <Text style={styles.stale}>STALE · no packet received for over 60 seconds.</Text>
        ) : null}
        {live.freshness === 'DISCONNECTED' ? (
          <Text style={styles.stale}>DISCONNECTED · live packets have stopped.</Text>
        ) : null}
        {showSettings ? (
          <BackendSettingsCard
            draft={live.draftUrl}
            errorText={live.urlError}
            onChangeDraft={live.setDraftUrl}
            onSave={live.saveUrl}
            savedBase={live.savedBase}
          />
        ) : null}

        <GasAlarmBanner
          ackError={live.ackError}
          acknowledging={live.acknowledging}
          alarm={live.gasAlarm}
          onAcknowledge={live.acknowledgeAlarm}
        />
        <FireRiskCard assessment={assessment} />

        <Text style={styles.section}>Receiver</Text>
        {live.loading && !reading ? (
          <View accessibilityRole="progressbar" style={styles.waiting}>
            <ActivityIndicator color={colors.forest700} />
            <Text style={styles.note}>{live.savedBase ? 'Loading receiver data' : 'Loading saved address'}</Text>
          </View>
        ) : (
          <View style={styles.grid}>
            <SensorMetricCard
              dense
              icon="temperature"
              label="Temperature"
              note={reading ? 'From the receiver' : missing}
              unit={reading ? '°C' : ''}
              value={reading ? formatMeasurement(reading.temp_c, 1) : '—'}
            />
            <SensorMetricCard
              dense
              icon="humidity"
              label="Humidity"
              note={reading ? 'Relative humidity' : missing}
              unit={reading ? '%' : ''}
              value={reading ? formatMeasurement(reading.humidity_percent, 1) : '—'}
            />
            <SensorMetricCard
              dense
              icon="activity"
              label="MQ135"
              note={reading ? 'Raw value, not ppm' : missing}
              unit={reading ? 'raw' : ''}
              value={reading ? formatRaw(reading.mq135_raw) : '—'}
            />
            <SensorMetricCard
              dense
              icon="activity"
              label="MQ9"
              note={reading ? 'Raw value, not ppm' : missing}
              unit={reading ? 'raw' : ''}
              value={reading ? formatRaw(reading.mq9_raw) : '—'}
            />
            <SensorMetricCard
              dense
              icon="signal"
              label="RSSI"
              note={
                reading == null
                  ? missing
                  : reading.rssi_dbm == null
                    ? 'Not in this packet'
                    : 'Receiver signal, dBm'
              }
              unit={reading?.rssi_dbm == null ? '' : 'dBm'}
              value={reading?.rssi_dbm == null ? '—' : formatRaw(reading.rssi_dbm)}
              wide
            />
          </View>
        )}

        <View style={styles.block}>
          <Text style={styles.section}>Forest catalog · Demo</Text>
          <View style={styles.bar}>
            {mix.map((item) =>
              values[item.key] > 0 ? (
                <View key={item.key} style={{ flex: values[item.key], backgroundColor: item.color }} />
              ) : null,
            )}
          </View>
          <View style={styles.mixRow}>
            {mix.map((item) => (
              <View
                key={item.key}
                accessibilityLabel={`${item.label} ${values[item.key]} of ${total}, demonstration catalog`}
                style={styles.mixItem}
              >
                <Text style={styles.mixValue}>{values[item.key]}</Text>
                <Text style={styles.mixLabel}>{item.label}</Text>
              </View>
            ))}
          </View>
          {critical ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                router.push({ pathname: '/alert/[id]', params: { id: critical.id } });
              }}
              style={({ pressed }) => [styles.incident, pressed && styles.pressed]}
            >
              <Icon color={colors.alertRed} name="flame" size={iconSize.sm} />
              <View style={styles.incidentCopy}>
                <Text style={styles.kicker}>Critical · Demo</Text>
                <Text numberOfLines={1} style={styles.incidentName}>
                  {catalog.sensors.find((node) => node.id === critical.nodeId)?.name ?? critical.nodeId}
                </Text>
              </View>
              <Text style={styles.time}>{formatSampleTime(critical.observedAt)}</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.sectionHead}>
          <Text style={styles.section}>Recent · Demo</Text>
          <Text style={styles.count}>{recent.length}</Text>
        </View>
        {recent.length === 0 ? (
          <Text style={styles.note}>No demonstration alerts on file</Text>
        ) : (
          recent.map((alert) => {
            const sensor = catalog.sensors.find((node) => node.id === alert.nodeId);
            const criticalAlert = alert.severity === 'critical';
            return (
              <Pressable
                key={alert.id}
                accessibilityRole="button"
                onPress={() => {
                  router.push({ pathname: '/alert/[id]', params: { id: alert.id } });
                }}
                style={({ pressed }) => [styles.event, pressed && styles.pressed]}
              >
                <Icon
                  color={criticalAlert ? colors.alertRed : colors.warningAmber}
                  name={criticalAlert ? 'flame' : 'alert'}
                  size={iconSize.md}
                />
                <View style={styles.incidentCopy}>
                  <Text numberOfLines={1} style={styles.eventName}>
                    {sensor?.name ?? alert.nodeId}
                  </Text>
                  <Text style={styles.note}>{criticalAlert ? 'Critical' : 'Warning'} · Demo</Text>
                </View>
                <Text style={styles.time}>{formatSampleTime(alert.observedAt)}</Text>
              </Pressable>
            );
          })
        )}

        <View style={styles.actions}>
          {(
            [
              ['Map', '/map', 'map'],
              ['Sensors', '/sensors', 'activity'],
              ['Alerts', '/alerts', 'alert'],
              ['Report', '/reports', 'clipboard'],
            ] as const
          ).map(([label, path, icon]) => (
            <Pressable
              key={path}
              accessibilityRole="button"
              onPress={() => router.push(path)}
              style={({ pressed }) => [styles.action, pressed && styles.pressed]}
            >
              <Icon color={colors.forest900} name={icon as IconName} size={iconSize.md} />
              <Text style={styles.actionLabel}>{label}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.sm,
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.sm,
  },
  updated: {
    ...typography.meta,
    color: colors.neutral950,
    fontWeight: '600',
  },
  stale: {
    ...typography.meta,
    color: colors.warningAmber,
    fontWeight: '600',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  waiting: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 16,
    gap: spacing.sm,
    minHeight: 88,
    justifyContent: 'center',
    padding: spacing.md,
  },
  block: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    gap: spacing.sm,
    padding: spacing.md,
  },
  bar: {
    backgroundColor: colors.neutral300,
    borderRadius: 6,
    flexDirection: 'row',
    height: 8,
    overflow: 'hidden',
  },
  mixRow: {
    flexDirection: 'row',
  },
  mixItem: {
    alignItems: 'center',
    flex: 1,
    minHeight: 44,
  },
  mixValue: {
    color: colors.neutral950,
    fontSize: 16,
    fontVariant: ['tabular-nums'],
    fontWeight: '700',
  },
  mixLabel: {
    color: colors.neutral700,
    fontSize: 10,
    fontWeight: '600',
  },
  section: {
    ...typography.sectionTitle,
    color: colors.neutral950,
  },
  sectionHead: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  count: {
    color: colors.neutral700,
    fontSize: 13,
  },
  incident: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 44,
  },
  incidentCopy: {
    flex: 1,
  },
  kicker: {
    color: colors.alertRed,
    fontSize: 12,
    fontWeight: '700',
  },
  incidentName: {
    ...typography.bodyStrong,
    color: colors.neutral950,
  },
  time: {
    color: colors.neutral700,
    fontSize: 12,
  },
  note: {
    color: colors.neutral700,
    fontSize: 13,
  },
  event: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 48,
  },
  eventName: {
    ...typography.bodyStrong,
    color: colors.neutral950,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  action: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    flex: 1,
    gap: 4,
    justifyContent: 'center',
    minHeight: 64,
  },
  actionLabel: {
    color: colors.forest900,
    fontSize: 12,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.75,
  },
});
