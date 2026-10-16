import type { DesktopSettings } from './types';

export const DEFAULT_SETTINGS: DesktopSettings = {
  backendUrl: 'http://127.0.0.1:8000',
  inferenceUrl: 'http://127.0.0.1:8100',
  cameraIp: 'http://10.241.226.236',
  cameraUrl: 'http://10.241.226.236:81/stream',
  modelPath: 'F:\\wildcraft_project\\weights\\best.pt',
  confidence: 0.25,
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

export function normalizeSettings(input: DesktopSettings): DesktopSettings | null {
  const backendUrl = normalizeBackendUrl(input.backendUrl);
  const inferenceUrl = normalizeServiceUrl(input.inferenceUrl);
  const cameraUrl = normalizeCameraUrl(input.cameraUrl);
  const confidence = clampConfidence(input.confidence);
  const cameraIp = normalizeCameraIp(input.cameraIp);
  const modelPath = input.modelPath.trim();
  if (!backendUrl || !inferenceUrl || !cameraUrl || !cameraIp || confidence == null) {
    return null;
  }
  if (!modelPath || modelPath.length > 500 || !modelPath.toLowerCase().endsWith('.pt') || /[\r\n]/.test(modelPath)) {
    return null;
  }
  return { backendUrl, inferenceUrl, cameraIp, cameraUrl, modelPath, confidence };
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
