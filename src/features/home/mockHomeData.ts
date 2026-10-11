import type { NodeRecord, SampleReportStub } from '@/types/records';

/**
 * Layout sample only.
 * Coordinates are invented for the Home screen. They are not a node registry,
 * not surveyed Tadoba positions, and not fire locations.
 */
const unreportedTelemetry = {
  temperatureC: null,
  humidityPercent: null,
  smokeIndex: null,
  batteryPercent: null,
} as const;

const nodes = [
  {
    id: 'MOCK-CAM-01',
    name: 'Sample north camera',
    nodeType: 'camera',
    zoneLabel: 'No zone assigned',
    latitude: 20.271,
    longitude: 79.351,
    communicationStatus: 'potential_alert',
    lastHeardAt: '2026-10-09T08:15:00+05:30',
    statusNote: 'Sample status. Not a live detection and not a surveyed node.',
    telemetry: unreportedTelemetry,
    readingsHistory: null,
    origin: 'mock',
  },
  {
    id: 'MOCK-SEN-02',
    name: 'Sample ridge sensor',
    nodeType: 'sensor',
    zoneLabel: 'No zone assigned',
    latitude: 20.248,
    longitude: 79.412,
    communicationStatus: 'healthy',
    lastHeardAt: '2026-10-09T07:40:00+05:30',
    statusNote: 'Sample status. Not a live heartbeat.',
    telemetry: unreportedTelemetry,
    readingsHistory: null,
    origin: 'mock',
  },
  {
    id: 'MOCK-CAM-03',
    name: 'Sample east camera',
    nodeType: 'camera',
    zoneLabel: 'No zone assigned',
    latitude: 20.196,
    longitude: 79.298,
    communicationStatus: 'verified_fire',
    lastHeardAt: '2026-10-09T06:05:00+05:30',
    statusNote: 'Sample status. Not a confirmed Tadoba incident.',
    telemetry: unreportedTelemetry,
    readingsHistory: null,
    origin: 'mock',
  },
  {
    id: 'MOCK-GW-04',
    name: 'Sample gateway',
    nodeType: 'gateway',
    zoneLabel: 'No zone assigned',
    latitude: 20.223,
    longitude: 79.467,
    communicationStatus: 'offline',
    lastHeardAt: '2026-10-08T18:10:00+05:30',
    statusNote: 'Sample status. Not a measured node outage.',
    telemetry: unreportedTelemetry,
    readingsHistory: null,
    origin: 'mock',
  },
  {
    id: 'MOCK-SEN-05',
    name: 'Sample beat sensor',
    nodeType: 'sensor',
    zoneLabel: 'No zone assigned',
    latitude: 20.305,
    longitude: 79.389,
    communicationStatus: 'unknown',
    lastHeardAt: null,
    statusNote: 'Sample status. No trustworthy message time is stored.',
    telemetry: unreportedTelemetry,
    readingsHistory: null,
    origin: 'mock',
  },
] as const satisfies readonly NodeRecord[];

const pendingReports = [
  {
    id: 'MOCK-REPORT-01',
    origin: 'mock',
    storedOnDevice: false,
    label: 'Sample pending report',
    note: 'Not saved on this device and not queued for synchronization.',
  },
] as const satisfies readonly SampleReportStub[];

export const mockHomeSnapshot = {
  origin: 'mock' as const,
  disclaimer:
    'Sample data only. The device network has not been checked, nothing is saved on this phone, and these are not real Tadoba nodes or fires.',
  connectionLabel: 'Mock · offline',
  connectionHint: 'Sample label. This build does not read the device network state.',
  nodes,
  pendingReports,
  activeAlertCount: nodes.filter(
    (node) =>
      node.communicationStatus === 'potential_alert' ||
      node.communicationStatus === 'verified_fire',
  ).length,
  offlineNodeCount: nodes.filter((node) => node.communicationStatus === 'offline').length,
  pendingReportCount: pendingReports.length,
};

export type MockHomeSnapshot = typeof mockHomeSnapshot;
