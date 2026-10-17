export type GeoPoint = { lat: number; lon: number };

const EARTH_RADIUS_M = 6_371_000;

export function isGeoPoint(value: { lat: number; lon: number } | null | undefined): value is GeoPoint {
  if (!value) return false;
  return Number.isFinite(value.lat) && Number.isFinite(value.lon) && value.lat >= -90 && value.lat <= 90 && value.lon >= -180 && value.lon <= 180;
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance in metres. */
export function haversineMeters(from: GeoPoint, to: GeoPoint): number {
  const dLat = toRadians(to.lat - from.lat);
  const dLon = toRadians(to.lon - from.lon);
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Degrees clockwise from north, 0–360. */
export function bearingDegrees(from: GeoPoint, to: GeoPoint): number {
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);
  const dLon = toRadians(to.lon - from.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Point at `fraction` (0–1) along the great-circle arc. */
export function interpolate(from: GeoPoint, to: GeoPoint, fraction: number): GeoPoint {
  const t = Math.min(1, Math.max(0, fraction));
  const lat1 = toRadians(from.lat);
  const lon1 = toRadians(from.lon);
  const lat2 = toRadians(to.lat);
  const lon2 = toRadians(to.lon);
  const d = 2 * Math.asin(Math.min(1, Math.sqrt(
    Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2,
  )));
  if (d === 0) return { lat: from.lat, lon: from.lon };
  const sinD = Math.sin(d);
  const w1 = Math.sin((1 - t) * d) / sinD;
  const w2 = Math.sin(t * d) / sinD;
  const x = w1 * Math.cos(lat1) * Math.cos(lon1) + w2 * Math.cos(lat2) * Math.cos(lon2);
  const y = w1 * Math.cos(lat1) * Math.sin(lon1) + w2 * Math.cos(lat2) * Math.sin(lon2);
  const z = w1 * Math.sin(lat1) + w2 * Math.sin(lat2);
  return {
    lat: (Math.atan2(z, Math.sqrt(x * x + y * y)) * 180) / Math.PI,
    lon: (Math.atan2(y, x) * 180) / Math.PI,
  };
}

export function formatMeters(meters: number): string {
  if (!Number.isFinite(meters)) return 'Unavailable';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}
