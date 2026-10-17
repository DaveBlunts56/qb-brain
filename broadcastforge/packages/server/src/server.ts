import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express, { type Request, type Response, type NextFunction } from 'express';
import { createId } from '@bf/shared';
import type { AppConfig } from './config.js';
import { openDatabase } from './db/database.js';
import { Store } from './db/store.js';
import { createApp, errorHandler } from './http/app.js';
import { LiveHub } from './live/LiveHub.js';
import { logger, setLogLevel } from './logger.js';
import { ObsManager } from './obs/ObsManager.js';
import { Realtime } from './realtime.js';
import { Security } from './security/auth.js';
import { AssetService } from './services/assets.js';
import { ProjectService } from './services/projects.js';

const log = logger('server');

export interface RunningServer {
  url: string;
  port: number;
  httpServer: http.Server;
  store: Store;
  hub: LiveHub;
  obs: ObsManager;
  projects: ProjectService;
  security: Security;
  close(): Promise<void>;
}

export interface ServerOptions {
  /** Skip serving the web UI (API/socket only; used by tests). */
  headless?: boolean;
  /** Create the example project on first run. */
  seedExample?: boolean;
  dbFile?: string;
}

export async function startServer(config: AppConfig, opts: ServerOptions = {}): Promise<RunningServer> {
  setLogLevel(config.logLevel);
  const bootId = createId('boot');
  const db = openDatabase(config.dataDir, opts.dbFile);
  const store = new Store(db);
  const realtime = new Realtime();
  const hub = new LiveHub(store, realtime, bootId);
  const assets = new AssetService(store, config.dataDir);
  const projects = new ProjectService(store, assets, hub, realtime);
  const security = new Security(config, store);
  const obs = new ObsManager(store, (s) => realtime.obsStatus(s), config.obs);

  assets.seedTemplateAssets();
  if (opts.seedExample !== false) projects.ensureExample();

  const app = createApp({ config, store, security, hub, projects, assets, obs, realtime, bootId });
  const httpServer = http.createServer(app);
  realtime.attach(httpServer, { config, security, hub, published: (id) => projects.published(id), obsStatus: () => obs.getStatus() });

  let vite: { close(): Promise<void> } | null = null;
  if (!opts.headless) vite = await mountWebUi(app, config, httpServer);
  app.use(errorHandler);

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(config.port, config.host, () => {
      httpServer.off('error', reject);
      resolve();
    });
  });
  const addr = httpServer.address();
  const port = typeof addr === 'object' && addr ? addr.port : config.port;
  config.port = port;

  if (obs.settings().connectOnStart) obs.connect().catch(() => {});

  return {
    url: `http://localhost:${port}`,
    port,
    httpServer,
    store,
    hub,
    obs,
    projects,
    security,
    async close() {
      hub.disposeAll();
      await obs.shutdown();
      realtime.close();
      await vite?.close();
      await new Promise<void>((r) => httpServer.close(() => r()));
      httpServer.closeAllConnections?.();
      db.close();
    },
  };
}

/**
 * Serve the React app and the standalone overlay page. In development Vite
 * runs as middleware on the same port, so overlay URLs are identical in dev
 * and production.
 */
async function mountWebUi(app: express.Express, config: AppConfig, httpServer: http.Server): Promise<{ close(): Promise<void> } | null> {
  const isHtmlRequest = (req: Request) => req.method === 'GET' && !req.path.startsWith('/api') && !req.path.startsWith('/socket.io') && !req.path.startsWith('/assets/');
  const pageFor = (req: Request) => (req.path.startsWith('/overlay/') ? 'overlay.html' : 'index.html');

  if (config.dev) {
    const { createServer } = await import('vite');
    const vite = await createServer({
      root: config.webRoot,
      configFile: path.join(config.webRoot, 'vite.config.ts'),
      server: { middlewareMode: true, hmr: { server: httpServer } },
      appType: 'custom',
    });
    app.use(vite.middlewares);
    app.use(async (req: Request, res: Response, next: NextFunction) => {
      if (!isHtmlRequest(req)) return next();
      try {
        const file = pageFor(req);
        const raw = fs.readFileSync(path.join(config.webRoot, file), 'utf8');
        const html = await vite.transformIndexHtml(req.originalUrl, raw);
        res.status(200).set({ 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }).end(html);
      } catch (err) {
        vite.ssrFixStacktrace(err as Error);
        next(err);
      }
    });
    log.info('Development mode: Vite middleware enabled');
    return vite;
  }

  if (!fs.existsSync(path.join(config.webDist, 'index.html'))) {
    log.warn(`Web UI not built (${config.webDist} missing). Run "npm run build" or use "npm run dev".`);
    app.use((req, res, next) => (isHtmlRequest(req) ? res.status(503).type('text/plain').send('BroadcastForge web UI is not built. Run "npm run build" first, or "npm run dev".') : next()));
    return null;
  }
  app.use('/static', express.static(path.join(config.webDist, 'static'), { immutable: true, maxAge: '365d', index: false }));
  app.use(express.static(config.webDist, { index: false, maxAge: '1h' }));
  const pages = {
    'index.html': fs.readFileSync(path.join(config.webDist, 'index.html'), 'utf8'),
    'overlay.html': fs.readFileSync(path.join(config.webDist, 'overlay.html'), 'utf8'),
  };
  app.use((req, res, next) => {
    if (!isHtmlRequest(req)) return next();
    res.status(200).set({ 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' }).end(pages[pageFor(req)]);
  });
  return null;
}
