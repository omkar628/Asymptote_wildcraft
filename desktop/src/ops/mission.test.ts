import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { demoReading } from './demoTelemetry';
import { bearingDegrees, haversineMeters } from './geo';
import { pointInRing } from '../intel/geometry';
import { TADOBA_OUTLINE } from '../intel/tadobaPlaces';
import { DEFAULT_RULES } from './incidentRules';
import {
  ROUTE_NOTE,
  beginSimulation,
  cancelMission,
  commandReturn,
  consumeArrival,
  planMission,
  sampleMission,
} from './mission';
import { buildArrivalPopup } from './popup';
import { SIMULATED_NODES } from './simulatedNodes';
import type { Incident } from './types';

const rules = { ...DEFAULT_RULES, simSpeedMps: 200, arrivalRadiusM: 80, approachRadiusM: 500 };
const launch = { lat: 20.2, lon: 79.4 };
const destination = { kind: 'real_node' as const, id: 'real-lora-1', name: 'LoRa sensor node', lat: 20.22, lon: 79.4 };

function incident(): Incident {
  return {
    id: 'inc-1',
    createdAtMs: 0,
    category: 'confirmed_multi',
    status: 'open',
    evidenceClass: 'observed',
    phase: 'INCIDENT_DETECTED',
    camera: { id: 'cam-1', className: 'fire', confidence: 0.42, observedAtMs: 0 },
    sensorTimestampMs: 0,
    mq135: 700,
    mq9: 400,
    tempC: 32,
    humidityPct: 40,
    flame: null,
    highMq135: true,
    highMq9: false,
    sensorFresh: true,
    sensorSource: 'serial',
    usedSensorTimestampMs: 0,
    usedCameraIds: ['cam-1'],
    missionId: null,
    destinationNodeId: null,
    blockReason: null,
    summary: 'fire with MQ135',
  };
}

test('the simulated route moves north and arrives once inside 80 metres', () => {
  const planned = planMission({ missionId: 'msn-1', incident: incident(), launch, destination, nowMs: 0 });
  assert.equal(planned.ok, true);
  if (!planned.ok) return;
  assert.equal(planned.mission.routeNote, ROUTE_NOTE);
  assert.ok(bearingDegrees(launch, destination) < 1);
  let mission = beginSimulation(planned.mission, 0);
  const seen = new Set<string>();
  let opens = 0;
  for (let time = 200; time <= 20_000; time += 200) {
    const sampled = sampleMission(mission, time, rules);
    const consumed = consumeArrival(mission, sampled, time);
    if (consumed.openPopup) opens += 1;
    seen.add(consumed.mission.state);
    mission = consumed.mission;
  }
  assert.equal(opens, 1);
  assert.ok(seen.has('TAKEOFF_SIMULATED'));
  assert.ok(seen.has('EN_ROUTE'));
  assert.ok(seen.has('APPROACHING_DESTINATION'));
  assert.ok(seen.has('INSPECTING_NODE'));
  assert.ok(haversineMeters(mission.pose, destination) <= 80);
  assert.equal(mission.popupOpened, true);
  const extra = consumeArrival(mission, sampleMission(mission, 21_000, rules), 21_000);
  assert.equal(extra.openPopup, false);
});

test('cancel freezes the simulated drone and return to base completes', () => {
  const planned = planMission({ missionId: 'msn-1', incident: incident(), launch, destination, nowMs: 0 });
  assert.equal(planned.ok, true);
  if (!planned.ok) return;
  let mission = beginSimulation(planned.mission, 0);
  mission = sampleMission(mission, 4_000, rules);
  assert.equal(mission.state, 'EN_ROUTE');
  const stopped = cancelMission(mission, 4_000, true);
  const later = sampleMission(stopped, 9_000, rules);
  assert.equal(later.state, 'MISSION_CANCELLED');
  assert.equal(later.pose.lat, stopped.pose.lat);
  assert.match(later.outcome ?? '', /Emergency stop/);
  let returning = commandReturn(sampleMission(beginSimulation(planned.mission, 0), 15_000, rules).state === 'ARRIVED'
    ? sampleMission(beginSimulation(planned.mission, 0), 15_000, rules)
    : sampleMission(beginSimulation(planned.mission, 0), 15_000, rules), 15_000);
  returning = commandReturn(returning, 15_000);
  let done = returning;
  for (let time = 15_200; time <= 40_000; time += 200) {
    done = sampleMission(done, time, rules);
    if (done.state === 'MISSION_COMPLETED') break;
  }
  assert.equal(done.state, 'MISSION_COMPLETED');
  assert.ok(haversineMeters(done.pose, launch) <= 80);
  assert.match(done.returnStatus, /Returned/);
});

