import assert from 'node:assert/strict';
import test from 'node:test';

import { predictFireRisk } from './fireRisk';
import { cameraLinkText, detectionLinkText, detectionStatusText, modelLinkText, parseInferenceStatus } from './inferenceParse';
import { gasAlarmTriggered, parseGasAlarm, shouldStartGasCue, type GasAlarm } from './gasAlarm';
import { parseReading, parseSocketMessage } from './sensorParse';
import type { InferenceStatus } from '../../shared/types';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { loadSettings, saveSettings } from '../../electron/settingsStore';
import {
  DEFAULT_SETTINGS,
  normalizeBackendUrl,
  normalizeCameraUrl,
  streamUrlFromIp,
} from '../../shared/validate';

const reading = {
  timestamp: '2026-10-16T10:00:00.000+05:30',
  temp_c: 31.7,
  humidity_percent: 45.7,
  mq135_raw: 418,
  mq9_raw: 479,
  rssi_dbm: -32,
  source: 'serial',
};

test('serial readings are accepted and other sources are dropped', () => {
  assert.deepEqual(parseReading(reading), reading);
  assert.equal(parseReading({ ...reading, source: 'test' }), null);
  assert.equal(parseReading({ ...reading, temp_c: Number.NaN }), null);
});

test('synthetic websocket traffic is ignored', () => {
  const message = parseSocketMessage(
    JSON.stringify({
      type: 'reading',
      synthetic: true,
      reading: { ...reading, source: 'test' },
      preliminary_alerts: [],
      alerts_changed: false,
    }),
  );
  assert.deepEqual(message, { type: 'ignore' });
});

test('real websocket readings keep the serial source', () => {
  const message = parseSocketMessage(
    JSON.stringify({
      type: 'reading',
      synthetic: false,
      reading,
      preliminary_alerts: [],
      alerts_changed: false,
    }),
  );
  assert.equal(message?.type, 'reading');
});

const gasAlarm = (overrides: Partial<GasAlarm> = {}): GasAlarm => ({
  state: 'ALARM_ACTIVE',
  activation_threshold: 750,
  recovery_threshold: 750,
  units: 'raw',
  mq9_raw: 751,
  mq135_raw: 751,
  mq9_above: true,
  mq135_above: true,
  triggered_sensors: ['mq9', 'mq135'],
  event_id: 'gas-1',
  started_at: '2026-10-17T12:00:00.000+05:30',
  acknowledged_at: null,
  reading_status: 'valid',
  safe_to_treat_as_normal: false,
  detail: 'BOTH GAS SENSORS ABOVE 750. MQ9 raw 751 and MQ135 raw 751 are above the threshold together. This is one alarm.',
  link_down: false,
  ...overrides,
});

test('a gas alarm event starts sound once and acknowledgement does not', () => {
  const active = gasAlarm();
  assert.equal(shouldStartGasCue(null, active), 'gas-1');
  assert.equal(shouldStartGasCue('gas-1', active), null);
  assert.equal(shouldStartGasCue('gas-1', gasAlarm({ mq9_raw: 780, mq135_raw: 800, triggered_sensors: ['mq9', 'mq135'] })), null);
  assert.equal(shouldStartGasCue('gas-1', gasAlarm({ state: 'ACKNOWLEDGED', acknowledged_at: '2026-10-17T12:01:00.000+05:30' })), null);
  assert.equal(shouldStartGasCue('gas-1', gasAlarm({ state: 'NORMAL', event_id: null, mq9_raw: 100, mq135_raw: 100, mq9_above: false, mq135_above: false, triggered_sensors: [] })), null);
  assert.equal(shouldStartGasCue(null, gasAlarm({ state: 'ALARM_ACTIVE', event_id: 'gas-2', mq9_raw: 900, mq135_raw: 810 })), 'gas-2');
  assert.equal(shouldStartGasCue(null, gasAlarm({ state: 'SENSOR_DATA_STALE', reading_status: 'stale' })), null);
  assert.equal(shouldStartGasCue(null, gasAlarm({ state: 'INCOMPLETE', event_id: null, mq9_raw: null, mq9_above: false, reading_status: 'incomplete', triggered_sensors: [] })), null);
  assert.equal(shouldStartGasCue(null, gasAlarm({ mq9_raw: 800, mq135_raw: 400, mq135_above: false, triggered_sensors: ['mq9'] })), null);
  assert.equal(shouldStartGasCue(null, gasAlarm({ mq9_raw: 750, mq135_raw: 750, mq9_above: false, mq135_above: false })), null);
  assert.equal(shouldStartGasCue(null, gasAlarm({ mq9_raw: null, mq135_raw: 900, mq9_above: false, reading_status: 'incomplete' })), null);
});

