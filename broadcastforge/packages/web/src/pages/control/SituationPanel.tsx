import { Eye, EyeOff, Flag, Repeat } from 'lucide-react';
import { ballOnText, downAndDistanceText, type BallSpot, type GameCommand, type GameState, type TeamSide } from '@bf/shared';

export function SituationPanel({ state, send }: { state: GameState; send: (c: GameCommand) => Promise<boolean> }) {
  const spot = state.ballOn;
  const setSpot = (s: BallSpot | null) => send({ type: 'situation.set', ballOn: s });
  const yard = spot?.yardLine ?? 25;
  const side: TeamSide | null = spot?.side ?? null;
  const moveYard = (delta: number) => {
    // Moves the ball along the field: towards the away goal is "+" from home's perspective.
    let abs = side === 'home' ? yard : side === 'away' ? 100 - yard : 50;
    abs = Math.min(99, Math.max(1, abs + delta));
    if (abs === 50) return setSpot({ side: null, yardLine: 50 });
    return setSpot(abs < 50 ? { side: 'home', yardLine: abs } : { side: 'away', yardLine: 100 - abs });
  };

  return (
    <section className="panel p-3" aria-label="Game situation">
      <div className="mb-2 flex items-center justify-between">
        <span className="panel-title">Down & distance</span>
        <span className="font-display text-lg font-bold text-ink-100">{downAndDistanceText(state) || '—'}</span>
      </div>
      <div className="grid grid-cols-5 gap-1">
        {[1, 2, 3, 4].map((d) => (
          <button key={d} className={`rounded py-2.5 font-display text-lg font-bold ${state.down === d ? 'bg-accent text-ink-950' : 'bg-ink-750 text-ink-200 hover:bg-ink-700'}`} onClick={() => send({ type: 'situation.set', down: d })}>
            {['1ST', '2ND', '3RD', '4TH'][d - 1]}
          </button>
        ))}
        <button className="rounded bg-ink-750 py-2.5 text-xs text-ink-400 hover:bg-ink-700" onClick={() => send({ type: 'situation.set', down: null })}>
          Clear
        </button>
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-1">
        <button className="rounded bg-ok/80 py-2 text-sm font-bold text-ink-950 hover:bg-ok" onClick={() => send({ type: 'firstDown' })}>
          1ST & 10
        </button>
        <button className="rounded bg-ink-700 py-2 text-sm font-semibold hover:bg-ink-600" onClick={() => send({ type: 'down.next' })}>
          Next down →
        </button>
      </div>

      <div className="mt-3 flex items-center gap-1">
        <span className="w-16 text-[11px] uppercase tracking-wider text-ink-400">To gain</span>
        <button className="h-9 w-9 rounded bg-ink-700 hover:bg-ink-600" onClick={() => send({ type: 'situation.set', distance: Math.max(0, (state.distance ?? 10) - 1), goalToGo: false })}>
          −
        </button>
        <input
          className="field w-14 text-center font-display text-lg font-bold"
          value={state.goalToGo ? 'G' : (state.distance ?? '')}
          onChange={(e) => {
            const n = Number(e.target.value.replace(/\D/g, ''));
            if (Number.isFinite(n) && n <= 99) void send({ type: 'situation.set', distance: n, goalToGo: false });
          }}
          aria-label="Yards to gain"
        />
        <button className="h-9 w-9 rounded bg-ink-700 hover:bg-ink-600" onClick={() => send({ type: 'situation.set', distance: Math.min(99, (state.distance ?? 9) + 1), goalToGo: false })}>
          +
        </button>
        <button className={`h-9 rounded px-2 text-xs font-bold ${state.goalToGo ? 'bg-accent text-ink-950' : 'bg-ink-700 hover:bg-ink-600'}`} onClick={() => send({ type: 'situation.set', goalToGo: !state.goalToGo })}>
          GOAL
        </button>
        <button className={`h-9 rounded px-2 text-xs font-bold ${state.distance === 0 && !state.goalToGo ? 'bg-accent text-ink-950' : 'bg-ink-700 hover:bg-ink-600'}`} onClick={() => send({ type: 'situation.set', distance: 0, goalToGo: false })}>
          INCHES
        </button>
      </div>

      <div className="mt-2 flex items-center gap-1">
        <span className="w-16 text-[11px] uppercase tracking-wider text-ink-400">Ball on</span>
        <button className="h-9 w-9 rounded bg-ink-700 hover:bg-ink-600" onClick={() => moveYard(-1)} title="1 yard towards the home goal">
          ◀
        </button>
        <div className="flex-1 rounded border border-ink-600 bg-ink-900 py-1.5 text-center font-display text-lg font-bold">{spot ? ballOnText(state) : '—'}</div>
        <button className="h-9 w-9 rounded bg-ink-700 hover:bg-ink-600" onClick={() => moveYard(1)} title="1 yard towards the away goal">
          ▶
        </button>
      </div>
      <div className="mt-1 grid grid-cols-4 gap-1 text-xs">
        <button className={`rounded py-1.5 font-semibold ${side === 'home' ? 'bg-ink-500' : 'bg-ink-750 hover:bg-ink-700'}`} onClick={() => setSpot({ side: 'home', yardLine: Math.min(49, yard) })}>
          {state.home.abbreviation} side
        </button>
        <button className={`rounded py-1.5 font-semibold ${spot && side === null ? 'bg-ink-500' : 'bg-ink-750 hover:bg-ink-700'}`} onClick={() => setSpot({ side: null, yardLine: 50 })}>
          50
        </button>
        <button className={`rounded py-1.5 font-semibold ${side === 'away' ? 'bg-ink-500' : 'bg-ink-750 hover:bg-ink-700'}`} onClick={() => setSpot({ side: 'away', yardLine: Math.min(49, yard) })}>
          {state.away.abbreviation} side
        </button>
        <input
          className="field-sm text-center"
          type="number"
          min={1}
          max={50}
          value={yard}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (n >= 1 && n <= 50) void setSpot(n === 50 ? { side: null, yardLine: 50 } : { side: side ?? 'home', yardLine: n });
          }}
          aria-label="Yard line"
        />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-1.5">
        <button
          className={`flex flex-col items-center justify-center gap-0.5 rounded-lg py-3 font-display text-xl font-bold transition active:scale-95 ${state.flag ? 'bg-[#ffd200] text-black shadow-[0_0_24px_rgba(255,210,0,0.4)]' : 'bg-ink-750 text-[#ffd200] hover:bg-ink-700'}`}
          onClick={() => send({ type: 'flag.set', on: !state.flag })}
        >
          <Flag className="h-5 w-5" /> {state.flag ? 'FLAG ON' : 'FLAG'}
        </button>
        <button className="flex flex-col items-center justify-center gap-0.5 rounded-lg bg-ink-750 py-3 text-xs font-semibold hover:bg-ink-700" onClick={() => send({ type: 'possession.toggle' })}>
          <Repeat className="h-5 w-5" /> Switch possession
        </button>
        <button className="flex flex-col items-center justify-center gap-0.5 rounded-lg bg-ink-750 py-3 text-xs font-semibold hover:bg-ink-700" onClick={() => send({ type: 'situation.visibility', visible: !state.situationVisible })}>
          {state.situationVisible ? <Eye className="h-5 w-5" /> : <EyeOff className="h-5 w-5 text-warn" />}
          {state.situationVisible ? 'D&D shown' : 'D&D hidden'}
        </button>
      </div>
    </section>
  );
}
