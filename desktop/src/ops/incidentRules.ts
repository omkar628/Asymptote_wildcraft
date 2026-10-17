import type {
  AutoDispatchMode,
  CameraEvidence,
  DispatchRules,
  Incident,
  IncidentCategory,
  SensorEvidence,
} from './types';

export const SMOKE_CONFIDENCE = 0.4;
export const FIRE_CONFIDENCE = 0.2;
export const GAS_HIGH_RAW = 650;
export const MATCH_WINDOW_MS = 30_000;
export const SENSOR_STALE_MS = 60_000;
export const COOLDOWN_MS = 120_000;

export const DEFAULT_RULES: DispatchRules = {
  smokeConfidence: SMOKE_CONFIDENCE,
  fireConfidence: FIRE_CONFIDENCE,
  mq135High: GAS_HIGH_RAW,
  mq9High: GAS_HIGH_RAW,
  matchWindowMs: MATCH_WINDOW_MS,
  sensorStaleMs: SENSOR_STALE_MS,
  cooldownMs: COOLDOWN_MS,
  autoDispatch: 'combined',
  arrivalRadiusM: 80,
  approachRadiusM: 500,
  simSpeedMps: 250,
};

export type ReviewResult = {
  incident: Incident | null;
  cooldownUntilMs: number;
  requestDispatch: boolean;
  created: boolean;
  note: string;
};

type Qualified = CameraEvidence & { kind: 'fire' | 'smoke' };

