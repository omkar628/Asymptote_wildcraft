import type { SimulatedNode, SimProfile } from './simulatedNodes';

export type DemoReading = {
  generated: boolean;
  online: boolean;
  profile: SimProfile;
  tempC: number | null;
  humidityPct: number | null;
  mq135: number | null;
  mq9: number | null;
  flame: number | null;
  timestampMs: number | null;
  label: string;
};

const BASE: Record<Exclude<SimProfile, 'offline'>, { tempC: number; humidityPct: number; mq135: number; mq9: number; flame: number }> = {
  normal: { tempC: 29, humidityPct: 62, mq135: 410, mq9: 390, flame: 0 },
  elevated_gas: { tempC: 34, humidityPct: 48, mq135: 720, mq9: 540, flame: 0 },
  suspected_smoke: { tempC: 36, humidityPct: 44, mq135: 680, mq9: 710, flame: 0 },
  high_risk: { tempC: 41, humidityPct: 30, mq135: 860, mq9: 840, flame: 1 },
};

function wobble(id: string, bucket: number): number {
  let hash = 0;
  const text = `${id}:${bucket}`;
  for (let index = 0; index < text.length; index += 1) hash = (hash * 33 + text.charCodeAt(index)) >>> 0;
  return (hash % 7) - 3;
}

/** Deterministic 15-second buckets. The same node and bucket always return the same values. */
export function demoReading(node: SimulatedNode, nowMs: number, enabled: boolean): DemoReading {
  if (!enabled) {
    return {
      generated: false,
      online: false,
      profile: node.profile,
      tempC: null,
      humidityPct: null,
      mq135: null,
      mq9: null,
      flame: null,
      timestampMs: null,
      label: 'Demo mode is off. No simulated readings are generated.',
    };
  }
  if (node.profile === 'offline') {
    return {
      generated: true,
      online: false,
      profile: node.profile,
      tempC: null,
      humidityPct: null,
      mq135: null,
      mq9: null,
      flame: null,
      timestampMs: null,
      label: 'SIMULATED offline profile. These are not field measurements.',
    };
  }
  const bucket = Math.floor(nowMs / 15_000);
  const shift = wobble(node.id, bucket);
  const base = BASE[node.profile];
  return {
    generated: true,
    online: true,
    profile: node.profile,
    tempC: base.tempC + shift * 0.1,
    humidityPct: base.humidityPct - shift,
    mq135: base.mq135 + shift,
    mq9: base.mq9 + shift,
    flame: base.flame,
    timestampMs: bucket * 15_000,
    label: 'SIMULATED demonstration values. Not a Tadoba field measurement and not written to the sensor log.',
  };
}
