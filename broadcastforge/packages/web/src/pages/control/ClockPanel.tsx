import { useState } from 'react';
import { ChevronLeft, ChevronRight, Eye, EyeOff, Pause, Play, RotateCcw, Settings2 } from 'lucide-react';
import {
  FOOTBALL_FORMATS,
  isTimedPeriod,
  parseClockInput,
  periodLabel,
  periodOrder,
  type FootballFormatId,
  type GameCommand,
  type GameState,
} from '@bf/shared';
import { useClockText } from '../../lib/useClock';
import { Button, Modal, NumberField, Toggle } from '../../components/ui';

export function ClockPanel({ state, now, send, hotkeyHint }: { state: GameState; now: () => number; send: (c: GameCommand) => Promise<boolean>; hotkeyHint: (a: string) => string | null }) {
  const game = useClockText(state.gameClock, now, 'game', state.config.showTenthsUnderMinute);
  const play = useClockText(state.playClock, now, 'play');
  const [setText, setSetText] = useState('');
  const [settings, setSettings] = useState(false);
  const timed = isTimedPeriod(state.period, state.config) || state.period === 'PRE';
  const periods = periodOrder(state.config).filter((p) => !p.startsWith('OT') || Number(p.slice(2)) <= Math.max(1, Number(state.period.startsWith('OT') ? state.period.slice(2) : 0) + 1));
  const running = state.gameClock.running;

  const applySet = async () => {
    const ms = parseClockInput(setText);
    if (ms === null) return;
    if (await send({ type: 'clock.set', clock: 'game', ms })) setSetText('');
  };

  return (
    <section className="panel p-3" aria-label="Clock">
      <div className="mb-2 flex items-center justify-between">
        <span className="panel-title">Period & clock</span>
        <button className="rounded p-1 text-ink-400 hover:bg-ink-700 hover:text-ink-100" onClick={() => setSettings(true)} title="Game format & clock rules">
          <Settings2 className="h-4 w-4" />
        </button>
      </div>
      <div className="mb-3 flex items-center gap-1">
        <button className="rounded bg-ink-700 p-1.5 hover:bg-ink-600" onClick={() => send({ type: 'period.step', direction: -1 })} aria-label="Previous period">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="flex flex-1 flex-wrap gap-1">
          {periods.map((p) => (
            <button
              key={p}
              className={`min-w-[2.6rem] flex-1 rounded px-1.5 py-1.5 font-display text-sm font-bold ${p === state.period ? 'bg-accent text-ink-950' : 'bg-ink-750 text-ink-300 hover:bg-ink-700'}`}
              onClick={() => p !== state.period && send({ type: 'period.set', period: p })}
            >
              {periodLabel(p)}
            </button>
          ))}
        </div>
        <button className="rounded bg-ink-700 p-1.5 hover:bg-ink-600" onClick={() => send({ type: 'period.step', direction: 1 })} aria-label="Next period">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="flex items-stretch gap-2">
        <div className={`flex flex-1 flex-col items-center justify-center rounded-lg border bg-ink-950 py-2 ${running ? 'border-ok/60' : 'border-ink-700'}`}>
          <div className={`font-display text-6xl font-bold tabular-nums leading-none ${!timed ? 'text-ink-500' : game.ms === 0 ? 'text-live' : running ? 'text-ok' : 'text-white'}`}>{timed ? game.text : '—:—'}</div>
          <div className="mt-1 text-[10px] uppercase tracking-widest text-ink-400">{!timed ? `No game clock in ${periodLabel(state.period)}` : running ? 'Running' : 'Stopped'}</div>
        </div>
        <button
          className={`flex w-28 flex-col items-center justify-center gap-1 rounded-lg font-display text-xl font-bold transition active:scale-95 disabled:opacity-30 ${running ? 'bg-live text-white' : 'bg-ok text-ink-950'}`}
          onClick={() => send({ type: 'clock.toggle', clock: 'game' })}
          disabled={!timed}
        >
          {running ? <Pause className="h-7 w-7" /> : <Play className="h-7 w-7" />}
          {running ? 'STOP' : 'START'}
          {hotkeyHint('clock.toggle') && <span className="font-mono text-[10px] font-normal opacity-70">{hotkeyHint('clock.toggle')}</span>}
        </button>
      </div>

      <div className="mt-2 grid grid-cols-4 gap-1">
        {[
          [-10_000, '−10s'],
          [-1_000, '−1s'],
          [1_000, '+1s'],
          [10_000, '+10s'],
        ].map(([d, l]) => (
          <button key={l} className="rounded bg-ink-750 py-1.5 text-xs font-semibold text-ink-200 hover:bg-ink-700" onClick={() => send({ type: 'clock.adjust', clock: 'game', deltaMs: d as number })}>
            {l}
          </button>
        ))}
      </div>
      <div className="mt-2 flex gap-1">
        <input
          className="field flex-1 font-mono"
          placeholder="Sync to stadium: 4:07 or 45.3"
          value={setText}
          onChange={(e) => setSetText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void applySet()}
          aria-label="Set game clock"
        />
        <Button onClick={applySet} disabled={parseClockInput(setText) === null}>
          Set
        </Button>
        <Button onClick={() => send({ type: 'clock.reset', clock: 'game' })} title="Reset to full period length">
          <RotateCcw className="h-4 w-4" />
        </Button>
      </div>
      <p className="mt-1 text-[11px] text-ink-500">Setting the clock while it runs keeps it running from the new value — type the stadium clock and press Enter.</p>

      <div className="mt-3 border-t border-ink-700 pt-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="panel-title">Play clock</span>
          <button className="text-ink-400 hover:text-ink-100" onClick={() => send({ type: 'playClock.visibility', visible: !state.playClockVisible })} title={state.playClockVisible ? 'Hide play clock on air' : 'Show play clock on air'}>
            {state.playClockVisible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <div className={`w-16 text-center font-display text-4xl font-bold tabular-nums ${state.playClock.running ? (play.ms <= 5000 ? 'text-live' : 'text-accent') : 'text-ink-200'}`}>{play.text}</div>
          <div className="grid flex-1 grid-cols-4 gap-1">
            <button className="rounded bg-accent/20 py-2 font-display text-lg font-bold text-accent hover:bg-accent/30" onClick={() => send({ type: 'clock.reset', clock: 'play', seconds: state.config.playClockSeconds, autoStart: true })} title="Reset and start">
              {state.config.playClockSeconds}
            </button>
            <button className="rounded bg-accent/20 py-2 font-display text-lg font-bold text-accent hover:bg-accent/30" onClick={() => send({ type: 'clock.reset', clock: 'play', seconds: state.config.playClockShortSeconds, autoStart: true })} title="Reset and start">
              {state.config.playClockShortSeconds}
            </button>
            <button className="rounded bg-ink-700 py-2 hover:bg-ink-600" onClick={() => send({ type: 'clock.toggle', clock: 'play' })} aria-label="Start/stop play clock">
              {state.playClock.running ? <Pause className="mx-auto h-4 w-4" /> : <Play className="mx-auto h-4 w-4" />}
            </button>
            <button className="rounded bg-ink-700 py-2 hover:bg-ink-600" onClick={() => send({ type: 'clock.reset', clock: 'play' })} aria-label="Reset play clock">
              <RotateCcw className="mx-auto h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
      <ClockSettings open={settings} onClose={() => setSettings(false)} state={state} send={send} />
    </section>
  );
}

function ClockSettings({ open, onClose, state, send }: { open: boolean; onClose: () => void; state: GameState; send: (c: GameCommand) => Promise<boolean> }) {
  const c = state.config;
  const update = (patch: Partial<typeof c>) => send({ type: 'config.update', patch });
  return (
    <Modal open={open} onClose={onClose} title="Game format & clock rules" width="max-w-xl">
      <div className="space-y-4">
        <div>
          <label className="label">Format preset</label>
          <div className="grid grid-cols-2 gap-2">
            {Object.values(FOOTBALL_FORMATS).map((f) => (
              <button
                key={f.id}
                className={`rounded-lg border p-2.5 text-left ${c.formatId === f.id ? 'border-accent bg-accent/10' : 'border-ink-600 hover:border-ink-400'}`}
                onClick={() => update({ ...f.config, formatId: f.id as FootballFormatId })}
              >
                <div className="text-sm font-semibold">{f.label}</div>
                <div className="text-[11px] text-ink-400">{f.description}</div>
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Quarter length (minutes)</label>
            <NumberField className="field" value={c.quarterLengthMs / 60000} min={1} max={30} onChange={(v) => update({ quarterLengthMs: Math.round(v * 60000), formatId: 'custom' })} />
          </div>
          <div>
            <label className="label">Overtime length (0 = untimed)</label>
            <NumberField className="field" value={(c.overtimeLengthMs ?? 0) / 60000} min={0} max={30} onChange={(v) => update({ overtimeLengthMs: v > 0 ? Math.round(v * 60000) : null, formatId: 'custom' })} />
          </div>
          <div>
            <label className="label">Play clock (long)</label>
            <NumberField className="field" value={c.playClockSeconds} min={5} max={99} onChange={(v) => update({ playClockSeconds: Math.round(v), formatId: 'custom' })} />
          </div>
          <div>
            <label className="label">Play clock (short)</label>
            <NumberField className="field" value={c.playClockShortSeconds} min={5} max={99} onChange={(v) => update({ playClockShortSeconds: Math.round(v), formatId: 'custom' })} />
          </div>
          <div>
            <label className="label">Timeouts per half</label>
            <NumberField className="field" value={c.timeoutsPerHalf} min={0} max={9} onChange={(v) => update({ timeoutsPerHalf: Math.round(v), formatId: 'custom' })} />
          </div>
          <div>
            <label className="label">Timeouts per overtime</label>
            <NumberField className="field" value={c.overtimeTimeouts} min={0} max={9} onChange={(v) => update({ overtimeTimeouts: Math.round(v), formatId: 'custom' })} />
          </div>
        </div>
        <Toggle checked={c.showTenthsUnderMinute} onChange={(v) => update({ showTenthsUnderMinute: v })} label="Show tenths of a second in the final minute" />
        <Toggle checked={c.resetTimeoutsAtHalf} onChange={(v) => update({ resetTimeoutsAtHalf: v })} label="Reset timeouts at halftime" />
        <p className="text-xs text-ink-400">Changes apply immediately. A stopped clock sitting at a full period follows the new length; a running clock is never changed.</p>
      </div>
    </Modal>
  );
}