function finite(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

export function shouldAutoDispatch(category: IncidentCategory, mode: AutoDispatchMode): boolean {
  if (category === 'manual_test' || mode === 'off') return false;
  if (mode === 'any_alert') return true;
  if (mode === 'combined') return category === 'confirmed_multi' || category === 'smoke_plus_sensor';
  if (mode === 'fire_and_gas') return category === 'confirmed_multi';
  if (mode === 'smoke_and_gas') return category === 'smoke_plus_sensor';
  return false;
}

export function qualifyCamera(camera: CameraEvidence, rules: DispatchRules): 'fire' | 'smoke' | null {
  const confidence = finite(camera.confidence);
  const observed = finite(camera.observedAtMs);
  if (confidence === null || observed === null || !camera.id) return null;
  if (camera.className === 'fire' && confidence >= rules.fireConfidence) return 'fire';
  if (camera.className === 'smoke' && confidence >= rules.smokeConfidence) return 'smoke';
  return null;
}

function sensorFacts(sensor: SensorEvidence | null, nowMs: number, rules: DispatchRules): {
  timestampMs: number | null;
  fresh: boolean;
  mq135: number | null;
  mq9: number | null;
  tempC: number | null;
  humidityPct: number | null;
  flame: number | null;
  highMq135: boolean;
  highMq9: boolean;
  source: 'serial' | 'simulated' | 'none';
} {
  const timestampMs = finite(sensor?.timestampMs);
  const age = timestampMs === null ? null : nowMs - timestampMs;
  const fresh = age !== null && age >= 0 && age <= rules.sensorStaleMs;
  const mq135 = finite(sensor?.mq135);
  const mq9 = finite(sensor?.mq9);
  return {
    timestampMs,
    fresh,
    mq135,
    mq9,
    tempC: finite(sensor?.tempC),
    humidityPct: finite(sensor?.humidityPct),
    flame: finite(sensor?.flame),
    highMq135: fresh && mq135 !== null && mq135 > rules.mq135High,
    highMq9: fresh && mq9 !== null && mq9 > rules.mq9High,
    source: sensor?.source ?? 'none',
  };
}

function pick(cameras: CameraEvidence[], rules: DispatchRules, accept: (camera: CameraEvidence) => boolean): Qualified | null {
  let best: Qualified | null = null;
  for (const camera of cameras) {
    const kind = qualifyCamera(camera, rules);
    if (!kind || !accept(camera)) continue;
    const qualified = { ...camera, kind };
    if (!best) {
      best = qualified;
      continue;
    }
    const fireRank = (item: Qualified) => (item.kind === 'fire' ? 1 : 0);
    if (fireRank(qualified) > fireRank(best) || (qualified.kind === best.kind && qualified.confidence > best.confidence)) {
      best = qualified;
    }
  }
  return best;
}

function categoryFor(kind: 'fire' | 'smoke'): IncidentCategory {
  return kind === 'fire' ? 'confirmed_multi' : 'smoke_plus_sensor';
}

function summaryFor(category: IncidentCategory, camera: Qualified | null, high135: boolean, high9: boolean): string {
  const gas = [high135 ? 'MQ135 high' : '', high9 ? 'MQ9 high' : ''].filter(Boolean).join(' and ') || 'no high gas';
  if (category === 'confirmed_multi' || category === 'smoke_plus_sensor') {
    return `${camera?.kind ?? 'camera'} ${camera?.confidence.toFixed(2) ?? ''} with ${gas} inside the match window`.trim();
  }
  if (category === 'sensor_only') return `${gas}. No qualifying camera evidence inside the match window.`;
  if (category === 'camera_only') return `${camera?.kind ?? 'camera'} ${camera?.confidence.toFixed(2) ?? ''} without a fresh high gas reading`.trim();
  return 'Manual simulation dispatch. No combined-evidence rule was applied.';
}

function buildIncident(
  id: string,
  nowMs: number,
  category: IncidentCategory,
  evidenceClass: 'observed' | 'simulated_test',
  camera: Qualified | null,
  facts: ReturnType<typeof sensorFacts>,
): Incident {
  return {
    id,
    createdAtMs: nowMs,
    category,
    status: 'open',
    evidenceClass,
    phase: 'INCIDENT_DETECTED',
    camera: camera ? { id: camera.id, className: camera.kind, confidence: camera.confidence, observedAtMs: camera.observedAtMs } : null,
    sensorTimestampMs: facts.timestampMs,
    mq135: facts.mq135,
    mq9: facts.mq9,
    tempC: facts.tempC,
    humidityPct: facts.humidityPct,
    flame: facts.flame,
    highMq135: facts.highMq135,
    highMq9: facts.highMq9,
    sensorFresh: facts.fresh,
    sensorSource: facts.source === 'none' ? 'none' : facts.source,
    usedSensorTimestampMs: facts.fresh ? facts.timestampMs : null,
    usedCameraIds: camera ? [camera.id] : [],
    missionId: null,
    destinationNodeId: null,
    blockReason: null,
    summary: summaryFor(category, camera, facts.highMq135, facts.highMq9),
  };
}

function tryUpgrade(incident: Incident, camera: Qualified | null, facts: ReturnType<typeof sensorFacts>, rules: DispatchRules): Incident | null {
  if (incident.missionId || incident.status === 'closed') return null;
  if ((incident.category === 'sensor_only' || incident.category === 'camera_only') && camera && (facts.highMq135 || facts.highMq9)) {
    const sensorAt = facts.timestampMs ?? incident.sensorTimestampMs;
    if (sensorAt === null || Math.abs(camera.observedAtMs - sensorAt) > rules.matchWindowMs) return null;
    const category = categoryFor(camera.kind);
    return {
      ...incident,
      category,
      camera: { id: camera.id, className: camera.kind, confidence: camera.confidence, observedAtMs: camera.observedAtMs },
      sensorTimestampMs: facts.timestampMs ?? incident.sensorTimestampMs,
      mq135: facts.mq135 ?? incident.mq135,
      mq9: facts.mq9 ?? incident.mq9,
      tempC: facts.tempC ?? incident.tempC,
      humidityPct: facts.humidityPct ?? incident.humidityPct,
      flame: facts.flame ?? incident.flame,
      highMq135: facts.highMq135,
      highMq9: facts.highMq9,
      sensorFresh: facts.fresh,
      sensorSource: facts.source === 'none' ? incident.sensorSource : facts.source,
      usedSensorTimestampMs: facts.timestampMs ?? incident.usedSensorTimestampMs,
      usedCameraIds: [...new Set([...incident.usedCameraIds, camera.id])],
      summary: summaryFor(category, camera, facts.highMq135, facts.highMq9),
    };
  }
  return null;
}

export function reviewEvidence(input: {
  incident: Incident | null;
  cooldownUntilMs: number;
  nowMs: number;
  rules: DispatchRules;
  cameras: CameraEvidence[];
  sensor: SensorEvidence | null;
  evidenceClass: 'observed' | 'simulated_test';
  incidentId: string;
  bypassCooldown?: boolean;
}): ReviewResult {
  const facts = sensorFacts(input.sensor, input.nowMs, input.rules);
  const high = facts.highMq135 || facts.highMq9;
  const matched = high && facts.timestampMs !== null
    ? pick(input.cameras, input.rules, (camera) => Math.abs(camera.observedAtMs - (facts.timestampMs as number)) <= input.rules.matchWindowMs)
    : null;
  const recent = pick(
    input.cameras,
    input.rules,
    (camera) => input.nowMs - camera.observedAtMs <= input.rules.matchWindowMs && input.nowMs - camera.observedAtMs >= 0,
  );

  if (input.incident && input.incident.status !== 'closed') {
    if (input.incident.missionId) {
      return { incident: input.incident, cooldownUntilMs: input.cooldownUntilMs, requestDispatch: false, created: false, note: 'This incident already has a mission.' };
    }
    if (input.nowMs - input.incident.createdAtMs > input.rules.matchWindowMs) {
      return {
        incident: { ...input.incident, status: 'closed', phase: 'AWAITING_DISPATCH_RULE' },
        cooldownUntilMs: input.nowMs + input.rules.cooldownMs,
        requestDispatch: false,
        created: false,
        note: 'The match window elapsed without a dispatch.',
      };
    }
    const freshCamera = matched && !input.incident.usedCameraIds.includes(matched.id) ? matched : null;
    const sameSensor = facts.timestampMs !== null && input.incident.usedSensorTimestampMs === facts.timestampMs;
    if (sameSensor && !freshCamera) {
      return { incident: input.incident, cooldownUntilMs: input.cooldownUntilMs, requestDispatch: false, created: false, note: 'Duplicate sensor evidence was ignored.' };
    }
    const upgraded = tryUpgrade(input.incident, freshCamera ?? matched, facts, input.rules);
    if (upgraded && upgraded.category !== input.incident.category) {
      return {
        incident: upgraded,
        cooldownUntilMs: input.cooldownUntilMs,
        requestDispatch: shouldAutoDispatch(upgraded.category, input.rules.autoDispatch),
        created: false,
        note: 'The open alert was upgraded with matching evidence.',
      };
    }
    return { incident: input.incident, cooldownUntilMs: input.cooldownUntilMs, requestDispatch: false, created: false, note: 'An incident is already open.' };
  }

  if (!input.bypassCooldown && input.nowMs < input.cooldownUntilMs) {
    return { incident: input.incident, cooldownUntilMs: input.cooldownUntilMs, requestDispatch: false, created: false, note: 'Cooldown is active, so no new incident was opened.' };
  }

  let category: IncidentCategory | null = null;
  let camera: Qualified | null = null;
  if (matched && high) {
    category = categoryFor(matched.kind);
    camera = matched;
  } else if (high) {
    category = 'sensor_only';
  } else if (recent) {
    category = 'camera_only';
    camera = recent;
  }
  if (!category) {
    return { incident: input.incident, cooldownUntilMs: input.cooldownUntilMs, requestDispatch: false, created: false, note: 'No qualifying camera or fresh gas evidence.' };
  }
  const incident = buildIncident(input.incidentId, input.nowMs, category, input.evidenceClass, camera, facts);
  return {
    incident,
    cooldownUntilMs: input.cooldownUntilMs,
    requestDispatch: shouldAutoDispatch(category, input.rules.autoDispatch),
    created: true,
    note: incident.summary,
  };
}
