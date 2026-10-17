import { useEffect, useState } from 'react';
import { Keyboard, RefreshCw, ShieldCheck, Smartphone } from 'lucide-react';
import { api } from '../lib/api';
import { comboFromEvent, comboLabel, HOTKEY_ACTIONS, useHotkeyMap } from '../lib/hotkeys';
import { Button, CopyField } from '../components/ui';
import { toast } from '../components/toast';
import { useSystemInfo } from '../app/AppShell';

function HotkeyEditor() {
  const [map, setMap] = useHotkeyMap();
  const [capturing, setCapturing] = useState<string | null>(null);

  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'].includes(e.code)) return;
      const combo = e.code === 'Escape' ? '' : comboFromEvent(e);
      const next = { ...map };
      // A key can only trigger one action.
      for (const [k, v] of Object.entries(next)) if (combo && v === combo) next[k] = '';
      next[capturing] = combo;
      setMap(next);
      setCapturing(null);
      api.put('/api/settings/hotkeys', next).catch((err) => toast.error((err as Error).message));
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capturing, map, setMap]);

  const groups = [...new Set(HOTKEY_ACTIONS.map((a) => a.group))];
  return (
    <section className="panel p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-display text-xl font-semibold">
          <Keyboard className="h-5 w-5" /> Control Room hotkeys
        </h2>
        <Button
          size="sm"
          onClick={async () => {
            setMap(await api.post<Record<string, string>>('/api/settings/hotkeys/reset'));
            toast.success('Hotkeys reset to defaults');
          }}
        >
          Reset defaults
        </Button>
      </div>
      <p className="mb-4 text-sm text-ink-400">Click a shortcut, then press the new key (Esc clears it). Hotkeys never fire while you are typing in a field, and can be switched off in the Control Room.</p>
      <div className="grid gap-x-8 gap-y-4 md:grid-cols-2">
        {groups.map((g) => (
          <div key={g}>
            <div className="panel-title mb-1.5">{g}</div>
            {HOTKEY_ACTIONS.filter((a) => a.group === g).map((a) => (
              <div key={a.id} className="flex items-center justify-between border-b border-ink-750 py-1.5 text-sm">
                <span>{a.label}</span>
                <button className={`min-w-[90px] rounded border px-2 py-0.5 font-mono text-xs ${capturing === a.id ? 'border-accent bg-accent/20 text-accent' : 'border-ink-600 bg-ink-800 text-ink-200 hover:border-ink-400'}`} onClick={() => setCapturing(a.id)}>
                  {capturing === a.id ? 'Press a key…' : map[a.id] ? comboLabel(map[a.id]) : '—'}
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function RemoteAccess() {
  const info = useSystemInfo((s) => s.info);
  const [pairing, setPairing] = useState<{ code: string; sessions: { id: string; label: string; lastSeen: number }[] } | null>(null);
  useEffect(() => {
    if (info?.isLocal) api.get<typeof pairing>('/api/auth/pairing').then(setPairing).catch(() => {});
  }, [info?.isLocal]);
  if (!info) return null;
  const urls = info.lanAddresses.map((ip) => `http://${ip}:${info.port}/pair`);
  return (
    <section className="panel p-5">
      <h2 className="mb-3 flex items-center gap-2 font-display text-xl font-semibold">
        <Smartphone className="h-5 w-5" /> Remote control from a tablet or phone
      </h2>
      {!info.lanEnabled ? (
        <div className="space-y-2 text-sm text-ink-300">
          <p>
            Network access is <b>off</b>: BroadcastForge only listens on this computer (safest default). To run the Control Room from a tablet on the same trusted network, restart with:
          </p>
          <div className="kbd w-fit text-sm">npm run start:lan</div>
          <p className="text-ink-400">Never forward this port to the internet.</p>
        </div>
      ) : !info.isLocal ? (
        <p className="text-sm text-ink-300">You are on a paired remote device. Pairing codes are only shown on the BroadcastForge computer.</p>
      ) : (
        <div className="space-y-4 text-sm">
          <ol className="list-decimal space-y-1 pl-5 text-ink-300">
            <li>Join the tablet/phone to the same network as this computer.</li>
            <li>Open the pairing address in its browser.</li>
            <li>Enter the pairing code. The device stays paired until you revoke it.</li>
          </ol>
          <div className="space-y-1">
            {urls.map((u) => (
              <CopyField key={u} value={u} />
            ))}
          </div>
          <div className="flex items-center gap-4">
            <div>
              <div className="label">Pairing code</div>
              <div className="font-mono text-3xl font-bold tracking-[0.2em] text-accent">{pairing?.code ?? '…'}</div>
            </div>
            <Button
              size="sm"
              onClick={async () => {
                const r = await api.post<{ code: string }>('/api/auth/pairing/regenerate');
                setPairing((p) => (p ? { ...p, code: r.code } : p));
                toast.success('New code generated. Already-paired devices stay paired.');
              }}
            >
              <RefreshCw className="h-3.5 w-3.5" /> New code
            </Button>
          </div>
          <div>
            <div className="label">Paired devices</div>
            {pairing?.sessions.length ? (
              <ul className="divide-y divide-ink-700 rounded border border-ink-700">
                {pairing.sessions.map((s) => (
                  <li key={s.id} className="flex justify-between px-3 py-1.5 text-xs">
                    <span className="truncate">{s.label}</span>
                    <span className="text-ink-400">last seen {new Date(s.lastSeen).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-xs text-ink-500">None yet.</div>
            )}
            {Boolean(pairing?.sessions.length) && (
              <Button
                size="sm"
                variant="danger"
                className="mt-2"
                onClick={async () => {
                  await api.post('/api/auth/sessions/revoke-all');
                  setPairing((p) => (p ? { ...p, sessions: [] } : p));
                  toast.success('All remote devices signed out');
                }}
              >
                Revoke all devices
              </Button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export function SettingsPage() {
  const info = useSystemInfo((s) => s.info);
  return (
    <div className="mx-auto max-w-5xl space-y-5 px-6 py-8">
      <h1 className="font-display text-4xl font-bold tracking-wide">Settings</h1>
      <HotkeyEditor />
      <RemoteAccess />
      <section className="panel p-5 text-sm text-ink-300">
        <h2 className="mb-2 flex items-center gap-2 font-display text-xl font-semibold text-ink-100">
          <ShieldCheck className="h-5 w-5" /> Security & storage
        </h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Everything (projects, artwork, games, OBS password) is stored in the local data folder; no account or cloud service is used.</li>
          <li>The server listens on {info?.lanEnabled ? 'your local network (paired devices only for control)' : 'this computer only'} — port {info?.port}.</li>
          <li>Overlay pages are display-only and never receive the OBS password.</li>
          <li>Uploaded files are checked by content; SVG artwork is served with scripts disabled.</li>
        </ul>
      </section>
    </div>
  );
}
