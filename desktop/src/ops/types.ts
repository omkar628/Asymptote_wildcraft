import type { GeoPoint } from './geo';

export type MissionState =
  | 'IDLE'
  | 'INCIDENT_DETECTED'
  | 'AWAITING_DISPATCH_RULE'
  | 'MISSION_PLANNED'
  | 'TAKEOFF_SIMULATED'
  | 'EN_ROUTE'
  | 'APPROACHING_DESTINATION'
  | 'ARRIVED'
  | 'INSPECTING_NODE'
  | 'RETURNING_TO_BASE'
  | 'MISSION_COMPLETED'
  | 'MISSION_CANCELLED'
  | 'MISSION_FAILED';

export type EvidenceKind = 'observed' | 'rule_alert' | 'simulated_test' | 'mission_event' | 'confirmed_field';

export type IncidentCategory =
  | 'confirmed_multi'
  | 'smoke_plus_sensor'
  | 'sensor_only'
  | 'camera_only'
  | 'manual_test';

/** Default autonomous dispatch uses combined camera-plus-gas evidence only. */
export type AutoDispatchMode = 'off' | 'combined' | 'fire_and_gas' | 'smoke_and_gas' | 'any_alert';

export type DispatchRules = {
  smokeConfidence: number;
  fireConfidence: number;
  mq135High: number;
  mq9High: number;
  matchWindowMs: number;
  sensorStaleMs: number;
  cooldownMs: number;
  autoDispatch: AutoDispatchMode;
  arrivalRadiusM: number;
  approachRadiusM: number;
  simSpeedMps: number;
};

export type CameraEvidence = {
  id: string;
  className: string;
  confidence: number;
  observedAtMs: number;
};

export type SensorEvidence = {
  timestampMs: number | null;
  tempC: number | null;
  humidityPct: number | null;
  mq135: number | null;
  mq9: number | null;
  flame: number | null;
  rssiDbm: number | null;
  source: 'serial' | 'simulated';
};

export type Incident = {
  id: string;
  createdAtMs: number;
  category: IncidentCategory;
  status: 'open' | 'dispatched' | 'closed';
  evidenceClass: 'observed' | 'simulated_test';
  phase: MissionState;
  camera: { id: string; className: string; confidence: number; observedAtMs: number } | null;
  sensorTimestampMs: number | null;
  mq135: number | null;
  mq9: number | null;
  tempC: number | null;
  humidityPct: number | null;
  flame: number | null;
  highMq135: boolean;
  highMq9: boolean;
  sensorFresh: boolean;
  sensorSource: 'serial' | 'simulated' | 'none';
  usedSensorTimestampMs: number | null;
  usedCameraIds: string[];
  missionId: string | null;
  destinationNodeId: string | null;
  blockReason: string | null;
  summary: string;
};

export type Destination = {
  kind: 'real_node' | 'simulated_node' | 'incident_area';
  id: string | null;
  name: string;
  lat: number;
  lon: number;
};

export type { GeoPoint };
