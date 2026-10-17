import type { Server as HttpServer } from 'node:http';
import { performance } from 'node:perf_hooks';
import { Server, type Socket } from 'socket.io';
import {
  APP_VERSION,
  parseCommand,
  SOCKET,
  SYSTEM_ONLY_COMMANDS,
  type ClientRole,
  type CommandAck,
  type EventsMessage,
  type HelloAck,
  type MatchSnapshot,
  type ObsStatus,
  type PresenceInfo,
  type PublishedScene,
  type SyncMessage,
  type TimePong,
} from '@bf/shared';
import type { AppConfig } from './config.js';
import type { LiveHub } from './live/LiveHub.js';
import { logger } from './logger.js';
import type { Security } from './security/auth.js';

const log = logger('socket');

interface SocketData {
  authorized: boolean;
  role: ClientRole | null;
  projectId: string | null;
  rate: { count: number; resetAt: number };
}

type Ack<T> = (v: T) => void;
const asAck = <T>(fn: unknown): Ack<T> => (typeof fn === 'function' ? (fn as Ack<T>) : () => {});

const room = (projectId: string) => `p:${projectId}`;
const STAFF = 'staff';

/** Broadcast fan-out used by the match runtimes, project service and OBS manager. */
export class Realtime {
  io: Server | null = null;
  private presenceTimer: ReturnType<typeof setTimeout> | null = null;
  private dirtyPresence = new Set<string>();

  attach(
    httpServer: HttpServer,
    deps: {
      config: AppConfig;
      security: Security;
      hub: LiveHub;
      published: (projectId: string) => PublishedScene | null;
      obsStatus: () => ObsStatus;
    },
  ) {
    const { security, hub } = deps;
    const io = new Server(httpServer, {
      serveClient: false,
      pingInterval: 10_000,
      pingTimeout: 8_000,
      maxHttpBufferSize: 256 * 1024,
      // Same host check as HTTP, plus Origin check: a random web page must not
      // be able to open a control socket to the operator's localhost.
      allowRequest: (req, cb) => cb(null, security.hostAllowed(req.headers.host) && security.originAllowed(req.headers.origin, req.headers.host)),
    });
    this.io = io;

    io.on('connection', (socket: Socket) => {
      const data: SocketData = { authorized: security.isAuthorized(socket.request), role: null, projectId: null, rate: { count: 0, resetAt: 0 } };
      socket.data = data;

      socket.on(SOCKET.hello, (payload: unknown, ackFn: unknown) => {
        const ack = asAck<HelloAck>(ackFn);
        const p = payload as { role?: string; projectId?: string } | null;
        const role = p?.role;
        const projectId = p?.projectId;
        if (!role || !['overlay', 'control', 'editor'].includes(role) || typeof projectId !== 'string' || projectId.length > 64) {
          return ack({ ok: false, error: 'Invalid hello' });
        }
        if (role !== 'overlay' && !data.authorized) return ack({ ok: false, error: 'PAIRING_REQUIRED' });
        if (role === 'overlay' && !data.authorized && !deps.config.publicOverlay) return ack({ ok: false, error: 'PAIRING_REQUIRED' });
        const rt = hub.runtimeFor(projectId);
        if (!rt) return ack({ ok: false, error: 'Project not found' });
        if (data.projectId) {
          socket.leave(room(data.projectId));
          socket.leave(`${room(data.projectId)}:${data.role}`);
          this.markPresence(data.projectId);
        }
        data.role = role as ClientRole;
        data.projectId = projectId;
        socket.join(room(projectId));
        socket.join(`${room(projectId)}:${role}`);
        if (role !== 'overlay') {
          socket.join(STAFF);
          socket.emit(SOCKET.obsStatus, deps.obsStatus());
        }
        this.markPresence(projectId);
        ack({ ok: true, snapshot: rt.snapshot(), scene: deps.published(projectId), serverInfo: { bootId: hub.bootId, version: APP_VERSION } });
      });

      socket.on(SOCKET.command, (payload: unknown, ackFn: unknown) => {
        const ack = asAck<CommandAck>(ackFn);
        if (!data.authorized || (data.role !== 'control' && data.role !== 'editor')) return ack({ ok: false, error: 'Not allowed' });
        const now = Date.now();
        if (now > data.rate.resetAt) data.rate = { count: 0, resetAt: now + 1000 };
        if (++data.rate.count > 40) return ack({ ok: false, error: 'Too many commands per second' });
        const req = payload as { commandId?: unknown; projectId?: unknown; command?: unknown } | null;
        if (typeof req?.commandId !== 'string' || req.commandId.length < 4 || req.commandId.length > 80) return ack({ ok: false, error: 'Missing command id' });
        if (typeof req.projectId !== 'string') return ack({ ok: false, error: 'Missing project id' });
        const parsed = parseCommand(req.command);
        if (!parsed.ok) return ack({ ok: false, error: parsed.error });
        if (SYSTEM_ONLY_COMMANDS.has(parsed.command.type)) return ack({ ok: false, error: 'Not allowed' });
        const rt = hub.runtimeFor(req.projectId);
        if (!rt) return ack({ ok: false, error: 'Project not found' });
        try {
          ack(rt.apply(req.commandId, parsed.command, 'operator'));
        } catch (err) {
          log.error('Command failed', err);
          ack({ ok: false, error: 'Internal error' });
        }
      });

      socket.on(SOCKET.timePing, (t0: unknown, ackFn: unknown) => {
        const ack = asAck<TimePong>(ackFn);
        ack({ t0: typeof t0 === 'number' ? t0 : 0, serverMono: performance.now(), serverWall: Date.now(), bootId: hub.bootId });
      });

      socket.on('disconnect', () => {
        if (data.projectId) this.markPresence(data.projectId);
      });
    });
  }

  private markPresence(projectId: string) {
    this.dirtyPresence.add(projectId);
    if (this.presenceTimer) return;
    this.presenceTimer = setTimeout(() => {
      this.presenceTimer = null;
      const ids = [...this.dirtyPresence];
      this.dirtyPresence.clear();
      for (const id of ids) this.io?.to(STAFF).emit(SOCKET.presence, this.presence(id));
    }, 100);
  }

  presence(projectId: string): PresenceInfo {
    const count = (role: string) => this.io?.sockets.adapter.rooms.get(`${room(projectId)}:${role}`)?.size ?? 0;
    return { projectId, overlays: count('overlay'), controls: count('control'), editors: count('editor') };
  }

  // ---- sink -----------------------------------------------------------------

  events(projectId: string, msg: EventsMessage) {
    this.io?.to(room(projectId)).emit(SOCKET.events, msg);
  }

  sync(projectId: string, msg: SyncMessage) {
    this.io?.to(room(projectId)).volatile.emit(SOCKET.sync, msg);
  }

  snapshot(projectId: string, snap: MatchSnapshot) {
    this.io?.to(room(projectId)).emit(SOCKET.snapshot, snap);
  }

  scenePublished(projectId: string, scene: PublishedScene) {
    this.io?.to(room(projectId)).emit(SOCKET.scenePublished, scene);
  }

  projectsChanged() {
    this.io?.to(STAFF).emit(SOCKET.projectsChanged);
  }

  obsStatus(status: ObsStatus) {
    this.io?.to(STAFF).emit(SOCKET.obsStatus, status);
  }

  reloadOverlays(projectId: string) {
    this.io?.to(`${room(projectId)}:overlay`).emit(SOCKET.overlayReload);
  }

  close() {
    this.io?.close();
  }
}
