import type { DetectionRecord, InferenceBox, InferenceStatus } from '../../shared/types';

export type DetectionStatus = {
  kind: 'pending' | 'failure' | 'empty' | 'boxes';
  text: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseBox(value: unknown): InferenceBox | null {
  if (!isRecord(value) || typeof value.class_name !== 'string' || !isFiniteNumber(value.confidence)) {
    return null;
  }
  if (!Array.isArray(value.bbox) || value.bbox.length !== 4 || value.bbox.some((item) => !isFiniteNumber(item))) {
    return null;
  }
  return {
    class_name: value.class_name,
    confidence: value.confidence,
    bbox: value.bbox,
    distance_m: isFiniteNumber(value.distance_m) ? value.distance_m : undefined,
    estimated_lat: isFiniteNumber(value.estimated_lat) ? value.estimated_lat : undefined,
    estimated_lon: isFiniteNumber(value.estimated_lon) ? value.estimated_lon : undefined,
  };
}

export function parseDetection(value: unknown): DetectionRecord | null {
  if (!isRecord(value)) {
    return null;
  }
  if (typeof value.id !== 'string' || typeof value.created_at !== 'string' || typeof value.class_name !== 'string') {
    return null;
  }
  if (!isFiniteNumber(value.confidence) || !isFiniteNumber(value.frame_width) || !isFiniteNumber(value.frame_height)) {
    return null;
  }
  if (!Array.isArray(value.bbox) || value.bbox.some((item) => !isFiniteNumber(item))) {
    return null;
  }
  if (typeof value.camera_url !== 'string' || typeof value.model_path !== 'string' || typeof value.disclaimer !== 'string') {
    return null;
  }
  if (typeof value.acknowledged !== 'boolean') {
    return null;
  }
  return {
    id: value.id,
    created_at: value.created_at,
    class_name: value.class_name,
    confidence: value.confidence,
    bbox: value.bbox.filter((item): item is number => typeof item === 'number'),
    camera_url: value.camera_url,
    model_path: value.model_path,
    frame_width: value.frame_width,
    frame_height: value.frame_height,
    disclaimer: value.disclaimer,
    acknowledged: value.acknowledged,
    source: typeof value.source === 'string' ? value.source : 'local-yolo',
  };
}

export function parseInferenceStatus(value: unknown): InferenceStatus | null {
  if (!isRecord(value) || value.service !== 'running' || !isRecord(value.model) || !isRecord(value.camera)) {
    return null;
  }
  if (!isRecord(value.inference) || !Array.isArray(value.recent_boxes) || !Array.isArray(value.recent_events)) {
    return null;
  }
  const model = value.model;
  const camera = value.camera;
  const inference = value.inference;
  if (typeof model.path !== 'string' || typeof model.loaded !== 'boolean' || typeof model.state !== 'string') {
    return null;
  }
  if (model.error !== null && typeof model.error !== 'string') {
    return null;
  }
  if (!Array.isArray(model.class_names) || model.class_names.some((item) => typeof item !== 'string')) {
    return null;
  }
  if (model.device !== null && typeof model.device !== 'string') {
    return null;
  }
  if (typeof camera.url !== 'string' || typeof camera.state !== 'string' || !isFiniteNumber(camera.frames_received)) {
    return null;
  }
  if (camera.last_error !== null && typeof camera.last_error !== 'string') {
    return null;
  }
  if (camera.last_frame_at !== null && typeof camera.last_frame_at !== 'string') {
    return null;
  }
  if (
    typeof inference.running !== 'boolean' ||
    !isFiniteNumber(inference.confidence) ||
    !isFiniteNumber(inference.processed_fps) ||
    !isFiniteNumber(inference.frames_processed)
  ) {
    return null;
  }
  if (inference.last_error !== null && typeof inference.last_error !== 'string') {
    return null;
  }
  if (inference.last_inference_at !== null && typeof inference.last_inference_at !== 'string') {
    return null;
  }
  const recentBoxes: InferenceBox[] = [];
  for (const item of value.recent_boxes) {
    const box = parseBox(item);
    if (box) {
      recentBoxes.push(box);
    }
  }
  const recentEvents: DetectionRecord[] = [];
  for (const item of value.recent_events) {
    const event = parseDetection(item);
    if (event) {
      recentEvents.push(event);
    }
  }
  return {
    service: 'running',
    model: {
      path: model.path,
      exists: typeof model.exists === 'boolean' ? model.exists : null,
      loaded: model.loaded,
      state: model.state,
      error: model.error,
      class_names: model.class_names.filter((item): item is string => typeof item === 'string'),
      device: model.device,
    },
    camera: {
      url: camera.url,
      state: camera.state,
      last_error: camera.last_error,
      last_frame_at: camera.last_frame_at,
      frames_received: camera.frames_received,
      source: typeof camera.source === 'string' ? camera.source : '',
      index: isFiniteNumber(camera.index) ? camera.index : null,
      device_name: typeof camera.device_name === 'string' ? camera.device_name : null,
      width: isFiniteNumber(camera.width) ? camera.width : null,
      height: isFiniteNumber(camera.height) ? camera.height : null,
      capture_fps: isFiniteNumber(camera.capture_fps) ? camera.capture_fps : null,
    },
    inference: {
      running: inference.running,
      detection_state: typeof inference.detection_state === 'string' ? inference.detection_state : inference.running ? 'running' : 'stopped',
      confidence: inference.confidence,
      processed_fps: inference.processed_fps,
      last_inference_at: inference.last_inference_at,
      last_error: inference.last_error,
      frames_processed: inference.frames_processed,
      frame_width: isFiniteNumber(inference.frame_width) ? inference.frame_width : null,
      frame_height: isFiniteNumber(inference.frame_height) ? inference.frame_height : null,
      last_duration_ms: isFiniteNumber(inference.last_duration_ms) ? inference.last_duration_ms : null,
      max_fps: isFiniteNumber(inference.max_fps) ? inference.max_fps : undefined,
      event_window_s: isFiniteNumber(inference.event_window_s) ? inference.event_window_s : undefined,
    },
    recent_boxes: recentBoxes,
    recent_events: recentEvents,
  };
}

export function cameraLinkText(state: string | undefined): string {
  if (state === 'streaming') {
    return 'Camera connected';
  }
  if (state === 'connecting') {
    return 'Camera connecting';
  }
  if (state === 'reconnecting') {
    return 'Camera reconnecting';
  }
  return 'Camera disconnected';
}

export function modelLinkText(status: InferenceStatus | null): string {
  if (!status || status.model.state === 'loading') {
    return 'Model loading';
  }
  if (status.model.loaded || status.model.state === 'ready') {
    return 'Model ready';
  }
  return 'Model error';
}

export function detectionLinkText(status: InferenceStatus | null): string {
  if (!status) {
    return 'Detection stopped';
  }
  if (status.inference.detection_state === 'error' || (status.model.loaded && status.inference.last_error)) {
    return 'Detection error';
  }
  if (status.inference.running || status.inference.detection_state === 'running') {
    return 'Detection running';
  }
  return 'Detection stopped';
}

export function detectionStatusText(status: InferenceStatus | null): DetectionStatus {
  if (!status) {
    return { kind: 'pending', text: 'Inference status has not arrived.' };
  }
  if (status.model.state === 'loading') {
    return { kind: 'pending', text: 'The YOLO model is loading.' };
  }
  if (!status.model.loaded || status.model.error) {
    const reason = status.model.error ?? 'The YOLO model is not loaded.';
    return { kind: 'failure', text: `Inference did not return detections. ${reason}` };
  }
  if (status.inference.last_error) {
    return { kind: 'failure', text: `Inference did not return detections. ${status.inference.last_error}` };
  }
  if (status.inference.frames_processed < 1) {
    return { kind: 'pending', text: 'No frame has been processed yet.' };
  }
  if (status.recent_boxes.length === 0) {
    return { kind: 'empty', text: 'No detections in current frame' };
  }
  return { kind: 'boxes', text: '' };
}
