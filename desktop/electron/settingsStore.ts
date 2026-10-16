import fs from 'node:fs';
import path from 'node:path';

import { moduleDir } from './modulePath';
import type { DesktopSettings, ModelFileStat } from '../shared/types';
import { DEFAULT_SETTINGS, normalizeSettings } from '../shared/validate';

export function loadSettings(filePath: string, projectRoot: string): DesktopSettings {
  const defaults = { ...DEFAULT_SETTINGS, modelPath: defaultModelPath(projectRoot) };
  if (!fs.existsSync(filePath)) {
    return defaults;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as DesktopSettings;
    const normalized = normalizeSettings(parsed);
    if (!normalized) {
      return defaults;
    }
    return { ...normalized, modelPath: migrateModelPath(normalized.modelPath, projectRoot) };
  } catch {
    return defaults;
  }
}

export function saveSettings(filePath: string, settings: DesktopSettings): DesktopSettings {
  const normalized = normalizeSettings(settings);
  if (!normalized) {
    throw new Error('Check the backend URL, inference URL, camera settings, model path, and confidence.');
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(normalized, null, 2), 'utf8');
  return normalized;
}

export function statModel(modelPath: string): ModelFileStat {
  try {
    const stat = fs.statSync(modelPath);
    return { exists: stat.isFile(), size: stat.isFile() ? stat.size : null };
  } catch {
    return { exists: false, size: null };
  }
}

export function defaultModelPath(projectRoot: string): string {
  const preferred = path.join(projectRoot, 'weights', 'best.pt');
  const candidates = [preferred, path.join(projectRoot, 'models', 'best.pt'), path.join(projectRoot, 'best.pt')];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return preferred;
}

function migrateModelPath(modelPath: string, projectRoot: string): string {
  const preferred = path.join(projectRoot, 'weights', 'best.pt');
  if (!fs.existsSync(preferred) || !fs.statSync(preferred).isFile()) {
    return modelPath;
  }
  const stale = new Set(
    [path.join(projectRoot, 'best.pt'), 'F:\\edit\\best.pt', 'F:\\wildcraft_project\\best.pt'].map((item) =>
      path.normalize(item).toLowerCase(),
    ),
  );
  if (stale.has(path.normalize(modelPath).toLowerCase())) {
    return preferred;
  }
  return modelPath;
}

export function resolveProjectRoot(): string {
  const devRoot = path.resolve(moduleDir(), '..', '..');
  if (fs.existsSync(path.join(devRoot, 'backend', 'main.py'))) {
    return devRoot;
  }
  return 'F:\\wildcraft_project';
}
