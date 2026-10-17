import assert from 'node:assert/strict';
import test from 'node:test';

import {
  firmsProximityPoints,
  forecastSteps,
  rainWindowPoints,
  rawMqAlert,
  sensorAlertPoints,
  sensorIsFresh,
  sensitivityScore,
  spreadIntensity,
} from './fireModel';

const full = {
  temperatureC: 42,
  humidityPct: 25,
  precipitationMm: 0,
  windKmh: 40,
  soilMoisture: 0.1,
  firmsKnown: true,
  hotspotCount: 1,
  firmsDistanceM: 0,
  sensorLocated: true,
  sensorFresh: true,
  sensorAlert: true,
  rainWindowMm: 10,
};

test('a complete sensitivity sample scores 100 and keeps vegetation confidence down', () => {
  const result = sensitivityScore(full);
  assert.equal(result.score, 100);
  assert.equal(result.confidence, 0.722);
  assert.match(result.missing.join(' '), /Vegetation/);
  assert.match(result.uncertainty, /not validated/);
});

test('missing inputs are not treated as high sensitivity or as safe', () => {
  const empty = sensitivityScore({
    ...full,
    temperatureC: null,
    humidityPct: null,
    precipitationMm: null,
    windKmh: null,
    soilMoisture: null,
    firmsKnown: false,
    hotspotCount: 0,
    firmsDistanceM: null,
    sensorLocated: false,
    sensorFresh: false,
    sensorAlert: false,
    rainWindowMm: null,
  });
  assert.equal(empty.score, null);
  const partial = sensitivityScore({ ...full, humidityPct: null, precipitationMm: null, windKmh: null, soilMoisture: null, firmsKnown: false, sensorLocated: false, rainWindowMm: null });
  assert.equal(partial.score, 16);
  assert.ok(partial.confidence < 0.45);
  assert.match(partial.band ?? '', /incomplete/);
});

test('sensor raw thresholds need a location and a fresh strict crossing', () => {
  assert.equal(rawMqAlert(650, 650), false);
  assert.equal(rawMqAlert(650.1, null), true);
  assert.equal(rawMqAlert(null, null), false);
  assert.equal(sensorAlertPoints(false, true, true), null);
  assert.equal(sensorAlertPoints(true, false, true), null);
  assert.equal(sensorAlertPoints(true, true, false), 0);
  assert.equal(sensorAlertPoints(true, true, true), 8);
  assert.equal(sensorIsFresh(null, Date.now()), false);
  assert.equal(sensorIsFresh(new Date(Date.now() - 61_000).toISOString(), Date.now()), false);
  assert.equal(sensorIsFresh(new Date(Date.now() - 10_000).toISOString(), Date.now()), true);
});

test('an empty FIRMS response is not the same as a failed request', () => {
  assert.equal(firmsProximityPoints(null, false, 0), null);
  assert.equal(firmsProximityPoints(null, true, 0), 0);
  assert.equal(rainWindowPoints(null), null);
  assert.equal(rainWindowPoints(19), 10);
});

test('forecast steps stop at the requested horizon', () => {
  assert.deepEqual(forecastSteps(6), [0, 1, 3, 6]);
  assert.deepEqual(forecastSteps(24), [0, 1, 3, 6, 12, 24]);
  assert.deepEqual(forecastSteps(0), [0]);
});

test('spread intensity is strongest at the ignition and empty outside the zone', () => {
  assert.equal(spreadIntensity(0, 1000, true), 1);
  assert.equal(spreadIntensity(500, 1000, true), 0.5);
  assert.equal(spreadIntensity(0, 1000, false), null);
});
