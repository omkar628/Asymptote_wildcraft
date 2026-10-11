/** Where a record came from. Mock records must stay labelled in the UI. */
export type DataOrigin = 'mock' | 'local' | 'server';

/**
 * Phone network state. This is not the same as node communication status
 * or incident status.
 */
export type PhoneConnectionState = 'offline' | 'online' | 'unknown';

/** Last-known node communication state. A cached value is not a live heartbeat. */
export type NodeCommunicationStatus =
  | 'healthy'
  | 'potential_alert'
  | 'verified_fire'
  | 'offline'
  | 'unknown';

/** Incident lifecycle. Separate from report synchronization state. */
export type IncidentStatus =
  | 'potential'
  | 'under_review'
  | 'needs_investigation'
  | 'verified'
  | 'assigned'
  | 'responding'
  | 'contained'
  | 'false_alarm'
  | 'duplicate'
  | 'closed';

/** Local synchronization state for a report or field update. */
export type SyncStatus = 'saved_locally' | 'pending_sync' | 'synced' | 'sync_failed';

export type NodeType = 'camera' | 'sensor' | 'gateway' | 'other';

/** Null means the sample or device did not report that measurement. */
export type SensorTelemetry = {
  temperatureC: number | null;
  humidityPercent: number | null;
  /** Null means this node does not report smoke or particulates. */
  smokeIndex: number | null;
  batteryPercent: number | null;
};

export type SensorReadingPoint = {
  at: string;
  temperatureC: number | null;
  humidityPercent: number | null;
};

export type NodeRecord = {
  id: string;
  name: string;
  nodeType: NodeType;
  /** No surveyed zone is assigned in the sample catalog. */
  zoneLabel: string;
  latitude: number | null;
  longitude: number | null;
  communicationStatus: NodeCommunicationStatus;
  /** ISO time when a real message time exists. Null when it does not. */
  lastHeardAt: string | null;
  /** Shown beside the status so color is never the only signal. */
  statusNote: string;
  telemetry: SensorTelemetry;
  /** Null means no history is stored. An empty list would mean a stored series with no points. */
  readingsHistory: readonly SensorReadingPoint[] | null;
  origin: DataOrigin;
};

export type SampleAlert = {
  id: string;
  nodeId: string;
  severity: 'warning' | 'critical';
  incidentType: string;
  status: IncidentStatus;
  observedAt: string | null;
  summary: string;
  origin: 'mock';
};

export type IncidentRecord = {
  id: string;
  status: IncidentStatus;
  priority: 'high' | 'normal';
  latitude: number;
  longitude: number;
  source: string;
  observedAt: string;
  syncStatus: SyncStatus;
  summary: string;
  origin: DataOrigin;
};

export type ObservationRecord = {
  id: string;
  incidentId: string;
  source: string;
  observedAt: string;
  notes: string;
  origin: DataOrigin;
};

export type EvidenceRecord = {
  id: string;
  incidentId: string;
  mediaType: 'photo' | 'other';
  /** Local file path or later storage reference. Never an image blob. */
  storageReference: string | null;
  capturedAt: string | null;
  origin: DataOrigin;
};

export type SyncQueueItem = {
  id: string;
  idempotencyKey: string;
  kind: 'report' | 'field_update' | 'evidence';
  createdAt: string;
  syncStatus: SyncStatus;
  attemptCount: number;
  lastError: string | null;
};

/** Layout-only report row. It is not stored and not queued. */
export type SampleReportStub = {
  id: string;
  origin: 'mock';
  storedOnDevice: false;
  label: string;
  note: string;
};
