import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEvidence, type DeskState } from './dispatch';
import { DEFAULT_RULES } from './incidentRules';
import type { SensorEvidence } from './types';

const launch = { lat: 20.2, lon: 79.4 };
const destination = { kind: 'real_node' as const, id: 'real-lora-1', name: 'LoRa sensor node', lat: 20.22, lon: 79.4 };
const empty = (): DeskState => ({ incident: null, cooldownUntilMs: 0, mission: null });

function sensor(patch: Partial<SensorEvidence> & { timestampMs: number | null }): SensorEvidence {
  return {
    tempC: 31,
    humidityPct: 50,
    mq135: null,
    mq9: null,
    flame: null,
    rssiDbm: -40,
    source: 'serial',
    ...patch,
  };
}

test('combined fire and gas opens one incident and one simulated mission', () => {
  const now = 1_700_000_000_000;
  const first = applyEvidence(empty(), {
    nowMs: now,
    rules: DEFAULT_RULES,
    cameras: [{ id: 'cam-fire', className: 'fire', confidence: 0.31, observedAtMs: now - 5_000 }],
    sensor: sensor({ timestampMs: now, mq135: 651, mq9: 400 }),
    evidenceClass: 'observed',
    incidentId: 'inc-1',
    missionId: 'msn-1',
    launch,
    destination,
  });
  assert.equal(first.createdMission, true);
  assert.equal(first.createdAlert, true);
  assert.equal(first.desk.incident?.category, 'confirmed_multi');
  assert.equal(first.desk.incident?.id, 'inc-1');
  assert.equal(first.desk.mission?.id, 'msn-1');
  assert.equal(first.desk.mission?.simulation, true);
  assert.equal(first.desk.mission?.state, 'TAKEOFF_SIMULATED');
  const second = applyEvidence(first.desk, {
    nowMs: now + 1_000,
    rules: DEFAULT_RULES,
    cameras: [{ id: 'cam-fire', className: 'fire', confidence: 0.31, observedAtMs: now - 5_000 }],
    sensor: sensor({ timestampMs: now, mq135: 651, mq9: 400 }),
    evidenceClass: 'observed',
    incidentId: 'inc-2',
    missionId: 'msn-2',
    launch,
    destination,
  });
  assert.equal(second.createdMission, false);
  assert.equal(second.desk.mission?.id, 'msn-1');
  assert.equal(second.desk.incident?.id, 'inc-1');
});

test('camera-only and sensor-only alerts do not auto-dispatch', () => {
  const now = 1_700_000_000_000;
  const camera = applyEvidence(empty(), {
    nowMs: now,
    rules: DEFAULT_RULES,
    cameras: [{ id: 'cam-fire', className: 'fire', confidence: 0.9, observedAtMs: now }],
    sensor: sensor({ timestampMs: now, mq135: 100, mq9: 100 }),
    evidenceClass: 'observed',
    incidentId: 'inc-cam',
    missionId: 'msn-cam',
    launch,
    destination,
  });
  assert.equal(camera.desk.incident?.category, 'camera_only');
  assert.equal(camera.createdMission, false);
  assert.equal(camera.desk.mission, null);
  const gas = applyEvidence(empty(), {
    nowMs: now,
    rules: DEFAULT_RULES,
    cameras: [],
    sensor: sensor({ timestampMs: now, mq135: 800, mq9: null }),
    evidenceClass: 'observed',
    incidentId: 'inc-gas',
    missionId: 'msn-gas',
    launch,
    destination,
  });
  assert.equal(gas.desk.incident?.category, 'sensor_only');
  assert.equal(gas.createdMission, false);
});

test('duplicate sensor messages and a raw value of 650 do not dispatch', () => {
  const now = 1_700_000_000_000;
  const first = applyEvidence(empty(), {
    nowMs: now,
    rules: DEFAULT_RULES,
    cameras: [],
    sensor: sensor({ timestampMs: now, mq9: 700, mq135: null }),
    evidenceClass: 'observed',
    incidentId: 'inc-gas',
    missionId: 'msn-gas',
    launch,
    destination,
  });
  const duplicate = applyEvidence(first.desk, {
    nowMs: now + 500,
    rules: DEFAULT_RULES,
    cameras: [],
    sensor: sensor({ timestampMs: now, mq9: 700, mq135: null }),
    evidenceClass: 'observed',
    incidentId: 'inc-other',
    missionId: 'msn-other',
    launch,
    destination,
  });
  assert.equal(duplicate.createdAlert, false);
  assert.equal(duplicate.createdMission, false);
  assert.equal(duplicate.desk.incident?.id, 'inc-gas');
  assert.match(duplicate.note, /Duplicate/);
  const exact = applyEvidence(empty(), {
    nowMs: now,
    rules: DEFAULT_RULES,
    cameras: [],
    sensor: sensor({ timestampMs: now, mq135: 650, mq9: 650 }),
    evidenceClass: 'observed',
    incidentId: 'inc-exact',
    missionId: 'msn-exact',
    launch,
    destination,
  });
  assert.equal(exact.desk.incident, null);
  assert.equal(exact.createdMission, false);
});

