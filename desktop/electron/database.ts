import { createRequire } from 'node:module';

import { moduleDir } from './modulePath';

declare const __filename: string;
import fs from 'node:fs';
import path from 'node:path';

import type { DesktopAlert } from '../shared/types';
import { isAlertKind } from '../shared/validate';

type Statement = {
  bind(params: Array<string | number | null>): void;
  step(): boolean;
  getAsObject(): Record<string, string | number | Uint8Array | null>;
  free(): void;
};

type SqlDatabase = {
  run(sql: string, params?: Array<string | number | null>): void;
  exec(sql: string): void;
  prepare(sql: string): Statement;
  export(): Uint8Array;
  close(): void;
};

type SqlModule = {
  Database: new (data?: Uint8Array) => SqlDatabase;
};

const require = createRequire(__filename);

function wasmPath(): string {
  const beside = path.join(moduleDir(), 'sql-wasm.wasm');
  const unpacked = beside.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
  const candidates = [
    unpacked,
    beside,
    path.join(moduleDir(), '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
    path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error('sql-wasm.wasm was not found. Reinstall the desktop dependencies.');
}

export class AlertDatabase {
  private db: SqlDatabase | null = null;

  constructor(private readonly filePath: string) {}

  async open(): Promise<void> {
    const initSqlJs = require('sql.js') as (options: { locateFile: (file: string) => string }) => Promise<SqlModule>;
    const SQL = await initSqlJs({ locateFile: () => wasmPath() });
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (fs.existsSync(this.filePath)) {
      this.db = new SQL.Database(fs.readFileSync(this.filePath));
    } else {
      this.db = new SQL.Database();
    }
    this.database().exec(`
      CREATE TABLE IF NOT EXISTS alerts (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        kind TEXT NOT NULL,
        severity TEXT NOT NULL,
        title TEXT NOT NULL,
        detail TEXT NOT NULL,
        source_label TEXT NOT NULL,
        dedupe_key TEXT NOT NULL,
        acknowledged INTEGER NOT NULL DEFAULT 0,
        acknowledged_at TEXT
      );
    `);
    this.persist();
  }

  list(): DesktopAlert[] {
    const statement = this.database().prepare(
      'SELECT id, created_at, kind, severity, title, detail, source_label, dedupe_key, acknowledged, acknowledged_at FROM alerts ORDER BY created_at DESC LIMIT 500',
    );
    const rows: DesktopAlert[] = [];
    while (statement.step()) {
      const row = statement.getAsObject();
      const alert = rowToAlert(row);
      if (alert) {
        rows.push(alert);
      }
    }
    statement.free();
    return rows;
  }

  save(input: unknown): DesktopAlert {
    const alert = sanitizeAlert(input);
    this.database().run(
      `INSERT INTO alerts (
         id, created_at, kind, severity, title, detail, source_label, dedupe_key, acknowledged, acknowledged_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         kind = excluded.kind,
         severity = excluded.severity,
         title = excluded.title,
         detail = excluded.detail,
         source_label = excluded.source_label,
         dedupe_key = excluded.dedupe_key,
         acknowledged = MAX(alerts.acknowledged, excluded.acknowledged),
         acknowledged_at = COALESCE(alerts.acknowledged_at, excluded.acknowledged_at)`,
      [
        alert.id,
        alert.createdAt,
        alert.kind,
        alert.severity,
        alert.title,
        alert.detail,
        alert.sourceLabel,
        alert.dedupeKey,
        alert.acknowledged ? 1 : 0,
        alert.acknowledgedAt,
      ],
    );
    this.persist();
    return this.list().find((item) => item.id === alert.id) ?? alert;
  }

  acknowledge(id: string): DesktopAlert | null {
    if (!id || id.length > 120) {
      return null;
    }
    const statement = this.database().prepare('SELECT id FROM alerts WHERE id = ?');
    statement.bind([id]);
    const found = statement.step();
    statement.free();
    if (!found) {
      return null;
    }
    const acknowledgedAt = new Date().toISOString();
    this.database().run('UPDATE alerts SET acknowledged = 1, acknowledged_at = ? WHERE id = ?', [acknowledgedAt, id]);
    this.persist();
    return this.list().find((item) => item.id === id) ?? null;
  }

  private database(): SqlDatabase {
    if (!this.db) {
      throw new Error('The alert database is not open.');
    }
    return this.db;
  }

  private persist(): void {
    const exported = this.database().export();
    const temporary = `${this.filePath}.tmp`;
    fs.writeFileSync(temporary, Buffer.from(exported));
    fs.renameSync(temporary, this.filePath);
  }
}

function sanitizeAlert(input: unknown): DesktopAlert {
  if (typeof input !== 'object' || input === null) {
    throw new Error('Alert payload was empty.');
  }
  const value = input as Record<string, unknown>;
  const id = cleanText(value.id, 120);
  const createdAt = cleanText(value.createdAt, 40);
  const kind = cleanText(value.kind, 40);
  const severity = cleanText(value.severity, 20);
  const title = cleanText(value.title, 200);
  const detail = cleanText(value.detail, 2000);
  const sourceLabel = cleanText(value.sourceLabel, 80);
  const dedupeKey = cleanText(value.dedupeKey, 200);
  if (!id || !createdAt || !isAlertKind(kind) || !title || !detail || !sourceLabel || !dedupeKey) {
    throw new Error('Alert payload was not valid.');
  }
  if (severity !== 'info' && severity !== 'warning' && severity !== 'critical') {
    throw new Error('Alert severity was not valid.');
  }
  const acknowledged = value.acknowledged === true;
  const acknowledgedAt = typeof value.acknowledgedAt === 'string' ? value.acknowledgedAt.slice(0, 40) : null;
  return {
    id,
    createdAt,
    kind: kind as DesktopAlert['kind'],
    severity,
    title,
    detail,
    sourceLabel,
    dedupeKey,
    acknowledged,
    acknowledgedAt: acknowledged ? acknowledgedAt : null,
  };
}

function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
}

function rowToAlert(row: Record<string, string | number | Uint8Array | null>): DesktopAlert | null {
  const kind = String(row.kind ?? '');
  const severity = String(row.severity ?? '');
  if (!isAlertKind(kind) || (severity !== 'info' && severity !== 'warning' && severity !== 'critical')) {
    return null;
  }
  return {
    id: String(row.id ?? ''),
    createdAt: String(row.created_at ?? ''),
    kind: kind as DesktopAlert['kind'],
    severity,
    title: String(row.title ?? ''),
    detail: String(row.detail ?? ''),
    sourceLabel: String(row.source_label ?? ''),
    dedupeKey: String(row.dedupe_key ?? ''),
    acknowledged: Number(row.acknowledged ?? 0) === 1,
    acknowledgedAt: row.acknowledged_at == null ? null : String(row.acknowledged_at),
  };
}
