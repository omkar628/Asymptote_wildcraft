import type { NodeRecord } from '@/types/records';

export const sensorFilters = ['all', 'online', 'warning', 'critical', 'offline'] as const;

export type SensorFilter = (typeof sensorFilters)[number];

const filterLabels: Record<SensorFilter, string> = {
  all: 'All',
  online: 'Online',
  warning: 'Warning',
  critical: 'Critical',
  offline: 'Offline',
};

export function sensorFilterLabel(filter: SensorFilter): string {
  return filterLabels[filter];
}

export function parseSensorFilter(value: string | null): SensorFilter {
  if (
    value === 'online' ||
    value === 'warning' ||
    value === 'critical' ||
    value === 'offline' ||
    value === 'all'
  ) {
    return value;
  }

  return 'all';
}

export function sensorMatchesFilter(node: NodeRecord, filter: SensorFilter): boolean {
  if (filter === 'all') {
    return true;
  }
  if (filter === 'online') {
    return node.communicationStatus === 'healthy';
  }
  if (filter === 'warning') {
    return node.communicationStatus === 'potential_alert';
  }
  if (filter === 'critical') {
    return node.communicationStatus === 'verified_fire';
  }

  return node.communicationStatus === 'offline';
}

export function sensorMatchesQuery(node: NodeRecord, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return true;
  }

  return [node.id, node.name, node.nodeType, node.zoneLabel, node.statusNote]
    .join(' ')
    .toLowerCase()
    .includes(needle);
}
