import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { Play, Plus, RotateCcw, Send, Sparkles, Square, Trash2 } from 'lucide-react';
import {
  buildClip,
  createId,
  reduceGame,
  ROLE_MAP,
  TAKEOVER_PRIORITY,
  TIMELINE_TRIGGERS,
  TRANSIENT_EVENT_TYPES,
  type BroadcastEvent,
  type EventTimeline,
  type GameCommand,
  type GameState,
  type TeamSide,
  type TimelineTrigger,
} from '@bf/shared';
import { endpoints } from '../../lib/api';
import { Button, NumberField, Toggle } from '../../components/ui';
import { toast } from '../../components/toast';
import { ScenePreview } from '../../components/ScenePreview';
import type { SceneRenderer } from '../../render/SceneRenderer';
import { flushSave, useEditor } from '../studio/editorStore';
import { GeneratorDialog } from '../studio/GeneratorDialog';
import { Row, Section } from '../studio/inspector/fields';
import { TimelineEditor } from './TimelineEditor';
import { ClipEditor } from './ClipEditor';
import { useTimelinePreview } from './usePreview';

const TRIGGER_LABELS: Record<TimelineTrigger, string> = {
  entrance: 'Scorebug entrance',
  exit: 'Scorebug exit',
  touchdown: 'Touchdown',
  fieldGoal: 'Field goal',
  safety: 'Safety',
  extraPoint: 'Extra point',
  twoPoint: '2-point conversion',
  firstDown: 'First down',
  turnover: 'Turnover',
  timeout: 'Timeout',
  penalty: 'Penalty banner',
  custom: 'Custom banner',
  periodChange: 'Quarter change',
  possessionChange: 'Possession change',
  scoreChange: 'Score change',
};

const MODE_FOR: Record<TimelineTrigger, EventTimeline['mode']> = {
  entrance: 'visibility',
  exit: 'visibility',
  periodChange: 'accent',
  possessionChange: 'accent',
  scoreChange: 'accent',
  touchdown: 'takeover',
  fieldGoal: 'takeover',
  safety: 'takeover',
  extraPoint: 'takeover',
  twoPoint: 'takeover',
  firstDown: 'takeover',
  turnover: 'takeover',
  timeout: 'takeover',
  penalty: 'takeover',
  custom: 'takeover',
};

function Simulator({ state, setState, renderer }: { state: GameState; setState: (s: GameState) => void; renderer: () => SceneRenderer | null }) {
  const seq = useRef(0);
  const run = (cmd: GameCommand) => {
    const r = reduceGame(state, cmd, { nowMono: performance.now(), nowWall: Date.now() });
    if (r.error) return toast.warn(r.error);
    const events: BroadcastEvent[] = r.events.map((d) => ({ ...d, id: createId('sim'), matchId: 'preview', seq: ++seq.current, ts: Date.now(), persistent: !TRANSIENT_EVENT_TYPES.has(d.type), commandId: null, origin: 'operator' }));
    const rd = renderer();
    if (events.some((e) => e.type === 'GRAPHICS_CLEARED')) rd?.clearGraphics();
    rd?.setState(r.state, true);
    rd?.handleEvents(events);
    setState(r.state);
  };
  const btn = (label: string, cmds: GameCommand[], tone = 'bg-ink-700 hover:bg-ink-600') => (
    <button key={label} className={`rounded px-2 py-1 text-[11px] font-semibold ${tone}`} onClick={() => cmds.forEach(run)}>
      {label}
    </button>
  );
  return (
    <div className="flex flex-wrap gap-1">
      {btn('Home +6', [{ type: 'score.add', team: 'home', delta: 6 }], 'bg-ok/70 hover:bg-ok text-ink-950')}
      {btn('Home TD graphic', [{ type: 'graphic.trigger', graphic: 'touchdown', team: 'home' }])}
      {btn('Away +3', [{ type: 'score.add', team: 'away', delta: 3 }], 'bg-info/70 hover:bg-info text-ink-950')}
      {btn('Away FG graphic', [{ type: 'graphic.trigger', graphic: 'fieldGoal', team: 'away' }])}
      {btn('Next quarter', [{ type: 'period.step', direction: 1 }])}
      {btn('Switch possession', [{ type: 'possession.toggle' }])}
      {btn('Next down', [{ type: 'down.next' }])}
      {btn('1st & 10', [{ type: 'firstDown' }])}
      {btn(state.flag ? 'Flag off' : 'Flag on', [{ type: 'flag.set', on: !state.flag }], 'bg-[#ffd200]/80 text-black hover:bg-[#ffd200]')}
      {btn('Home timeout', [{ type: 'timeout.call', team: 'home' }])}
      {btn(state.overlayVisible ? 'Hide bug' : 'Show bug', [{ type: 'overlay.visibility', visible: !state.overlayVisible }])}
      {btn('Custom banner', [{ type: 'graphic.trigger', graphic: 'custom', text: 'WEATHER DELAY' }])}
      {btn('Clear all', [{ type: 'graphics.clear' }], 'bg-live/40 hover:bg-live')}
    </div>
  );
}

