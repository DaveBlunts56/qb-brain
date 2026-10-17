import { useMemo, useState } from 'react';
import { CheckCircle2, Plus, ScanSearch, Sparkles, TriangleAlert, X, Zap } from 'lucide-react';
import {
  boundsOf,
  createElement,
  defaultTextProps,
  ROLE_DEFS,
  ROLE_MAP,
  rotatedBounds,
  type FieldRole,
  type GraphicElement,
  type Rect,
  type RoleDef,
  type Scene,
} from '@bf/shared';
import { Button, Toggle } from '../../components/ui';
import { toast } from '../../components/toast';
import { useEditor, type Candidate } from './editorStore';
import { detectRegions, sampleRegionFill } from './regionDetect';

/** Default look for a new live element created for a role. */
function elementForRole(role: RoleDef, area: Rect, scene: Scene): GraphicElement {
  // Only geometry: callers may pass richer objects (detection candidates carry ids and colours).
  const r = { x: Math.round(area.x), y: Math.round(area.y), width: Math.round(area.width), height: Math.round(area.height) };
  const name = role.label;
  const meta = { source: 'user' as const };
  const index = role.id.endsWith('Timeout') ? scene.elements.filter((e) => e.role === role.id).length + 1 : undefined;
  const base = { name: index ? `${name} ${index}` : name, ...r, role: role.id, bindings: role.bindings(index), meta };
  if (role.element === 'text') {
    const big = role.id.endsWith('Score') || role.id === 'gameClock';
    return createElement('text', {
      ...base,
      text: defaultTextProps({
        content: role.sample,
        fontSize: Math.max(8, Math.round(r.height * (big ? 0.85 : 0.7))),
        fontWeight: big ? 700 : 600,
        color: '#ffffff',
        shadow: { x: 0, y: 2, blur: 4, color: 'rgba(0,0,0,0.45)' },
      }),
    });
  }
  if (role.element === 'image') return createElement('image', { ...base, image: { assetId: null, fit: 'contain' } });
  if (role.id === 'flag') {
    return createElement('rect', { ...base, fill: { type: 'linear', angle: 180, stops: [{ offset: 0, color: '#ffd84a' }, { offset: 1, color: '#f2b705' }] } });
  }
  if (role.id.endsWith('Possession')) return createElement('polygon', { ...base, fill: { type: 'solid', color: '#ffffff' }, polygon: { points: [[0, 0], [r.width, r.height / 2], [0, r.height]] } });
  if (role.id.endsWith('Timeout')) return createElement('rect', { ...base, fill: { type: 'solid', color: '#ffd84a' }, radius: Math.min(3, r.height / 2) });
  return createElement('rect', { ...base, fill: { type: 'solid', color: '#3a3f4a' } });
}

function defaultRect(role: RoleDef, scene: Scene): Rect {
  const roots = scene.elements.filter((e) => e.parentId === null && e.visible && !e.restHidden && !e.meta?.component);
  const bug = boundsOf(roots.map((e) => rotatedBounds(e))) ?? { x: scene.width * 0.25, y: scene.height * 0.86, width: scene.width * 0.5, height: scene.height * 0.07 };
  const h = Math.max(20, bug.height);
  const sizes: Partial<Record<string, [number, number]>> = { text: [h * 1.6, h], image: [h * 0.85, h * 0.85], shape: [h * 1.2, h * 0.6] };
  let [w, hh] = sizes[role.element]!;
  if (role.id.endsWith('Timeout')) [w, hh] = [h * 0.4, h * 0.08];
  if (role.id.endsWith('Possession')) [w, hh] = [h * 0.25, h * 0.25];
  return { x: Math.round(bug.x + bug.width / 2 - w / 2), y: Math.round(bug.y - hh - 16), width: Math.round(w), height: Math.round(hh) };
}

