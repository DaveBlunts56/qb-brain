import { useState } from 'react';
import { Eye, EyeOff, OctagonX, Send } from 'lucide-react';
import type { GameCommand, GameState, GraphicKind, Scene, TeamSide } from '@bf/shared';

const TEAM_GRAPHICS: { kind: GraphicKind; label: string; tone: string }[] = [
  { kind: 'touchdown', label: 'TOUCHDOWN', tone: 'bg-ok/85 hover:bg-ok text-ink-950' },
  { kind: 'fieldGoal', label: 'FIELD GOAL', tone: 'bg-info/80 hover:bg-info text-ink-950' },
  { kind: 'safety', label: 'SAFETY', tone: 'bg-ink-600 hover:bg-ink-500' },
  { kind: 'extraPoint', label: 'PAT GOOD', tone: 'bg-ink-600 hover:bg-ink-500' },
  { kind: 'twoPoint', label: '2-PT GOOD', tone: 'bg-ink-600 hover:bg-ink-500' },
  { kind: 'turnover', label: 'TURNOVER', tone: 'bg-ink-600 hover:bg-ink-500' },
];

export function GraphicsPanel({
  state,
  scene,
  send,
  onEmergency,
  hotkeyHint,
}: {
  state: GameState;
  scene: Scene | null;
  send: (c: GameCommand) => Promise<boolean>;
  onEmergency: () => void;
  hotkeyHint: (a: string) => string | null;
}) {
  const [text, setText] = useState('');
  const [title, setTitle] = useState(state.labels.title ?? '');
  const has = (k: GraphicKind) => Boolean(scene?.timelines.some((t) => t.trigger === k && t.enabled));
  const trigger = (graphic: GraphicKind, team: TeamSide | null, extra?: string) => send({ type: 'graphic.trigger', graphic, team, ...(extra ? { text: extra } : {}) });

  return (
    <section className="panel p-3" aria-label="Graphics">
      <div className="mb-2 flex items-center justify-between">
        <span className="panel-title">Graphics — cues never change the score</span>
      </div>
      <div className="grid gap-2 lg:grid-cols-[1fr_1fr_auto]">
        {(['away', 'home'] as const).map((side) => (
          <div key={side} className="rounded-lg border border-ink-700 p-2">
            <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold">
              <span className="h-3 w-3 rounded-sm" style={{ background: state[side].primaryColor }} />
              {state[side].abbreviation}
            </div>
            <div className="grid grid-cols-3 gap-1">
              {TEAM_GRAPHICS.map((g) => (
                <button
                  key={g.kind}
                  className={`rounded py-2.5 font-display text-sm font-bold tracking-wide transition active:scale-95 disabled:opacity-25 ${g.tone}`}
                  onClick={() => trigger(g.kind, side)}
                  disabled={!has(g.kind) || !state.overlayVisible}
                  title={!has(g.kind) ? 'No animation for this graphic yet (Animate → Generate)' : !state.overlayVisible ? 'Show the scorebug first' : ''}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>
        ))}
        <div className="flex flex-col gap-1.5 lg:w-48">
          <button
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-3 font-display text-lg font-bold transition active:scale-95 ${state.overlayVisible ? 'bg-ink-600 hover:bg-ink-500' : 'bg-ok text-ink-950 hover:brightness-110'}`}
            onClick={() => send({ type: 'overlay.visibility', visible: !state.overlayVisible })}
          >
            {state.overlayVisible ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            {state.overlayVisible ? 'HIDE BUG' : 'SHOW BUG'}
            {hotkeyHint('overlay.toggle') && <span className="font-mono text-[10px] font-normal opacity-60">{hotkeyHint('overlay.toggle')}</span>}
          </button>
          <button className="flex flex-1 items-center justify-center gap-2 rounded-lg border-2 border-live bg-live/20 py-3 font-display text-lg font-bold text-red-200 transition hover:bg-live hover:text-white active:scale-95" onClick={onEmergency}>
            <OctagonX className="h-5 w-5" /> CLEAR ALL
          </button>
        </div>
      </div>
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        <div className="flex gap-1">
          <button className="rounded bg-ink-600 px-3 py-2 font-display text-sm font-bold hover:bg-ink-500 disabled:opacity-25" disabled={!has('firstDown') || !state.overlayVisible} onClick={() => trigger('firstDown', state.possession)}>
            FIRST DOWN
          </button>
          <button className="rounded bg-[#ffd200]/90 px-3 py-2 font-display text-sm font-bold text-black hover:bg-[#ffd200] disabled:opacity-25" disabled={!has('penalty') || !state.overlayVisible} onClick={() => trigger('penalty', null)}>
            PENALTY
          </button>
          <input className="field min-w-0 flex-1" placeholder="Custom banner text…" maxLength={80} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && text.trim() && trigger('custom', null, text.trim())} />
          <button className="rounded bg-ink-600 px-2 hover:bg-ink-500 disabled:opacity-25" disabled={!text.trim() || !has('custom') || !state.overlayVisible} onClick={() => trigger('custom', null, text.trim())} aria-label="Show custom banner">
            <Send className="h-4 w-4" />
          </button>
        </div>
        <div className="flex gap-1">
          <input className="field min-w-0 flex-1" placeholder="Title tab (e.g. HOMECOMING) — empty hides it" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send({ type: 'label.set', key: 'title', value: title.trim() })} />
          <button className="rounded bg-ink-600 px-3 text-sm hover:bg-ink-500" onClick={() => send({ type: 'label.set', key: 'title', value: title.trim() })}>
            Set title
          </button>
        </div>
      </div>
    </section>
  );
}
