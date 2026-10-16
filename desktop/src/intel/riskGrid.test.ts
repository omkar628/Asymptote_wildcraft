import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCells, hotspotFactor, humidityFactor, metersPerDegreeLon, precipitationFactor, scoreFromInputs, temperatureFactor, windFactor } from './riskGrid';

test('grid cells stay aligned to the meter grid', () => {
  const cellMeters = 1000;
  const refLat = 20;
  const built = buildCells({ west: 79.2, south: 20.0, east: 79.23, north: 20.03 }, cellMeters, refLat);
  assert.ok(built.cells.length > 1);
  assert.equal(built.truncated, false);
  const mLon = metersPerDegreeLon(refLat);
  for (const cell of built.cells) {
    assert.ok(Math.abs((cell.west * mLon) / cellMeters - cell.col) < 1e-6);
    assert.ok(Math.abs((cell.south * 111320) / cellMeters - cell.row) < 1e-6);
  }
});

test('a large cell request is refused instead of drawing thousands of cells', () => {
  const built = buildCells({ west: 79.197222, south: 19.990833, east: 79.681667, north: 20.495556 }, 250, 20.24, 1000);
  assert.equal(built.truncated, true);
  assert.equal(built.cells.length, 0);
  assert.ok(built.estimated > 1000);
});

test('weather factors stay unscaled when one input is missing', () => {
  assert.equal(temperatureFactor(42), 15);
  assert.equal(humidityFactor(70), 0);
  assert.equal(precipitationFactor(0), 15);
  assert.equal(windFactor(8), 0);
  const result = scoreFromInputs(
    { temperatureC: null, humidityPct: 30, precipitationMm: 0, windKmh: 8 },
    true,
    true,
    0,
    null,
  );
  assert.equal(result.weatherScore, 30);
  assert.equal(result.hotspotScore, 0);
  assert.equal(result.score, 30);
  assert.match(result.uncertainty, /Absence is not a safety finding/);
});

test('a detection inside the cell adds 40 and a miss adds nothing', () => {
  assert.equal(hotspotFactor(0), 40);
  assert.equal(hotspotFactor(1000), 30);
  assert.equal(hotspotFactor(3000), 18);
  assert.equal(hotspotFactor(8000), 8);
  assert.equal(hotspotFactor(8001), 0);
  const inside = scoreFromInputs(null, false, true, 1, 0);
  assert.equal(inside.score, 40);
  assert.equal(inside.band, 'Moderate');
  assert.match(inside.uncertainty, /Weather was unavailable/);
  const none = scoreFromInputs(null, false, false, 0, null);
  assert.equal(none.score, null);
  assert.match(none.uncertainty, /not scored/);
});
