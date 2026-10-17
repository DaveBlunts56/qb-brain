import { useCallback, useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import { AlertTriangle, CheckCircle2, Plug, PlugZap, RefreshCw, Unplug } from 'lucide-react';
import { SOCKET, type ObsStatus } from '@bf/shared';
import { api, endpoints, type ProjectSummary } from '../lib/api';
import { Button, CopyField, StatusDot, Toggle } from '../components/ui';
import { toast } from '../components/toast';
import { useCurrentProject, useSystemInfo } from '../app/AppShell';

interface SourceResult {
  action: 'created' | 'updated' | 'added-to-scene' | 'unchanged';
  sourceName: string;
  sceneName: string;
  reusedExisting?: boolean;
  warnings: string[];
}

const ACTION_TEXT: Record<SourceResult['action'], string> = {
  created: 'Created a new Browser Source',
  updated: 'Updated the existing Browser Source (URL / size)',
  'added-to-scene': 'Added the existing Browser Source to this scene',
  unchanged: 'Browser Source already up to date',
};

export function ObsPage() {
  const info = useSystemInfo((s) => s.info);
  const current = useCurrentProject();
  const [status, setStatus] = useState<ObsStatus | null>(null);
  const [form, setForm] = useState({ host: '127.0.0.1', port: 4455, password: '', clearPassword: false, autoReconnect: true, connectOnStart: false });
  const [busy, setBusy] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectId, setProjectId] = useState<string>(current.id ?? '');
  const [scenes, setScenes] = useState<string[]>([]);
  const [sceneName, setSceneName] = useState('');
  const [sourceName, setSourceName] = useState('');
  const [urls, setUrls] = useState<{ label: string; url: string }[]>([]);
  const [baseUrl, setBaseUrl] = useState('');
  const [fps, setFps] = useState(60);
  const [fit, setFit] = useState(true);
  const [result, setResult] = useState<SourceResult | null>(null);
  const [now, setNow] = useState(Date.now());
  const canManage = Boolean(info?.isLocal || info?.remoteObs);
  const project = projects.find((p) => p.id === projectId);

  useEffect(() => {
    endpoints
      .obsStatus()
      .then((s) => {
        setStatus(s);
        setForm((f) => ({ ...f, host: s.host, port: s.port, autoReconnect: s.autoReconnect }));
      })
      .catch(() => {});
    endpoints
      .projects()
      .then((p) => {
        setProjects(p);
        setProjectId((cur) => cur || p[0]?.id || '');
      })
      .catch(() => {});
    const s = io({ transports: ['websocket', 'polling'] });
    s.on('connect', () => s.emit(SOCKET.staffJoin, {}));
    s.on(SOCKET.obsStatus, (st: ObsStatus) => setStatus(st));
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      s.disconnect();
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (!projectId) return;
    endpoints
      .overlayUrls(projectId)
      .then((u) => {
        setUrls(u);
        setBaseUrl(u[0]?.url ?? '');
      })
      .catch(() => {});
    endpoints
      .project(projectId)
      .then((p) => setSourceName(p.settings.obsSourceName ?? `BroadcastForge – ${p.name}`.slice(0, 120)))
      .catch(() => {});
  }, [projectId]);

  const loadScenes = useCallback(async () => {
    try {
      const r = await api.get<{ current: string; scenes: string[] }>('/api/obs/scenes');
      setScenes(r.scenes);
      setSceneName((cur) => (cur && r.scenes.includes(cur) ? cur : r.current));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (status?.state === 'connected') void loadScenes();
  }, [status?.state, loadScenes]);

  const saveAndConnect = async () => {
    setBusy('connect');
    try {
      await api.put('/api/obs/settings', {
        host: form.host.trim(),
        port: form.port,
        autoReconnect: form.autoReconnect,
        connectOnStart: form.connectOnStart,
        ...(form.clearPassword ? { password: null } : form.password ? { password: form.password } : {}),
      });
      setForm((f) => ({ ...f, password: '', clearPassword: false }));
      const s = await api.post<ObsStatus>('/api/obs/connect');
      setStatus(s);
      toast.success(`Connected to OBS ${s.obsVersion ?? ''}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    setBusy('disconnect');
    try {
      setStatus(await api.post<ObsStatus>('/api/obs/disconnect'));
    } finally {
      setBusy(null);
    }
  };

  const createSource = async () => {
    setBusy('source');
    setResult(null);
    try {
      const r = await api.post<SourceResult>('/api/obs/browser-source', { projectId, sceneName, sourceName: sourceName.trim(), baseUrl: baseUrl ? new URL(baseUrl).origin : undefined, fps, fitToCanvas: fit });
      setResult(r);
      toast.success(ACTION_TEXT[r.action]);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const refreshSource = async () => {
    try {
      await api.post('/api/obs/refresh-source', { sourceName: result?.sourceName ?? sourceName });
      toast.success('OBS reloaded the browser source');
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const stateLabel = useMemo(() => {
    if (!status) return 'Loading…';
    switch (status.state) {
      case 'connected':
        return `Connected to OBS ${status.obsVersion ?? ''}`;
      case 'connecting':
        return 'Connecting…';
      case 'reconnecting':
        return `Reconnecting${status.nextRetryAt ? ` in ${Math.max(0, Math.ceil((status.nextRetryAt - now) / 1000))} s` : '…'}`;
      case 'error':
        return 'Connection failed';
      default:
        return 'Not connected';
    }
  }, [status, now]);

  const connected = status?.state === 'connected';
  const sizeMismatch = connected && project && status?.baseWidth && (status.baseWidth !== project.width || status.baseHeight !== project.height);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <h1 className="font-display text-4xl font-bold tracking-wide">OBS Connection</h1>
      <p className="mt-1 text-sm text-ink-400">BroadcastForge talks to OBS Studio 28+ through its built-in WebSocket server (v5). Your OBS password stays on this computer and is never sent to overlay pages.</p>

      {!canManage && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-warn/50 bg-warn/10 p-3 text-sm text-amber-200">
          <AlertTriangle className="h-4 w-4" /> OBS can only be managed from the BroadcastForge computer itself. You can still copy the overlay URL below.
        </div>
      )}

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <section className="panel p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-xl font-semibold">1 · Connect</h2>
            <StatusDot state={connected ? 'ok' : status?.state === 'error' ? 'error' : status?.state === 'reconnecting' || status?.state === 'connecting' ? 'warn' : 'idle'} label={stateLabel} />
          </div>
          <div className="grid grid-cols-[1fr_120px] gap-3">
            <div>
              <label className="label">Host / IP</label>
              <input className="field font-mono" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} disabled={!canManage} placeholder="127.0.0.1" />
            </div>
            <div>
              <label className="label">Port</label>
              <input className="field font-mono" type="number" min={1} max={65535} value={form.port} onChange={(e) => setForm({ ...form, port: Number(e.target.value) })} disabled={!canManage} />
            </div>
            <div className="col-span-2">
              <label className="label">Password</label>
              <input
                className="field font-mono"
                type="password"
                autoComplete="off"
                value={form.password}
                placeholder={status?.hasPassword ? '•••••••• saved — leave empty to keep' : 'OBS WebSocket password (if authentication is on)'}
                onChange={(e) => setForm({ ...form, password: e.target.value, clearPassword: false })}
                disabled={!canManage}
              />
              {status?.hasPassword && (
                <label className="mt-1 flex items-center gap-2 text-xs text-ink-400">
                  <input type="checkbox" checked={form.clearPassword} onChange={(e) => setForm({ ...form, clearPassword: e.target.checked, password: '' })} /> Remove saved password
                </label>
              )}
            </div>
          </div>
          <div className="mt-3 flex flex-col gap-2">
            <Toggle checked={form.autoReconnect} onChange={(v) => setForm({ ...form, autoReconnect: v })} label="Reconnect automatically if OBS restarts" disabled={!canManage} />
            <Toggle checked={form.connectOnStart} onChange={(v) => setForm({ ...form, connectOnStart: v })} label="Connect when BroadcastForge starts" disabled={!canManage} />
          </div>
          <div className="mt-4 flex gap-2">
            <Button variant="primary" onClick={saveAndConnect} disabled={!canManage || busy !== null}>
              <Plug className="h-4 w-4" /> {busy === 'connect' ? 'Connecting…' : connected ? 'Save & reconnect' : 'Save & connect'}
            </Button>
            <Button onClick={disconnect} disabled={!canManage || busy !== null || status?.state === 'disconnected'}>
              <Unplug className="h-4 w-4" /> Disconnect
            </Button>
          </div>
          {status?.lastError && <div className="mt-3 rounded-md border border-live/40 bg-live/10 p-2.5 text-sm text-red-200">{status.lastError}</div>}
          {connected && (
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <dt className="text-ink-400">OBS version</dt>
              <dd>{status.obsVersion}</dd>
              <dt className="text-ink-400">WebSocket version</dt>
              <dd>{status.websocketVersion}</dd>
              <dt className="text-ink-400">Canvas</dt>
              <dd>
                {status.baseWidth}×{status.baseHeight}
              </dd>
              <dt className="text-ink-400">Program scene</dt>
              <dd>{status.currentProgramScene}</dd>
              <dt className="text-ink-400">Latency</dt>
              <dd>{status.latencyMs !== undefined ? `${status.latencyMs} ms` : '—'}</dd>
            </dl>
          )}
          <details className="mt-4 text-xs text-ink-400">
            <summary className="cursor-pointer text-ink-300">Where do I find these settings in OBS?</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>In OBS: Tools → WebSocket Server Settings.</li>
              <li>Tick “Enable WebSocket server”. The default port is 4455.</li>
              <li>Tick “Enable Authentication” and click “Show Connect Info” to copy the password.</li>
              <li>If OBS runs on another computer, use that computer’s IP address and allow port 4455 through its firewall.</li>
            </ol>
          </details>
        </section>

        <section className="panel p-5">
          <h2 className="mb-4 font-display text-xl font-semibold">2 · Add the overlay to a scene</h2>
          <div className="space-y-3">
            <div>
              <label className="label">Project</label>
              <select className="field" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.width}×{p.height})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label flex items-center justify-between">
                <span>OBS scene</span>
                <button className="flex items-center gap-1 normal-case tracking-normal text-ink-300 hover:text-ink-100 disabled:opacity-30" onClick={loadScenes} disabled={!connected}>
                  <RefreshCw className="h-3 w-3" /> refresh
                </button>
              </label>
              <select className="field" value={sceneName} onChange={(e) => setSceneName(e.target.value)} disabled={!connected}>
                {!connected && <option>Connect to OBS first</option>}
                {scenes.map((s) => (
                  <option key={s} value={s}>
                    {s}
                    {s === status?.currentProgramScene ? '  (on program)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Source name</label>
              <input className="field" value={sourceName} maxLength={120} onChange={(e) => setSourceName(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Overlay address OBS should use</label>
                <select className="field" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)}>
                  {urls.map((u) => (
                    <option key={u.url} value={u.url}>
                      {u.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Frame rate</label>
                <select className="field" value={fps} onChange={(e) => setFps(Number(e.target.value))}>
                  <option value={60}>60 fps</option>
                  <option value={30}>30 fps (slower PCs)</option>
                </select>
              </div>
            </div>
            <Toggle checked={fit} onChange={setFit} label="Position at 0,0, fit to the OBS canvas and keep on top" />
            {sizeMismatch && (
              <div className="flex items-start gap-2 rounded-md border border-warn/40 bg-warn/10 p-2 text-xs text-amber-200">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                OBS canvas is {status?.baseWidth}×{status?.baseHeight}, this project is {project?.width}×{project?.height}. The source will be scaled; matching sizes is sharper.
              </div>
            )}
            <div className="flex gap-2">
              <Button variant="primary" onClick={createSource} disabled={!connected || !canManage || !sceneName || !sourceName.trim() || busy !== null}>
                <PlugZap className="h-4 w-4" /> {busy === 'source' ? 'Working…' : 'Create / update Browser Source'}
              </Button>
              <Button onClick={refreshSource} disabled={!connected || !canManage}>
                <RefreshCw className="h-4 w-4" /> Reload in OBS
              </Button>
            </div>
            {result && (
              <div className="rounded-md border border-ok/40 bg-ok/10 p-3 text-sm">
                <div className="flex items-center gap-2 font-semibold text-green-300">
                  <CheckCircle2 className="h-4 w-4" /> {ACTION_TEXT[result.action]}
                </div>
                <div className="mt-1 text-xs text-ink-300">
                  “{result.sourceName}” in scene “{result.sceneName}”
                </div>
                {result.warnings.map((w) => (
                  <div key={w} className="mt-1 text-xs text-amber-200">
                    {w}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      <section className="panel mt-5 p-5">
        <h2 className="mb-1 font-display text-xl font-semibold">Manual setup (works without the WebSocket connection)</h2>
        <p className="mb-3 text-sm text-ink-400">Copy the overlay URL into an OBS Browser Source yourself:</p>
        <div className="space-y-2">
          {urls.map((u) => (
            <div key={u.url}>
              <div className="mb-0.5 text-xs text-ink-400">{u.label}</div>
              <CopyField value={u.url} />
            </div>
          ))}
          {!info?.lanEnabled && <p className="text-xs text-ink-500">Only “This computer” works right now. Start BroadcastForge with <span className="kbd">npm run start:lan</span> to let OBS on another computer load the overlay.</p>}
        </div>
        <ol className="mt-4 grid list-decimal gap-1 pl-5 text-sm text-ink-300 md:grid-cols-2">
          <li>In OBS, select your scene and click + under Sources → Browser.</li>
          <li>Paste the URL. Set Width {project?.width ?? 1920} and Height {project?.height ?? 1080}.</li>
          <li>Leave Custom CSS as OBS’s default (transparent background).</li>
          <li>Untick “Shutdown source when not visible” so graphics stay in sync.</li>
          <li>Move the source to the top of the Sources list so it sits over your cameras.</li>
          <li>Right-click → Transform → Fit to screen if your canvas size differs.</li>
        </ol>
      </section>
    </div>
  );
}
