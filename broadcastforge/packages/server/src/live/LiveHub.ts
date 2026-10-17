import {
  createId,
  createInitialGameState,
  createSampleGameState,
  defaultGameConfig,
  TEMPLATE_AWAY,
  TEMPLATE_HOME,
  teamInfoOf,
  type GameState,
  type MatchSnapshot,
} from '@bf/shared';
import type { Store } from '../db/store.js';
import { MatchRuntime, type RuntimeSink } from './MatchRuntime.js';

/** Owns one MatchRuntime per project (the project's live match). */
export class LiveHub {
  private runtimes = new Map<string, MatchRuntime>();

  constructor(
    private readonly store: Store,
    private readonly sink: RuntimeSink & { snapshot(projectId: string, snap: MatchSnapshot): void },
    readonly bootId: string,
  ) {}

  runtimeFor(projectId: string): MatchRuntime | null {
    const existing = this.runtimes.get(projectId);
    if (existing) return existing;
    const project = this.store.getProject(projectId);
    if (!project) return null;
    let match = project.liveMatchId ? this.store.getMatch(project.liveMatchId) : null;
    if (!match) {
      const id = this.createMatch(projectId, createInitialGameState({ config: defaultGameConfig('nfhs') }), 'Game 1');
      match = this.store.getMatch(id)!;
    }
    const rt = new MatchRuntime(this.store, match, this.sink, this.bootId);
    this.runtimes.set(projectId, rt);
    return rt;
  }

  createMatch(projectId: string, state: GameState, name: string): string {
    const id = createId('match');
    const now = Date.now();
    this.store.insertMatch({ id, projectId, name, state, seq: 0, createdAt: now, updatedAt: now });
    this.store.setLiveMatch(projectId, id);
    return id;
  }

  /** Start a fresh game (new match record); history of the old one is kept. */
  newMatch(projectId: string, opts: { keepTeams: boolean; name?: string }): MatchSnapshot | null {
    const current = this.runtimeFor(projectId);
    if (!current) return null;
    const prev = current.getState();
    const state = createInitialGameState({
      home: opts.keepTeams ? teamInfoOf(prev.home) : undefined,
      away: opts.keepTeams ? teamInfoOf(prev.away) : undefined,
      config: prev.config,
      overlayVisible: prev.overlayVisible,
    });
    this.dispose(projectId);
    this.createMatch(projectId, state, opts.name ?? `Game ${new Date().toLocaleDateString()}`);
    const rt = this.runtimeFor(projectId)!;
    const snap = rt.snapshot();
    this.sink.snapshot(projectId, snap);
    return snap;
  }

  /** Initial match for the bundled example: template teams mid-game. */
  createExampleMatch(projectId: string) {
    const state = createSampleGameState(TEMPLATE_HOME, TEMPLATE_AWAY);
    state.home.score = 14;
    state.away.score = 10;
    state.period = 'Q2';
    state.gameClock = { running: false, remainingMs: 4 * 60_000 + 18_000, anchorMono: 0, anchorWall: Date.now() };
    state.labels = { title: 'HOMECOMING' };
    this.createMatch(projectId, state, 'Example game');
  }

  dispose(projectId: string) {
    this.runtimes.get(projectId)?.dispose();
    this.runtimes.delete(projectId);
  }

  disposeAll() {
    for (const id of [...this.runtimes.keys()]) this.dispose(id);
  }
}
