import { performance } from 'node:perf_hooks';
import {
  applyUndoPatch,
  clockExpiresAt,
  createId,
  createUndoPatch,
  draft,
  isEmptyPatch,
  recoverClock,
  reduceGame,
  TRANSIENT_EVENT_TYPES,
  type BroadcastEvent,
  type CommandAck,
  type EventDraft,
  type EventsMessage,
  type GameCommand,
  type GameState,
  type MatchSnapshot,
  type ReduceContext,
  type SyncMessage,
  type UndoPatch,
} from '@bf/shared';
import type { MatchRecord, Store } from '../db/store.js';
import { logger } from '../logger.js';

const log = logger('match');

export interface RuntimeSink {
  events(projectId: string, msg: EventsMessage): void;
  sync(projectId: string, msg: SyncMessage): void;
}

type Origin = BroadcastEvent['origin'];

/**
 * The single source of truth for one live match.
 *
 * - Commands are applied one at a time (Node's event loop serialises them).
 * - Each command id is applied at most once: retries after a reconnect get
 *   the original result back instead of scoring twice.
 * - State, events and the undo patch are committed in one SQLite transaction
 *   before anything is broadcast, so a crash never leaves clients ahead of disk.
 * - Clocks are anchored to performance.now(); expiry is scheduled from the
 *   computed zero time, and periodic sync messages let clients correct drift.
 */
export class MatchRuntime {
  readonly matchId: string;
  readonly projectId: string;
  private state: GameState;
  private seq: number;
  private expiryTimers: Record<'game' | 'play', ReturnType<typeof setTimeout> | null> = { game: null, play: null };
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private syncTick = 0;
  private disposed = false;

  constructor(
    private readonly store: Store,
    record: MatchRecord,
    private readonly sink: RuntimeSink,
    private readonly bootId: string,
  ) {
    this.matchId = record.id;
    this.projectId = record.projectId;
    this.seq = record.seq;
    // Monotonic anchors from a previous process are meaningless: recover via wall time.
    const now = this.ctx();
    const recovered: GameState = {
      ...record.state,
      gameClock: recoverClock(record.state.gameClock, now.nowMono, now.nowWall),
      playClock: recoverClock(record.state.playClock, now.nowMono, now.nowWall),
    };
    this.state = recovered;
    this.store.saveMatchState(this.matchId, recovered);
    if (record.state.gameClock.running) log.warn(`Recovered running game clock for match ${this.matchId}; verify it against the stadium clock.`);
    this.scheduleExpiry();
    this.syncTimer = setInterval(() => this.periodicSync(), 1000);
    this.syncTimer.unref?.();
  }

  private ctx(): ReduceContext {
    return { nowMono: performance.now(), nowWall: Date.now() };
  }

  getState(): GameState {
    return this.state;
  }

  snapshot(): MatchSnapshot {
    const last = this.store.lastUndoable(this.matchId);
    return {
      matchId: this.matchId,
      projectId: this.projectId,
      seq: this.seq,
      state: this.state,
      serverMono: performance.now(),
      serverWall: Date.now(),
      bootId: this.bootId,
      undo: { available: Boolean(last), label: last?.label ?? null },
    };
  }

  apply(commandId: string, command: GameCommand, origin: Origin = 'operator'): CommandAck {
    if (this.disposed) return { ok: false, error: 'Match is no longer live' };
    const prior = this.store.getCommand(this.matchId, commandId);
    if (prior) return { ok: true, duplicate: true, seq: prior.seq ?? this.seq, label: prior.label };

    if (command.type === 'undo') return this.undo(commandId);

    const ctx = this.ctx();
    const result = reduceGame(this.state, command, ctx);
    if (result.error) return { ok: false, error: result.error };

    if (!result.events.length) {
      // Nothing changed. Record operator no-ops for dedupe; never record system
      // timers, or a re-armed expiry with the same id would be swallowed.
      if (origin !== 'system') {
        this.store.commitCommand({
          matchId: this.matchId,
          state: this.state,
          seq: this.seq,
          events: [],
          command: { matchId: this.matchId, commandId, ts: ctx.nowWall, type: command.type, label: result.label, seq: null, undoable: false, undo: null, undone: false },
        });
      }
      this.scheduleExpiry();
      return { ok: true, seq: this.seq, label: result.label };
    }

    let undo: UndoPatch | null = null;
    if (result.undoable) {
      undo = createUndoPatch(this.state, result.state);
      if (isEmptyPatch(undo)) undo = null;
    }
    return this.commit(commandId, command.type, result.label, result.state, result.events, origin, {
      undo,
      clearUndo: command.type === 'game.reset',
    });
  }