export function AnimationEditor() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const st = useEditor();
  const { scene, update, previewState, hasUnpublished } = st;
  const [tlId, setTlId] = useState<string | null>(null);
  const [elementId, setElementId] = useState<string | null>(params.get('element'));
  const [selectedTracks, setSelectedTracks] = useState<string[]>([]);
  const [team, setTeam] = useState<TeamSide>('home');
  const [simState, setSimState] = useState<GameState>(previewState);
  const [genOpen, setGenOpen] = useState(false);
  const rendererRef = useRef<SceneRenderer | null>(null);
  const getRenderer = useCallback(() => rendererRef.current, []);
  const preview = useTimelinePreview(getRenderer);

  useEffect(() => {
    if (useEditor.getState().projectId !== id) void st.load(id);
    return () => void flushSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => setSimState(previewState), [previewState]);
  useEffect(() => {
    if (scene && !elementId && (!tlId || !scene.timelines.some((t) => t.id === tlId))) setTlId(scene.timelines.find((t) => t.trigger === 'touchdown')?.id ?? scene.timelines[0]?.id ?? null);
  }, [scene, tlId, elementId]);
  useEffect(() => {
    if (elementId) st.select([elementId]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elementId]);

  if (!scene) return <div className="p-10 text-ink-400">Loading…</div>;

  const tl = elementId ? null : (scene.timelines.find((t) => t.id === tlId) ?? null);
  const el = elementId ? scene.elements.find((e) => e.id === elementId) : null;
  const changeTl = (mutate: (t: EventTimeline) => void, coalesce?: string) =>
    update(
      (s) => {
        const t = s.timelines.find((x) => x.id === tlId);
        if (t) mutate(t);
      },
      coalesce ? { coalesce } : undefined,
    );
  const track = tl && selectedTracks.length === 1 ? tl.tracks.find((t) => t.id === selectedTracks[0]) : null;
  const animatedEls = scene.elements.filter((e) => e.anim.update || e.anim.enter || e.anim.exit || e.role);
  const groups: { label: string; mode: EventTimeline['mode'] }[] = [
    { label: 'Scorebug in / out', mode: 'visibility' },
    { label: 'Takeover graphics', mode: 'takeover' },
    { label: 'Accents', mode: 'accent' },
  ];
  const missingTriggers = TIMELINE_TRIGGERS.filter((t) => !scene.timelines.some((x) => x.trigger === t));

  const addTimeline = (trigger: TimelineTrigger) => {
    const t: EventTimeline = { id: createId('tl'), name: TRIGGER_LABELS[trigger], trigger, mode: MODE_FOR[trigger], priority: TAKEOVER_PRIORITY[trigger] ?? 0, enabled: true, tracks: [] };
    update((s) => void s.timelines.push(t));
    setElementId(null);
    setTlId(t.id);
  };

  const publish = async () => {
    try {
      await flushSave();
      const r = await endpoints.publish(id);
      st.markPublished(r.version);
      toast.success(`Published v${r.version} — overlays now use these animations.`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-ink-800 bg-ink-900 px-3 py-1.5">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{st.name}</div>
          <div className="text-[10px] text-ink-400">Animation Editor</div>
        </div>
        <div className="flex-1" />
        <Link to={`/projects/${id}/studio`} className="text-xs text-ink-300 hover:text-ink-100">
          ← Studio
        </Link>
        <Button size="sm" onClick={() => setGenOpen(true)}>
          <Sparkles className="h-4 w-4" /> Generate animations
        </Button>
        <Button size="sm" variant={hasUnpublished ? 'live' : 'default'} onClick={publish}>
          <Send className="h-4 w-4" /> {hasUnpublished ? 'Publish to air' : 'Published'}
        </Button>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="w-60 shrink-0 overflow-y-auto border-r border-ink-800 bg-ink-900 py-2 text-xs">
          {groups.map((g) => (
            <div key={g.mode} className="mb-3">
              <div className="panel-title px-3 pb-1">{g.label}</div>
              {scene.timelines
                .filter((t) => t.mode === g.mode)
                .map((t) => (
                  <button
                    key={t.id}
                    className={`flex w-full items-center gap-2 px-3 py-1 text-left ${tl?.id === t.id ? 'bg-info/25 text-white' : 'text-ink-200 hover:bg-ink-800'}`}
                    onClick={() => {
                      setElementId(null);
                      setTlId(t.id);
                      setSelectedTracks([]);
                    }}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${t.enabled ? 'bg-ok' : 'bg-ink-500'}`} />
                    <span className="flex-1 truncate">{t.name}</span>
                    <span className="text-[10px] text-ink-500">{t.tracks.length}</span>
                  </button>
                ))}
            </div>
          ))}
          {missingTriggers.length > 0 && (
            <div className="px-3 pb-3">
              <select className="field-sm" value="" onChange={(e) => e.target.value && addTimeline(e.target.value as TimelineTrigger)}>
                <option value="">+ New timeline…</option>
                {missingTriggers.map((t) => (
                  <option key={t} value={t}>
                    {TRIGGER_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="panel-title px-3 pb-1 pt-2">Element animations</div>
          {animatedEls.map((e) => (
            <button key={e.id} className={`flex w-full items-center gap-2 px-3 py-1 text-left ${elementId === e.id ? 'bg-info/25 text-white' : 'text-ink-200 hover:bg-ink-800'}`} onClick={() => setElementId(e.id)}>
              <span className="flex-1 truncate">{e.name}</span>
              {e.role && <span className="shrink-0 text-[10px] text-accent">{ROLE_MAP[e.role].label.slice(0, 12)}</span>}
            </button>
          ))}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="border-b border-ink-800 bg-ink-950 p-3">
            <div className="checker relative mx-auto aspect-video max-h-[42vh] w-full overflow-hidden rounded-lg border border-ink-700">
              <ScenePreview scene={scene} state={simState} className="absolute inset-0" onRenderer={(r) => (rendererRef.current = r)} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {tl && (
                <>
                  {preview.isPlaying ? (
                    <Button size="sm" variant="live" onClick={preview.stop}>
                      <Square className="h-3.5 w-3.5" /> Stop
                    </Button>
                  ) : (
                    <Button size="sm" variant="success" onClick={() => preview.play(tl, team)}>
                      <Play className="h-3.5 w-3.5" /> Play “{tl.name}”
                    </Button>
                  )}
                  <Button
                    size="sm"
                    onClick={() => {
                      preview.stop();
                      rendererRef.current?.clearGraphics(false);
                      rendererRef.current?.setState(simState, false);
                    }}
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Reset
                  </Button>
                  <select className="field-sm w-24" value={team} onChange={(e) => setTeam(e.target.value as TeamSide)}>
                    <option value="home">Home team</option>
                    <option value="away">Away team</option>
                  </select>
                  <span className="h-4 w-px bg-ink-700" />
                </>
              )}
              <span className="text-[11px] text-ink-400">Simulate:</span>
              <Simulator state={simState} setState={setSimState} renderer={getRenderer} />
            </div>
          </div>
          {tl ? (
            <TimelineEditor scene={scene} timeline={tl} selected={selectedTracks} onSelect={setSelectedTracks} onChange={changeTl} playheadMs={preview.playhead} />
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-ink-500">{el ? `Editing “${el.name}” — see the panel on the right.` : 'Choose a timeline or element on the left.'}</div>
          )}
        </div>

        <aside className="w-80 shrink-0 overflow-y-auto border-l border-ink-800 bg-ink-900">
          {tl && !track && (
            <Section title="Timeline">
              <input className="field-sm" value={tl.name} onChange={(e) => changeTl((t) => void (t.name = e.target.value.slice(0, 120)), `tlname:${tl.id}`)} aria-label="Timeline name" />
              <Row label="Plays on">
                <span className="text-xs text-ink-200">{TRIGGER_LABELS[tl.trigger]}</span>
              </Row>
              <Row label="Behaviour">
                <span className="text-xs text-ink-300">{tl.mode === 'takeover' ? 'Exclusive graphic (queued / preempted by priority)' : tl.mode === 'accent' ? 'Accent (plays alongside)' : 'Show / hide the scorebug'}</span>
              </Row>
              {tl.mode === 'takeover' && (
                <Row label="Priority">
                  <NumberField value={tl.priority} min={0} max={1000} onChange={(v) => changeTl((t) => void (t.priority = v))} />
                </Row>
              )}
              <Toggle checked={tl.enabled} onChange={(v) => changeTl((t) => void (t.enabled = v))} label="Enabled" />
              <p className="text-[11px] text-ink-500">Select a bar to edit its animation. Team-relative targets (⚡) follow whichever team the graphic is for.</p>
              <button className="flex items-center gap-1 text-xs text-red-300 hover:text-red-200" onClick={() => update((s) => void (s.timelines = s.timelines.filter((x) => x.id !== tl.id)))}>
                <Trash2 className="h-3.5 w-3.5" /> Delete timeline
              </button>
            </Section>
          )}
          {track && (
            <Section title="Clip">
              <Row label="Start">
                <NumberField value={track.startMs} min={0} max={120000} step={10} suffix="ms" onChange={(v) => changeTl((t) => void (t.tracks.find((x) => x.id === track.id)!.startMs = v))} />
              </Row>
              <ClipEditor
                clip={track.clip}
                onChange={(c) => changeTl((t) => void (t.tracks.find((x) => x.id === track.id)!.clip = c), `clip:${track.id}`)}
                onPreview={() => {
                  for (const id of track.elementId.startsWith('@') ? [] : [track.elementId]) rendererRef.current?.previewClip(id, track.clip);
                  if (track.elementId.startsWith('@')) preview.play({ ...tl!, tracks: [{ ...track, startMs: 0 }] }, team);
                }}
              />
            </Section>
          )}
          {el && (
            <>
              <Section title={`Enter — ${el.name}`}>
                <p className="text-[11px] text-ink-500">Plays when a visibility binding turns this element on (flag, possession, restored timeout).</p>
                {el.anim.enter ? (
                  <ClipEditor clip={el.anim.enter} onChange={(c) => update((s) => void (s.elements.find((x) => x.id === el.id)!.anim.enter = c), { coalesce: `enter:${el.id}` })} onPreview={() => rendererRef.current?.previewClip(el.id, el.anim.enter!)} />
                ) : (
                  <button className="flex items-center gap-1 text-xs text-ink-300 hover:text-ink-100" onClick={() => update((s) => void (s.elements.find((x) => x.id === el.id)!.anim.enter = buildClip('fadeIn')))}>
                    <Plus className="h-3 w-3" /> Add enter animation
                  </button>
                )}
              </Section>
              <Section title={`Exit — ${el.name}`}>
                {el.anim.exit ? (
                  <ClipEditor clip={el.anim.exit} onChange={(c) => update((s) => void (s.elements.find((x) => x.id === el.id)!.anim.exit = c), { coalesce: `exit:${el.id}` })} onPreview={() => rendererRef.current?.previewClip(el.id, el.anim.exit!)} />
                ) : (
                  <button className="flex items-center gap-1 text-xs text-ink-300 hover:text-ink-100" onClick={() => update((s) => void (s.elements.find((x) => x.id === el.id)!.anim.exit = buildClip('fadeOut')))}>
                    <Plus className="h-3 w-3" /> Add exit animation
                  </button>
                )}
              </Section>
              <Section title="When the value changes">
                <p className="text-[11px] text-ink-500">Set the change style (roll, flip, slide…) in the Studio inspector → Animation. Use Simulate above to preview it.</p>
                <Link to={`/projects/${id}/studio`} className="text-xs text-accent hover:underline" onClick={() => st.select([el.id])}>
                  Open in Studio →
                </Link>
              </Section>
            </>
          )}
        </aside>
      </div>
      <GeneratorDialog open={genOpen} onClose={() => setGenOpen(false)} scene={scene} apply={(s) => update((cur) => Object.assign(cur, s))} />
    </div>
  );
}
