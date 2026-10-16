export function formatMeasurement(value: number, decimals: number): string {
  if (!Number.isFinite(value)) {
    return '—';
  }
  return value.toFixed(decimals);
}

export function formatRaw(value: number): string {
  if (!Number.isFinite(value)) {
    return '—';
  }
  if (Math.abs(value - Math.round(value)) < 1e-6) {
    return String(Math.round(value));
  }
  return value.toFixed(2);
}

export function formatPacketTime(iso: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/.exec(iso);
  if (!match) {
    return iso;
  }
  const zone = iso.endsWith('+05:30') ? ' IST' : '';
  return `${match[1]} ${match[2]}${zone}`;
}

export function formatElapsed(deltaMs: number): string {
  if (!Number.isFinite(deltaMs)) {
    return 'Unknown time';
  }
  if (deltaMs < 5000) {
    return 'Just now';
  }
  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours} h ago`;
}

export const STALE_AFTER_MS = 60_000;

export type PacketFreshness = 'LIVE' | 'STALE' | 'DISCONNECTED' | 'LINKING' | 'WAITING';
export type DashboardLinkState = 'Connected' | 'Connecting' | 'Disconnected' | 'No data received';

export function packetFreshness(input: {
  link: DashboardLinkState;
  receivedAtMs: number | null;
  nowMs: number;
}): PacketFreshness {
  if (input.receivedAtMs != null && input.nowMs - input.receivedAtMs <= STALE_AFTER_MS) {
    return 'LIVE';
  }
  if (input.receivedAtMs != null) {
    return input.link === 'Disconnected' ? 'DISCONNECTED' : 'STALE';
  }
  if (input.link === 'Connecting') {
    return 'LINKING';
  }
  if (input.link === 'Disconnected') {
    return 'DISCONNECTED';
  }
  return 'WAITING';
}
