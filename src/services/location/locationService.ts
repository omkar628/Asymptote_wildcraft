import type { LocationServiceStatus } from '@/types/services';

/**
 * GPS boundary.
 * Location permission is not requested and no coordinates are read.
 */
export function getLocationStatus(): LocationServiceStatus {
  return {
    name: 'location',
    permission: 'not_requested',
    fix: null,
    summary: 'GPS not requested',
    detail: 'No position is shown.',
  };
}
