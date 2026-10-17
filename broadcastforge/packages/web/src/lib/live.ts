import { io, type Socket } from 'socket.io-client';
import {
  createId,
  ServerTimeEstimator,
  SOCKET,
  type ClientRole,
  type CommandAck,
  type EventsMessage,
  type GameCommand,
  type HelloAck,
  type MatchSnapshot,
  type ObsStatus,
  type PresenceInfo,
  type PublishedScene,
  type SyncMessage,
  type TimePong,
} from '@bf/shared';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface ConnectionStatus {
  state: ConnectionState;
  error?: string;
  rttMs: number | null;
  /** True after a reconnect until the first snapshot arrives again. */
  resyncing: boolean;
}

export interface LiveCallbacks {
  onSnapshot?(snap: MatchSnapshot, reason: 'hello' | 'server'): void;
  /** Live events with the snapshot they produced. Events already seen are filtered out. */
  onEvents?(msg: EventsMessage): void;
  onScene?(scene: PublishedScene): void;
  onStatus?(status: ConnectionStatus): void;
  onObsStatus?(status: ObsStatus): void;
  onPresence?(p: PresenceInfo): void;
  onProjectsChanged?(): void;
  onReload?(): void;
}

/**
 * One realtime connection to a project's live match.
 *
 * - Reconnects forever; each (re)connect re-sends hello and receives a full
 *   snapshot, which is applied without animation (state is the truth).
 * - Events carry sequence numbers; anything at or below the last applied
 *   seq is ignored, so nothing is animated twice after a reconnect.
 * - Server time is estimated with ping/pong so clocks render smoothly locally.
 * - Commands carry a unique id and are retried once with the same id; the
 *   server applies each id at most once.
 */
export class LiveConnection {
  readonly socket: Socket;
  readonly time = new ServerTimeEstimator();
  snapshot: MatchSnapshot | null = null;
  scene: PublishedScene | null = null;
  private lastSeq = -1;
  private bootId: string | null = null;
  private status: ConnectionStatus = { state: 'connecting', rttMs: null, resyncing: false };
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pings = 0;
  private stopped = false;

  constructor(
    readonly projectId: string,
    readonly role: ClientRole,
    private readonly cb: LiveCallbacks,
  ) {
    this.socket = io({
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 300,
      reconnectionDelayMax: 3000,
      timeout: 5000,
      autoConnect: false,
    });
    const s = this.socket;
    s.on('connect', () => void this.hello());
    s.on('disconnect', () => this.setStatus({ state: 'disconnected', resyncing: true }));
    s.on('connect_error', (err) => this.setStatus({ state: 'error', error: err.message || 'Cannot reach server' }));
    s.on(SOCKET.events, (msg: EventsMessage) => this.handleEvents(msg));
    s.on(SOCKET.snapshot, (snap: MatchSnapshot) => this.applySnapshot(snap, 'server'));
    s.on(SOCKET.sync, (msg: SyncMessage) => this.handleSync(msg));
    s.on(SOCKET.scenePublished, (scene: PublishedScene) => {
      if (scene.projectId !== this.projectId) return;
      this.scene = scene;
      this.cb.onScene?.(scene);
    });
    s.on(SOCKET.obsStatus, (st: ObsStatus) => this.cb.onObsStatus?.(st));
    s.on(SOCKET.presence, (p: PresenceInfo) => p.projectId === this.projectId && this.cb.onPresence?.(p));
    s.on(SOCKET.projectsChanged, () => this.cb.onProjectsChanged?.());
    s.on(SOCKET.overlayReload, () => this.cb.onReload?.());
  }

  start() {
    this.socket.connect();
    this.pingTimer = setInterval(() => void this.ping(), 2000);
  }