  private undo(commandId: string): CommandAck {
    const last = this.store.lastUndoable(this.matchId);
    if (!last?.undo) return { ok: false, error: 'Nothing to undo' };
    const { state, events } = applyUndoPatch(this.state, last.undo, this.ctx());
    events.push(draft('STATE_RESTORED', { undoOfSeq: last.seq ?? 0, label: last.label }));
    return this.commit(commandId, 'undo', `Undo: ${last.label}`, state, events, 'undo', { undo: null, markUndone: last.id });
  }

  private commit(
    commandId: string,
    type: string,
    label: string,
    next: GameState,
    drafts: EventDraft[],
    origin: Origin,
    opts: { undo: UndoPatch | null; markUndone?: number; clearUndo?: boolean },
  ): CommandAck {
    const ts = Date.now();
    let seq = this.seq;
    const events: BroadcastEvent[] = drafts.map((d) => ({
      id: createId('ev'),
      matchId: this.matchId,
      seq: ++seq,
      type: d.type,
      payload: d.payload,
      ts,
      persistent: !TRANSIENT_EVENT_TYPES.has(d.type),
      commandId,
      origin,
    }));
    try {
      this.store.commitCommand({
        matchId: this.matchId,
        state: next,
        seq,
        events,
        markUndone: opts.markUndone,
        clearUndo: opts.clearUndo,
        command: { matchId: this.matchId, commandId, ts, type, label, seq, undoable: Boolean(opts.undo), undo: opts.undo, undone: false },
      });
    } catch (err) {
      log.error(`Failed to persist command ${type}`, err);
      return { ok: false, error: 'Could not save the change (storage error); nothing was applied.' };
    }
    this.state = next;
    this.seq = seq;
    this.scheduleExpiry();
    this.sink.events(this.projectId, { matchId: this.matchId, events, snapshot: this.snapshot() });
    if (seq % 500 === 0) this.store.pruneCommands(this.matchId);
    return { ok: true, seq, label };
  }

  private scheduleExpiry() {
    for (const clock of ['game', 'play'] as const) {
      const timer = this.expiryTimers[clock];
      if (timer) clearTimeout(timer);
      this.expiryTimers[clock] = null;
      const c = clock === 'game' ? this.state.gameClock : this.state.playClock;
      const at = clockExpiresAt(c);
      if (at === null) continue;
      const delay = Math.max(0, at - performance.now());
      // Command id is tied to the anchor, so re-arming the same expiry is idempotent.
      const id = `sys-expire-${clock}-${c.anchorWall}-${Math.round(c.anchorMono)}`;
      this.expiryTimers[clock] = setTimeout(() => {
        this.expiryTimers[clock] = null;
        this.apply(id, { type: 'clock.expire', clock }, 'system');
      }, delay + 2);
    }
  }

  private periodicSync() {
    this.syncTick++;
    const running = this.state.gameClock.running || this.state.playClock.running;
    // Every second while a clock runs, every 5 s otherwise as a heartbeat.
    if (!running && this.syncTick % 5 !== 0) return;
    this.sink.sync(this.projectId, {
      matchId: this.matchId,
      seq: this.seq,
      serverMono: performance.now(),
      gameClock: this.state.gameClock,
      playClock: this.state.playClock,
    });
  }

  dispose() {
    this.disposed = true;
    for (const t of Object.values(this.expiryTimers)) if (t) clearTimeout(t);
    if (this.syncTimer) clearInterval(this.syncTimer);
  }
}
