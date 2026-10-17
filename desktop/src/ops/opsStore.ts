import { websocketUrl } from '../../shared/validate';
import { demoReading } from './demoTelemetry';
import { applyEvidence, manualDispatch, type DeskResult, type DeskState } from './dispatch';
import { isGeoPoint, type GeoPoint } from './geo';
import { DEFAULT_RULES } from './incidentRules';
import { loadIncidentHistory, postMission } from './missionClient';
import {
  MOVING_STATES,
  TERMINAL_STATES,
  cancelMission,
  commandReturn,
  consumeArrival,
  continueMission,
  sampleMission,
  type Mission,
  type SimulatedPose,
} from './mission';
import { buildArrivalPopup, type ArrivalPopup, type LiveSnapshot } from './popup';
import { REAL_NODE_ID, REAL_NODE_NAME, SIMULATED_NODES, type SimulatedNode } from './simulatedNodes';
import type { CameraEvidence, Destination, DispatchRules, EvidenceKind, Incident, SensorEvidence } from './types';

export type HistoryRow = {
  id: string;
  atMs: number;
  kind: EvidenceKind;
  incidentId: string;
  category: string;
  camera: string;
  sensor: string;
  destination: string;
  evidence: string;
  missionStart: string | null;
  arrival: string | null;
  outcome: string;
  returnStatus: string;
};

export type OpsDocument = {
  rules: DispatchRules;
  incident: Incident | null;
  mission: Mission | null;
  popup: ArrivalPopup | null;
  history: HistoryRow[];
  launch: GeoPoint | null;
  realPin: GeoPoint | null;
  follow: boolean;
  showSim: boolean;
  showReal: boolean;
  demoMode: boolean;
  note: string;
  live: LiveSnapshot | null;
  selectedNodeId: string;
  detailNodeId: string | null;
  backendUrl: string;
  logLinked: boolean;
  cooldownUntilMs: number;
};

type DetectionLike = { id: string; class_name: string; confidence: number; created_at: string };
type PacketLike = {
  timestamp: string;
  temp_c: number;
  humidity_percent: number;
  mq135_raw: number;
  mq9_raw: number;
  rssi_dbm: number | null;
};

const listeners = new Set<() => void>();
const poseListeners = new Set<() => void>();
let pose: SimulatedPose | null = null;
let lastPersist = 0;
let socket: WebSocket | null = null;
let seq = 0;

function readPin(key: string): GeoPoint | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const text = localStorage.getItem(key);
    if (!text) return null;
    const parsed = JSON.parse(text) as { lat?: unknown; lon?: unknown };
    if (typeof parsed.lat !== 'number' || typeof parsed.lon !== 'number') return null;
    return isGeoPoint({ lat: parsed.lat, lon: parsed.lon }) ? { lat: parsed.lat, lon: parsed.lon } : null;
  } catch {
    return null;
  }
}

function writePin(key: string, pin: GeoPoint | null) {
  try {
    if (typeof localStorage === 'undefined') return;
    if (!pin) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(pin));
  } catch {
    // The session still keeps the coordinate when storage is blocked.
  }
}

function readRules(): DispatchRules {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_RULES;
    const text = localStorage.getItem('wildcraft.dispatchRules');
    if (!text) return DEFAULT_RULES;
    const parsed = JSON.parse(text) as Partial<DispatchRules>;
    return sanitizeRules({ ...DEFAULT_RULES, ...parsed });
  } catch {
    return DEFAULT_RULES;
  }
}

