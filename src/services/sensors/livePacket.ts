import type { DashboardLinkState, SensorReading } from '../../types/liveSensor';

/** The reading on the cards. History rows never belong in this slot. */
export type LiveSlot = {
  reading: SensorReading | null;
  /** Phone clock when this packet was accepted. Not the collector timestamp. */
  receivedAtMs: number | null;
};

export function emptyLiveSlot(): LiveSlot {
  return { reading: null, receivedAtMs: null };
}

/**
 * A WebSocket reading always becomes the live packet.
 * Collector timestamps are not compared: an older CSV time must not drop a packet that just arrived.
 */
export function acceptSocketReading(
  _slot: LiveSlot,
  reading: SensorReading,
  receivedAtMs: number,
): LiveSlot {
  return { reading, receivedAtMs };
}

/**
 * GET /latest may fill the live slot only when the socket has not already
 * delivered a packet after this request started, and only when the body is a
 * newer collector packet. The same packet polled again does not refresh receive time.
 */
export function acceptPolledLatest(
  slot: LiveSlot,
  reading: SensorReading | null,
  requestStartedAtMs: number,
  responseAtMs: number,
): LiveSlot {
  if (!reading) {
    return slot;
  }
  if (slot.receivedAtMs != null && slot.receivedAtMs >= requestStartedAtMs) {
    return slot;
  }
  if (slot.reading && reading.timestamp <= slot.reading.timestamp) {
    return slot;
  }
  return { reading, receivedAtMs: responseAtMs };
}

export function isPacketFresh(
  receivedAtMs: number | null,
  nowMs: number,
  staleAfterMs: number,
): boolean {
  if (receivedAtMs == null) {
    return false;
  }
  return nowMs - receivedAtMs <= staleAfterMs;
}

export type PacketFreshness = 'LIVE' | 'STALE' | 'DISCONNECTED' | 'LINKING' | 'WAITING';

export function packetFreshness(input: {
  link: DashboardLinkState;
  receivedAtMs: number | null;
  nowMs: number;
  staleAfterMs: number;
}): PacketFreshness {
  if (isPacketFresh(input.receivedAtMs, input.nowMs, input.staleAfterMs)) {
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
