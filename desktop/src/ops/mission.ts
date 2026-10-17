import { bearingDegrees, haversineMeters, interpolate, isGeoPoint, type GeoPoint } from './geo';
import type { Destination, DispatchRules, Incident, MissionState } from './types';

/** Arrival when geographic distance to the destination is at or below this radius. */
export const DEFAULT_ARRIVAL_RADIUS_M = 80;
export const DEFAULT_APPROACH_RADIUS_M = 500;
export const TAKEOFF_SIM_MS = 2_000;
export const SIM_ALTITUDE_M = 60;
export const ROUTE_NOTE =
  'Straight-line simulation between the configured launch point and the destination. This is not a driving route and does not model trees, wires, airspace, or terrain.';

export const TERMINAL_STATES: ReadonlySet<MissionState> = new Set([
  'MISSION_COMPLETED',
  'MISSION_CANCELLED',
  'MISSION_FAILED',
]);

export const MOVING_STATES: ReadonlySet<MissionState> = new Set([
  'TAKEOFF_SIMULATED',
  'EN_ROUTE',
  'APPROACHING_DESTINATION',
  'RETURNING_TO_BASE',
]);

export type SimulatedPose = {
  lat: number;
  lon: number;
  headingDeg: number;
  altitudeM: number;
  speedMps: number;
  batteryPct: number;
  distanceRemainingM: number;
  distanceTravelledM: number;
  etaSeconds: number | null;
};

export type Mission = {
  id: string;
  incidentId: string;
  state: MissionState;
  simulation: true;
  launch: GeoPoint;
  destination: GeoPoint;
  destinationKind: Destination['kind'];
  destinationNodeId: string | null;
  destinationName: string;
  waypoints: GeoPoint[];
  routeNote: string;
  createdAtMs: number;
  startedAtMs: number | null;
  phaseStartedAtMs: number | null;
  motionFrom: GeoPoint | null;
  motionTo: GeoPoint | null;
  arrivalAtMs: number | null;
  completedAtMs: number | null;
  cancelledAtMs: number | null;
  outboundTravelledM: number;
  pose: SimulatedPose;
  inspectionResult: string | null;
  outcome: string | null;
  returnStatus: string;
  popupOpened: boolean;
  evidenceClass: 'observed' | 'simulated_test';
};

export type PlanResult = { ok: true; mission: Mission } | { ok: false; reason: string };

function poseAt(point: GeoPoint, headingDeg: number, travelled: number, remaining: number, altitude: number, speed: number, startedAt: number | null, nowMs: number): SimulatedPose {
  const minutes = startedAt === null ? 0 : Math.max(0, nowMs - startedAt) / 60_000;
  return {
    lat: point.lat,
    lon: point.lon,
    headingDeg,
    altitudeM: altitude,
    speedMps: speed,
    batteryPct: Math.max(0, 100 - minutes * 0.8),
    distanceRemainingM: remaining,
    distanceTravelledM: travelled,
    etaSeconds: speed > 0 ? remaining / speed : null,
  };
}

