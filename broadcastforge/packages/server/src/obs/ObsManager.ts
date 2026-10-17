import OBSWebSocket, { EventSubscription } from 'obs-websocket-js';
import type { ObsStatus } from '@bf/shared';
import type { Store } from '../db/store.js';
import { logger } from '../logger.js';

const log = logger('obs');

export interface ObsSettings {
  host: string;
  port: number;
  autoReconnect: boolean;
  connectOnStart: boolean;
}

export interface BrowserSourceRequest {
  sceneName: string;
  sourceName: string;
  url: string;
  width: number;
  height: number;
  fps: number;
  /** Fit the scene item to the full OBS canvas at 0,0. */
  fitToCanvas: boolean;
}

export interface BrowserSourceResult {
  action: 'created' | 'updated' | 'added-to-scene' | 'unchanged';
  sourceName: string;
  sceneName: string;
  sceneItemId: number;
  /** Set when an existing source with a different name already showed this overlay. */
  reusedExisting?: boolean;
  warnings: string[];
}

const BROWSER_KIND = 'browser_source';
const BACKOFF_MS = [1000, 2000, 5000, 10_000, 20_000, 30_000];

type ObsFactory = () => OBSWebSocket;

/**
 * Talks to OBS Studio through obs-websocket v5 (OBS 28+). Lives only on the
 * backend: the OBS password never reaches any browser page.
 */
export class ObsManager {
  private obs: OBSWebSocket | null = null;
  private status: ObsStatus;
  private retry = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private wantConnected = false;
  private connecting: Promise<void> | null = null;

  constructor(
    private readonly store: Store,
    private readonly onStatus: (s: ObsStatus) => void,
    private readonly envDefaults: { host: string; port: number; password: string | null },
    private readonly factory: ObsFactory = () => new OBSWebSocket(),
  ) {
    const s = this.settings();
    this.status = { state: 'disconnected', host: s.host, port: s.port, hasPassword: Boolean(this.password()), autoReconnect: s.autoReconnect };
  }

  settings(): ObsSettings {
    const saved = this.store.getSetting<Partial<ObsSettings>>('obs') ?? {};
    return {
      host: saved.host ?? this.envDefaults.host,
      port: saved.port ?? this.envDefaults.port,
      autoReconnect: saved.autoReconnect ?? true,
      connectOnStart: saved.connectOnStart ?? false,
    };
  }

  private password(): string | null {
    return this.envDefaults.password ?? this.store.getSetting<string>('obsPassword');
  }

  /** password: undefined = keep, '' or null = clear. Never returned by any API. */
  updateSettings(patch: Partial<ObsSettings> & { password?: string | null }) {
    const next = { ...this.settings(), ...patch };
    delete (next as { password?: unknown }).password;
    this.store.setSetting('obs', next);
    if (patch.password !== undefined) this.store.setSetting('obsPassword', patch.password || null);
    this.setStatus({ host: next.host, port: next.port, autoReconnect: next.autoReconnect, hasPassword: Boolean(this.password()) });
  }

  getStatus(): ObsStatus {
    return { ...this.status };
  }

  private setStatus(patch: Partial<ObsStatus>) {
    this.status = { ...this.status, ...patch };
    this.onStatus(this.getStatus());
  }

  get connected(): boolean {
    return this.status.state === 'connected' && this.obs !== null;
  }

