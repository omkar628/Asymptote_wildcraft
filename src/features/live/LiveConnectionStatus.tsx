import { StyleSheet, Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/Icon';
import { SecondaryButton } from '@/components/SecondaryButton';
import { colors, iconSize, radii, spacing, typography } from '@/theme';
import type { PacketFreshness } from '@/services/sensors/livePacket';
import type { DashboardLinkState, SerialStatus } from '@/types/liveSensor';

const presentation: Record<
  DashboardLinkState,
  { icon: IconName; color: string; surface: string; hint: string }
> = {
  Connected: {
    icon: 'activity',
    color: colors.successGreen,
    surface: colors.successSurface,
    hint: 'The phone is linked to the laptop API. Fresh packets also require the receiver serial line below to stay connected.',
  },
  Connecting: {
    icon: 'activity',
    color: colors.warningAmber,
    surface: colors.warningSurface,
    hint: 'Opening the link to the laptop.',
  },
  Disconnected: {
    icon: 'offline',
    color: colors.offline,
    surface: colors.offlineSurface,
    hint: 'This phone is not linked to the laptop API. Another attempt starts on its own. Retry starts one now.',
  },
  'No data received': {
    icon: 'unknown',
    color: colors.infoBlue,
    surface: colors.infoSurface,
    hint: 'The API link is open. No receiver packet has arrived.',
  },
};

function serialLabel(serial: SerialStatus | null): string {
  if (!serial) {
    return 'Receiver serial: waiting for status';
  }
  const state = serial.state === 'unknown' ? serial.rawState : serial.state;
  return `Receiver serial: ${state} · ${serial.port} · ${serial.baudRate}`;
}

type LiveConnectionStatusProps = {
  link: DashboardLinkState;
  freshness?: PacketFreshness;
  serial: SerialStatus | null;
  errorText: string | null;
  onRetry?: () => void;
  compact?: boolean;
};

function visibleLabel(link: DashboardLinkState, freshness: PacketFreshness | undefined): string {
  if (freshness === 'LIVE' || freshness === 'STALE' || freshness === 'DISCONNECTED') {
    return freshness;
  }
  return link;
}

export function LiveConnectionStatus({
  link,
  freshness,
  serial,
  errorText,
  onRetry,
  compact = false,
}: LiveConnectionStatusProps) {
  const label = visibleLabel(link, freshness);
  const tone =
    freshness === 'LIVE'
      ? presentation.Connected
      : freshness === 'STALE'
        ? presentation.Connecting
        : freshness === 'DISCONNECTED'
          ? presentation.Disconnected
          : presentation[link];
  const hint =
    freshness === 'LIVE'
      ? 'Packets are arriving from the receiver.'
      : freshness === 'STALE'
        ? 'No packet has arrived on this phone in the last 60 seconds.'
        : freshness === 'DISCONNECTED'
          ? 'This phone is not receiving live packets.'
          : tone.hint;
  const serialError = serial?.lastError && !serial.connected ? serial.lastError : null;

  return (
    <View accessibilityRole="summary" style={[styles.card, compact && styles.compact, { backgroundColor: tone.surface }]}>
      <View style={styles.row}>
        <Icon color={tone.color} name={tone.icon} size={iconSize.md} />
        <Text style={[styles.label, { color: tone.color }]}>{label}</Text>
      </View>
      {compact ? null : <Text style={styles.hint}>{hint}</Text>}
      <Text style={styles.meta}>{serialLabel(serial)}</Text>
      {serialError ? <Text style={styles.meta}>{serialError}</Text> : null}
      {errorText ? <Text style={styles.error}>{errorText}</Text> : null}
      {onRetry ? (
        <SecondaryButton
          accessibilityHint="Opens the laptop link again and reloads the latest readings"
          label="Retry"
          onPress={onRetry}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.card,
    gap: spacing.xs,
    padding: spacing.md,
  },
  compact: {
    paddingVertical: spacing.sm,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  label: {
    ...typography.sectionTitle,
  },
  hint: {
    ...typography.body,
    color: colors.neutral950,
  },
  meta: {
    ...typography.meta,
    color: colors.neutral700,
    fontWeight: '400',
  },
  error: {
    ...typography.meta,
    color: colors.alertRed,
    fontWeight: '400',
  },
});
