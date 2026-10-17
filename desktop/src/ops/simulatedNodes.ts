import type { GeoPoint } from './geo';

export type SimProfile = 'normal' | 'elevated_gas' | 'suspected_smoke' | 'high_risk' | 'offline';

export type SimulatedNode = GeoPoint & {
  id: string;
  name: string;
  profile: SimProfile;
  note: string;
};

export const REAL_NODE_ID = 'real-lora-1';
export const REAL_NODE_NAME = 'LoRa sensor node';

const NOTE = 'SIMULATED demonstration point inside OpenStreetMap way 679249389. Not a surveyed sensor site and not a field measurement.';

/** Stable demonstration posts. Coordinates are fixed; they are not regenerated per render. */
export const SIMULATED_NODES: SimulatedNode[] = [
  { id: 'sim-tadoba-01', name: 'Demo post 01', lat: 20.17, lon: 79.46, profile: 'normal', note: NOTE },
  { id: 'sim-tadoba-02', name: 'Demo post 02', lat: 20.21, lon: 79.51, profile: 'elevated_gas', note: NOTE },
  { id: 'sim-tadoba-03', name: 'Demo post 03', lat: 20.27, lon: 79.46, profile: 'suspected_smoke', note: NOTE },
  { id: 'sim-tadoba-04', name: 'Demo post 04', lat: 20.27, lon: 79.535, profile: 'high_risk', note: NOTE },
  { id: 'sim-tadoba-05', name: 'Demo post 05', lat: 20.17, lon: 79.56, profile: 'offline', note: NOTE },
  { id: 'sim-tadoba-06', name: 'Demo post 06', lat: 20.13, lon: 79.51, profile: 'normal', note: NOTE },
  { id: 'sim-tadoba-07', name: 'Demo post 07', lat: 20.23, lon: 79.41, profile: 'elevated_gas', note: NOTE },
  { id: 'sim-tadoba-08', name: 'Demo post 08', lat: 20.29, lon: 79.385, profile: 'normal', note: NOTE },
  { id: 'sim-tadoba-09', name: 'Demo post 09', lat: 20.15, lon: 79.47, profile: 'suspected_smoke', note: NOTE },
  { id: 'sim-tadoba-10', name: 'Demo post 10', lat: 20.35, lon: 79.335, profile: 'normal', note: NOTE },
];
