/** Laptop API address selection. One place owns the host used by HTTP and WebSocket. */

/** Wi-Fi IPv4 for this laptop. DHCP can change it. Update this, .env, and restart Expo with npx expo start -c. */
export const LAN_API_BASE = 'http://10.241.226.2:8000';
export const API_BASE_URL = LAN_API_BASE;
export const EMULATOR_API_BASE = 'http://10.0.2.2:8000';
export const LOOPBACK_API_BASE = 'http://127.0.0.1:8000';
/** Addresses from an earlier network. A saved copy must not keep beating the current LAN address. */
export const PREVIOUS_LAN_API_BASES = ['http://10.236.143.146:8000'] as const;

export type ApiRuntime = 'physical' | 'android-emulator' | 'ios-simulator' | 'web-local' | 'web-lan';

export function isLoopbackApiBase(base: string): boolean {
  const host = hostOf(base);
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

export function isEmulatorApiBase(base: string): boolean {
  return hostOf(base) === '10.0.2.2';
}

export function isStaleLanApiBase(base: string): boolean {
  const normalized = normalizeApiBase(base);
  return normalized != null && (PREVIOUS_LAN_API_BASES as readonly string[]).includes(normalized);
}

/** Accept an HTTP(S) base URL, or a WebSocket URL pasted from the setup notes. */
export function normalizeApiBase(input: string): string | null {
  let trimmed = input.trim();
  if (!trimmed) {
    return null;
  }
  if (/^wss:\/\//i.test(trimmed)) {
    trimmed = `https://${trimmed.slice(6)}`;
  } else if (/^ws:\/\//i.test(trimmed)) {
    trimmed = `http://${trimmed.slice(5)}`;
  }
  trimmed = trimmed.replace(/\/ws\/sensors$/i, '').replace(/\/+$/, '');
  if (!/^https?:\/\/[^/\s]+$/i.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export function websocketUrlFromBase(base: string): string {
  if (/^https:\/\//i.test(base)) {
    return `wss://${base.slice('https://'.length)}/ws/sensors`;
  }
  if (/^http:\/\//i.test(base)) {
    return `ws://${base.slice('http://'.length)}/ws/sensors`;
  }
  return '';
}

export const SENSOR_WS_URL = websocketUrlFromBase(API_BASE_URL);

export function detectApiRuntime(input: {
  os: string;
  isDevice: boolean | null;
  webHostname?: string | null;
}): ApiRuntime {
  if (input.os === 'web') {
    const host = (input.webHostname ?? '').trim().toLowerCase();
    if (!host || host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') {
      return 'web-local';
    }
    return 'web-lan';
  }
  if (input.os === 'android' && input.isDevice === false) {
    return 'android-emulator';
  }
  if (input.os === 'ios' && input.isDevice === false) {
    return 'ios-simulator';
  }
  return 'physical';
}

export function resolveApiBase(input: {
  stored: string | null;
  envValue: string | undefined;
  runtime: ApiRuntime;
  webHost?: string | null;
}): string {
  const stored = normalizeApiBase(input.stored ?? '');
  const fromEnv = normalizeApiBase(typeof input.envValue === 'string' ? input.envValue.trim() : '');
  const lan = fromEnv && !isLoopbackApiBase(fromEnv) && !isStaleLanApiBase(fromEnv) ? fromEnv : LAN_API_BASE;
  const fallback = fallbackForRuntime(input.runtime, input.webHost ?? null, lan);

  if (!stored || isStaleLanApiBase(stored)) {
    return fallback;
  }
  if (isLoopbackApiBase(stored)) {
    if (input.runtime === 'web-local' || input.runtime === 'ios-simulator') {
      return stored;
    }
    return fallback;
  }
  return stored;
}

export function unreachableApiMessage(base: string): string {
  return `HTTP request failed for ${base}. The phone and laptop must be on the same Wi-Fi.`;
}

export function websocketFailedMessage(base: string): string {
  const socket = websocketUrlFromBase(base);
  return `WebSocket connection failed for ${socket || base}.`;
}

export function timedOutApiMessage(base: string): string {
  return `HTTP request to ${base} did not respond in time.`;
}

export function httpStatusApiMessage(base: string, status: number): string {
  return `The laptop API at ${base} returned HTTP ${status}.`;
}

function fallbackForRuntime(runtime: ApiRuntime, webHost: string | null, lan: string): string {
  if (runtime === 'android-emulator') {
    return EMULATOR_API_BASE;
  }
  if (runtime === 'ios-simulator' || runtime === 'web-local') {
    return LOOPBACK_API_BASE;
  }
  if (runtime === 'web-lan') {
    const host = (webHost ?? '').replace(/^\[|\]$/g, '').trim();
    return (host ? normalizeApiBase(`http://${host}:8000`) : null) ?? lan;
  }
  return lan;
}

function hostOf(base: string): string {
  return base.replace(/^https?:\/\//i, '').split('/')[0]?.split(':')[0]?.toLowerCase() ?? '';
}
