import { useMemo, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { buildClip, createId, PRESETS, PRESET_MAP, TRACK_ALIASES, trackTargetLabel, type EventTimeline, type Scene, type TimelineTrack } from '@bf/shared';
import { NumberField } from '../../components/ui';

const FAMILY_COLORS: Record<string, string> = {
  Slide: 'bg-sky-600',
  Roll: 'bg-indigo-500',
  Scale: 'bg-violet-500',
  Fade: 'bg-slate-500',
  Wipe: 'bg-teal-600',
  Flip: 'bg-fuchsia-600',
  Glow: 'bg-amber-500',
  Expand: 'bg-emerald-600',
  Pulse: 'bg-pink-500',
  Flash: 'bg-yellow-500',
  Sweep: 'bg-cyan-500',
};

export function timelineDuration(tl: EventTimeline): number {
  return tl.tracks.reduce((m, t) => Math.max(m, t.startMs + t.clip.durationMs), 0);
}

/**
 * Track view for one event timeline. Rows are targets (elements or
 * team-relative aliases); bars are clips. Drag a bar to move it, drag its
 * right edge to change duration (10 ms snapping; hold Shift for free).
 */
export function TimelineEditor({
  scene,
  timeline,
  selected,
  onSelect,
  onChange,
  playheadMs,
  compact,
}: {
  scene: Scene;
  timeline: EventTimeline;
  selected: string[];
  onSelect: (ids: string[]) => void;
  onChange: (mutate: (tl: EventTimeline) => void, coalesce?: string) => void;
  playheadMs: number | null;
  compact?: boolean;
}) {
  const [pxPerMs, setPxPerMs] = useState(0.16);
  const [newTarget, setNewTarget] = useState('');
  const [newPreset, setNewPreset] = useState('fadeIn');
  const [stagger, setStagger] = useState(60);
  const drag = useRef<{ id: string; mode: 'move' | 'resize'; x0: number; start0: number; dur0: number; others: { id: string; start0: number }[] } | null>(null);

  const total = Math.max(2000, timelineDuration(timeline) + 600);
  const width = total * pxPerMs;
  const rows = useMemo(() => {
    const m = new Map<string, TimelineTrack[]>();
    for (const t of timeline.tracks) m.set(t.elementId, [...(m.get(t.elementId) ?? []), t]);
    return [...m.entries()];
  }, [timeline]);
  const rowH = compact ? 24 : 30;
  const step = total > 8000 ? 1000 : total > 3000 ? 500 : 250;

  const onPointerDown = (e: React.PointerEvent, t: TimelineTrack, mode: 'move' | 'resize') => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    const sel = e.shiftKey || e.metaKey || e.ctrlKey ? (selected.includes(t.id) ? selected : [...selected, t.id]) : selected.includes(t.id) ? selected : [t.id];
    onSelect(sel);
    drag.current = {
      id: t.id,
      mode,
      x0: e.clientX,
      start0: t.startMs,
      dur0: t.clip.durationMs,
      others: mode === 'move' ? timeline.tracks.filter((x) => sel.includes(x.id) && x.id !== t.id).map((x) => ({ id: x.id, start0: x.startMs })) : [],
    };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const raw = (e.clientX - d.x0) / pxPerMs;
    const snap = (v: number) => (e.shiftKey ? Math.round(v) : Math.round(v / 10) * 10);
    onChange((tl) => {
      const tr = tl.tracks.find((x) => x.id === d.id);
      if (!tr) return;
      if (d.mode === 'move') {
        const delta = snap(d.start0 + raw) - d.start0;
        const minStart = Math.min(d.start0, ...d.others.map((o) => o.start0));
        const clamped = Math.max(delta, -minStart);
        tr.startMs = d.start0 + clamped;
        for (const o of d.others) {
          const x = tl.tracks.find((y) => y.id === o.id);
          if (x) x.startMs = o.start0 + clamped;
        }
      } else {
        tr.clip.durationMs = Math.max(20, snap(d.dur0 + raw));
      }
    }, `drag:${d.id}`);
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const addTrack = () => {
    const target = newTarget || TRACK_ALIASES[0]!.id;
    const t: TimelineTrack = { id: createId('tr'), elementId: target, startMs: Math.round(playheadMs ?? 0), clip: buildClip(newPreset) };
    onChange((tl) => void tl.tracks.push(t));
    onSelect([t.id]);
  };

  const applyStagger = () => {
    const ids = timeline.tracks.filter((t) => selected.includes(t.id)).sort((a, b) => a.startMs - b.startMs);
    if (ids.length < 2) return;
    const base = ids[0]!.startMs;
    onChange((tl) => ids.forEach((t, i) => void (tl.tracks.find((x) => x.id === t.id)!.startMs = base + i * stagger)));
  };

  const targetOptions = [
    ...TRACK_ALIASES.map((a) => ({ value: a.id, label: `⚡ ${a.label}` })),
    ...scene.elements.filter((e) => e.visible).map((e) => ({ value: e.id, label: `${'  '.repeat(e.parentId ? 1 : 0)}${e.name}${e.restHidden ? ' (FX)' : ''}` })),
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col text-xs">
      <div className="flex flex-wrap items-center gap-2 border-b border-ink-800 px-2 py-1.5">
        <select className="field-sm w-48" value={newTarget} onChange={(e) => setNewTarget(e.target.value)} aria-label="Track target">
          <option value="">Choose target…</option>
          {targetOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select className="field-sm w-36" value={newPreset} onChange={(e) => setNewPreset(e.target.value)} aria-label="Preset for new track">
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button className="flex items-center gap-1 rounded bg-ink-700 px-2 py-1 hover:bg-ink-600" onClick={addTrack}>
          <Plus className="h-3 w-3" /> Track
        </button>
        <span className="mx-1 h-4 w-px bg-ink-700" />
        <span className="text-ink-400">Stagger</span>
        <div className="w-16">
          <NumberField value={stagger} min={0} max={2000} step={10} suffix="ms" onChange={setStagger} />
        </div>
        <button className="rounded bg-ink-700 px-2 py-1 hover:bg-ink-600 disabled:opacity-30" onClick={applyStagger} disabled={selected.length < 2} title="Space the selected tracks evenly from the first one">
          Apply to selected
        </button>
        <button className="flex items-center gap-1 rounded px-2 py-1 text-red-300 hover:bg-live/20 disabled:opacity-30" disabled={!selected.length} onClick={() => onChange((tl) => void (tl.tracks = tl.tracks.filter((t) => !selected.includes(t.id))))}>
          <Trash2 className="h-3 w-3" /> Delete
        </button>
        <div className="flex-1" />
        <span className="text-ink-500">{(timelineDuration(timeline) / 1000).toFixed(2)} s</span>
        <input type="range" min={0.04} max={0.6} step={0.01} value={pxPerMs} onChange={(e) => setPxPerMs(Number(e.target.value))} title="Timeline zoom" className="w-20" />
      </div>
      <div className="flex min-h-0 flex-1 overflow-auto" onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerDown={() => onSelect([])}>
        <div className="sticky left-0 z-10 w-44 shrink-0 border-r border-ink-800 bg-ink-900">
          <div className="h-6 border-b border-ink-800" />
          {rows.map(([target]) => (
            <div key={target} className="flex items-center truncate border-b border-ink-850 px-2 text-ink-300" style={{ height: rowH }} title={target}>
              <span className="truncate">{trackTargetLabel(scene, target)}</span>
            </div>
          ))}
          {!rows.length && <div className="p-3 text-ink-500">No tracks. Add one above, or Generate animations.</div>}
        </div>
        <div className="relative" style={{ width, minWidth: '100%' }}>
          <div className="sticky top-0 z-[5] h-6 border-b border-ink-800 bg-ink-900">
            {Array.from({ length: Math.ceil(total / step) + 1 }).map((_, i) => (
              <div key={i} className="absolute top-0 h-full border-l border-ink-700 pl-1 text-[10px] text-ink-500" style={{ left: i * step * pxPerMs }}>
                {((i * step) / 1000).toFixed(step < 1000 ? 2 : 0)}s
              </div>
            ))}
          </div>
          {rows.map(([target, tracks]) => (
            <div key={target} className="relative border-b border-ink-850" style={{ height: rowH }}>
              {tracks.map((t) => {
                const def = PRESET_MAP[t.clip.preset];
                const sel = selected.includes(t.id);
                return (
                  <div
                    key={t.id}
                    className={`absolute top-1 flex cursor-grab items-center overflow-hidden rounded text-[10px] font-semibold text-white active:cursor-grabbing ${FAMILY_COLORS[def?.family ?? ''] ?? 'bg-ink-500'} ${sel ? 'ring-2 ring-white' : 'opacity-85'}`}
                    style={{ left: t.startMs * pxPerMs, width: Math.max(6, t.clip.durationMs * pxPerMs), height: rowH - 8 }}
                    onPointerDown={(e) => onPointerDown(e, t, 'move')}
                    title={`${def?.name ?? 'Custom'} · start ${t.startMs} ms · ${t.clip.durationMs} ms`}
                  >
                    <span className="truncate px-1">{def?.name ?? 'Custom'}</span>
                    {sel &&
                      t.clip.keyframes.map((k, i) => (
                        <span key={i} className="absolute top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-white" style={{ left: `${k.offset * 100}%` }} />
                      ))}
                    <span className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize bg-white/30" onPointerDown={(e) => onPointerDown(e, t, 'resize')} />
                  </div>
                );
              })}
            </div>
          ))}
          {playheadMs !== null && <div className="pointer-events-none absolute bottom-0 top-0 z-20 w-px bg-live" style={{ left: playheadMs * pxPerMs }} />}
        </div>
      </div>
    </div>
  );
}
