import type { DashboardLinkState, SocketPhase } from '@/types/liveSensor';

import { LAN_API_BASE } from '@/services/sensors/apiBase';

export {
  EMULATOR_API_BASE,
  LAN_API_BASE,
  LOOPBACK_API_BASE,
  detectApiRuntime,
  httpStatusApiMessage,
  isEmulatorApiBase,
  isLoopbackApiBase,
  isStaleLanApiBase,
  normalizeApiBase,
  resolveApiBase,
  timedOutApiMessage,
  unreachableApiMessage,
  websocketFailedMessage,
  websocketUrlFromBase,
} from '@/services/sensors/apiBase';
export type { ApiRuntime } from '@/services/sensors/apiBase';

export const HISTORY_LIMIT = 120;
export const HISTORY_MEMORY_CAP = 180;
export const STATUS_POLL_MS = 5000;
/** Freshness label only. This is not a fire threshold. */
export const STALE_AFTER_MS = 60_000;
export const API_TIMEOUT_MS = 8000;
export const STORAGE_KEY_BASE = 'tadoba.sensorApiBase';
export const STORAGE_KEY_THRESHOLDS = 'tadoba.sensorPhoneThresholds';
/** Physical-phone default when EXPO_PUBLIC_SENSOR_API_BASE is absent. */
export const DEFAULT_API_BASE = LAN_API_BASE;

export function bundledApiBase(): string {
  const value = process.env.EXPO_PUBLIC_SENSOR_API_BASE;
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || DEFAULT_API_BASE;
}

export function dashboardLinkState(input: {
  urlReady: boolean;
  urlConfigured: boolean;
  phase: SocketPhase;
  hasReading: boolean;
}): DashboardLinkState {
  if (!input.urlReady) {
    return 'Connecting';
  }
  if (!input.urlConfigured) {
    return 'Disconnected';
  }
  if (input.phase === 'connecting') {
    return 'Connecting';
  }
  if (input.phase === 'disconnected') {
    return 'Disconnected';
  }
  if (!input.hasReading) {
    return 'No data received';
  }
  return 'Connected';
}
