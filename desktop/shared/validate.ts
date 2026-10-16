import type { CameraSource, DesktopSettings } from './types';

export const DEFAULT_SETTINGS: DesktopSettings = {
  backendUrl: 'http://127.0.0.1:8000',
  inferenceUrl: 'http://127.0.0.1:8100',
  cameraIp: 'http://10.241.226.236',
  cameraUrl: 'http://10.241.226.236:81/stream',
  cameraSource: 'webcam',
  cameraIndex: null,
  cameraDevice: '',
  modelPath: 'F:\\wildcraft_project\\weights\\best.pt',
  confidence: 0.35,
  inferenceFps: 4,
  eventWindowS: 20,
};

const ALERT_KINDS = new Set([
  'ai_fire',
  'ai_smoke',
  'ai_detection',
  'sensor_warning',
  'node_offline',
  'camera_disconnected',
]);

export function normalizeBackendUrl(input: string): string | null {
  let trimmed = input.trim();
  if (!trimmed) {
    return null;
  }
  if (/^wss:\/\//i.test(trimmed)) {
    trimmed = `https://${trimmed.slice(6)}`;
  } else if (/^ws:\/\//i.test(trimmed)) {
    trimmed = `http://${trimmed.slice(5)}`;
  }
  trimmed = trimmed.replace(/\/ws\/sensors\/?$/i, '').replace(/\/+$/, '');
  if (!/^https?:\/\/[^/\s]+$/i.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export function normalizeServiceUrl(input: string): string | null {
  const trimmed = input.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^/\s]+$/i.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export function normalizeCameraUrl(input: string): string | null {
  const trimmed = input.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return null;
  }
  if (!url.hostname || url.username || url.password) {
    return null;
  }
  return url.toString();
}

export function normalizeCameraIp(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > 200 || /[\s\r\n]/.test(trimmed)) {
    return null;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname || url.username || url.password) {
        return null;
      }
      if (url.pathname !== '/' && url.pathname !== '') {
        return null;
      }
      return `${url.protocol}//${url.host}`;
    } catch {
      return null;
    }
  }
  if (/[/?#]/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export function streamUrlFromIp(ip: string): string | null {
  const normalized = normalizeCameraIp(ip);
  if (!normalized) {
    return null;
  }
  const host = /^https?:\/\//i.test(normalized) ? new URL(normalized).hostname : normalized;
  if (!host) {
    return null;
  }
  return normalizeCameraUrl(`http://${host}:81/stream`);
}

export function cameraPathWarning(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.pathname === '/' || parsed.pathname === '') {
      return 'This URL has no stream path. ESP32-CAM firmware often serves video at http://CAMERA_IP:81/stream rather than the root address.';
    }
  } catch {
    return null;
  }
  return null;
}

export function clampConfidence(value: number): number | null {
  if (!Number.isFinite(value)) {
    return null;
  }
  const rounded = Math.round(value * 100) / 100;
  if (rounded < 0.01 || rounded > 0.99) {
    return null;
  }
  return rounded;
}

function clampFps(value: number): number | null {
  if (!Number.isFinite(value)) {
    return null;
  }
  const rounded = Math.round(value * 10) / 10;
  if (rounded < 0.5 || rounded > 12) {
    return null;
  }
  return rounded;
}

function clampWindow(value: number): number | null {
  if (!Number.isFinite(value)) {
    return null;
  }
  const rounded = Math.round(value);
  if (rounded < 5 || rounded > 120) {
    return null;
  }
  return rounded;
}

function normalizeCameraIndex(value: unknown): number | null {
  if (value == null || value === '') {
    return null;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 32) {
    return null;
  }
  return value;
}

export function normalizeSettings(input: DesktopSettings): DesktopSettings | null {
  const backendUrl = normalizeBackendUrl(input.backendUrl);
  const inferenceUrl = normalizeServiceUrl(input.inferenceUrl);
  const cameraSource: CameraSource = input.cameraSource === 'stream' ? 'stream' : 'webcam';
  const cameraUrl = input.cameraUrl.trim() ? normalizeCameraUrl(input.cameraUrl) : '';
  const confidence = clampConfidence(input.confidence);
  const cameraIp = input.cameraIp.trim() ? normalizeCameraIp(input.cameraIp) : '';
  const modelPath = input.modelPath.trim();
  const cameraDevice = typeof input.cameraDevice === 'string' ? input.cameraDevice.trim() : '';
  const inferenceFps = clampFps(typeof input.inferenceFps === 'number' ? input.inferenceFps : DEFAULT_SETTINGS.inferenceFps);
  const eventWindowS = clampWindow(typeof input.eventWindowS === 'number' ? input.eventWindowS : DEFAULT_SETTINGS.eventWindowS);
  if (!backendUrl || !inferenceUrl || confidence == null || inferenceFps == null || eventWindowS == null) {
    return null;
  }
  if (input.cameraUrl.trim() && !cameraUrl) {
    return null;
  }
  if (input.cameraIp.trim() && !cameraIp) {
    return null;
  }
  if (cameraSource === 'stream' && (!cameraUrl || !cameraIp)) {
    return null;
  }
  if (!modelPath || modelPath.length > 500 || !modelPath.toLowerCase().endsWith('.pt') || /[\r\n]/.test(modelPath)) {
    return null;
  }
  if (cameraDevice.length > 200 || /[\r\n]/.test(cameraDevice)) {
    return null;
  }
  return {
    backendUrl,
    inferenceUrl,
    cameraIp: cameraIp ?? '',
    cameraUrl: cameraUrl ?? '',
    cameraSource,
    cameraIndex: normalizeCameraIndex(input.cameraIndex),
    cameraDevice,
    modelPath,
    confidence,
    inferenceFps,
    eventWindowS,
  };
}

export function websocketUrl(base: string, path: string): string {
  if (base.startsWith('https://')) {
    return `wss://${base.slice('https://'.length)}${path}`;
  }
  if (base.startsWith('http://')) {
    return `ws://${base.slice('http://'.length)}${path}`;
  }
  return '';
}

export function isAlertKind(value: string): boolean {
  return ALERT_KINDS.has(value);
}
