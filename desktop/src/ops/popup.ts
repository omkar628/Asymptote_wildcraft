import type { DemoReading } from './demoTelemetry';
import type { Mission } from './mission';
import type { Incident } from './types';

export type ReadingRow = {
  name: string;
  value: string;
  timestamp: string;
  freshness: string;
};

export type LiveSnapshot = {
  link: string;
  timestamp: string | null;
  fresh: boolean;
  tempC: number | null;
  humidityPct: number | null;
  mq135: number | null;
  mq9: number | null;
  rssiDbm: number | null;
};

export type ArrivalPopup = {
  missionId: string;
  destinationKind: Mission['destinationKind'];
  nodeId: string | null;
  nodeName: string;
  nodeTypeLabel: 'REAL HARDWARE' | 'SIMULATED' | null;
  lat: number;
  lon: number;
  connection: string;
  lastUpdate: string;
  readings: ReadingRow[];
  incidentId: string;
  incidentCreated: string;
  cameraClass: string | null;
  cameraConfidence: number | null;
  sensorTrigger: string;
  incidentStatus: string;
  evidenceLabel: string;
  arrivalTime: string;
  distanceTravelledM: number;
  flightDurationS: number;
  missionStatus: string;
  inspectionResult: string;
  simulatedData: boolean;
};

function iso(ms: number | null): string {
  return ms === null || !Number.isFinite(ms) ? 'Unavailable' : new Date(ms).toISOString();
}

function numberText(value: number | null, digits: number, unit: string): string {
  return value === null || !Number.isFinite(value) ? 'Unavailable' : `${value.toFixed(digits)} ${unit}`;
}

function row(name: string, value: string, timestamp: string, freshness: string): ReadingRow {
  return { name, value, timestamp, freshness };
}

export function buildArrivalPopup(mission: Mission, incident: Incident, live: LiveSnapshot | null, demo: DemoReading | null, nowMs: number): ArrivalPopup {
  const simulatedNode = mission.destinationKind === 'simulated_node';
  const incidentArea = mission.destinationKind === 'incident_area';
  const freshness = live?.fresh ? 'Fresh' : live ? 'Stale or unreadable' : 'No packet';
  const liveStamp = live?.timestamp ?? 'Unavailable';
  let readings: ReadingRow[];
  if (incidentArea) {
    readings = [];
  } else if (simulatedNode) {
    const stamp = iso(demo?.timestampMs ?? null);
    const fresh = demo?.online ? 'Generated for this 15-second demo bucket' : 'Not generated';
    readings = [
      row('MQ135', demo?.mq135 === null || demo?.mq135 === undefined ? 'Unavailable' : `${Math.round(demo.mq135)} raw, simulated`, stamp, fresh),
      row('MQ9', demo?.mq9 === null || demo?.mq9 === undefined ? 'Unavailable' : `${Math.round(demo.mq9)} raw, simulated`, stamp, fresh),
      row('Temperature', numberText(demo?.tempC ?? null, 1, '°C, simulated'), stamp, fresh),
      row('Humidity', numberText(demo?.humidityPct ?? null, 0, '%, simulated'), stamp, fresh),
      row('Flame', demo?.flame === null || demo?.flame === undefined ? 'Unavailable' : `${demo.flame} simulated`, stamp, fresh),
    ];
  } else {
    readings = [
      row('MQ135', live?.mq135 === null || live?.mq135 === undefined ? 'Unavailable' : `${live.mq135} raw`, liveStamp, freshness),
      row('MQ9', live?.mq9 === null || live?.mq9 === undefined ? 'Unavailable' : `${live.mq9} raw`, liveStamp, freshness),
      row('Temperature', numberText(live?.tempC ?? null, 1, '°C'), liveStamp, freshness),
      row('Humidity', numberText(live?.humidityPct ?? null, 0, '%'), liveStamp, freshness),
      row('Flame', 'Unavailable. The sensor API does not publish flame.', liveStamp, freshness),
      row('RSSI', live?.rssiDbm === null || live?.rssiDbm === undefined ? 'Unavailable' : `${live.rssiDbm} dBm`, liveStamp, freshness),
    ];
  }
  const gas = [
    incident.highMq135 ? `MQ135 ${incident.mq135 ?? 'high'}` : '',
    incident.highMq9 ? `MQ9 ${incident.mq9 ?? 'high'}` : '',
  ].filter(Boolean).join(', ') || 'No high gas reading was used.';
  const started = mission.startedAtMs ?? mission.createdAtMs;
  return {
    missionId: mission.id,
    destinationKind: mission.destinationKind,
    nodeId: incidentArea ? null : mission.destinationNodeId,
    nodeName: mission.destinationName,
    nodeTypeLabel: incidentArea ? null : simulatedNode ? 'SIMULATED' : 'REAL HARDWARE',
    lat: mission.destination.lat,
    lon: mission.destination.lon,
    connection: incidentArea ? 'This destination is an incident area, not a sensor node.' : simulatedNode ? (demo?.label ?? 'SIMULATED') : (live?.link ?? 'No packet'),
    lastUpdate: simulatedNode ? iso(demo?.timestampMs ?? null) : incidentArea ? iso(incident.createdAtMs) : liveStamp,
    readings,
    incidentId: incident.id,
    incidentCreated: iso(incident.createdAtMs),
    cameraClass: incident.camera?.className ?? null,
    cameraConfidence: incident.camera?.confidence ?? null,
    sensorTrigger: gas,
    incidentStatus: incident.status,
    evidenceLabel: incident.evidenceClass === 'simulated_test'
      ? 'Simulated test evidence. Not a field measurement.'
      : 'Observed hardware or camera evidence. Camera boxes are not ground coordinates.',
    arrivalTime: iso(mission.arrivalAtMs ?? nowMs),
    distanceTravelledM: mission.pose.distanceTravelledM,
    flightDurationS: Math.max(0, (mission.arrivalAtMs ?? nowMs) - started) / 1000,
    missionStatus: mission.state,
    inspectionResult: mission.inspectionResult ?? 'Simulated arrival. No physical inspection was performed.',
    simulatedData: simulatedNode || incident.evidenceClass === 'simulated_test',
  };
}
