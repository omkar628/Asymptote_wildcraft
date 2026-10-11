import type { MapPackageStatus } from '@/types/services';

/**
 * Map boundary.
 * The screen can request online tiles. No offline tile pack is installed.
 */
export function getMapPackageStatus(): MapPackageStatus {
  return {
    name: 'map',
    installed: false,
    onlineRuntime: 'webview',
    summary: 'Online tiles',
    detail:
      'Tiles load over the network when the tile host answers. No offline map pack is installed.',
  };
}
