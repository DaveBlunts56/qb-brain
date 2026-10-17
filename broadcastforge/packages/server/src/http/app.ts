import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import {
  APP_VERSION,
  createId,
  parseCommand,
  SYSTEM_ONLY_COMMANDS,
  type AnimationClip,
} from '@bf/shared';
import { lanAddresses, type AppConfig } from '../config.js';
import type { Store } from '../db/store.js';
import type { LiveHub } from '../live/LiveHub.js';
import { logger } from '../logger.js';
import type { ObsManager } from '../obs/ObsManager.js';
import type { Realtime } from '../realtime.js';
import type { Security } from '../security/auth.js';
import type { AssetService } from '../services/assets.js';
import { createProjectSchema, type ProjectService } from '../services/projects.js';
import { badRequest, HttpError, notFound } from './errors.js';
import { MAX_UPLOAD_BYTES } from './uploads.js';

const log = logger('http');

export interface AppDeps {
  config: AppConfig;
  store: Store;
  security: Security;
  hub: LiveHub;
  projects: ProjectService;
  assets: AssetService;
  obs: ObsManager;
  realtime: Realtime;
  bootId: string;
}

const DEFAULT_HOTKEYS: Record<string, string> = {
  'home.+1': 'KeyQ',
  'home.+2': 'KeyW',
  'home.+3': 'KeyE',
  'home.+6': 'KeyR',
  'away.+1': 'KeyU',
  'away.+2': 'KeyI',
  'away.+3': 'KeyO',
  'away.+6': 'KeyP',
  'clock.toggle': 'Space',
  'playClock.reset40': 'KeyK',
  'playClock.reset25': 'KeyL',
  'possession.toggle': 'KeyX',
  'down.next': 'KeyD',
  'firstDown': 'Shift+KeyD',
  'flag.toggle': 'KeyF',
  'overlay.toggle': 'KeyB',
  'undo': 'Ctrl+KeyZ',
};

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) {
    const i = r.error.issues[0];
    throw badRequest(i ? `${i.path.join('.') || 'body'}: ${i.message}` : 'Invalid request');
  }
  return r.data;
}

const idParam = (req: Request) => {
  const id = String(req.params.id ?? '');
  if (!/^[\w-]{1,64}$/.test(id)) throw badRequest('Invalid id');
  return id;
};

export function overlayUrls(config: AppConfig, projectId: string): { label: string; url: string }[] {
  const urls = [{ label: 'This computer', url: `http://localhost:${config.port}/overlay/${projectId}` }];
  const lanCapable = config.host === '0.0.0.0' || config.host === '::';
  if (lanCapable) for (const ip of lanAddresses()) urls.push({ label: `Network (${ip})`, url: `http://${ip}:${config.port}/overlay/${projectId}` });
  else if (config.host !== '127.0.0.1' && config.host !== 'localhost') urls.push({ label: 'Network', url: `http://${config.host}:${config.port}/overlay/${projectId}` });
  return urls;
}