test('the mobile gas rule is both sensors strictly above 750', () => {
  assert.equal(gasAlarmTriggered(653, 638), false);
  assert.equal(gasAlarmTriggered(751, 740), false);
  assert.equal(gasAlarmTriggered(740, 751), false);
  assert.equal(gasAlarmTriggered(750, 750), false);
  assert.equal(gasAlarmTriggered(751, 751), true);
  assert.equal(gasAlarmTriggered(800, 780), true);
  assert.equal(gasAlarmTriggered(900, 810), true);
  assert.equal(gasAlarmTriggered(null, 900), false);
  assert.equal(gasAlarmTriggered(900, null), false);
  assert.equal(gasAlarmTriggered(Number.NaN, 900), false);
});

test('gas alarm messages parse without dropping the sensor reading', () => {
  const parsed = parseGasAlarm(gasAlarm());
  assert.equal(parsed?.state, 'ALARM_ACTIVE');
  assert.equal(parsed?.units, 'raw');
  const message = parseSocketMessage(
    JSON.stringify({
      type: 'reading',
      synthetic: false,
      reading,
      preliminary_alerts: [],
      gas_alarm: gasAlarm(),
    }),
  );
  assert.equal(message?.type, 'reading');
  if (message?.type === 'reading') {
    assert.equal(message.gasAlarm?.event_id, 'gas-1');
    assert.equal(message.reading.mq9_raw, 479);
  }
  assert.equal(parseGasAlarm({ ...gasAlarm(), units: 'ppm' }), null);
});

test('fire risk stays unavailable without a packet', () => {
  const assessment = predictFireRisk(null, []);
  assert.equal(assessment.available, false);
  assert.equal(assessment.level, null);
  assert.match(assessment.disclaimer, /does not confirm a fire/);
});

test('urls keep the backend host and the camera stream path', () => {
  assert.equal(normalizeBackendUrl('ws://127.0.0.1:8000/ws/sensors'), 'http://127.0.0.1:8000');
  assert.equal(normalizeCameraUrl('http://10.241.226.236:81/stream'), 'http://10.241.226.236:81/stream');
  assert.equal(streamUrlFromIp('http://10.241.226.236'), 'http://10.241.226.236:81/stream');
  assert.equal(DEFAULT_SETTINGS.cameraIp, 'http://10.241.226.236');
  assert.equal(DEFAULT_SETTINGS.cameraUrl, 'http://10.241.226.236:81/stream');
  assert.equal(DEFAULT_SETTINGS.modelPath, 'F:\\wildcraft_project\\weights\\best.pt');
  assert.equal(DEFAULT_SETTINGS.confidence, 0.35);
  assert.equal(DEFAULT_SETTINGS.cameraSource, 'webcam');
});

