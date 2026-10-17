import { reviewEvidence } from './incidentRules';
import { beginSimulation, planMission, type Mission } from './mission';
import type { CameraEvidence, Destination, DispatchRules, GeoPoint, Incident, SensorEvidence } from './types';

export type DeskState = {
  incident: Incident | null;
  cooldownUntilMs: number;
  mission: Mission | null;
};

export type EvidenceOffer = {
  nowMs: number;
  rules: DispatchRules;
  cameras: CameraEvidence[];
  sensor: SensorEvidence | null;
  evidenceClass: 'observed' | 'simulated_test';
  incidentId: string;
  missionId: string;
  launch: GeoPoint | null;
  destination: Destination | null;
  bypassCooldown?: boolean;
};

export type DeskResult = {
  desk: DeskState;
  note: string;
  createdAlert: boolean;
  createdMission: boolean;
};

function attachBlock(incident: Incident, reason: string): Incident {
  return { ...incident, phase: 'AWAITING_DISPATCH_RULE', blockReason: reason, status: 'open', missionId: null };
}

export function applyEvidence(desk: DeskState, offer: EvidenceOffer): DeskResult {
  if (desk.mission && !['MISSION_COMPLETED', 'MISSION_CANCELLED', 'MISSION_FAILED'].includes(desk.mission.state)) {
    const reviewed = reviewEvidence({ ...offer, incident: desk.incident, cooldownUntilMs: desk.cooldownUntilMs });
    return {
      desk: { incident: reviewed.incident, cooldownUntilMs: reviewed.cooldownUntilMs, mission: desk.mission },
      note: reviewed.incident?.missionId ? 'This incident already has a mission.' : reviewed.note,
      createdAlert: false,
      createdMission: false,
    };
  }
  const reviewed = reviewEvidence({ ...offer, incident: desk.incident, cooldownUntilMs: desk.cooldownUntilMs });
  if (!reviewed.incident) {
    return { desk: { ...desk, cooldownUntilMs: reviewed.cooldownUntilMs }, note: reviewed.note, createdAlert: false, createdMission: false };
  }
  if (!reviewed.requestDispatch) {
    const waiting = reviewed.incident.missionId
      ? reviewed.incident
      : { ...reviewed.incident, phase: reviewed.incident.status === 'closed' ? reviewed.incident.phase : 'AWAITING_DISPATCH_RULE' as const };
    return {
      desk: { incident: waiting, cooldownUntilMs: reviewed.cooldownUntilMs, mission: desk.mission },
      note: reviewed.note,
      createdAlert: reviewed.created,
      createdMission: false,
    };
  }
  const planned = planMission({
    missionId: offer.missionId,
    incident: reviewed.incident,
    launch: offer.launch,
    destination: offer.destination,
    nowMs: offer.nowMs,
  });
  if (!planned.ok) {
    return {
      desk: { incident: attachBlock(reviewed.incident, planned.reason), cooldownUntilMs: reviewed.cooldownUntilMs, mission: null },
      note: planned.reason,
      createdAlert: reviewed.created || reviewed.incident.category !== desk.incident?.category,
      createdMission: false,
    };
  }
  const mission = beginSimulation(planned.mission, offer.nowMs);
  const incident: Incident = {
    ...reviewed.incident,
    status: 'dispatched',
    phase: mission.state,
    missionId: mission.id,
    destinationNodeId: mission.destinationNodeId,
    blockReason: null,
  };
  return {
    desk: { incident, cooldownUntilMs: reviewed.cooldownUntilMs, mission },
    note: 'Simulated dispatch started. No aircraft was commanded.',
    createdAlert: reviewed.created,
    createdMission: true,
  };
}

export function manualDispatch(desk: DeskState, input: {
  nowMs: number;
  rules: DispatchRules;
  incidentId: string;
  missionId: string;
  launch: GeoPoint | null;
  destination: Destination | null;
}): DeskResult {
  if (desk.mission && !['MISSION_COMPLETED', 'MISSION_CANCELLED', 'MISSION_FAILED'].includes(desk.mission.state)) {
    return { desk, note: 'A simulated mission is already active.', createdAlert: false, createdMission: false };
  }
  const base = desk.incident && desk.incident.status !== 'closed'
    ? desk.incident
    : {
        id: input.incidentId,
        createdAtMs: input.nowMs,
        category: 'manual_test' as const,
        status: 'open' as const,
        evidenceClass: 'simulated_test' as const,
        phase: 'INCIDENT_DETECTED' as const,
        camera: null,
        sensorTimestampMs: null,
        mq135: null,
        mq9: null,
        tempC: null,
        humidityPct: null,
        flame: null,
        highMq135: false,
        highMq9: false,
        sensorFresh: false,
        sensorSource: 'none' as const,
        usedSensorTimestampMs: null,
        usedCameraIds: [],
        missionId: null,
        destinationNodeId: null,
        blockReason: null,
        summary: 'Manual simulation dispatch. This was not produced by the combined-evidence rule.',
      };
  const planned = planMission({
    missionId: input.missionId,
    incident: base,
    launch: input.launch,
    destination: input.destination,
    nowMs: input.nowMs,
  });
  if (!planned.ok) {
    return {
      desk: { ...desk, incident: attachBlock(base, planned.reason) },
      note: planned.reason,
      createdAlert: base.category === 'manual_test' && desk.incident?.id !== base.id,
      createdMission: false,
    };
  }
  const mission = beginSimulation(planned.mission, input.nowMs);
  return {
    desk: {
      incident: { ...base, status: 'dispatched', phase: mission.state, missionId: mission.id, destinationNodeId: mission.destinationNodeId, blockReason: null },
      cooldownUntilMs: desk.cooldownUntilMs,
      mission,
    },
    note: 'Manual simulated dispatch started. No aircraft was commanded.',
    createdAlert: base.category === 'manual_test',
    createdMission: true,
  };
}
