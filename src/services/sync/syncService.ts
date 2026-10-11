import type { SyncServiceStatus } from '@/types/services';

/**
 * Synchronization boundary.
 * No API client and no durable queue exist yet.
 * Phone connectivity is separate from node communication status.
 */
export function getSyncStatus(): SyncServiceStatus {
  return {
    name: 'sync',
    configured: false,
    lastSuccessfulSyncAt: null,
    lastSuccessfulSyncLabel: 'None',
    summary: 'Not synchronized',
    detail: 'No server is configured and no queue exists.',
  };
}