test('camera URL settings save and load after a restart', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'wildcraft-settings-'));
  const filePath = path.join(directory, 'settings.json');
  const saved = saveSettings(filePath, {
    backendUrl: 'http://127.0.0.1:8000',
    inferenceUrl: 'http://127.0.0.1:8100',
    cameraIp: 'http://10.241.226.236',
    cameraUrl: 'http://10.241.226.236:81/stream',
    cameraSource: 'stream',
    cameraIndex: null,
    cameraDevice: '',
    modelPath: 'F:\\wildcraft_project\\weights\\best.pt',
    confidence: 0.25,
    inferenceFps: 4,
    eventWindowS: 20,
  });
  assert.equal(saved.cameraIp, 'http://10.241.226.236');
  const stored = JSON.parse(readFileSync(filePath, 'utf8')) as { modelPath: string; cameraUrl: string };
  assert.equal(stored.modelPath, 'F:\\wildcraft_project\\weights\\best.pt');
  assert.equal(stored.cameraUrl, 'http://10.241.226.236:81/stream');
  const loaded = loadSettings(filePath, 'F:\\wildcraft_project');
  assert.equal(loaded.backendUrl, 'http://127.0.0.1:8000');
  assert.equal(loaded.inferenceUrl, 'http://127.0.0.1:8100');
  assert.equal(loaded.cameraIp, 'http://10.241.226.236');
  assert.equal(loaded.cameraUrl, 'http://10.241.226.236:81/stream');
  assert.equal(loaded.modelPath, 'F:\\wildcraft_project\\weights\\best.pt');
  assert.equal(loaded.confidence, 0.25);
  assert.equal(loaded.cameraSource, 'stream');
  const webcamFile = path.join(directory, 'webcam.json');
  writeFileSync(
    webcamFile,
    JSON.stringify({
      backendUrl: 'http://127.0.0.1:8000',
      inferenceUrl: 'http://127.0.0.1:8100',
      cameraIp: '',
      cameraUrl: '',
      modelPath: 'F:\\wildcraft_project\\weights\\best.pt',
      confidence: 0.35,
    }),
  );
  const webcamSettings = loadSettings(webcamFile, 'F:\\wildcraft_project');
  assert.equal(webcamSettings.cameraSource, 'webcam');
  assert.equal(webcamSettings.cameraUrl, '');
  assert.equal(webcamSettings.confidence, 0.35);
  assert.equal(cameraLinkText('streaming'), 'Camera connected');
  assert.equal(cameraLinkText('idle'), 'Camera disconnected');
  assert.equal(modelLinkText(inferenceStatus({ state: 'loading', loaded: false })), 'Model loading');
  assert.equal(modelLinkText(inferenceStatus({})), 'Model ready');
  assert.equal(detectionLinkText(inferenceStatus({})), 'Detection running');
  assert.equal(detectionLinkText(inferenceStatus({ frames: 0, lastError: 'Inference failed: cuda' })), 'Detection error');
  const migratedFile = path.join(directory, 'old.json');
  writeFileSync(
    migratedFile,
    JSON.stringify({
      ...loaded,
      modelPath: 'F:\\wildcraft_project\\best.pt',
    }),
  );
  assert.equal(loadSettings(migratedFile, 'F:\\wildcraft_project').modelPath, 'F:\\wildcraft_project\\weights\\best.pt');
  rmSync(directory, { recursive: true, force: true });
});

function inferenceStatus(overrides: {
  loaded?: boolean;
  state?: string;
  error?: string | null;
  lastError?: string | null;
  frames?: number;
  boxes?: InferenceStatus['recent_boxes'];
}): InferenceStatus {
  return {
    service: 'running',
    model: {
      path: 'F:\\wildcraft_project\\weights\\best.pt',
      exists: true,
      loaded: overrides.loaded ?? true,
      state: overrides.state ?? 'ready',
      error: overrides.error ?? null,
      class_names: ['smoke', 'fire'],
      device: 'cpu',
    },
    camera: {
      url: 'http://10.241.226.236:81/stream',
      state: 'streaming',
      last_error: null,
      last_frame_at: '2026-10-16T17:40:00.000+05:30',
      frames_received: 10,
    },
    inference: {
      running: true,
      confidence: 0.25,
      processed_fps: 3.5,
      last_inference_at: '2026-10-16T17:40:00.000+05:30',
      last_error: overrides.lastError ?? null,
      frames_processed: overrides.frames ?? 4,
      frame_width: 320,
      frame_height: 240,
      last_duration_ms: 80,
    },
    recent_boxes: overrides.boxes ?? [],
    recent_events: [],
  };
}

test('a loaded model with no boxes is not reported as missing', () => {
  assert.equal(detectionStatusText(null).text, 'Inference status has not arrived.');
  assert.equal(detectionStatusText(inferenceStatus({ frames: 0 })).text, 'No frame has been processed yet.');
  assert.equal(detectionStatusText(inferenceStatus({})).text, 'No detections in current frame');
  const missing = detectionStatusText(
    inferenceStatus({ loaded: false, state: 'missing', error: 'Model file not found: F:\\wildcraft_project\\best.pt' }),
  );
  assert.equal(missing.kind, 'failure');
  assert.match(missing.text, /Model file not found/);
  const parsed = parseInferenceStatus({
    service: 'running',
    model: {
      path: 'F:\\wildcraft_project\\weights\\best.pt',
      loaded: true,
      state: 'ready',
      error: null,
      class_names: ['smoke', 'fire'],
      device: 'cpu',
    },
    camera: {
      url: 'http://10.241.226.236:81/stream',
      state: 'streaming',
      last_error: null,
      last_frame_at: null,
      frames_received: 2,
    },
    inference: {
      running: true,
      confidence: 0.25,
      processed_fps: 1,
      last_inference_at: null,
      last_error: null,
      frames_processed: 2,
    },
    recent_boxes: [],
    recent_events: [],
  });
  assert.equal(parsed?.model.exists, null);
  assert.equal(parsed?.inference.frame_width, null);
  assert.equal(detectionStatusText(parsed).text, 'No detections in current frame');
});