export function planMission(input: {
  missionId: string;
  incident: Incident;
  launch: GeoPoint | null;
  destination: Destination | null;
  nowMs: number;
}): PlanResult {
  if (!isGeoPoint(input.launch)) {
    return { ok: false, reason: 'Launch coordinates are not configured. Set a launch point on the map. No headquarters coordinate is used, because none is surveyed in this app.' };
  }
  if (!input.destination || !isGeoPoint(input.destination)) {
    return { ok: false, reason: 'Destination coordinates are not configured. A geographic mission was not created.' };
  }
  const heading = bearingDegrees(input.launch, input.destination);
  const midpoint = interpolate(input.launch, input.destination, 0.5);
  const mission: Mission = {
    id: input.missionId,
    incidentId: input.incident.id,
    state: 'MISSION_PLANNED',
    simulation: true,
    launch: { lat: input.launch.lat, lon: input.launch.lon },
    destination: { lat: input.destination.lat, lon: input.destination.lon },
    destinationKind: input.destination.kind,
    destinationNodeId: input.destination.id,
    destinationName: input.destination.name,
    waypoints: [input.launch, midpoint, input.destination],
    routeNote: ROUTE_NOTE,
    createdAtMs: input.nowMs,
    startedAtMs: null,
    phaseStartedAtMs: input.nowMs,
    motionFrom: input.launch,
    motionTo: input.destination,
    arrivalAtMs: null,
    completedAtMs: null,
    cancelledAtMs: null,
    outboundTravelledM: 0,
    pose: poseAt(input.launch, heading, 0, haversineMeters(input.launch, input.destination), 0, 0, null, input.nowMs),
    inspectionResult: null,
    outcome: null,
    returnStatus: 'Not started',
    popupOpened: false,
    evidenceClass: input.incident.evidenceClass,
  };
  return { ok: true, mission };
}

export function beginSimulation(mission: Mission, nowMs: number): Mission {
  if (mission.state !== 'MISSION_PLANNED') return mission;
  return {
    ...mission,
    state: 'TAKEOFF_SIMULATED',
    startedAtMs: nowMs,
    phaseStartedAtMs: nowMs,
    pose: { ...mission.pose, altitudeM: 0, speedMps: 0, etaSeconds: null },
  };
}

function moveAlong(mission: Mission, nowMs: number, rules: DispatchRules, returning: boolean): Mission {
  const from = mission.motionFrom;
  const to = mission.motionTo;
  const started = mission.phaseStartedAtMs ?? nowMs;
  if (!from || !to) {
    return { ...mission, state: 'MISSION_FAILED', outcome: 'The route lost its endpoints.', completedAtMs: nowMs };
  }
  const total = haversineMeters(from, to);
  const speed = Math.max(1, rules.simSpeedMps);
  const travelledLeg = Math.max(0, ((nowMs - started) / 1000) * speed);
  const remaining = Math.max(0, total - travelledLeg);
  const fraction = total === 0 ? 1 : Math.min(1, travelledLeg / total);
  const point = interpolate(from, to, fraction);
  const heading = bearingDegrees(from, to);
  const travelled = mission.outboundTravelledM + Math.min(total, travelledLeg);
  const arrival = Math.max(1, rules.arrivalRadiusM);
  const approach = Math.max(arrival + 50, rules.approachRadiusM);
  const pose = poseAt(remaining <= arrival ? to : point, heading, travelled, remaining <= arrival ? 0 : remaining, SIM_ALTITUDE_M, remaining <= arrival ? 0 : speed, mission.startedAtMs, nowMs);
  if (remaining <= arrival || total === 0) {
    if (returning) {
      return {
        ...mission,
        state: 'MISSION_COMPLETED',
        pose: { ...pose, lat: to.lat, lon: to.lon, speedMps: 0, altitudeM: 0, distanceRemainingM: 0, etaSeconds: 0 },
        completedAtMs: nowMs,
        outcome: 'Returned to the configured launch point in simulation.',
        returnStatus: 'Returned to launch in simulation',
      };
    }
    return {
      ...mission,
      state: 'ARRIVED',
      pose: { ...pose, lat: to.lat, lon: to.lon, speedMps: 0, distanceRemainingM: 0, etaSeconds: 0 },
      arrivalAtMs: mission.arrivalAtMs ?? nowMs,
      outcome: 'Arrived inside the simulated arrival radius.',
    };
  }
  return {
    ...mission,
    state: !returning && remaining <= approach ? 'APPROACHING_DESTINATION' : returning ? 'RETURNING_TO_BASE' : 'EN_ROUTE',
    pose,
  };
}

