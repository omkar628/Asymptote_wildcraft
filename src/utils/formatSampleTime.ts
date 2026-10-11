/** Stable sample-clock label. This does not describe freshness. */
export function formatSampleTime(iso: string | null): string {
  if (!iso) {
    return 'No time stored';
  }

  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  if (!match) {
    return iso;
  }

  const zone = iso.endsWith('+05:30') ? ' IST' : '';
  return `${match[1]} ${match[2]}${zone}`;
}

export function formatCoordinate(latitude: number | null, longitude: number | null): string {
  if (latitude == null || longitude == null) {
    return 'No coordinates stored';
  }

  return `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`;
}
