import { colors } from '@/theme/tokens';
import type { NodeCommunicationStatus } from '@/types/records';

export type BadgeTone = 'success' | 'warning' | 'alert' | 'info' | 'offline' | 'neutral';

export const nodeStatusBadge: Record<
  NodeCommunicationStatus,
  { label: string; tone: BadgeTone }
> = {
  healthy: { label: 'Healthy', tone: 'success' },
  potential_alert: { label: 'Warning', tone: 'warning' },
  verified_fire: { label: 'Critical', tone: 'alert' },
  offline: { label: 'Offline', tone: 'offline' },
  unknown: { label: 'Unknown', tone: 'neutral' },
};

/** Marker and rail fills. Pair each with an icon or a word. */
export const statusFill: Record<NodeCommunicationStatus, string> = {
  healthy: colors.successGreen,
  potential_alert: colors.warningAmber,
  verified_fire: colors.alertRed,
  offline: colors.offline,
  unknown: colors.neutral700,
};
