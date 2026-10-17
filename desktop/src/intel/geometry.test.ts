import assert from 'node:assert/strict';
import test from 'node:test';

import { pointInRing, ringAreaKm2, ringBounds } from './geometry';
import { TADOBA_GATES, TADOBA_HEADQUARTERS, TADOBA_MAP_BOUNDS, TADOBA_OSM_AREA_KM2, TADOBA_OUTLINE } from './tadobaPlaces';

test('the Tadoba outline is a closed polygon inside the published Chandrapur ranges', () => {
  assert.ok(TADOBA_OUTLINE.length > 100);
  assert.deepEqual(TADOBA_OUTLINE[0], TADOBA_OUTLINE[TADOBA_OUTLINE.length - 1]);
  const bounds = ringBounds(TADOBA_OUTLINE);
  assert.deepEqual(bounds, TADOBA_MAP_BOUNDS);
  assert.ok(bounds.west > 79 && bounds.east < 80);
  assert.ok(bounds.south > 19.9 && bounds.north < 20.6);
  assert.ok(bounds.west < bounds.east && bounds.south < bounds.north);
  const area = ringAreaKm2(TADOBA_OUTLINE);
  assert.ok(Math.abs(area - TADOBA_OSM_AREA_KM2) < 5);
  assert.ok(area > 700 && area < 900);
});

test('a published interior point is inside the outline and a district point is outside', () => {
  assert.equal(pointInRing(20.267028, 79.494519, TADOBA_OUTLINE), true);
  assert.equal(pointInRing(19.5, 79.4, TADOBA_OUTLINE), false);
});

test('gates keep their OSM coordinates and headquarters stays unconfigured', () => {
  assert.equal(TADOBA_GATES.length, 4);
  for (const gate of TADOBA_GATES) {
    assert.ok(pointInRing(gate.lat, gate.lon, TADOBA_OUTLINE) || (gate.lat > 20 && gate.lon > 79));
    assert.match(gate.source, /OpenStreetMap node/);
  }
  assert.equal(TADOBA_HEADQUARTERS.coordinates, null);
  assert.match(TADOBA_HEADQUARTERS.name, /Field Director/);
  assert.match(TADOBA_HEADQUARTERS.source, /mytadoba/);
});
