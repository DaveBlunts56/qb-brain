import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';

// node:sqlite prints an ExperimentalWarning on load; silence only that warning.
const originalEmitWarning = process.emitWarning;
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const text = typeof warning === 'string' ? warning : warning?.message;
  if (text && text.includes('SQLite')) return;
  return (originalEmitWarning as (...a: unknown[]) => void).call(process, warning, ...rest);
}) as typeof process.emitWarning;
const { DatabaseSync } = await import('node:sqlite');

export type Db = DatabaseSyncType;

const MIGRATIONS: string[] = [
  `
  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sport TEXT NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    draft_json TEXT NOT NULL,
    draft_rev INTEGER NOT NULL DEFAULT 0,
    published_json TEXT,
    published_version INTEGER NOT NULL DEFAULT 0,
    published_at INTEGER,
    live_match_id TEXT,
    settings_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE assets (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    kind TEXT NOT NULL,
    mime TEXT NOT NULL,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    size INTEGER NOT NULL,
    width INTEGER,
    height INTEGER,
    sha256 TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX assets_project ON assets(project_id);
  CREATE TABLE matches (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    state_json TEXT NOT NULL,
    seq INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX matches_project ON matches(project_id);
  CREATE TABLE events (
    id TEXT PRIMARY KEY,
    match_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    type TEXT NOT NULL,
    ts INTEGER NOT NULL,
    payload_json TEXT NOT NULL,
    persistent INTEGER NOT NULL,
    command_id TEXT,
    origin TEXT NOT NULL,
    UNIQUE(match_id, seq)
  );
  CREATE TABLE commands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id TEXT NOT NULL,
    command_id TEXT NOT NULL,
    ts INTEGER NOT NULL,
    type TEXT NOT NULL,
    label TEXT NOT NULL,
    seq INTEGER,
    undoable INTEGER NOT NULL DEFAULT 0,
    undo_json TEXT,
    undone INTEGER NOT NULL DEFAULT 0,
    UNIQUE(match_id, command_id)
  );
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL
  );
  CREATE TABLE animation_presets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    clip_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL
  );
  `,
];

export function openDatabase(dataDir: string, file = 'broadcastforge.db'): Db {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(file === ':memory:' ? ':memory:' : path.join(dataDir, file));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const row = db.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined;
  let version = row?.version ?? 0;
  if (!row) db.prepare('INSERT INTO schema_version (version) VALUES (0)').run();
  while (version < MIGRATIONS.length) {
    transaction(db, () => {
      db.exec(MIGRATIONS[version]!);
      version++;
      db.prepare('UPDATE schema_version SET version = ?').run(version);
    });
  }
  return db;
}

export function transaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