function sanitizeRules(rules: DispatchRules): DispatchRules {
  const arrival = clamp(rules.arrivalRadiusM, 20, 500, DEFAULT_RULES.arrivalRadiusM);
  return {
    smokeConfidence: clamp(rules.smokeConfidence, 0.05, 0.99, DEFAULT_RULES.smokeConfidence),
    fireConfidence: clamp(rules.fireConfidence, 0.05, 0.99, DEFAULT_RULES.fireConfidence),
    mq135High: clamp(rules.mq135High, 1, 4095, DEFAULT_RULES.mq135High),
    mq9High: clamp(rules.mq9High, 1, 4095, DEFAULT_RULES.mq9High),
    matchWindowMs: clamp(rules.matchWindowMs, 5_000, 300_000, DEFAULT_RULES.matchWindowMs),
    sensorStaleMs: clamp(rules.sensorStaleMs, 5_000, 600_000, DEFAULT_RULES.sensorStaleMs),
    cooldownMs: clamp(rules.cooldownMs, 10_000, 1_800_000, DEFAULT_RULES.cooldownMs),
    autoDispatch: rules.autoDispatch === 'off' || rules.autoDispatch === 'fire_and_gas' || rules.autoDispatch === 'smoke_and_gas' || rules.autoDispatch === 'any_alert' || rules.autoDispatch === 'combined' ? rules.autoDispatch : 'combined',
    arrivalRadiusM: arrival,
    approachRadiusM: Math.max(arrival + 50, clamp(rules.approachRadiusM, 50, 5_000, DEFAULT_RULES.approachRadiusM)),
    simSpeedMps: clamp(rules.simSpeedMps, 20, 2_000, DEFAULT_RULES.simSpeedMps),
  };
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function nextId(prefix: string, nowMs: number): string {
  seq += 1;
  return `${prefix}-${nowMs.toString(36)}-${seq.toString(36)}`;
}

let documentState: OpsDocument = {
  rules: readRules(),
  incident: null,
  mission: null,
  popup: null,
  history: [],
  launch: readPin('wildcraft.launchPin'),
  realPin: readPin('wildcraft.sensorPin'),
  follow: false,
  showSim: true,
  showReal: true,
  demoMode: false,
  note: 'Autonomous dispatch is a map simulation. No flight controller is connected.',
  live: null,
  selectedNodeId: 'sim-tadoba-04',
  detailNodeId: null,
  backendUrl: '',
  logLinked: false,
  cooldownUntilMs: 0,
};

function emit() {
  listeners.forEach((listener) => listener());
}

function emitPose() {
  poseListeners.forEach((listener) => listener());
}

export function subscribeOps(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getOpsDocument(): OpsDocument {
  return documentState;
}

export function subscribePose(listener: () => void): () => void {
  poseListeners.add(listener);
  return () => poseListeners.delete(listener);
}

export function getPose(): SimulatedPose | null {
  return pose;
}

function stamp(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString();
}

function historyFrom(incident: Incident, mission: Mission | null): HistoryRow {
  return {
    id: incident.id,
    atMs: incident.createdAtMs,
    kind: incident.evidenceClass === 'simulated_test' ? 'simulated_test' : 'rule_alert',
    incidentId: incident.id,
    category: incident.category,
    camera: incident.camera ? `${incident.camera.className} ${incident.camera.confidence.toFixed(2)}` : 'No qualifying camera evidence',
    sensor: incident.sensorSource === 'none'
      ? 'No sensor evidence'
      : `MQ135 ${incident.mq135 ?? 'unavailable'} · MQ9 ${incident.mq9 ?? 'unavailable'} · ${incident.sensorSource}`,
    destination: mission ? `${mission.destinationName} (${mission.destinationKind})` : incident.destinationNodeId ?? 'Not selected',
    evidence: incident.evidenceClass === 'simulated_test' ? 'Simulated test' : 'Observed evidence, rule alert',
    missionStart: stamp(mission?.startedAtMs ?? null),
    arrival: stamp(mission?.arrivalAtMs ?? null),
    outcome: mission?.outcome ?? incident.blockReason ?? incident.summary,
    returnStatus: mission?.returnStatus ?? 'No mission',
  };
}

function withHistory(history: HistoryRow[], incident: Incident | null, mission: Mission | null): HistoryRow[] {
  if (!incident) return history;
  const row = historyFrom(incident, mission);
  const index = history.findIndex((item) => item.id === incident.id);
  if (index === -1) return [row, ...history].slice(0, 40);
  return history.map((item, itemIndex) => (itemIndex === index ? row : item));
}

function publish(next: OpsDocument, nextPose: SimulatedPose | null) {
  documentState = next;
  pose = nextPose;
  emit();
  emitPose();
}

function nodeById(id: string | null): SimulatedNode | undefined {
  return SIMULATED_NODES.find((item) => item.id === id);
}

function selectedDestination(): Destination | null {
  if (documentState.selectedNodeId === REAL_NODE_ID) {
    if (!isGeoPoint(documentState.realPin)) return null;
    return { kind: 'real_node', id: REAL_NODE_ID, name: REAL_NODE_NAME, lat: documentState.realPin.lat, lon: documentState.realPin.lon };
  }
  const node = nodeById(documentState.selectedNodeId);
  return node ? { kind: 'simulated_node', id: node.id, name: node.name, lat: node.lat, lon: node.lon } : null;
}

function desk(): DeskState {
  return { incident: documentState.incident, cooldownUntilMs: documentState.cooldownUntilMs, mission: documentState.mission };
}

function commit(result: DeskResult) {
  const previous = documentState;
  const mission = result.desk.mission;
  const incident = result.desk.incident;
  const history = withHistory(previous.history, incident, mission);
  publish(
    {
      ...previous,
      incident,
      mission,
      cooldownUntilMs: result.desk.cooldownUntilMs,
      note: result.note,
      follow: result.createdMission && mission ? true : previous.follow,
      history,
    },
    mission?.pose ?? pose,
  );
  if (result.createdMission && mission && incident) persistCreate(incident, mission);
  else if (incident && (result.createdAlert || incident.status !== previous.incident?.status || incident.category !== previous.incident?.category)) persistIncident(incident);
}

function persistIncident(incident: Incident) {
  const kind: EvidenceKind = incident.evidenceClass === 'simulated_test' ? 'simulated_test' : 'rule_alert';
  void postMission(documentState.backendUrl, '/api/incidents', {
    kind,
    incident_id: incident.id,
    mission_id: incident.missionId,
    state: incident.phase,
    summary: incident.summary,
    evidence_class: incident.evidenceClass,
    category: incident.category,
    payload: { sensor_source: incident.sensorSource },
  }).catch(() => setNote('The mission log did not accept the incident. The map simulation is still local.'));
}

function persistCreate(incident: Incident, mission: Mission) {
  void persistIncident(incident);
  void postMission(documentState.backendUrl, '/api/missions', {
    incident_id: incident.id,
    mission_id: mission.id,
    launch_lat: mission.launch.lat,
    launch_lon: mission.launch.lon,
    destination_lat: mission.destination.lat,
    destination_lon: mission.destination.lon,
    destination_kind: mission.destinationKind,
    destination_node_id: mission.destinationNodeId,
    state: mission.state,
    summary: mission.routeNote,
    simulation: true,
    kind: 'mission_event',
    evidence_class: mission.evidenceClass,
    payload: { route: mission.routeNote },
  }).catch(() => setNote('The mission log did not accept the simulated mission. Motion on the map continues locally.'));
}

function persistTransition(mission: Mission) {
  void postMission(documentState.backendUrl, `/api/missions/${encodeURIComponent(mission.id)}/transition`, {
    state: mission.state,
    summary: mission.outcome ?? mission.state,
    outcome: mission.outcome,
    simulation: true,
  }).catch(() => undefined);
}

function persistPosition(mission: Mission) {
  void postMission(documentState.backendUrl, `/api/missions/${encodeURIComponent(mission.id)}/position`, {
    lat: mission.pose.lat,
    lon: mission.pose.lon,
    heading_deg: mission.pose.headingDeg,
    distance_remaining_m: mission.pose.distanceRemainingM,
    state: mission.state,
    simulation: true,
    persist: true,
  }).catch(() => undefined);
}

function setNote(note: string) {
  documentState = { ...documentState, note };
  emit();
}

export function setBackendUrl(url: string) {
  if (documentState.backendUrl === url) return;
  documentState = { ...documentState, backendUrl: url };
  emit();
  connectLog(url);
  void refreshHistory();
}

function connectLog(url: string) {
  socket?.close();
  socket = null;
  const target = websocketUrl(url, '/ws/missions');
  if (!target || typeof WebSocket === 'undefined') {
    documentState = { ...documentState, logLinked: false };
    return;
  }
  try {
    const next = new WebSocket(target);
    socket = next;
    next.onopen = () => {
      if (socket !== next) return;
      documentState = { ...documentState, logLinked: true };
      emit();
    };
    next.onclose = () => {
      if (socket !== next) return;
      documentState = { ...documentState, logLinked: false };
      emit();
    };
    next.onerror = () => undefined;
  } catch {
    documentState = { ...documentState, logLinked: false };
  }
}

async function refreshHistory() {
  try {
    const body = await loadIncidentHistory(documentState.backendUrl);
    if (!body || typeof body !== 'object' || !('incidents' in body) || !Array.isArray(body.incidents)) return;
    if (documentState.history.length > 0) return;
    const history: HistoryRow[] = body.incidents.slice(0, 40).map((item) => {
      const row = item as { incident_id?: string; created_at?: string; kind?: EvidenceKind; category?: string; summary?: string; evidence_class?: string };
      return {
        id: row.incident_id ?? 'stored',
        atMs: row.created_at ? Date.parse(row.created_at) : Date.now(),
        kind: row.kind ?? 'rule_alert',
        incidentId: row.incident_id ?? 'stored',
        category: row.category ?? 'stored',
        camera: 'Stored record',
        sensor: 'Stored record',
        destination: 'Stored record',
        evidence: row.evidence_class === 'simulated_test' ? 'Simulated test' : 'Stored rule alert',
        missionStart: null,
        arrival: null,
        outcome: row.summary ?? '',
        returnStatus: 'See the mission log',
      };
    });
    documentState = { ...documentState, history };
    emit();
  } catch {
    // An older backend without the mission log keeps the local history.
  }
}

export function setLaunch(pin: GeoPoint | null) {
  writePin('wildcraft.launchPin', pin);
  documentState = { ...documentState, launch: pin, note: pin ? 'Launch point saved for simulation only.' : 'Launch point cleared. A mission cannot be created without it.' };
  emit();
}

export function setRealPin(pin: GeoPoint | null) {
  documentState = { ...documentState, realPin: pin };
  emit();
}

export function setFollow(follow: boolean) {
  documentState = { ...documentState, follow };
  emit();
}

export function setShowSim(showSim: boolean) {
  documentState = { ...documentState, showSim };
  emit();
}

export function setShowReal(showReal: boolean) {
  documentState = { ...documentState, showReal };
  emit();
}

export function setDemoMode(demoMode: boolean) {
  documentState = { ...documentState, demoMode, note: demoMode ? 'Demo mode is on. Simulated node values are generated and are not field measurements.' : 'Demo mode is off. Simulated nodes stay on the map without generated readings.' };
  emit();
}

export function setSelectedNode(id: string) {
  documentState = { ...documentState, selectedNodeId: id, detailNodeId: id };
  emit();
}

export function setRules(patch: Partial<DispatchRules>) {
  const rules = sanitizeRules({ ...documentState.rules, ...patch });
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem('wildcraft.dispatchRules', JSON.stringify(rules));
  } catch {
    // The open session still uses the edited rule.
  }
  documentState = { ...documentState, rules };
  emit();
}

export function offerLive(input: { nowMs: number; events: DetectionLike[]; sensor: PacketLike | null; link: string }) {
  const parsed = input.sensor ? Date.parse(input.sensor.timestamp) : Number.NaN;
  const timestampMs = Number.isFinite(parsed) ? parsed : null;
  const fresh = timestampMs !== null && input.nowMs - timestampMs <= documentState.rules.sensorStaleMs && input.nowMs - timestampMs >= 0;
  const live: LiveSnapshot = {
    link: input.link,
    timestamp: input.sensor?.timestamp ?? null,
    fresh,
    tempC: input.sensor ? input.sensor.temp_c : null,
    humidityPct: input.sensor ? input.sensor.humidity_percent : null,
    mq135: input.sensor ? input.sensor.mq135_raw : null,
    mq9: input.sensor ? input.sensor.mq9_raw : null,
    rssiDbm: input.sensor ? input.sensor.rssi_dbm : null,
  };
  const cameras: CameraEvidence[] = [];
  for (const event of input.events) {
    const observedAtMs = Date.parse(event.created_at);
    if (!Number.isFinite(observedAtMs)) continue;
    cameras.push({ id: event.id, className: event.class_name, confidence: event.confidence, observedAtMs });
  }
  const sensor: SensorEvidence | null = input.sensor
    ? {
        timestampMs,
        tempC: input.sensor.temp_c,
        humidityPct: input.sensor.humidity_percent,
        mq135: input.sensor.mq135_raw,
        mq9: input.sensor.mq9_raw,
        flame: null,
        rssiDbm: input.sensor.rssi_dbm,
        source: 'serial',
      }
    : null;
  const destination = isGeoPoint(documentState.realPin)
    ? { kind: 'real_node' as const, id: REAL_NODE_ID, name: REAL_NODE_NAME, lat: documentState.realPin.lat, lon: documentState.realPin.lon }
    : null;
  const result = applyEvidence(desk(), {
    nowMs: input.nowMs,
    rules: documentState.rules,
    cameras,
    sensor,
    evidenceClass: 'observed',
    incidentId: documentState.incident?.status === 'closed' || !documentState.incident ? nextId('inc', input.nowMs) : documentState.incident.id,
    missionId: nextId('msn', input.nowMs),
    launch: documentState.launch,
    destination,
  });
  if (
    !result.createdAlert
    && !result.createdMission
    && result.desk.incident?.id === documentState.incident?.id
    && result.desk.incident?.category === documentState.incident?.category
    && result.desk.incident?.status === documentState.incident?.status
    && result.desk.mission?.id === documentState.mission?.id
    && result.desk.mission?.state === documentState.mission?.state
  ) {
    if (!sameLive(documentState.live, live)) {
      documentState = { ...documentState, live };
      emit();
    }
    return;
  }
  documentState = { ...documentState, live };
  commit(result);
}

function sameLive(left: LiveSnapshot | null, right: LiveSnapshot): boolean {
  if (!left) return false;
  return left.link === right.link
    && left.timestamp === right.timestamp
    && left.fresh === right.fresh
    && left.tempC === right.tempC
    && left.humidityPct === right.humidityPct
    && left.mq135 === right.mq135
    && left.mq9 === right.mq9
    && left.rssiDbm === right.rssiDbm;
}

export function runDemoScenario(nowMs: number) {
  if (documentState.mission && !TERMINAL_STATES.has(documentState.mission.state)) {
    setNote('A simulated mission is already active.');
    return;
  }
  if (documentState.incident && documentState.incident.status !== 'closed') {
    setNote('Dismiss the open alert before running the simulated test scenario.');
    return;
  }
  const node = nodeById(documentState.selectedNodeId) ?? nodeById('sim-tadoba-04');
  if (!node) return;
  const reading = demoReading(node, nowMs, true);
  documentState = { ...documentState, demoMode: true, selectedNodeId: node.id };
  const result = applyEvidence(desk(), {
    nowMs,
    rules: documentState.rules,
    cameras: [{ id: `demo-fire-${nowMs}`, className: 'fire', confidence: 0.55, observedAtMs: nowMs }],
    sensor: {
      timestampMs: nowMs,
      tempC: reading.tempC,
      humidityPct: reading.humidityPct,
      mq135: reading.mq135,
      mq9: reading.mq9,
      flame: reading.flame,
      rssiDbm: null,
      source: 'simulated',
    },
    evidenceClass: 'simulated_test',
    incidentId: nextId('inc', nowMs),
    missionId: nextId('msn', nowMs),
    launch: documentState.launch,
    destination: { kind: 'simulated_node', id: node.id, name: node.name, lat: node.lat, lon: node.lon },
    bypassCooldown: true,
  });
  commit(result);
}

export function dispatchSelected(nowMs: number) {
  const result = manualDispatch(desk(), {
    nowMs,
    rules: documentState.rules,
    incidentId: nextId('inc', nowMs),
    missionId: nextId('msn', nowMs),
    launch: documentState.launch,
    destination: selectedDestination(),
  });
  commit(result);
}

export function dismissAlert(nowMs: number) {
  if (documentState.mission && !TERMINAL_STATES.has(documentState.mission.state)) {
    setNote('Cancel the simulated mission before dismissing the incident.');
    return;
  }
  if (!documentState.incident || documentState.incident.status === 'closed') return;
  const incident = { ...documentState.incident, status: 'closed' as const };
  documentState = {
    ...documentState,
    incident,
    history: withHistory(documentState.history, incident, documentState.mission),
    cooldownUntilMs: nowMs + documentState.rules.cooldownMs,
    note: 'Alert dismissed. Cooldown is active.',
  };
  emit();
}

export function advanceSimulation(nowMs: number) {
  const mission = documentState.mission;
  if (!mission || !MOVING_STATES.has(mission.state)) return;
  const sampled = sampleMission(mission, nowMs, documentState.rules);
  const consumed = consumeArrival(mission, sampled, nowMs);
  const next = consumed.mission;
  pose = next.pose;
  emitPose();
  if (!consumed.openPopup && next.state === mission.state) {
    if (nowMs - lastPersist > 5_000) {
      lastPersist = nowMs;
      persistPosition(next);
      documentState = { ...documentState, mission: next };
    }
    return;
  }
  const node = nodeById(next.destinationNodeId);
  const popup = consumed.openPopup && documentState.incident
    ? buildArrivalPopup(
        next,
        documentState.incident,
        documentState.live,
        node ? demoReading(node, nowMs, documentState.demoMode || next.evidenceClass === 'simulated_test') : null,
        nowMs,
      )
    : documentState.popup;
  const closed = TERMINAL_STATES.has(next.state);
  const incident = documentState.incident
    ? { ...documentState.incident, phase: next.state, status: closed ? 'closed' as const : documentState.incident.status }
    : null;
  documentState = {
    ...documentState,
    mission: next,
    incident,
    popup,
    cooldownUntilMs: closed ? nowMs + documentState.rules.cooldownMs : documentState.cooldownUntilMs,
    note: next.outcome ?? documentState.note,
    history: withHistory(documentState.history, incident, next),
  };
  emit();
  persistTransition(next);
}

export function closePopup() {
  documentState = { ...documentState, popup: null };
  emit();
}

export function inspectNode() {
  const id = documentState.mission?.destinationNodeId ?? documentState.selectedNodeId;
  documentState = { ...documentState, detailNodeId: id };
  emit();
}

export function continueActive() {
  if (!documentState.mission) return;
  const mission = continueMission(documentState.mission);
  const popup = documentState.popup ? { ...documentState.popup, inspectionResult: mission.inspectionResult ?? documentState.popup.inspectionResult, missionStatus: mission.state } : null;
  documentState = {
    ...documentState,
    mission,
    popup,
    note: mission.inspectionResult ?? documentState.note,
    history: withHistory(documentState.history, documentState.incident, mission),
  };
  emit();
}

export function returnActive(nowMs: number) {
  if (!documentState.mission) return;
  const mission = commandReturn(documentState.mission, nowMs);
  documentState = {
    ...documentState,
    mission,
    note: 'Return to launch is a simulation. No aircraft was commanded.',
    history: withHistory(documentState.history, documentState.incident, mission),
  };
  pose = mission.pose;
  emit();
  emitPose();
  persistTransition(mission);
}

export function stopActive(nowMs: number, emergency: boolean) {
  if (!documentState.mission) return;
  const mission = cancelMission(documentState.mission, nowMs, emergency);
  const incident = documentState.incident ? { ...documentState.incident, status: 'closed' as const, phase: mission.state } : null;
  documentState = {
    ...documentState,
    mission,
    incident,
    cooldownUntilMs: nowMs + documentState.rules.cooldownMs,
    note: mission.outcome ?? 'Simulation stopped.',
    history: withHistory(documentState.history, incident, mission),
  };
  pose = mission.pose;
  emit();
  emitPose();
  persistTransition(mission);
}
