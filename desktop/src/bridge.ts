import type { DesktopAlert, DesktopSettings, ModelFileStat } from '../shared/types';
import { DEFAULT_SETTINGS, normalizeSettings } from '../shared/validate';

export type WildcraftBridge = {
  getSettings(): Promise<DesktopSettings>;
  saveSettings(settings: DesktopSettings): Promise<DesktopSettings>;
  chooseModel(): Promise<string | null>;
  statModel(modelPath: string): Promise<ModelFileStat>;
  listAlerts(): Promise<DesktopAlert[]>;
  saveAlert(alert: DesktopAlert): Promise<DesktopAlert>;
  acknowledgeAlert(id: string): Promise<DesktopAlert | null>;
};

const SETTINGS_KEY = 'wildcraft.settings';
const ALERTS_KEY = 'wildcraft.alerts';

function browserBridge(): WildcraftBridge {
  return {
    async getSettings() {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) {
        return DEFAULT_SETTINGS;
      }
      try {
        const parsed = normalizeSettings(JSON.parse(raw) as DesktopSettings);
        return parsed ?? DEFAULT_SETTINGS;
      } catch {
        return DEFAULT_SETTINGS;
      }
    },
    async saveSettings(settings) {
      const normalized = normalizeSettings(settings);
      if (!normalized) {
        throw new Error('Check the backend URL, inference URL, camera settings, model path, and confidence.');
      }
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalized));
      return normalized;
    },
    async chooseModel() {
      return null;
    },
    async statModel() {
      return { exists: false, size: null };
    },
    async listAlerts() {
      const raw = localStorage.getItem(ALERTS_KEY);
      if (!raw) {
        return [];
      }
      try {
        const parsed = JSON.parse(raw) as DesktopAlert[];
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    },
    async saveAlert(alert) {
      const current = await this.listAlerts();
      const index = current.findIndex((item) => item.id === alert.id);
      const next = [...current];
      if (index >= 0) {
        const existing = next[index];
        next[index] = {
          ...alert,
          acknowledged: existing.acknowledged || alert.acknowledged,
          acknowledgedAt: existing.acknowledgedAt ?? alert.acknowledgedAt,
        };
      } else {
        next.unshift(alert);
      }
      localStorage.setItem(ALERTS_KEY, JSON.stringify(next.slice(0, 500)));
      return index >= 0 ? next[index] : alert;
    },
    async acknowledgeAlert(id) {
      const current = await this.listAlerts();
      const index = current.findIndex((item) => item.id === id);
      if (index < 0) {
        return null;
      }
      const next = [...current];
      next[index] = {
        ...next[index],
        acknowledged: true,
        acknowledgedAt: new Date().toISOString(),
      };
      localStorage.setItem(ALERTS_KEY, JSON.stringify(next));
      return next[index];
    },
  };
}

export function bridge(): WildcraftBridge {
  if (typeof window !== 'undefined' && window.wildcraft) {
    return window.wildcraft;
  }
  return browserBridge();
}