  stop() {
    this.stopped = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.socket.removeAllListeners();
    this.socket.disconnect();
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  /** Estimated server monotonic time, for clock rendering. */
  serverNow(): number {
    return this.time.serverNow(performance.now());
  }

  private setStatus(patch: Partial<ConnectionStatus>) {
    this.status = { ...this.status, ...patch };
    this.cb.onStatus?.(this.status);
  }

  private async hello() {
    try {
      const ack: HelloAck = await this.socket.timeout(6000).emitWithAck(SOCKET.hello, { role: this.role, projectId: this.projectId, lastSeq: this.lastSeq });
      if (!ack.ok || !ack.snapshot) {
        this.setStatus({ state: 'error', error: ack.error === 'PAIRING_REQUIRED' ? 'This device is not paired' : (ack.error ?? 'Rejected by server') });
        return;
      }
      if (ack.serverInfo && this.bootId && ack.serverInfo.bootId !== this.bootId) {
        // Server restarted: its monotonic time base changed.
        this.time.reset();
      }
      this.bootId = ack.serverInfo?.bootId ?? null;
      if (ack.scene) {
        this.scene = ack.scene;
        this.cb.onScene?.(ack.scene);
      }
      this.applySnapshot(ack.snapshot, 'hello');
      this.setStatus({ state: 'connected', error: undefined, resyncing: false });
      // A few quick pings for a good initial clock estimate.
      this.pings = 0;
      for (let i = 0; i < 4; i++) setTimeout(() => void this.ping(), i * 150);
    } catch {
      if (!this.stopped && this.socket.connected) setTimeout(() => void this.hello(), 1000);
    }
  }

  private applySnapshot(snap: MatchSnapshot, reason: 'hello' | 'server') {
    if (snap.projectId !== this.projectId) return;
    // A new match (new game) restarts sequence numbers.
    if (this.snapshot && snap.matchId !== this.snapshot.matchId) this.lastSeq = -1;
    if (reason === 'server' && this.snapshot?.matchId === snap.matchId && snap.seq < this.lastSeq) return;
    this.snapshot = snap;
    this.lastSeq = snap.seq;
    this.time.seed(snap.serverMono, performance.now());
    this.cb.onSnapshot?.(snap, reason);
  }

  private handleEvents(msg: EventsMessage) {
    if (msg.snapshot.projectId !== this.projectId) return;
    if (this.snapshot && msg.matchId !== this.snapshot.matchId) {
      this.applySnapshot(msg.snapshot, 'server');
      return;
    }
    const fresh = msg.events.filter((e) => e.seq > this.lastSeq);
    if (!fresh.length) return; // duplicate delivery
    this.snapshot = msg.snapshot;
    this.lastSeq = Math.max(this.lastSeq, msg.snapshot.seq);
    this.time.seed(msg.snapshot.serverMono, performance.now());
    this.cb.onEvents?.({ ...msg, events: fresh });
  }

  private handleSync(msg: SyncMessage) {
    if (!this.snapshot || msg.matchId !== this.snapshot.matchId) return;
    if (msg.seq > this.lastSeq) {
      // We missed something (dropped packet / sleep): fetch the truth.
      void this.hello();
      return;
    }
    if (msg.seq === this.snapshot.seq) {
      this.snapshot = { ...this.snapshot, state: { ...this.snapshot.state, gameClock: msg.gameClock, playClock: msg.playClock } };
    }
  }

  private async ping() {
    if (!this.socket.connected) return;
    const t0 = performance.now();
    try {
      const pong: TimePong = await this.socket.timeout(3000).emitWithAck(SOCKET.timePing, t0);
      const t1 = performance.now();
      if (this.bootId && pong.bootId !== this.bootId) return;
      this.time.addSample(pong.t0, pong.serverMono, t1);
      this.pings++;
      this.setStatus({ rttMs: Math.round(t1 - t0) });
    } catch {
      /* timeout: next ping will retry */
    }
  }

  /** Send an operator command. Retries once with the same id (safe: server dedupes). */
  async send(command: GameCommand): Promise<CommandAck> {
    const req = { commandId: createId('cmd'), projectId: this.projectId, command };
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!this.socket.connected) {
        const ok = await this.waitForConnection(3000);
        if (!ok) return { ok: false, error: 'Not connected to the BroadcastForge server' };
      }
      try {
        return await this.socket.timeout(4000).emitWithAck(SOCKET.command, req);
      } catch {
        // timed out: retry once with the same commandId
      }
    }
    return { ok: false, error: 'The server did not confirm the change (timeout). Check the connection.' };
  }

  private waitForConnection(ms: number): Promise<boolean> {
    if (this.socket.connected) return Promise.resolve(true);
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        this.socket.off('connect', on);
        resolve(false);
      }, ms);
      const on = () => {
        clearTimeout(t);
        resolve(true);
      };
      this.socket.once('connect', on);
    });
  }
}
