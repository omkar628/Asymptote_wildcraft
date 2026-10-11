import { loadHomeOverview, type HomeOverview } from '@/features/home/loadHomeOverview';
import { mockHomeSnapshot } from '@/features/home/mockHomeData';
import type { NodeRecord, SampleAlert, SampleReportStub } from '@/types/records';

export function listSampleAlerts(nodes: readonly NodeRecord[]): SampleAlert[] {
  const critical: SampleAlert[] = [];
  const warnings: SampleAlert[] = [];

  for (const node of nodes) {
    if (node.communicationStatus === 'verified_fire') {
      critical.push({
        id: `SAMPLE-ALERT-${node.id}`,
        nodeId: node.id,
        severity: 'critical',
        incidentType: 'Demonstration marker',
        status: 'verified',
        observedAt: node.lastHeardAt,
        summary: node.statusNote,
        origin: 'mock',
      });
    }

    if (node.communicationStatus === 'potential_alert') {
      warnings.push({
        id: `SAMPLE-ALERT-${node.id}`,
        nodeId: node.id,
        severity: 'warning',
        incidentType: 'Demonstration marker',
        status: 'potential',
        observedAt: node.lastHeardAt,
        summary: node.statusNote,
        origin: 'mock',
      });
    }
  }

  return [...critical, ...warnings];
}

export type SensorCatalog = {
  overview: HomeOverview;
  sensors: readonly NodeRecord[];
  alerts: readonly SampleAlert[];
  reports: readonly SampleReportStub[];
};

export function getSensorCatalog(): SensorCatalog {
  const overview = loadHomeOverview();

  return {
    overview,
    sensors: overview.snapshot.nodes,
    alerts: listSampleAlerts(overview.snapshot.nodes),
    reports: overview.snapshot.pendingReports,
  };
}

export function getSensorById(id: string): NodeRecord | null {
  return mockHomeSnapshot.nodes.find((node) => node.id === id) ?? null;
}

export function getAlertById(id: string): SampleAlert | null {
  return listSampleAlerts(mockHomeSnapshot.nodes).find((alert) => alert.id === id) ?? null;
}

export function getAlertForSensor(nodeId: string): SampleAlert | null {
  return listSampleAlerts(mockHomeSnapshot.nodes).find((alert) => alert.nodeId === nodeId) ?? null;
}

export function countByStatus(nodes: readonly NodeRecord[]) {
  return {
    healthy: nodes.filter((node) => node.communicationStatus === 'healthy').length,
    warning: nodes.filter((node) => node.communicationStatus === 'potential_alert').length,
    critical: nodes.filter((node) => node.communicationStatus === 'verified_fire').length,
    offline: nodes.filter((node) => node.communicationStatus === 'offline').length,
    unknown: nodes.filter((node) => node.communicationStatus === 'unknown').length,
  };
}
