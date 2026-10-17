import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { History, Keyboard, MonitorPlay, RotateCcw, Undo2 } from 'lucide-react';
import type { GameCommand } from '@bf/shared';
import { useLive } from '../lib/useLive';
import { comboLabel, useHotkeyMap, useHotkeys } from '../lib/hotkeys';
import { endpoints, type CommandHistory } from '../lib/api';
import { Button, ConfirmDialog, Modal, StatusDot, Toggle } from '../components/ui';
import { ProgramMonitor } from '../components/ProgramMonitor';
import { toast } from '../components/toast';
import { TeamCard } from './control/TeamCard';
import { ClockPanel } from './control/ClockPanel';
import { SituationPanel } from './control/SituationPanel';
import { GraphicsPanel } from './control/GraphicsPanel';

function usePref<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  const set = (nv: T) => {
    setV(nv);
    try {
      localStorage.setItem(key, JSON.stringify(nv));
    } catch {
      /* ignore */
    }
  };
  return [v, set];
}

export function ControlRoom() {
  const { id = '' } = useParams();
  const live = useLive(id, 'control');
  const { snapshot, status, presence, obs, send, scene } = live;
  const state = snapshot?.state;
  const [hotkeyMap] = useHotkeyMap();
  const [hotkeysOn, setHotkeysOn] = usePref('bf.hotkeys', true);
  const [offerGraphics, setOfferGraphics] = usePref('bf.offerGraphics', true);
  const [showProgram, setShowProgram] = usePref('bf.showProgram', true);
  const [confirm, setConfirm] = useState<null | 'reset' | 'newGame'>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<CommandHistory | null>(null);
  const now = useCallback(() => live.conn?.serverNow() ?? performance.now(), [live.conn]);

  useEffect(() => {
    if (!historyOpen) return;
    const load = () => endpoints.history(id).then(setHistory).catch(() => {});
    void load();
    return live.onEvents(() => void load());
  }, [historyOpen, id, live]);

  const run = useCallback((c: GameCommand) => void send(c), [send]);

  const handlers = useMemo<Record<string, () => void>>(() => {
    const h: Record<string, () => void> = {};
    for (const side of ['home', 'away'] as const) for (const d of [1, 2, 3, 6]) h[`${side}.+${d}`] = () => run({ type: 'score.add', team: side, delta: d });
    if (!state) return h;
    return {
      ...h,
      'clock.toggle': () => run({ type: 'clock.toggle', clock: 'game' }),
      'playClock.reset40': () => run({ type: 'clock.reset', clock: 'play', seconds: state.config.playClockSeconds, autoStart: true }),
      'playClock.reset25': () => run({ type: 'clock.reset', clock: 'play', seconds: state.config.playClockShortSeconds, autoStart: true }),
      'possession.toggle': () => run({ type: 'possession.toggle' }),
      'down.next': () => run({ type: 'down.next' }),
      firstDown: () => run({ type: 'firstDown' }),
      'flag.toggle': () => run({ type: 'flag.set', on: !state.flag }),
      'overlay.toggle': () => run({ type: 'overlay.visibility', visible: !state.overlayVisible }),
      undo: () => run({ type: 'undo' }),
    };
  }, [run, state]);
  useHotkeys(hotkeyMap, handlers, hotkeysOn);
  const hotkeyHint = useCallback((a: string) => (hotkeysOn && hotkeyMap[a] ? comboLabel(hotkeyMap[a]) : null), [hotkeysOn, hotkeyMap]);

  const connected = status.state === 'connected';
  const onAir = Boolean(state?.overlayVisible && (presence?.overlays ?? 0) > 0);

  if (!state) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-ink-300">
        <StatusDot state={status.state === 'error' ? 'error' : 'warn'} label={status.state === 'error' ? (status.error ?? 'Error') : 'Connecting to the live game…'} />
        {status.state === 'error' && <Link to="/" className="text-sm text-accent underline">Back to projects</Link>}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Top: connection status */}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-ink-800 bg-ink-900 px-4 py-2">
        <div className={`flex items-center gap-2 rounded px-2.5 py-1 font-display text-sm font-bold tracking-widest ${onAir ? 'bg-live text-white' : 'bg-ink-700 text-ink-400'}`} title={onAir ? 'The scorebug is visible on at least one connected overlay' : 'Not on air'}>
          <span className={`h-2 w-2 rounded-full ${onAir ? 'bg-white live-pulse' : 'bg-ink-500'}`} />
          {onAir ? 'LIVE' : 'OFF AIR'}
        </div>
        <StatusDot state={connected ? 'ok' : status.state === 'error' ? 'error' : 'warn'} label={connected ? `Server ${status.rttMs ?? '–'} ms` : status.state === 'error' ? (status.error ?? 'Error') : 'Reconnecting…'} />
        <StatusDot state={(presence?.overlays ?? 0) > 0 ? 'ok' : 'warn'} label={`${presence?.overlays ?? 0} overlay${presence?.overlays === 1 ? '' : 's'} connected`} />
        <Link to="/obs">
          <StatusDot
            state={obs?.state === 'connected' ? 'ok' : obs?.state === 'reconnecting' || obs?.state === 'connecting' ? 'warn' : obs?.state === 'error' ? 'error' : 'idle'}
            label={obs?.state === 'connected' ? `OBS ${obs.currentProgramScene ? `· ${obs.currentProgramScene}` : ''}` : obs?.state === 'reconnecting' ? 'OBS reconnecting' : obs?.state === 'error' ? 'OBS error' : 'OBS not connected'}
          />
        </Link>
        {status.resyncing && <span className="text-xs text-warn">Resyncing…</span>}
        <div className="flex-1" />
        <Button size="sm" variant={snapshot.undo.available ? 'default' : 'ghost'} disabled={!snapshot.undo.available} onClick={() => run({ type: 'undo' })} title={hotkeyHint('undo') ?? ''}>
          <Undo2 className="h-4 w-4" />
          <span className="max-w-[180px] truncate">{snapshot.undo.label ? `Undo: ${snapshot.undo.label}` : 'Undo'}</span>
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setHistoryOpen(true)}>
          <History className="h-4 w-4" /> History
        </Button>
        <Button size="sm" variant={showProgram ? 'default' : 'ghost'} onClick={() => setShowProgram(!showProgram)}>
          <MonitorPlay className="h-4 w-4" /> Program
        </Button>
        <Button size="sm" variant={hotkeysOn ? 'default' : 'ghost'} onClick={() => setHotkeysOn(!hotkeysOn)} title="Keyboard shortcuts (configure in Settings)">
          <Keyboard className="h-4 w-4" /> {hotkeysOn ? 'Keys on' : 'Keys off'}
        </Button>
        <Button size="sm" variant="danger" onClick={() => setConfirm('reset')}>
          <RotateCcw className="h-4 w-4" /> Reset
        </Button>
      </header>

      {!connected && (
        <div className="bg-warn/90 px-4 py-1.5 text-center text-sm font-semibold text-ink-950">
          Connection to the server lost — controls will resume automatically. The overlay keeps showing the last state.
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3">
        <div className="mx-auto grid max-w-[1700px] gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(360px,440px)]">
          <div className="flex min-w-0 flex-col gap-3">
            <div className="grid gap-3 md:grid-cols-2">
              <TeamCard side="away" state={state} projectId={id} send={send} offerGraphics={offerGraphics} hotkeyHint={hotkeyHint} />
              <TeamCard side="home" state={state} projectId={id} send={send} offerGraphics={offerGraphics} hotkeyHint={hotkeyHint} />
            </div>
            <GraphicsPanel
              state={state}
              scene={scene?.scene ?? null}
              send={send}
              onEmergency={() => {
                run({ type: 'graphics.clear' });
                toast.warn('All graphics cleared. Press SHOW BUG to bring the scorebug back.');
              }}
              hotkeyHint={hotkeyHint}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-3">
            {showProgram && <ProgramMonitor projectId={id} live={onAir} />}
            <ClockPanel state={state} now={now} send={send} hotkeyHint={hotkeyHint} />
            <SituationPanel state={state} send={send} />
            <div className="panel space-y-2 p-3 text-sm">
              <Toggle checked={offerGraphics} onChange={setOfferGraphics} label="After scoring, offer the matching graphic (never automatic)" />
              <div className="flex gap-2">
                <Button size="sm" onClick={() => setConfirm('newGame')}>
                  New game (keep teams)
                </Button>
                <Link to={`/projects/${id}/studio`} className="text-xs text-ink-400 underline">
                  Edit design
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirm === 'reset'}
        title="Reset game state?"
        danger
        confirmLabel="Reset game"
        requireText="RESET"
        message={<p>Scores, timeouts, period, clocks and down & distance go back to pre-game. Team names, colours and logos are kept. This cannot be undone.</p>}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          run({ type: 'game.reset', keepTeams: true });
        }}
      />
      <ConfirmDialog
        open={confirm === 'newGame'}
        title="Start a new game?"
        confirmLabel="Start new game"
        message={<p>Creates a fresh game with the same teams and rules. The current game and its history are kept in the database.</p>}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          setConfirm(null);
          try {
            await endpoints.newMatch(id, true);
            toast.success('New game started');
          } catch (e) {
            toast.error((e as Error).message);
          }
        }}
      />
      <Modal open={historyOpen} onClose={() => setHistoryOpen(false)} title="Event history" width="max-w-xl">
        <ol className="divide-y divide-ink-700 text-sm">
          {history?.commands.map((c) => (
            <li key={c.id} className={`flex items-center gap-3 py-1.5 ${c.undone ? 'text-ink-500 line-through' : ''}`}>
              <span className="w-20 shrink-0 font-mono text-xs text-ink-400">{new Date(c.ts).toLocaleTimeString()}</span>
              <span className="flex-1">{c.label}</span>
              {c.undoable && !c.undone && <span className="rounded bg-ink-700 px-1.5 text-[10px] text-ink-300">undoable</span>}
            </li>
          ))}
          {!history?.commands.length && <li className="py-4 text-ink-400">No actions yet.</li>}
        </ol>
      </Modal>
    </div>
  );
}