export function sampleMission(mission: Mission, nowMs: number, rules: DispatchRules): Mission {
  if (TERMINAL_STATES.has(mission.state) || mission.state === 'ARRIVED' || mission.state === 'INSPECTING_NODE' || mission.state === 'MISSION_PLANNED' || mission.state === 'AWAITING_DISPATCH_RULE' || mission.state === 'IDLE' || mission.state === 'INCIDENT_DETECTED') {
    return mission;
  }
  if (mission.state === 'TAKEOFF_SIMULATED') {
    const elapsed = Math.max(0, nowMs - (mission.phaseStartedAtMs ?? nowMs));
    const fraction = Math.min(1, elapsed / TAKEOFF_SIM_MS);
    const climbing: Mission = {
      ...mission,
      pose: { ...mission.pose, altitudeM: SIM_ALTITUDE_M * fraction, speedMps: 0, etaSeconds: null },
    };
    if (elapsed < TAKEOFF_SIM_MS) return climbing;
    return moveAlong(
      {
        ...climbing,
        state: 'EN_ROUTE',
        phaseStartedAtMs: (mission.phaseStartedAtMs ?? nowMs) + TAKEOFF_SIM_MS,
        motionFrom: mission.launch,
        motionTo: mission.destination,
      },
      nowMs,
      rules,
      false,
    );
  }
  return moveAlong(mission, nowMs, rules, mission.state === 'RETURNING_TO_BASE');
}

export function beginInspection(mission: Mission, nowMs: number): Mission {
  if (mission.state !== 'ARRIVED' && mission.state !== 'INSPECTING_NODE') return mission;
  return {
    ...mission,
    state: 'INSPECTING_NODE',
    arrivalAtMs: mission.arrivalAtMs ?? nowMs,
    inspectionResult: mission.inspectionResult ?? 'Simulated arrival. No physical inspection was performed.',
  };
}

/** Open the arrival popup once, on the transition into ARRIVED. */
export function consumeArrival(before: Mission, after: Mission, nowMs: number): { mission: Mission; openPopup: boolean } {
  if (before.popupOpened || after.popupOpened) return { mission: after, openPopup: false };
  const arrived = after.state === 'ARRIVED' || after.state === 'INSPECTING_NODE';
  const wasArrived = before.state === 'ARRIVED' || before.state === 'INSPECTING_NODE';
  if (!arrived || wasArrived) return { mission: after, openPopup: false };
  const inspecting = beginInspection(after, nowMs);
  return { mission: { ...inspecting, popupOpened: true }, openPopup: true };
}

export function commandReturn(mission: Mission, nowMs: number): Mission {
  if (TERMINAL_STATES.has(mission.state) || mission.state === 'RETURNING_TO_BASE') return mission;
  return {
    ...mission,
    state: 'RETURNING_TO_BASE',
    phaseStartedAtMs: nowMs,
    motionFrom: { lat: mission.pose.lat, lon: mission.pose.lon },
    motionTo: mission.launch,
    outboundTravelledM: mission.pose.distanceTravelledM,
    returnStatus: 'Returning to launch in simulation',
    pose: { ...mission.pose, speedMps: 0 },
  };
}

export function cancelMission(mission: Mission, nowMs: number, emergency: boolean): Mission {
  if (TERMINAL_STATES.has(mission.state)) return mission;
  return {
    ...mission,
    state: 'MISSION_CANCELLED',
    cancelledAtMs: nowMs,
    pose: { ...mission.pose, speedMps: 0, etaSeconds: null },
    outcome: emergency
      ? 'Emergency stop. Simulated motion halted. No flight controller was commanded.'
      : 'Mission cancelled. Simulated motion halted. No flight controller was commanded.',
    returnStatus: mission.returnStatus === 'Not started' ? 'Cancelled before return' : mission.returnStatus,
  };
}

export function continueMission(mission: Mission): Mission {
  if (mission.state !== 'INSPECTING_NODE' && mission.state !== 'ARRIVED') return mission;
  return {
    ...mission,
    state: 'INSPECTING_NODE',
    inspectionResult: 'Operator continued the simulated mission. No further waypoint is planned.',
  };
}