export function MakeItLivePanel({ onGenerate }: { onGenerate: () => void }) {
  const { scene, selection, candidates, update, select, set } = useEditor();
  const [cover, setCover] = useState(true);
  const [detecting, setDetecting] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
  const [pending, setPending] = useState<Candidate | null>(null);
  const base = useMemo(() => scene?.elements.find((e) => e.meta?.isBaseArt && e.type === 'image'), [scene]);
  if (!scene) return null;

  const selected = selection.length === 1 ? scene.elements.find((e) => e.id === selection[0]) : null;
  const mappedFor = (role: FieldRole) => scene.elements.filter((e) => e.role === role);

  const detect = async () => {
    if (!base) return;
    setDetecting(true);
    try {
      const r = await detectRegions(base);
      set({ candidates: r.candidates });
      setNotes(r.notes);
      toast.info(`${r.candidates.length} possible live area(s) found. Assign or dismiss each one.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDetecting(false);
    }
  };

  /** Assign a role to an area: reuse a fitting element, otherwise create a live replacement (plus optional mask). */
  const assign = async (role: RoleDef, area: { rect: Rect; existing?: GraphicElement; candidate?: Candidate }) => {
    const ex = area.existing;
    const typeFits = ex && ((role.element === 'text' && ex.type === 'text') || (role.element === 'image' && ex.type === 'image' && !ex.meta?.isBaseArt) || (role.element === 'shape' && ['rect', 'ellipse', 'polygon', 'path', 'group'].includes(ex.type) && ex.fill.type !== 'none'));
    if (ex && typeFits) {
      const index = role.id.endsWith('Timeout') ? scene.elements.filter((e) => e.role === role.id && e.id !== ex.id).length + 1 : undefined;
      update((s) => {
        const e = s.elements.find((x) => x.id === ex.id)!;
        e.role = role.id;
        e.bindings = role.bindings(index);
      });
      toast.success(`${ex.name} → ${role.label}`);
      return;
    }
    // Create a live replacement over the area.
    const el = elementForRole(role, area.rect, scene);
    let mask: GraphicElement | null = null;
    const coverIt = cover && Boolean(base) && role.element !== 'shape';
    if (coverIt) {
      const fill = area.candidate ? { ...area.candidate.fill, complex: area.candidate.complexBackground } : await sampleRegionFill(scene, area.rect);
      if (fill.complex) toast.warn(`The artwork behind "${role.label}" is not a flat colour; the cover may be visible. Consider a replacement panel (draw a rectangle) or crop the artwork.`);
      const pad = 3;
      mask = createElement('rect', {
        name: `Cover · ${role.label}`,
        x: area.rect.x - pad,
        y: area.rect.y - pad,
        width: area.rect.width + pad * 2,
        height: area.rect.height + pad * 2,
        fill: fill.top === fill.bottom ? { type: 'solid', color: fill.top } : { type: 'linear', angle: 180, stops: [{ offset: 0, color: fill.top }, { offset: 1, color: fill.bottom }] },
        meta: { source: 'user', isMask: true, note: 'Covers the baked-in artwork under a live element. Colours sampled from the surrounding pixels.' },
      });
    }
    update((s) => {
      // A placeholder region is replaced by the live element.
      if (ex && ex.fill.type === 'none' && ex.type === 'rect' && !ex.role) s.elements = s.elements.filter((e) => e.id !== ex.id);
      if (mask) s.elements.push(mask);
      s.elements.push(el);
    });
    if (area.candidate) set({ candidates: useEditor.getState().candidates.filter((c) => c.id !== area.candidate!.id) });
    select([el.id]);
    toast.success(`Added live ${role.label}${mask ? ' with a cover over the old artwork' : ''}`);
  };

  const assignSelection = (role: RoleDef) => {
    if (!selected) {
      toast.info('Select an element or region on the canvas first (or use + to add a new one).');
      return;
    }
    void assign(role, { rect: { x: selected.x, y: selected.y, width: selected.width, height: selected.height }, existing: selected });
  };

  const addNew = (role: RoleDef) => {
    const r = defaultRect(role, scene);
    const el = elementForRole(role, r, scene);
    update((s) => void s.elements.push(el));
    select([el.id]);
  };

  const cats = [...new Set(ROLE_DEFS.map((r) => r.category))].filter((c) => c !== 'Graphics');
  const mappedCount = ROLE_DEFS.filter((r) => r.category !== 'Graphics' && mappedFor(r.id).length).length;
  const total = ROLE_DEFS.filter((r) => r.category !== 'Graphics').length;

  return (
    <div className="pb-10 text-sm">
      <div className="border-b border-ink-750 p-3">
        <div className="flex items-center gap-2 font-display text-lg font-semibold">
          <Zap className="h-4 w-4 text-accent" /> Make It Live
        </div>
        <p className="mt-1 text-xs text-ink-400">Tell BroadcastForge which parts of your design show live data. Select something on the canvas, then press a role’s “Use selection”. Missing parts can be added with +.</p>
        <div className="mt-2 h-1.5 overflow-hidden rounded bg-ink-700">
          <div className="h-full bg-accent" style={{ width: `${(mappedCount / total) * 100}%` }} />
        </div>
        <div className="mt-1 text-[11px] text-ink-400">
          {mappedCount} of {total} roles mapped (not every design needs all of them)
        </div>
      </div>

      <div className="border-b border-ink-750 p-3">
        <div className="panel-title mb-2">1 · Find live areas</div>
        {base ? (
          <>
            <Button size="sm" onClick={detect} disabled={detecting} className="w-full">
              <ScanSearch className="h-4 w-4" /> {detecting ? 'Analysing artwork…' : 'Detect regions in the artwork'}
            </Button>
            <Toggle checked={cover} onChange={setCover} label="Cover baked-in content with a sampled-colour mask" />
          </>
        ) : (
          <p className="text-xs text-ink-400">No flattened base artwork in this project — vector/PSD layers can be assigned directly.</p>
        )}
        <p className="mt-2 text-[11px] text-ink-500">Tip: draw areas yourself with the Region tool (R) or Polygon (P).</p>
        {notes.map((n) => (
          <p key={n} className="mt-1 flex gap-1 text-[11px] text-amber-200">
            <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" /> {n}
          </p>
        ))}
        {candidates.length > 0 && (
          <div className="mt-2 space-y-1">
            {candidates.map((c) => (
              <div key={c.id} className={`flex items-center gap-1 rounded border px-1.5 py-1 text-xs ${pending?.id === c.id ? 'border-accent' : 'border-ink-700'}`}>
                <span className="w-16 shrink-0 capitalize text-accent">{c.kind === 'largeText' ? 'big text' : c.kind}</span>
                <span className="text-ink-500">
                  {c.width}×{c.height}
                </span>
                {c.complexBackground && <TriangleAlert className="h-3 w-3 text-warn" aria-label="Complex background" />}
                <select
                  className="field-sm ml-auto w-28 py-0.5"
                  value=""
                  onFocus={() => setPending(c)}
                  onChange={(e) => {
                    const role = ROLE_MAP[e.target.value as FieldRole];
                    if (role) void assign(role, { rect: { x: c.x, y: c.y, width: c.width, height: c.height }, candidate: c });
                  }}
                >
                  <option value="">Assign…</option>
                  {ROLE_DEFS.filter((r) => r.category !== 'Graphics').map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <button className="text-ink-500 hover:text-ink-100" onClick={() => set({ candidates: candidates.filter((x) => x.id !== c.id) })} aria-label="Dismiss">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <button className="text-[11px] text-ink-400 hover:text-ink-100" onClick={() => set({ candidates: [] })}>
              Clear all suggestions
            </button>
          </div>
        )}
      </div>

      <div className="border-b border-ink-750 p-3">
        <div className="panel-title mb-1">2 · Assign roles</div>
        <div className="mb-2 rounded bg-ink-900 px-2 py-1 text-xs text-ink-300">Selection: {selected ? <b className="text-ink-100">{selected.name}</b> : selection.length > 1 ? `${selection.length} elements` : 'nothing'}</div>
        {cats.map((cat) => (
          <div key={cat} className="mb-2">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-500">{cat}</div>
            {ROLE_DEFS.filter((r) => r.category === cat).map((r) => {
              const mapped = mappedFor(r.id);
              return (
                <div key={r.id} className="group flex items-center gap-1.5 py-0.5">
                  {mapped.length ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-ok" /> : <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-ink-500" />}
                  <button className="min-w-0 flex-1 truncate text-left text-xs text-ink-200 hover:text-accent" title={r.description} onClick={() => mapped.length && select(mapped.map((m) => m.id))}>
                    {r.label}
                    {mapped.length > 1 && <span className="text-ink-500"> ×{mapped.length}</span>}
                  </button>
                  <button className="rounded px-1.5 py-0.5 text-[10px] text-ink-300 hover:bg-ink-700 hover:text-ink-100 disabled:opacity-30" onClick={() => assignSelection(r)} disabled={!selected}>
                    Use selection
                  </button>
                  <button className="rounded p-0.5 text-ink-400 hover:bg-ink-700 hover:text-ink-100" onClick={() => addNew(r)} title={`Add a new ${r.label}`}>
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="p-3">
        <div className="panel-title mb-2">3 · Animate</div>
        <Button variant="primary" className="w-full" onClick={onGenerate}>
          <Sparkles className="h-4 w-4" /> Generate animations
        </Button>
        <p className="mt-2 text-[11px] text-ink-500">Then press Publish to send the design to the live overlay.</p>
      </div>
    </div>
  );
}

