import { requestJson } from '../services/http';
import type { EvidenceKind } from './types';

export type MissionRecord = {
  kind: EvidenceKind;
  action: 'incident' | 'create' | 'transition' | 'position' | 'cancel';
  incident_id: string;
  mission_id: string | null;
  state: string | null;
  summary: string;
  simulation: true;
  payload: Record<string, unknown>;
};

export async function postMission(baseUrl: string, path: string, body: unknown): Promise<void> {
  const root = baseUrl.replace(/\/$/, '');
  if (!root) return;
  await requestJson(`${root}${path}`, 8000, { method: 'POST', body: JSON.stringify(body) });
}

export async function loadIncidentHistory(baseUrl: string): Promise<unknown> {
  const root = baseUrl.replace(/\/$/, '');
  if (!root) return null;
  return requestJson(`${root}/api/incidents`, 8000);
}

export function recordBody(record: MissionRecord): MissionRecord {
  return { ...record, simulation: true };
}
