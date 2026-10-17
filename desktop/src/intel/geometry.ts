import type { BBox } from './areas';

/** Ring positions are [latitude, longitude]. A repeated closing vertex is allowed. */
export type LatLonRing = Array<[number, number]>;

export function ringBounds(ring: LatLonRing): BBox {
  let west = 180;
  let east = -180;
  let south = 90;
  let north = -90;
  for (const [lat, lon] of ring) {
    west = Math.min(west, lon);
    east = Math.max(east, lon);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  return { west, south, east, north };
}

export function pointInRing(lat: number, lon: number, ring: LatLonRing): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const [latI, lonI] = ring[index];
    const [latJ, lonJ] = ring[previous];
    const crosses = latI > lat !== latJ > lat;
    if (!crosses || latJ === latI) continue;
    const longitude = ((lonJ - lonI) * (lat - latI)) / (latJ - latI) + lonI;
    if (lon < longitude) inside = !inside;
  }
  return inside;
}

export function ringAreaKm2(ring: LatLonRing): number {
  if (ring.length < 4) return 0;
  const lat0 = ring.reduce((sum, point) => sum + point[0], 0) / ring.length;
  const metersLat = 111_320;
  const metersLon = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  let area = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const x1 = ring[index][1] * metersLon;
    const y1 = ring[index][0] * metersLat;
    const x2 = ring[index + 1][1] * metersLon;
    const y2 = ring[index + 1][0] * metersLat;
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2 / 1_000_000;
}