export function createApp(deps: AppDeps) {
  const { config, store, security, hub, projects, assets, obs, realtime } = deps;
  const app = express();
  app.disable('x-powered-by');
  app.use(security.hostGuard);
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  const json = express.json({ limit: '4mb' });
  const bigJson = express.json({ limit: '80mb' });
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });

  // ---- public endpoints -------------------------------------------------------

  app.get('/api/system/info', (req, res) => {
    res.json({
      name: 'BroadcastForge Studio',
      version: APP_VERSION,
      bootId: deps.bootId,
      port: config.port,
      host: config.host,
      lanEnabled: config.host === '0.0.0.0' || config.host === '::',
      lanAddresses: lanAddresses(),
      isLocal: security.isLocal(req),
      authorized: security.isAuthorized(req),
      remoteObs: config.remoteObs,
      dev: config.dev,
    });
  });

  app.post('/api/auth/pair', json, (req, res) => {
    const body = parse(z.object({ code: z.string().max(20), label: z.string().max(60).optional() }), req.body);
    const r = security.pair(req.socket.remoteAddress ?? '?', body.code, body.label ?? String(req.headers['user-agent'] ?? '').slice(0, 60));
    if (!r.ok) return void res.status(401).json({ error: r.error });
    res.setHeader('Set-Cookie', security.sessionCookie(r.token));
    res.json({ ok: true });
  });

  /** Asset files are public (read-only) so OBS on another machine can load logos. */
  app.get('/assets/:id', (req, res) => {
    const a = assets.read(idParam(req));
    if (!a) return void res.status(404).end();
    res.setHeader('Content-Type', a.record.mime);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    // Uploaded SVG must never run script, even when opened directly.
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:");
    res.send(a.data);
  });

  // ---- everything below requires a local or paired client ----------------------

  app.use('/api', security.requireAuth);

  app.get('/api/auth/pairing', security.requireLocal, (_req, res) => {
    res.json({ code: security.pairingCode, sessions: store.listSessions() });
  });
  app.post('/api/auth/pairing/regenerate', security.requireLocal, (_req, res) => {
    res.json({ code: security.regeneratePairingCode() });
  });
  app.post('/api/auth/sessions/revoke-all', security.requireLocal, (_req, res) => {
    store.clearSessions();
    res.json({ ok: true });
  });

  // projects
  app.get('/api/projects', (_req, res) => res.json(store.listProjects()));
  app.post('/api/projects', json, (req, res) => {
    const p = projects.create(parse(createProjectSchema, req.body));
    res.status(201).json(p);
  });
  app.post('/api/projects/import', bigJson, (req, res) => {
    res.status(201).json(projects.import(req.body));
  });
  app.get('/api/projects/:id', (req, res) => res.json(projects.get(idParam(req))));
  app.patch('/api/projects/:id', json, (req, res) => {
    const body = parse(z.object({ name: z.string().trim().min(1).max(80) }), req.body);
    projects.rename(idParam(req), body.name);
    res.json({ ok: true });
  });
  app.put('/api/projects/:id/scene', bigJson, (req, res) => {
    const body = parse(z.object({ scene: z.unknown(), rev: z.number().int().nullable() }), req.body);
    res.json({ rev: projects.saveDraft(idParam(req), body.scene, body.rev) });
  });
  app.post('/api/projects/:id/publish', (req, res) => res.json(projects.publish(idParam(req))));
  app.post('/api/projects/:id/duplicate', (req, res) => res.status(201).json(projects.duplicate(idParam(req))));
  app.delete('/api/projects/:id', (req, res) => {
    projects.delete(idParam(req));
    res.json({ ok: true });
  });
  app.get('/api/projects/:id/export', (req, res) => {
    const bundle = projects.export(idParam(req));
    const safe = bundle.project.name.replace(/[^\w-]+/g, '_').slice(0, 40) || 'project';
    res.setHeader('Content-Disposition', `attachment; filename="${safe}.bfproject.json"`);
    res.json(bundle);
  });
  app.get('/api/projects/:id/overlay-urls', (req, res) => res.json(overlayUrls(config, idParam(req))));
  app.post('/api/projects/:id/reload-overlays', (req, res) => {
    realtime.reloadOverlays(idParam(req));
    res.json({ ok: true });
  });
  app.get('/api/projects/:id/presence', (req, res) => res.json(realtime.presence(idParam(req))));

  // live match
  app.get('/api/projects/:id/match', (req, res) => {
    const rt = hub.runtimeFor(idParam(req));
    if (!rt) throw notFound('Project not found');
    res.json(rt.snapshot());
  });
  /** HTTP command endpoint for external controllers (Stream Deck / Companion / scripts). */
  app.post('/api/projects/:id/command', json, (req, res) => {
    const rt = hub.runtimeFor(idParam(req));
    if (!rt) throw notFound('Project not found');
    const body = parse(z.object({ commandId: z.string().min(4).max(80).optional(), command: z.unknown() }), req.body);
    const parsed = parseCommand(body.command);
    if (!parsed.ok) throw badRequest(parsed.error);
    if (SYSTEM_ONLY_COMMANDS.has(parsed.command.type)) throw badRequest('Not allowed');
    const ack = rt.apply(body.commandId ?? createId('http'), parsed.command, 'operator');
    res.status(ack.ok ? 200 : 422).json(ack);
  });
  app.get('/api/projects/:id/match/history', (req, res) => {
    const rt = hub.runtimeFor(idParam(req));
    if (!rt) throw notFound('Project not found');
    res.json({ commands: store.recentCommands(rt.matchId, 60), events: store.recentEvents(rt.matchId, 80) });
  });
  app.post('/api/projects/:id/match/new', json, (req, res) => {
    const body = parse(z.object({ keepTeams: z.boolean(), name: z.string().max(80).optional() }), req.body);
    const snap = hub.newMatch(idParam(req), body);
    if (!snap) throw notFound('Project not found');
    res.json(snap);
  });

  // assets
  app.get('/api/assets', (req, res) => {
    const pid = typeof req.query.projectId === 'string' ? req.query.projectId : null;
    res.json(store.listAssets(pid));
  });
  app.post('/api/assets', upload.single('file'), (req, res) => {
    if (!req.file) throw badRequest('No file uploaded (field name "file").');
    const projectId = typeof req.body?.projectId === 'string' && req.body.projectId ? String(req.body.projectId) : null;
    if (projectId && !store.getProject(projectId)) throw notFound('Project not found');
    res.status(201).json(assets.save(req.file.buffer, req.file.originalname, projectId));
  });
  app.delete('/api/assets/:id', (req, res) => {
    const a = store.getAsset(idParam(req));
    if (!a) throw notFound('Asset not found');
    if (a.projectId === null && a.id.startsWith('asset_tpl_')) throw badRequest('Template assets cannot be deleted.');
    assets.delete(a.id);
    res.json({ ok: true });
  });

  // animation presets
  app.get('/api/presets', (_req, res) => res.json(store.listPresets()));
  app.post('/api/presets', json, (req, res) => {
    const body = parse(z.object({ name: z.string().trim().min(1).max(60), clip: z.record(z.string(), z.unknown()) }), req.body);
    const clip = body.clip as unknown as AnimationClip;
    if (!Array.isArray(clip.keyframes) || typeof clip.durationMs !== 'number') throw badRequest('Invalid clip');
    const id = createId('preset');
    store.insertPreset(id, body.name, clip);
    res.status(201).json({ id });
  });
  app.delete('/api/presets/:id', (req, res) => {
    store.deletePreset(idParam(req));
    res.json({ ok: true });
  });

  // settings
  app.get('/api/settings/hotkeys', (_req, res) => res.json({ ...DEFAULT_HOTKEYS, ...(store.getSetting<Record<string, string>>('hotkeys') ?? {}) }));
  app.put('/api/settings/hotkeys', json, (req, res) => {
    const body = parse(z.record(z.string().max(40), z.string().max(40)), req.body);
    store.setSetting('hotkeys', body);
    res.json({ ok: true });
  });
  app.post('/api/settings/hotkeys/reset', (_req, res) => {
    store.setSetting('hotkeys', {});
    res.json(DEFAULT_HOTKEYS);
  });
  app.get('/api/settings/control', (_req, res) => res.json(store.getSetting('control') ?? {}));
  app.put('/api/settings/control', json, (req, res) => {
    store.setSetting('control', parse(z.record(z.string().max(40), z.unknown()), req.body));
    res.json({ ok: true });
  });

  // OBS
  app.get('/api/obs/status', (_req, res) => res.json(obs.getStatus()));
  app.put('/api/obs/settings', security.requireObsAccess, json, (req, res) => {
    const body = parse(
      z.object({
        host: z.string().trim().min(1).max(253).regex(/^[\w.:[\]-]+$/, 'Invalid host'),
        port: z.number().int().min(1).max(65535),
        password: z.string().max(200).nullable().optional(),
        autoReconnect: z.boolean().optional(),
        connectOnStart: z.boolean().optional(),
      }),
      req.body,
    );
    obs.updateSettings(body);
    res.json(obs.getStatus());
  });
  app.post('/api/obs/connect', security.requireObsAccess, async (_req, res) => {
    try {
      await obs.connect();
      res.json(obs.getStatus());
    } catch (err) {
      res.status(502).json({ error: (err as Error).message, status: obs.getStatus() });
    }
  });
  app.post('/api/obs/disconnect', security.requireObsAccess, async (_req, res) => {
    await obs.disconnect();
    res.json(obs.getStatus());
  });
  app.get('/api/obs/scenes', security.requireObsAccess, async (_req, res) => {
    res.json(await obs.listScenes());
  });
  app.post('/api/obs/browser-source', security.requireObsAccess, json, async (req, res) => {
    const body = parse(
      z.object({
        projectId: z.string().max(64),
        sceneName: z.string().min(1).max(256),
        sourceName: z.string().trim().min(1).max(120),
        baseUrl: z.string().url().max(300).optional(),
        fps: z.number().int().min(10).max(120).default(60),
        fitToCanvas: z.boolean().default(true),
      }),
      req.body,
    );
    const p = projects.get(body.projectId);
    const path = `/overlay/${p.id}`;
    const base = body.baseUrl ? new URL(body.baseUrl).origin : `http://localhost:${config.port}`;
    const result = await obs.ensureBrowserSource(
      { sceneName: body.sceneName, sourceName: body.sourceName, url: `${base}${path}`, width: p.width, height: p.height, fps: body.fps, fitToCanvas: body.fitToCanvas },
      path,
    );
    store.updateProjectSettings(p.id, { ...p.settings, obsSourceName: result.sourceName, obsSceneName: result.sceneName });
    res.json(result);
  });
  app.post('/api/obs/refresh-source', security.requireObsAccess, json, async (req, res) => {
    const body = parse(z.object({ sourceName: z.string().min(1).max(120) }), req.body);
    await obs.refreshSource(body.sourceName);
    res.json({ ok: true });
  });

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown API endpoint' }));

  return app;
}

/** Final error handler: typed HttpErrors become JSON, everything else is a logged 500. */
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction) {
  if (res.headersSent) return next(err);
  if (err instanceof HttpError) return void res.status(err.status).json({ error: err.message, code: err.code });
  const e = err as { type?: string; code?: string; message?: string; status?: number };
  if (e?.type === 'entity.too.large') return void res.status(413).json({ error: 'Request is too large.' });
  if (e?.type === 'entity.parse.failed') return void res.status(400).json({ error: 'Malformed JSON.' });
  if (e?.code === 'LIMIT_FILE_SIZE') return void res.status(413).json({ error: `File is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.` });
  if (e?.code?.startsWith?.('LIMIT_')) return void res.status(400).json({ error: e.message });
  if (req.path.startsWith('/api/obs') && e?.message) return void res.status(502).json({ error: e.message });
  log.error(`${req.method} ${req.path} failed`, err);
  res.status(500).json({ error: 'Internal server error' });
}
