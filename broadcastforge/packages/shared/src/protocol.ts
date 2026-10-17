import type { GameCommand } from './game/commands.js';
import type { BroadcastEvent } from './game/events.js';
import type { GameState } from './game/types.js';
import type { Scene } from './scene/types.js';

/** Who a socket client is. Overlays are read-only. */
export type ClientRole = 'overlay' | 'control' | 'editor';

export interface MatchSnapshot {
  matchId: string;
  projectId: string;
  seq: number;
  state: GameState;
  /** Server monotonic ms at the moment the snapshot was taken. */
  serverMono: number;
  serverWall: number;
  /** Changes when the server restarts (monotonic time base resets). */
  bootId: string;
  undo: { available: boolean; label: string | null };
}

export interface HelloPayload {
  role: ClientRole;
  projectId: string;
  /** Last event seq this client applied (for gap detection). */
  lastSeq?: number;
}

export interface HelloAck {
  ok: boolean;
  error?: string;
  snapshot?: MatchSnapshot;
  scene?: PublishedScene | null;
  serverInfo?: { bootId: string; version: string };
}

export interface CommandRequest {
  /** Client-generated unique id: retries with the same id are applied once. */
  commandId: string;
  projectId: string;
  command: GameCommand;
}

export interface CommandAck {
  ok: boolean;
  duplicate?: boolean;
  error?: string;
  seq?: number;
  label?: string;
}

export interface PublishedScene {
  projectId: string;
  version: number;
  publishedAt: number;
  scene: Scene;
}

export interface EventsMessage {
  matchId: string;
  events: BroadcastEvent[];
  snapshot: MatchSnapshot;
}

export interface SyncMessage {
  matchId: string;
  seq: number;
  serverMono: number;
  gameClock: GameState['gameClock'];
  playClock: GameState['playClock'];
}

export interface TimePong {
  t0: number;
  serverMono: number;
  serverWall: number;
  bootId: string;
}

export interface PresenceInfo {
  projectId: string;
  overlays: number;
  controls: number;
  editors: number;
}

export interface ObsStatus {
  state: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';
  host: string;
  port: number;
  hasPassword: boolean;
  autoReconnect: boolean;
  obsVersion?: string;
  websocketVersion?: string;
  lastError?: string;
  latencyMs?: number;
  currentProgramScene?: string;
  nextRetryAt?: number;
  baseWidth?: number;
  baseHeight?: number;
}

/** Socket.IO event names. */
export const SOCKET = {
  hello: 'hello',
  command: 'command',
  timePing: 'time:ping',
  snapshot: 'match:snapshot',
  events: 'match:events',
  sync: 'match:sync',
  scenePublished: 'scene:published',
  presence: 'presence',
  obsStatus: 'obs:status',
  projectsChanged: 'projects:changed',
  overlayReload: 'overlay:reload',
} as const;