test('stale or missing gas cannot satisfy the combined rule', () => {
  const now = 1_700_000_000_000;
  const stale = applyEvidence(empty(), {
    nowMs: now,
    rules: DEFAULT_RULES,
    cameras: [{ id: 'cam-fire', className: 'fire', confidence: 0.8, observedAtMs: now }],
    sensor: sensor({ timestampMs: now - 61_000, mq135: 900, mq9: 900 }),
    evidenceClass: 'observed',
    incidentId: 'inc-stale',
    missionId: 'msn-stale',
    launch,
    destination,
  });
  assert.equal(stale.desk.incident?.category, 'camera_only');
  assert.equal(stale.createdMission, false);
  const missing = applyEvidence(empty(), {
    nowMs: now,
    rules: DEFAULT_RULES,
    cameras: [{ id: 'cam-smoke', className: 'smoke', confidence: 0.4, observedAtMs: now }],
    sensor: sensor({ timestampMs: now, mq135: null, mq9: null }),
    evidenceClass: 'observed',
    incidentId: 'inc-missing',
    missionId: 'msn-missing',
    launch,
    destination,
  });
  assert.equal(missing.desk.incident?.category, 'camera_only');
  assert.equal(missing.createdMission, false);
  assert.equal(missing.desk.incident?.mq135, null);
});

test('smoke plus fresh gas dispatches, and a sensor-only alert can upgrade once', () => {
  const now = 1_700_000_000_000;
  const smoke = applyEvidence(empty(), {
    nowMs: now,
    rules: DEFAULT_RULES,
    cameras: [{ id: 'cam-smoke', className: 'smoke', confidence: 0.4, observedAtMs: now }],
    sensor: sensor({ timestampMs: now, mq9: 651, mq135: 100 }),
    evidenceClass: 'observed',
    incidentId: 'inc-smoke',
    missionId: 'msn-smoke',
    launch,
    destination,
  });
  assert.equal(smoke.desk.incident?.category, 'smoke_plus_sensor');
  assert.equal(smoke.createdMission, true);
  const weak = applyEvidence(empty(), {
    nowMs: now,
    rules: DEFAULT_RULES,
    cameras: [{ id: 'cam-weak', className: 'smoke', confidence: 0.39, observedAtMs: now }],
    sensor: sensor({ timestampMs: now, mq9: 800, mq135: null }),
    evidenceClass: 'observed',
    incidentId: 'inc-weak',
    missionId: 'msn-weak',
    launch,
    destination,
  });
  assert.equal(weak.desk.incident?.category, 'sensor_only');
  assert.equal(weak.createdMission, false);
  const opened = applyEvidence(empty(), {
    nowMs: now,
    rules: DEFAULT_RULES,
    cameras: [],
    sensor: sensor({ timestampMs: now, mq135: 700, mq9: null }),
    evidenceClass: 'observed',
    incidentId: 'inc-open',
    missionId: 'msn-open',
    launch,
    destination,
  });
  const upgraded = applyEvidence(opened.desk, {
    nowMs: now + 10_000,
    rules: DEFAULT_RULES,
    cameras: [{ id: 'cam-later', className: 'fire', confidence: 0.3, observedAtMs: now + 10_000 }],
    sensor: sensor({ timestampMs: now, mq135: 700, mq9: null }),
    evidenceClass: 'observed',
    incidentId: 'inc-new',
    missionId: 'msn-new',
    launch,
    destination,
  });
  assert.equal(upgraded.desk.incident?.id, 'inc-open');
  assert.equal(upgraded.desk.incident?.category, 'confirmed_multi');
  assert.equal(upgraded.createdMission, true);
  assert.equal(upgraded.desk.mission?.id, 'msn-new');
});

test('events outside 30 seconds do not combine, and cooldown blocks the next alert', () => {
  const now = 1_700_000_000_000;
  const apart = applyEvidence(empty(), {
    nowMs: now + 31_000,
    rules: DEFAULT_RULES,
    cameras: [{ id: 'cam-old', className: 'fire', confidence: 0.9, observedAtMs: now }],
    sensor: sensor({ timestampMs: now + 31_000, mq135: 800, mq9: null }),
    evidenceClass: 'observed',
    incidentId: 'inc-apart',
    missionId: 'msn-apart',
    launch,
    destination,
  });
  assert.equal(apart.desk.incident?.category, 'sensor_only');
  assert.equal(apart.createdMission, false);
  const closed = applyEvidence(apart.desk, {
    nowMs: now + 31_000 + 31_000,
    rules: DEFAULT_RULES,
    cameras: [],
    sensor: sensor({ timestampMs: now + 31_000, mq135: 800, mq9: null }),
    evidenceClass: 'observed',
    incidentId: 'inc-apart',
    missionId: 'msn-apart',
    launch,
    destination,
  });
  assert.equal(closed.desk.incident?.status, 'closed');
  const blocked = applyEvidence(closed.desk, {
    nowMs: now + 70_000,
    rules: DEFAULT_RULES,
    cameras: [],
    sensor: sensor({ timestampMs: now + 70_000, mq135: 900, mq9: null }),
    evidenceClass: 'observed',
    incidentId: 'inc-next',
    missionId: 'msn-next',
    launch,
    destination,
  });
  assert.equal(blocked.createdAlert, false);
  assert.match(blocked.note, /Cooldown/);
});

test('missing launch or destination blocks geographic dispatch', () => {
  const now = 1_700_000_000_000;
  const base = {
    nowMs: now,
    rules: DEFAULT_RULES,
    cameras: [{ id: 'cam-fire', className: 'fire', confidence: 0.5, observedAtMs: now }],
    sensor: sensor({ timestampMs: now, mq135: 700, mq9: 700 }),
    evidenceClass: 'observed' as const,
    incidentId: 'inc-geo',
    missionId: 'msn-geo',
  };
  const noLaunch = applyEvidence(empty(), { ...base, launch: null, destination });
  assert.equal(noLaunch.createdMission, false);
  assert.equal(noLaunch.desk.mission, null);
  assert.match(noLaunch.note, /Launch coordinates/);
  const noDestination = applyEvidence(empty(), { ...base, launch, destination: null });
  assert.equal(noDestination.createdMission, false);
  assert.match(noDestination.note, /Destination coordinates/);
});
