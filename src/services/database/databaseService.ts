import type { DatabaseStatus } from '@/types/services';

/**
 * Local database boundary.
 * No database file is opened in this phase.
 */
export function getDatabaseStatus(): DatabaseStatus {
  return {
    name: 'database',
    ready: false,
    summary: 'No local database',
    detail: 'Home counts are labelled sample data. Nothing is persisted.',
  };
}