  async connect(): Promise<void> {
    this.wantConnected = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (this.connecting) return this.connecting;
    this.connecting = this.doConnect().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async doConnect(): Promise<void> {
    const s = this.settings();
    await this.teardown();
    this.setStatus({ state: this.retry > 0 ? 'reconnecting' : 'connecting', host: s.host, port: s.port, lastError: undefined, nextRetryAt: undefined });
    const obs = this.factory();
    this.obs = obs;
    obs.on('ConnectionClosed', (err) => {
      if (this.obs !== obs) return;
      this.obs = null;
      this.stopHealth();
      const msg = err?.message || 'Connection closed';
      log.warn(`OBS connection closed: ${msg}`);
      this.setStatus({ state: 'disconnected', lastError: this.wantConnected ? msg : undefined });
      if (this.wantConnected) this.scheduleReconnect();
    });
    obs.on('CurrentProgramSceneChanged', (e) => this.setStatus({ currentProgramScene: e.sceneName }));
    obs.on('ExitStarted', () => log.info('OBS is shutting down'));
    try {
      const url = `ws://${s.host.includes(':') && !s.host.startsWith('[') ? `[${s.host}]` : s.host}:${s.port}`;
      await obs.connect(url, this.password() ?? undefined, {
        rpcVersion: 1,
        eventSubscriptions: EventSubscription.General | EventSubscription.Scenes | EventSubscription.Inputs,
      });
      const version = await obs.call('GetVersion');
      const video = await obs.call('GetVideoSettings');
      const scenes = await obs.call('GetSceneList');
      this.retry = 0;
      this.setStatus({
        state: 'connected',
        obsVersion: version.obsVersion,
        websocketVersion: version.obsWebSocketVersion,
        baseWidth: video.baseWidth,
        baseHeight: video.baseHeight,
        currentProgramScene: scenes.currentProgramSceneName,
        lastError: undefined,
      });
      log.info(`Connected to OBS ${version.obsVersion} (websocket ${version.obsWebSocketVersion}) at ${url}`);
      this.startHealth();
    } catch (err) {
      const msg = describeObsError(err);
      if (this.obs === obs) this.obs = null;
      try {
        await obs.disconnect();
      } catch {
        /* ignore */
      }
      this.setStatus({ state: 'error', lastError: msg });
      log.warn(`OBS connect failed: ${msg}`);
      // Wrong password is not transient: don't hammer OBS with retries.
      if (this.wantConnected && !/auth/i.test(msg)) this.scheduleReconnect();
      throw new Error(msg);
    }
  }

  private scheduleReconnect() {
    if (!this.settings().autoReconnect || !this.wantConnected) return;
    const delay = BACKOFF_MS[Math.min(this.retry, BACKOFF_MS.length - 1)]!;
    this.retry++;
    this.setStatus({ state: 'reconnecting', nextRetryAt: Date.now() + delay });
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect().catch(() => {});
    }, delay);
    this.retryTimer.unref?.();
  }

  private startHealth() {
    this.stopHealth();
    this.healthTimer = setInterval(async () => {
      const obs = this.obs;
      if (!obs) return;
      const t0 = performance.now();
      try {
        await withTimeout(obs.call('GetVersion'), 4000);
        this.setStatus({ latencyMs: Math.round(performance.now() - t0) });
      } catch (err) {
        log.warn('OBS health check failed', err);
        // Force a reconnect cycle; ConnectionClosed will schedule it.
        obs.disconnect().catch(() => {});
      }
    }, 5000);
    this.healthTimer.unref?.();
  }

  private stopHealth() {
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.healthTimer = null;
  }

  private async teardown() {
    this.stopHealth();
    const old = this.obs;
    this.obs = null;
    if (old) {
      try {
        await old.disconnect();
      } catch {
        /* ignore */
      }
    }
  }

  async disconnect(): Promise<void> {
    this.wantConnected = false;
    this.retry = 0;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    await this.teardown();
    this.setStatus({ state: 'disconnected', lastError: undefined, nextRetryAt: undefined, latencyMs: undefined });
  }

  private client(): OBSWebSocket {
    if (!this.obs || this.status.state !== 'connected') throw new Error('Not connected to OBS. Connect on the OBS Connection page first.');
    return this.obs;
  }

  async listScenes(): Promise<{ current: string; scenes: string[] }> {
    const r = await this.client().call('GetSceneList');
    // OBS returns scenes bottom-to-top; show them in the order the OBS UI does.
    const scenes = [...r.scenes].sort((a, b) => Number(b.sceneIndex) - Number(a.sceneIndex)).map((s) => String(s.sceneName));
    return { current: r.currentProgramSceneName, scenes };
  }

  /**
   * Create or update the Browser Source for an overlay without ever creating
   * duplicates: an input with the same name is updated in place, and an
   * existing browser source already showing this overlay URL is reused.
   */
  async ensureBrowserSource(req: BrowserSourceRequest, overlayPath: string): Promise<BrowserSourceResult> {
    const obs = this.client();
    const warnings: string[] = [];
    const { scenes } = await this.listScenes();
    if (!scenes.includes(req.sceneName)) throw new Error(`Scene "${req.sceneName}" does not exist in OBS.`);

    const settings = {
      url: req.url,
      width: req.width,
      height: req.height,
      fps_custom: req.fps !== 30,
      fps: req.fps,
      reroute_audio: false,
      shutdown: false,
      restart_when_active: false,
      css: 'body { background-color: rgba(0, 0, 0, 0); margin: 0px auto; overflow: hidden; }',
    };

    const { inputs } = await obs.call('GetInputList');
    let target = inputs.find((i) => i.inputName === req.sourceName);
    let reusedExisting = false;
    if (target && target.unversionedInputKind !== BROWSER_KIND && target.inputKind !== BROWSER_KIND) {
      throw new Error(`OBS already has a source named "${req.sourceName}" that is not a Browser Source. Choose another name.`);
    }
    if (!target) {
      // Look for a browser source already pointing at this overlay under another name.
      for (const i of inputs) {
        if (i.unversionedInputKind !== BROWSER_KIND && i.inputKind !== BROWSER_KIND) continue;
        try {
          const s = await obs.call('GetInputSettings', { inputName: String(i.inputName) });
          const url = String((s.inputSettings as { url?: string }).url ?? '');
          if (url && new URL(url).pathname === overlayPath) {
            target = i;
            reusedExisting = true;
            warnings.push(`Reused existing source "${i.inputName}" that already shows this overlay (instead of creating a duplicate).`);
            break;
          }
        } catch {
          /* unreadable input: skip */
        }
      }
    }

    let action: BrowserSourceResult['action'];
    let sceneItemId: number;
    const sourceName = target ? String(target.inputName) : req.sourceName;
    if (!target) {
      const r = await obs.call('CreateInput', { sceneName: req.sceneName, inputName: sourceName, inputKind: BROWSER_KIND, inputSettings: settings, sceneItemEnabled: true });
      sceneItemId = Number(r.sceneItemId);
      action = 'created';
    } else {
      const current = await obs.call('GetInputSettings', { inputName: sourceName });
      const cur = current.inputSettings as Record<string, unknown>;
      const changed = cur.url !== settings.url || Number(cur.width) !== settings.width || Number(cur.height) !== settings.height || Number(cur.fps ?? 30) !== settings.fps;
      if (changed) await obs.call('SetInputSettings', { inputName: sourceName, inputSettings: settings, overlay: true });
      const { sceneItems } = await obs.call('GetSceneItemList', { sceneName: req.sceneName });
      const item = sceneItems.find((s) => s.sourceName === sourceName);
      if (item) {
        sceneItemId = Number(item.sceneItemId);
        action = changed ? 'updated' : 'unchanged';
      } else {
        const r = await obs.call('CreateSceneItem', { sceneName: req.sceneName, sourceName, sceneItemEnabled: true });
        sceneItemId = Number(r.sceneItemId);
        action = 'added-to-scene';
      }
    }

    if (req.fitToCanvas) {
      const video = await obs.call('GetVideoSettings');
      const scale = { x: video.baseWidth / req.width, y: video.baseHeight / req.height };
      await obs.call('SetSceneItemTransform', {
        sceneName: req.sceneName,
        sceneItemId,
        sceneItemTransform: { positionX: 0, positionY: 0, rotation: 0, scaleX: scale.x, scaleY: scale.y, alignment: 5, boundsType: 'OBS_BOUNDS_NONE' },
      });
      if (video.baseWidth !== req.width || video.baseHeight !== req.height) {
        warnings.push(`OBS canvas is ${video.baseWidth}×${video.baseHeight} but the overlay is ${req.width}×${req.height}; the source was scaled to fit. Matching sizes gives the sharpest result.`);
      }
      // Keep the overlay above the camera/video sources.
      const { sceneItems } = await obs.call('GetSceneItemList', { sceneName: req.sceneName });
      await obs.call('SetSceneItemIndex', { sceneName: req.sceneName, sceneItemId, sceneItemIndex: Math.max(0, sceneItems.length - 1) });
    }
    log.info(`Browser source "${sourceName}" ${action} in scene "${req.sceneName}"`);
    return { action, sourceName, sceneName: req.sceneName, sceneItemId, reusedExisting, warnings };
  }

  /** Ask OBS to reload the browser source (cache bypass). */
  async refreshSource(sourceName: string): Promise<void> {
    await this.client().call('PressInputPropertiesButton', { inputName: sourceName, propertyName: 'refreshnocache' });
  }

  async shutdown() {
    this.wantConnected = false;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    await this.teardown();
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Timed out')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export function describeObsError(err: unknown): string {
  const e = err as { message?: string; code?: number };
  const msg = e?.message ?? String(err);
  if (e?.code === 4009 || /authentication failed/i.test(msg)) return 'Authentication failed: check the OBS WebSocket password (Tools → WebSocket Server Settings).';
  if (/ECONNREFUSED|connect ECONN|socket hang up|closed before/i.test(msg) || e?.code === 1006)
    return 'Could not reach OBS. Is OBS running, and is the WebSocket server enabled (Tools → WebSocket Server Settings)?';
  if (/ENOTFOUND|EAI_AGAIN/i.test(msg)) return 'Host not found. Check the OBS host/IP address.';
  if (/ETIMEDOUT|EHOSTUNREACH|ENETUNREACH/i.test(msg)) return 'OBS did not respond (timeout). Check the host/IP and firewall.';
  return msg || 'Unknown OBS error';
}