test('arrival popup keeps the real packet and does not invent flame or a simulated node', () => {
  const planned = planMission({ missionId: 'msn-1', incident: incident(), launch, destination, nowMs: 0 });
  assert.equal(planned.ok, true);
  if (!planned.ok) return;
  const arrived = { ...planned.mission, state: 'ARRIVED' as const, arrivalAtMs: 12_000, startedAtMs: 0, pose: { ...planned.mission.pose, distanceTravelledM: 2200 } };
  const popup = buildArrivalPopup(arrived, incident(), {
    link: 'Connected',
    timestamp: '2026-10-17T08:00:00+05:30',
    fresh: true,
    tempC: 33,
    humidityPct: 41,
    mq135: 710,
    mq9: 420,
    rssiDbm: -35,
  }, null, 12_000);
  assert.equal(popup.nodeTypeLabel, 'REAL HARDWARE');
  assert.equal(popup.nodeId, 'real-lora-1');
  assert.equal(popup.cameraClass, 'fire');
  assert.equal(popup.cameraConfidence, 0.42);
  assert.equal(popup.readings.find((row) => row.name === 'MQ135')?.value, '710 raw');
  assert.match(popup.readings.find((row) => row.name === 'Flame')?.value ?? '', /Unavailable/);
  assert.equal(popup.simulatedData, false);
  const simulated = buildArrivalPopup(
    { ...arrived, destinationKind: 'simulated_node', destinationNodeId: 'sim-tadoba-04', destinationName: 'Demo post 04', evidenceClass: 'simulated_test' },
    { ...incident(), evidenceClass: 'simulated_test', sensorSource: 'simulated' },
    null,
    demoReading(SIMULATED_NODES[3], 15_000, true),
    12_000,
  );
  assert.equal(simulated.nodeTypeLabel, 'SIMULATED');
  assert.match(simulated.evidenceLabel, /Simulated test/);
  assert.equal(simulated.readings.find((row) => row.name === 'Flame')?.value.includes('simulated'), true);
});

test('simulated nodes stay inside the reserve and match the backend file', () => {
  assert.ok(SIMULATED_NODES.length >= 8 && SIMULATED_NODES.length <= 12);
  const ids = SIMULATED_NODES.map((node) => node.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const node of SIMULATED_NODES) {
    assert.equal(pointInRing(node.lat, node.lon, TADOBA_OUTLINE), true);
    assert.match(node.note, /SIMULATED/);
  }
  const file = path.resolve(process.cwd(), '../backend/data/simulated_nodes.json');
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { nodes: Array<{ id: string; latitude: number; longitude: number; profile: string }> };
  assert.deepEqual(
    parsed.nodes.map((node) => [node.id, node.latitude, node.longitude, node.profile]),
    SIMULATED_NODES.map((node) => [node.id, node.lat, node.lon, node.profile]),
  );
  const node = SIMULATED_NODES[0];
  const first = demoReading(node, 30_000, true);
  const second = demoReading(node, 30_500, true);
  assert.deepEqual(first, second);
  assert.equal(first.generated, true);
  assert.match(first.label, /SIMULATED/);
  const offline = demoReading(SIMULATED_NODES[4], 30_000, true);
  assert.equal(offline.mq135, null);
  assert.equal(offline.online, false);
  const disabled = demoReading(node, 30_000, false);
  assert.equal(disabled.generated, false);
  assert.equal(disabled.mq135, null);
});
