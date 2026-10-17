import type { AnimationClip, BroadcastEvent, GameState, Scene, UndoPatch } from '@bf/shared';
import { transaction, type Db } from './database.js';

export interface ProjectSettings {
  obsSourceName?: string;
  obsSceneName?: string;
}

export interface ProjectRecord {
  id: string;
  name: string;
  sport: string;
  width: number;
  height: number;
  draft: Scene;
  draftRev: number;
  published: Scene | null;
  publishedVersion: number;
  publishedAt: number | null;
  liveMatchId: string | null;
  settings: ProjectSettings;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectSummary {
  id: string;
  name: string;
  sport: string;
  width: number;
  height: number;
  publishedVersion: number;
  publishedAt: number | null;
  createdAt: number;
  updatedAt: number;
  /** Whether the draft differs from what is on air. */
  hasUnpublishedChanges: boolean;
}

export interface AssetRecord {
  id: string;
  projectId: string | null;
  kind: 'image' | 'font';
  mime: string;
  filename: string;
  originalName: string;
  size: number;
  width: number | null;
  height: number | null;
  sha256: string;
  createdAt: number;
}

export interface MatchRecord {
  id: string;
  projectId: string;
  name: string;
  state: GameState;
  seq: number;
  createdAt: number;
  updatedAt: number;
}

export interface CommandRecord {
  id: number;
  matchId: string;
  commandId: string;
  ts: number;
  type: string;
  label: string;
  seq: number | null;
  undoable: boolean;
  undo: UndoPatch | null;
  undone: boolean;
}

type Row = Record<string, unknown>;
const json = <T>(v: unknown): T => JSON.parse(String(v)) as T;

function projectFromRow(r: Row): ProjectRecord {
  return {
    id: String(r.id),
    name: String(r.name),
    sport: String(r.sport),
    width: Number(r.width),
    height: Number(r.height),
    draft: json<Scene>(r.draft_json),
    draftRev: Number(r.draft_rev),
    published: r.published_json ? json<Scene>(r.published_json) : null,
    publishedVersion: Number(r.published_version),
    publishedAt: r.published_at === null ? null : Number(r.published_at),
    liveMatchId: r.live_match_id === null ? null : String(r.live_match_id),
    settings: json<ProjectSettings>(r.settings_json),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

function assetFromRow(r: Row): AssetRecord {
  return {
    id: String(r.id),
    projectId: r.project_id === null ? null : String(r.project_id),
    kind: String(r.kind) as AssetRecord['kind'],
    mime: String(r.mime),
    filename: String(r.filename),
    originalName: String(r.original_name),
    size: Number(r.size),
    width: r.width === null ? null : Number(r.width),
    height: r.height === null ? null : Number(r.height),
    sha256: String(r.sha256),
    createdAt: Number(r.created_at),
  };
}

function commandFromRow(r: Row): CommandRecord {
  return {
    id: Number(r.id),
    matchId: String(r.match_id),
    commandId: String(r.command_id),
    ts: Number(r.ts),
    type: String(r.type),
    label: String(r.label),
    seq: r.seq === null ? null : Number(r.seq),
    undoable: Boolean(r.undoable),
    undo: r.undo_json ? json<UndoPatch>(r.undo_json) : null,
    undone: Boolean(r.undone),
  };
}

/** All SQL lives here. Every multi-row write is wrapped in a transaction. */
export class Store {
  constructor(readonly db: Db) {}

  // ---- projects ----------------------------------------------------------

  listProjects(): ProjectSummary[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, sport, width, height, published_version, published_at, created_at, updated_at,
                (published_json IS NULL OR published_json != draft_json) AS dirty
         FROM projects ORDER BY updated_at DESC`,
      )
      .all() as Row[];
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      sport: String(r.sport),
      width: Number(r.width),
      height: Number(r.height),
      publishedVersion: Number(r.published_version),
      publishedAt: r.published_at === null ? null : Number(r.published_at),
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
      hasUnpublishedChanges: Boolean(r.dirty),
    }));
  }

  getProject(id: string): ProjectRecord | null {
    const r = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Row | undefined;
    return r ? projectFromRow(r) : null;
  }

  insertProject(p: Omit<ProjectRecord, 'draftRev' | 'publishedVersion' | 'publishedAt' | 'liveMatchId'> & Partial<ProjectRecord>): void {
    this.db
      .prepare(
        `INSERT INTO projects (id, name, sport, width, height, draft_json, draft_rev, published_json, published_version, published_at, live_match_id, settings_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        p.id,
        p.name,
        p.sport,
        p.width,
        p.height,
        JSON.stringify(p.draft),
        p.draftRev ?? 0,
        p.published ? JSON.stringify(p.published) : null,
        p.publishedVersion ?? 0,
        p.publishedAt ?? null,
        p.liveMatchId ?? null,
        JSON.stringify(p.settings ?? {}),
        p.createdAt,
        p.updatedAt,
      );
  }

  renameProject(id: string, name: string): void {
    this.db.prepare('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?').run(name, Date.now(), id);
  }

  updateProjectSettings(id: string, settings: ProjectSettings): void {
    this.db.prepare('UPDATE projects SET settings_json = ? WHERE id = ?').run(JSON.stringify(settings), id);
  }

  /** Optimistic-concurrency draft save. Returns the new revision, or null on conflict. */
  saveDraft(id: string, scene: Scene, expectedRev: number | null): number | null {
    return transaction(this.db, () => {
      const r = this.db.prepare('SELECT draft_rev FROM projects WHERE id = ?').get(id) as Row | undefined;
      if (!r) return null;
      const rev = Number(r.draft_rev);
      if (expectedRev !== null && expectedRev !== rev) return null;
      this.db
        .prepare('UPDATE projects SET draft_json = ?, draft_rev = ?, width = ?, height = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(scene), rev + 1, scene.width, scene.height, Date.now(), id);
      return rev + 1;
    });
  }

  publish(id: string): { version: number; publishedAt: number; scene: Scene } | null {
    return transaction(this.db, () => {
      const p = this.getProject(id);
      if (!p) return null;
      const version = p.publishedVersion + 1;
      const now = Date.now();
      this.db
        .prepare('UPDATE projects SET published_json = draft_json, published_version = ?, published_at = ? WHERE id = ?')
        .run(version, now, id);
      return { version, publishedAt: now, scene: p.draft };
    });
  }

  setLiveMatch(projectId: string, matchId: string): void {
    this.db.prepare('UPDATE projects SET live_match_id = ? WHERE id = ?').run(matchId, projectId);
  }

  deleteProject(id: string): string[] {
    return transaction(this.db, () => {
      const matchIds = (this.db.prepare('SELECT id FROM matches WHERE project_id = ?').all(id) as Row[]).map((r) => String(r.id));
      for (const m of matchIds) {
        this.db.prepare('DELETE FROM events WHERE match_id = ?').run(m);
        this.db.prepare('DELETE FROM commands WHERE match_id = ?').run(m);
      }
      this.db.prepare('DELETE FROM matches WHERE project_id = ?').run(id);
      const files = (this.db.prepare('SELECT filename FROM assets WHERE project_id = ?').all(id) as Row[]).map((r) => String(r.filename));
      this.db.prepare('DELETE FROM assets WHERE project_id = ?').run(id);
      this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
      return files;
    });
  }

  // ---- assets ------------------------------------------------------------

  insertAsset(a: AssetRecord): void {
    this.db
      .prepare(
        `INSERT INTO assets (id, project_id, kind, mime, filename, original_name, size, width, height, sha256, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(a.id, a.projectId, a.kind, a.mime, a.filename, a.originalName, a.size, a.width, a.height, a.sha256, a.createdAt);
  }

  getAsset(id: string): AssetRecord | null {
    const r = this.db.prepare('SELECT * FROM assets WHERE id = ?').get(id) as Row | undefined;
    return r ? assetFromRow(r) : null;
  }

  listAssets(projectId: string | null): AssetRecord[] {
    const rows = (
      projectId
        ? this.db.prepare('SELECT * FROM assets WHERE project_id = ? OR project_id IS NULL ORDER BY created_at DESC').all(projectId)
        : this.db.prepare('SELECT * FROM assets ORDER BY created_at DESC').all()
    ) as Row[];
    return rows.map(assetFromRow);
  }

  deleteAsset(id: string): AssetRecord | null {
    const a = this.getAsset(id);
    if (a) this.db.prepare('DELETE FROM assets WHERE id = ?').run(id);
    return a;
  }

  // ---- matches -----------------------------------------------------------

  insertMatch(m: MatchRecord): void {
    this.db
      .prepare('INSERT INTO matches (id, project_id, name, state_json, seq, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(m.id, m.projectId, m.name, JSON.stringify(m.state), m.seq, m.createdAt, m.updatedAt);
  }

  getMatch(id: string): MatchRecord | null {
    const r = this.db.prepare('SELECT * FROM matches WHERE id = ?').get(id) as Row | undefined;
    if (!r) return null;
    return {
      id: String(r.id),
      projectId: String(r.project_id),
      name: String(r.name),
      state: json<GameState>(r.state_json),
      seq: Number(r.seq),
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
    };
  }

  /**
   * Atomically persist the result of one command: new state, its events and
   * the command record (dedupe key + undo patch). Either all of it lands or none.
   */
  commitCommand(args: {
    matchId: string;
    state: GameState;
    seq: number;
    events: BroadcastEvent[];
    command: Omit<CommandRecord, 'id'>;
    markUndone?: number;
    clearUndo?: boolean;
  }): void {
    transaction(this.db, () => {
      this.db.prepare('UPDATE matches SET state_json = ?, seq = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(args.state), args.seq, Date.now(), args.matchId);
      const ins = this.db.prepare(
        'INSERT INTO events (id, match_id, seq, type, ts, payload_json, persistent, command_id, origin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      );
      for (const e of args.events) ins.run(e.id, e.matchId, e.seq, e.type, e.ts, JSON.stringify(e.payload), e.persistent ? 1 : 0, e.commandId, e.origin);
      if (args.markUndone !== undefined) this.db.prepare('UPDATE commands SET undone = 1 WHERE id = ?').run(args.markUndone);
      if (args.clearUndo) this.db.prepare('UPDATE commands SET undone = 1 WHERE match_id = ? AND undoable = 1').run(args.matchId);
      const c = args.command;
      this.db
        .prepare(
          'INSERT INTO commands (match_id, command_id, ts, type, label, seq, undoable, undo_json, undone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(c.matchId, c.commandId, c.ts, c.type, c.label, c.seq, c.undoable ? 1 : 0, c.undo ? JSON.stringify(c.undo) : null, c.undone ? 1 : 0);
    });
  }

  /** Persist state only (e.g. clock recovery on startup). */
  saveMatchState(matchId: string, state: GameState): void {
    this.db.prepare('UPDATE matches SET state_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(state), Date.now(), matchId);
  }

  getCommand(matchId: string, commandId: string): CommandRecord | null {
    const r = this.db.prepare('SELECT * FROM commands WHERE match_id = ? AND command_id = ?').get(matchId, commandId) as Row | undefined;
    return r ? commandFromRow(r) : null;
  }

  lastUndoable(matchId: string): CommandRecord | null {
    const r = this.db
      .prepare('SELECT * FROM commands WHERE match_id = ? AND undoable = 1 AND undone = 0 ORDER BY id DESC LIMIT 1')
      .get(matchId) as Row | undefined;
    return r ? commandFromRow(r) : null;
  }

  recentCommands(matchId: string, limit = 50): CommandRecord[] {
    return (this.db.prepare('SELECT * FROM commands WHERE match_id = ? ORDER BY id DESC LIMIT ?').all(matchId, limit) as Row[]).map(commandFromRow);
  }

  recentEvents(matchId: string, limit = 100): BroadcastEvent[] {
    const rows = this.db.prepare('SELECT * FROM events WHERE match_id = ? ORDER BY seq DESC LIMIT ?').all(matchId, limit) as Row[];
    return rows.map((r) => ({
      id: String(r.id),
      matchId: String(r.match_id),
      seq: Number(r.seq),
      type: String(r.type) as BroadcastEvent['type'],
      ts: Number(r.ts),
      payload: json(r.payload_json),
      persistent: Boolean(r.persistent),
      commandId: r.command_id === null ? null : String(r.command_id),
      origin: String(r.origin) as BroadcastEvent['origin'],
    }));
  }

  /** Keep the dedupe/history tables bounded. */
  pruneCommands(matchId: string, keep = 5000): void {
    this.db
      .prepare('DELETE FROM commands WHERE match_id = ? AND id <= (SELECT id FROM commands WHERE match_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?)')
      .run(matchId, matchId, keep);
  }

  // ---- settings ------------------------------------------------------------

  getSetting<T>(key: string): T | null {
    const r = this.db.prepare('SELECT value_json FROM settings WHERE key = ?').get(key) as Row | undefined;
    return r ? json<T>(r.value_json) : null;
  }

  setSetting(key: string, value: unknown): void {
    this.db.prepare('INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json').run(key, JSON.stringify(value));
  }

  // ---- presets -------------------------------------------------------------

  listPresets(): { id: string; name: string; clip: AnimationClip; createdAt: number }[] {
    return (this.db.prepare('SELECT * FROM animation_presets ORDER BY created_at').all() as Row[]).map((r) => ({
      id: String(r.id),
      name: String(r.name),
      clip: json<AnimationClip>(r.clip_json),
      createdAt: Number(r.created_at),
    }));
  }

  insertPreset(id: string, name: string, clip: AnimationClip): void {
    this.db.prepare('INSERT INTO animation_presets (id, name, clip_json, created_at) VALUES (?, ?, ?, ?)').run(id, name, JSON.stringify(clip), Date.now());
  }

  deletePreset(id: string): void {
    this.db.prepare('DELETE FROM animation_presets WHERE id = ?').run(id);
  }

  // ---- sessions (paired remote devices) ------------------------------------

  insertSession(tokenHash: string, label: string): void {
    const now = Date.now();
    this.db.prepare('INSERT INTO sessions (token_hash, label, created_at, last_seen) VALUES (?, ?, ?, ?)').run(tokenHash, label, now, now);
  }

  touchSession(tokenHash: string): boolean {
    const r = this.db.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?').run(Date.now(), tokenHash);
    return Number(r.changes) > 0;
  }

  listSessions(): { label: string; createdAt: number; lastSeen: number; id: string }[] {
    return (this.db.prepare('SELECT * FROM sessions ORDER BY last_seen DESC').all() as Row[]).map((r) => ({
      id: String(r.token_hash).slice(0, 12),
      label: String(r.label),
      createdAt: Number(r.created_at),
      lastSeen: Number(r.last_seen),
    }));
  }

  clearSessions(): void {
    this.db.prepare('DELETE FROM sessions').run();
  }
}
