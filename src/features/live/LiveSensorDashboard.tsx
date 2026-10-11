import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppHeader } from '@/components/AppHeader';
import { ScreenFrame } from '@/components/ScreenFrame';
import { useTabBarInset } from '@/components/useTabBarInset';
import { BackendSettingsCard } from '@/features/live/BackendSettingsCard';
import { LiveConnectionStatus } from '@/features/live/LiveConnectionStatus';
import { PhoneThresholdCard } from '@/features/live/PhoneThresholdCard';
import { PreliminaryAlertCard } from '@/features/live/PreliminaryAlertCard';
import { RecentReadingsList } from '@/features/live/RecentReadingsList';
import { SensorMetricCard } from '@/features/live/SensorMetricCard';
import { SensorTrendChart } from '@/features/live/SensorTrendChart';
import { useLiveSensors } from '@/features/live/useLiveSensors';
import { colors, spacing, typography } from '@/theme';
import { formatElapsed, formatMeasurement, formatPacketTime, formatRaw } from '@/utils/sensorFormat';

export function LiveSensorDashboard() {
  const bottomInset = useTabBarInset();
  const live = useLiveSensors();
  const reading = live.latest;
  const receivedAge =
    live.liveReceivedAt == null ? null : formatElapsed(live.now - live.liveReceivedAt);
  const showSpinner = live.loading && !reading;
  const showFault =
    Boolean(live.savedBase) &&
    !reading &&
    !live.loading &&
    (Boolean(live.errorText) || (live.link === 'Disconnected' && !live.reachedApi));
  const showRetry =
    Boolean(live.savedBase) && !live.loading && (live.link === 'Disconnected' || Boolean(live.errorText));
  const settings = (
    <BackendSettingsCard
      draft={live.draftUrl}
      errorText={live.urlError}
      onChangeDraft={live.setDraftUrl}
      onSave={live.saveUrl}
      savedBase={live.savedBase}
    />
  );

  return (
    <ScreenFrame
      header={
        <AppHeader
          statusHint={
            live.freshness === 'LIVE'
              ? 'Live receiver packets'
              : live.freshness === 'STALE'
                ? 'Packets have stopped'
                : live.freshness === 'DISCONNECTED'
                  ? 'Phone is not receiving packets'
                  : 'Waiting for a receiver packet'
          }
          statusLabel={live.freshness}
          subtitle="NodeMCU receiver"
          title="Sensors"
        />
      }
    >
      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={[styles.content, { paddingBottom: bottomInset }]}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            onRefresh={live.refresh}
            refreshing={live.refreshing}
            tintColor={colors.forest700}
          />
        }
      >
        <LiveConnectionStatus
          errorText={live.errorText}
          freshness={live.freshness}
          link={live.link}
          onRetry={showRetry ? live.retry : undefined}
          serial={live.serial}
        />
        {settings}

        {reading ? (
          <View style={styles.grid}>
            <SensorMetricCard
              icon="temperature"
              label="Temperature"
              note="Reported by the receiver"
              unit="°C"
              value={formatMeasurement(reading.temp_c, 2)}
            />
            <SensorMetricCard
              icon="humidity"
              label="Humidity"
              note="Relative humidity"
              unit="%"
              value={formatMeasurement(reading.humidity_percent, 2)}
            />
            <SensorMetricCard
              icon="activity"
              label="MQ135"
              note="Raw sensor value"
              unit="raw"
              value={formatRaw(reading.mq135_raw)}
            />
            <SensorMetricCard
              icon="activity"
              label="MQ9"
              note="Raw sensor value"
              unit="raw"
              value={formatRaw(reading.mq9_raw)}
            />
            <SensorMetricCard
              icon="signal"
              label="RSSI"
              note={reading.rssi_dbm == null ? 'Not reported with this packet' : 'Receiver RSSI, shown as dBm'}
              unit={reading.rssi_dbm == null ? '' : 'dBm'}
              value={reading.rssi_dbm == null ? '—' : formatRaw(reading.rssi_dbm)}
              wide
            />
            <SensorMetricCard
              icon="activity"
              compact
              label="Last update"
              note={
                live.freshness === 'LIVE'
                  ? `LIVE · last packet received ${receivedAge ?? 'just now'}`
                  : live.freshness === 'STALE'
                    ? `STALE · last packet received ${receivedAge ?? 'earlier'} · no packet for over 60 seconds`
                    : live.freshness === 'DISCONNECTED'
                      ? `DISCONNECTED · last packet received ${receivedAge ?? 'earlier'}`
                      : `Last packet received ${receivedAge ?? 'just now'}`
              }
              unit=""
              value={formatPacketTime(reading.timestamp)}
              wide
            />
          </View>
        ) : showSpinner ? (
          <View accessibilityRole="progressbar" style={styles.empty}>
            <ActivityIndicator color={colors.forest700} size="large" />
            <Text style={styles.emptyTitle}>{live.savedBase ? 'Loading receiver data' : 'Loading saved address'}</Text>
            <Text style={styles.body}>Asking the laptop for the latest packet, history, and status.</Text>
          </View>
        ) : showFault ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{live.link === 'Disconnected' ? 'Disconnected' : 'Could not load readings'}</Text>
            <Text style={styles.body}>
              The address is saved, but this screen has no packet to show. Confirm the backend is running on the same Wi-Fi, then use Retry. Sample readings are not shown here.
            </Text>
          </View>
        ) : (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No receiver data yet</Text>
            <Text style={styles.body}>
              {live.savedBase
                ? 'The API link can be open before the NodeMCU sends a packet. This screen shows only readings the backend collected. Nothing here is simulated.'
                : 'Enter the laptop address above, in the form http://<laptop-ip>:8000. This screen does not show sample readings.'}
            </Text>
          </View>
        )}

        <PreliminaryAlertCard alerts={live.alerts} laptopThresholds={live.laptopThresholds} />

        <Text style={styles.section}>Trends</Text>
        <SensorTrendChart
          points={live.history.map((item) => ({ at: item.timestamp, value: item.temp_c }))}
          title="Temperature"
          unit="°C"
        />
        <SensorTrendChart
          points={live.history.map((item) => ({ at: item.timestamp, value: item.humidity_percent }))}
          title="Humidity"
          unit="%"
        />
        <SensorTrendChart
          points={live.history.map((item) => ({ at: item.timestamp, value: item.mq135_raw }))}
          title="MQ135 raw"
          unit="raw"
        />
        <SensorTrendChart
          points={live.history.map((item) => ({ at: item.timestamp, value: item.mq9_raw }))}
          title="MQ9 raw"
          unit="raw"
        />

        <RecentReadingsList readings={live.history} />
        <PhoneThresholdCard onSave={live.saveThresholds} thresholds={live.phoneThresholds} />
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
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  empty: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    gap: spacing.sm,
    padding: spacing.md,
  },
  emptyTitle: {
    ...typography.sectionTitle,
    color: colors.neutral950,
  },
  body: {
    ...typography.body,
    color: colors.neutral950,
  },
  section: {
    ...typography.sectionTitle,
    color: colors.neutral950,
  },
});
