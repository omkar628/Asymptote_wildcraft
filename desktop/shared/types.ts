export type SensorReading = {
  timestamp: string;
  temp_c: number;
  humidity_percent: number;
  mq135_raw: number;
  mq9_raw: number;
  rssi_dbm: number | null;
  source: 'serial';
};

export type PreliminaryAlert = {
  id: string;
  source: 'threshold' | 'model' | 'external';
  scope: 'laptop' | 'phone';
  title: string;
  detail: string;
  severity: 'warning' | 'critical';
};

export type SerialLinkState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'disabled'
  | 'unknown';

export type SerialStatus = {
  state: SerialLinkState;
  rawState: string;
  connected: boolean;
  port: string;
  baudRate: number;
  lastError: string | null;
};

export type LaptopThresholds = {
  temp_c_high: number | null;
  humidity_percent_low: number | null;
  mq135_raw_high: number | null;
  mq9_raw_high: number | null;
  rssi_dbm_low: number | null;
};

export type SensorStatus = {
  api: 'running';
  serial: SerialStatus;
  latestReadingAt: string | null;
  storedReadings: number;
  thresholds: LaptopThresholds;
  preliminaryAlerts: PreliminaryAlert[];
};

export type DesktopSettings = {
  backendUrl: string;
  inferenceUrl: string;
  cameraIp: string;
  cameraUrl: string;
  modelPath: string;
  confidence: number;
};

export type AlertKind =
  | 'ai_fire'
  | 'ai_smoke'
  | 'ai_detection'
  | 'sensor_warning'
  | 'node_offline'
  | 'camera_disconnected';

export type DesktopAlert = {
  id: string;
  createdAt: string;
  kind: AlertKind;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  detail: string;
  sourceLabel: string;
  dedupeKey: string;
  acknowledged: boolean;
  acknowledgedAt: string | null;
};

export type DetectionRecord = {
  id: string;
  created_at: string;
  class_name: string;
  confidence: number;
  bbox: number[];
  camera_url: string;
  model_path: string;
  frame_width: number;
  frame_height: number;
  disclaimer: string;
  acknowledged: boolean;
  source: string;
};

export type InferenceBox = {
  class_name: string;
  confidence: number;
  bbox: number[];
};

export type InferenceStatus = {
  service: 'running';
  model: {
    path: string;
    exists: boolean | null;
    loaded: boolean;
    state: string;
    error: string | null;
    class_names: string[];
    device: string | null;
  };
  camera: {
    url: string;
    state: string;
    last_error: string | null;
    last_frame_at: string | null;
    frames_received: number;
  };
  inference: {
    running: boolean;
    confidence: number;
    processed_fps: number;
    last_inference_at: string | null;
    last_error: string | null;
    frames_processed: number;
    frame_width: number | null;
    frame_height: number | null;
    last_duration_ms: number | null;
  };
  recent_boxes: InferenceBox[];
  recent_events: DetectionRecord[];
};

export type ModelFileStat = {
  exists: boolean;
  size: number | null;
};

export const AI_DISCLAIMER =
  'AI detection from the local YOLO model. One detection does not prove an actual forest fire.';
