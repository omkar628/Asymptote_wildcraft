/**
 * Online slippy-map tiles, requested only for the current view.
 * OpenStreetMap's public tile servers are for light use, not bulk downloads
 * or unlimited production traffic. Replace `urlTemplate` with a provider
 * whose terms cover this deployment. This app does not store an offline pack.
 */
export const tileConfig = {
  urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '© OpenStreetMap contributors',
  minZoom: 4,
  maxZoom: 17,
} as const;

export function tileOrigin(template: string): string {
  const match = /^https:\/\/[^/]+/.exec(template);
  return match?.[0] ?? 'https://tile.openstreetmap.org';
}
