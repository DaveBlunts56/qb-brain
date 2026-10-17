import { useState } from 'react';
import { Football, Hand, Pencil } from './icons';
import type { GameCommand, GameState, TeamSide } from '@bf/shared';
import { assetUrl } from '../../lib/api';
import { toast } from '../../components/toast';
import { TeamEditor } from './TeamEditor';

const SCORE_FOLLOWUP: Record<number, { label: string; graphic: 'touchdown' | 'fieldGoal' | 'twoPoint' | 'extraPoint' } | undefined> = {
  6: { label: 'Play TOUCHDOWN', graphic: 'touchdown' },
  3: { label: 'Play FIELD GOAL', graphic: 'fieldGoal' },
  2: { label: 'Play 2-PT', graphic: 'twoPoint' },
  1: { label: 'Play PAT GOOD', graphic: 'extraPoint' },
};

export function TeamCard({
  side,
  state,
  projectId,
  send,
  offerGraphics,
  hotkeyHint,
}: {
  side: TeamSide;
  state: GameState;
  projectId: string;
  send: (c: GameCommand) => Promise<boolean>;
  offerGraphics: boolean;
  hotkeyHint: (action: string) => string | null;
}) {
  const team = state[side];
  const [editing, setEditing] = useState(false);
  const [scoreEdit, setScoreEdit] = useState<string | null>(null);
  const hasBall = state.possession === side;

  const add = async (delta: number) => {
    const ok = await send({ type: 'score.add', team: side, delta });
    const follow = SCORE_FOLLOWUP[delta];
    // Scoring and graphics are separate actions: the graphic never changes the score.
    if (ok && offerGraphics && follow) {
      toast.info(`${team.abbreviation || side.toUpperCase()} +${delta}`, { label: follow.label, run: () => void send({ type: 'graphic.trigger', graphic: follow.graphic, team: side }) }, 6000);
    }
  };

  const commitScore = async () => {
    const n = Number(scoreEdit);
    setScoreEdit(null);
    if (Number.isInteger(n) && n >= 0 && n <= 999 && n !== team.score) await send({ type: 'score.set', team: side, value: n });
  };

  const kbd = (a: string) => {
    const h = hotkeyHint(a);
    return h ? <span className="ml-1 hidden rounded bg-black/30 px-1 font-mono text-[10px] font-normal opacity-70 lg:inline">{h}</span> : null;
  };

  return (
    <section className="panel flex flex-col overflow-hidden" aria-label={`${side} team`}>
      <div className="flex items-center gap-3 px-3 py-2.5" style={{ background: `linear-gradient(90deg, ${team.primaryColor}, ${team.secondaryColor})`, color: team.textColor }}>
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-black/20 p-1">
          {team.logoAssetId ? <img src={assetUrl(team.logoAssetId)} alt="" className="h-full w-full object-contain" /> : <span className="text-xs opacity-60">LOGO</span>}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-widest opacity-75">{side === 'home' ? 'Home' : 'Away'}</div>
          <div className="truncate font-display text-2xl font-bold leading-none">{team.abbreviation}</div>
          <div className="truncate text-xs opacity-80">
            {team.name} {team.mascot} {team.record && `· ${team.record}`}
          </div>
        </div>
        <button className="rounded-md bg-black/25 p-2 hover:bg-black/40" onClick={() => setEditing(true)} title="Edit team name, colours and logo">
          <Pencil className="h-4 w-4" />
        </button>
      </div>

      <div className="flex items-center justify-center py-3">
        {scoreEdit === null ? (
          <button className="min-w-[2ch] rounded-lg px-4 font-display text-[88px] font-bold leading-none tabular-nums text-white hover:bg-ink-750" title="Click to correct the score" onClick={() => setScoreEdit(String(team.score))}>
            {team.score}
          </button>
        ) : (
          <input
            className="w-40 rounded-lg border-2 border-accent bg-ink-900 text-center font-display text-[72px] font-bold leading-none text-white outline-none"
            autoFocus
            inputMode="numeric"
            value={scoreEdit}
            onChange={(e) => setScoreEdit(e.target.value.replace(/\D/g, '').slice(0, 3))}
            onBlur={commitScore}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commitScore();
              if (e.key === 'Escape') setScoreEdit(null);
            }}
            aria-label="Set score"
          />
        )}
      </div>

      <div className="grid grid-cols-5 gap-1.5 px-3 pb-3">
        <button className="h-14 rounded-md border border-ink-600 bg-ink-750 font-display text-xl font-bold text-ink-300 hover:bg-ink-700" onClick={() => add(-1)} title="Score correction −1">
          −1
        </button>
        {[1, 2, 3, 6].map((d) => (
          <button key={d} className={`h-14 rounded-md font-display text-2xl font-bold text-white transition active:scale-95 ${d === 6 ? 'bg-ok/80 hover:bg-ok' : 'bg-ink-600 hover:bg-ink-500'}`} onClick={() => add(d)}>
            +{d}
            {kbd(`${side}.+${d}`)}
          </button>
        ))}
      </div>

      <div className="mt-auto flex items-center gap-2 border-t border-ink-700 px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">Timeouts</span>
        <div className="flex gap-1" aria-label={`${team.timeouts} timeouts`}>
          {Array.from({ length: Math.max(team.timeouts, state.config.timeoutsPerHalf) }).map((_, i) => (
            <span key={i} className={`h-2.5 w-6 rounded-sm ${i < team.timeouts ? 'bg-accent' : 'bg-ink-600'}`} />
          ))}
        </div>
        <div className="ml-auto flex gap-1">
          <button className="h-8 w-8 rounded bg-ink-700 text-sm hover:bg-ink-600" onClick={() => send({ type: 'timeouts.adjust', team: side, delta: -1 })} title="Remove a timeout (no graphic)">
            −
          </button>
          <button className="h-8 w-8 rounded bg-ink-700 text-sm hover:bg-ink-600" onClick={() => send({ type: 'timeouts.adjust', team: side, delta: 1 })} title="Restore a timeout">
            +
          </button>
          <button className="flex h-8 items-center gap-1 rounded bg-accent/15 px-2 text-xs font-semibold text-accent hover:bg-accent/25 disabled:opacity-30" disabled={team.timeouts <= 0} onClick={() => send({ type: 'timeout.call', team: side })} title="Charge a timeout: stops the clock and plays the timeout graphic">
            <Hand className="h-3.5 w-3.5" /> Timeout
          </button>
        </div>
      </div>
      <button
        className={`flex items-center justify-center gap-2 border-t py-2.5 text-sm font-semibold transition ${hasBall ? 'border-accent/50 bg-accent/15 text-accent' : 'border-ink-700 text-ink-400 hover:bg-ink-750 hover:text-ink-100'}`}
        onClick={() => send({ type: 'possession.set', team: hasBall ? null : side })}
      >
        <Football className="h-4 w-4" /> {hasBall ? 'HAS POSSESSION' : 'Give possession'}
      </button>
      <TeamEditor open={editing} side={side} team={team} projectId={projectId} onClose={() => setEditing(false)} send={send} />
    </section>
  );
}
