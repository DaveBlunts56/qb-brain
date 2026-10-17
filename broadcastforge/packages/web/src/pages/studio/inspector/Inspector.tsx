import { AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignStartHorizontal, AlignStartVertical, Link2, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { Link } from 'react-router';
import {
  BUNDLED_FONTS,
  EASINGS,
  FIELD_DEFS,
  PRESETS,
  ROLE_DEFS,
  ROLE_MAP,
  boundsOf,
  buildClip,
  removeElements,
  rotatedBounds,
  type BindingTarget,
  type FieldBinding,
  type FieldRole,
  type GraphicElement,
  type Scene,
  type UpdateAnimation,
} from '@bf/shared';
import { assetUrl } from '../../../lib/api';
import { NumberField, Select, Toggle } from '../../../components/ui';
import { useEditor } from '../editorStore';
import { ColorField, PaintEditor, Row, Section, ShadowEditor, StrokeEditor } from './fields';

type Patch = (el: GraphicElement, scene: Scene) => void;

function usePatch() {
  const { update, selection } = useEditor();
  return (fn: Patch, coalesce?: string) =>
    update(
      (s) => {
        for (const id of selection) {
          const el = s.elements.find((e) => e.id === id);
          if (el) fn(el, s);
        }
      },
      coalesce ? { coalesce } : undefined,
    );
}

const TARGETS: { value: BindingTarget; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'image', label: 'Image' },
  { value: 'visible', label: 'Visibility' },
  { value: 'fill', label: 'Fill colour' },
  { value: 'color', label: 'Text colour' },
];

function BindingsEditor({ el }: { el: GraphicElement }) {
  const patch = usePatch();
  const set = (bindings: FieldBinding[]) => patch((e) => void (e.bindings = bindings));
  const groups = [...new Set(FIELD_DEFS.map((f) => f.group))];
  return (
    <div className="space-y-2">
      {el.bindings.map((b, i) => (
        <div key={i} className="space-y-1 rounded border border-ink-700 bg-ink-900 p-1.5">
          <div className="flex items-center gap-1">
            <select className="field-sm min-w-0 flex-1" value={b.field} onChange={(e) => set(el.bindings.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)))}>
              {groups.map((g) => (
                <optgroup key={g} label={g}>
                  {FIELD_DEFS.filter((f) => f.group === g).map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <button className="text-ink-500 hover:text-red-300" onClick={() => set(el.bindings.filter((_, j) => j !== i))} aria-label="Remove binding">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-ink-500">→</span>
            <Select value={b.target} onChange={(target) => set(el.bindings.map((x, j) => (j === i ? { ...x, target } : x)))} options={TARGETS} />
          </div>
          {b.target === 'text' && (
            <input className="field-sm" placeholder="Format, e.g. {value} PTS" value={b.format ?? ''} onChange={(e) => set(el.bindings.map((x, j) => (j === i ? { ...x, format: e.target.value || undefined } : x)))} />
          )}
          {b.target === 'visible' && (
            <div className="grid grid-cols-2 gap-1">
              <Select value={b.mode ?? 'hide'} onChange={(mode) => set(el.bindings.map((x, j) => (j === i ? { ...x, mode } : x)))} options={[{ value: 'hide', label: 'Hide when off' }, { value: 'dim', label: 'Dim when off' }]} />
              <NumberField label="≥" value={b.index ?? 0} min={0} max={9} onChange={(v) => set(el.bindings.map((x, j) => (j === i ? { ...x, index: v || undefined } : x)))} />
            </div>
          )}
        </div>
      ))}
      <button className="flex items-center gap-1 text-[11px] text-ink-400 hover:text-ink-100" onClick={() => set([...el.bindings, { field: 'home.score', target: 'text' }])}>
        <Plus className="h-3 w-3" /> Add binding
      </button>
    </div>
  );
}

function RoleSelect({ el }: { el: GraphicElement }) {
  const patch = usePatch();
  const scene = useEditor((s) => s.scene)!;
  const assign = (role: FieldRole | null) =>
    patch((e) => {
      e.role = role;
      if (role) {
        const def = ROLE_MAP[role];
        const index = def.repeatable && def.id.endsWith('Timeout') ? scene.elements.filter((x) => x.role === role && x.id !== e.id).length + 1 : undefined;
        e.bindings = def.bindings(index);
      } else e.bindings = [];
    });
  const cats = [...new Set(ROLE_DEFS.map((r) => r.category))];
  return (
    <select className="field-sm" value={el.role ?? ''} onChange={(e) => assign((e.target.value || null) as FieldRole | null)}>
      <option value="">— Static (not live) —</option>
      {cats.map((c) => (
        <optgroup key={c} label={c}>
          {ROLE_DEFS.filter((r) => r.category === c).map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function AnimationQuick({ el }: { el: GraphicElement }) {
  const patch = usePatch();
  const id = useEditor((s) => s.projectId);
  const u = el.anim.update;
  const setU = (p: Partial<UpdateAnimation> | null) =>
    patch((e) => {
      e.anim.update = p === null ? null : { style: 'fade', direction: 'up', durationMs: 400, easing: 'easeOutCubic', highlight: 'none', highlightColor: '#ffffff', highlightMs: 600, ...(e.anim.update ?? {}), ...p };
    });
  const inPresets = PRESETS.filter((p) => p.kind === 'in' || p.kind === 'emphasis');
  const outPresets = PRESETS.filter((p) => p.kind === 'out' || p.kind === 'emphasis');
  const hasVisibility = el.bindings.some((b) => b.target === 'visible');
  return (
    <div className="space-y-2">
      {(el.type === 'text' || el.type === 'image' || el.bindings.some((b) => b.target === 'fill')) && (
        <>
          <Row label="On change">
            <Select
              value={u?.style ?? 'none'}
              onChange={(style) => (style === 'none' ? setU(null) : setU({ style }))}
              options={[
                { value: 'none', label: 'Instant' },
                { value: 'roll', label: 'Roll' },
                { value: 'slide', label: 'Slide' },
                { value: 'flip', label: 'Flip' },
                { value: 'fade', label: 'Crossfade' },
                { value: 'scale', label: 'Scale' },
              ]}
            />
          </Row>
          {u && (
            <>
              <Row label="Direction">
                <Select value={u.direction} onChange={(direction) => setU({ direction })} options={['up', 'down', 'left', 'right'].map((d) => ({ value: d as UpdateAnimation['direction'], label: d }))} />
              </Row>
              <Row label="Duration">
                <NumberField value={u.durationMs} min={0} max={5000} step={50} suffix="ms" onChange={(durationMs) => setU({ durationMs })} />
              </Row>
              <Row label="Easing">
                <Select value={u.easing in EASINGS ? u.easing : 'easeOutCubic'} onChange={(easing) => setU({ easing })} options={Object.entries(EASINGS).map(([k, v]) => ({ value: k, label: v.label }))} />
              </Row>
              <Row label="Highlight">
                <Select value={u.highlight} onChange={(highlight) => setU({ highlight })} options={['none', 'pulse', 'flash', 'glow'].map((h) => ({ value: h as UpdateAnimation['highlight'], label: h }))} />
              </Row>
              {u.highlight === 'glow' && (
                <Row label="Glow colour">
                  <ColorField value={u.highlightColor} onChange={(highlightColor) => setU({ highlightColor })} />
                </Row>
              )}
            </>
          )}
        </>
      )}
      {hasVisibility && (
        <>
          <Row label="Enter">
            <select className="field-sm" value={el.anim.enter?.preset ?? ''} onChange={(e) => patch((x) => void (x.anim.enter = e.target.value ? buildClip(e.target.value) : null))}>
              <option value="">Instant</option>
              {inPresets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
              {el.anim.enter?.preset === 'custom' && <option value="custom">Custom</option>}
            </select>
          </Row>
          <Row label="Exit">
            <select className="field-sm" value={el.anim.exit?.preset ?? ''} onChange={(e) => patch((x) => void (x.anim.exit = e.target.value ? buildClip(e.target.value) : null))}>
              <option value="">Instant</option>
              {outPresets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
              {el.anim.exit?.preset === 'custom' && <option value="custom">Custom</option>}
            </select>
          </Row>
        </>
      )}
      <Link to={`/projects/${id}/animate?element=${el.id}`} className="flex items-center gap-1 text-[11px] text-accent hover:underline">
        <Sparkles className="h-3 w-3" /> Edit keyframes in the Animation Editor
      </Link>
    </div>
  );
}

function SceneSettings() {
  const { scene, update } = useEditor();
  if (!scene) return null;
  const st = scene.settings;
  return (
    <>
      <Section title="Canvas">
        <Row label="Size">
          <span className="text-xs text-ink-200">
            {scene.width} × {scene.height}
          </span>
        </Row>
        <Row label="Backdrop">
          <ColorField value={st.editorBackground} onChange={(c) => update((s) => void (s.settings.editorBackground = c), { coalesce: 'bg' })} />
        </Row>
        <p className="text-[11px] text-ink-500">The backdrop is only for editing; the overlay is always transparent.</p>
        <Toggle checked={st.safeZones} onChange={(v) => update((s) => void (s.settings.safeZones = v))} label="Safe-zone guides" />
        <Toggle checked={st.snap} onChange={(v) => update((s) => void (s.settings.snap = v))} label="Snap to guides & grid" />
        <Row label="Grid">
          <NumberField value={st.grid} min={1} max={200} suffix="px" onChange={(v) => update((s) => void (s.settings.grid = v))} />
        </Row>
      </Section>
      <Section title="Live elements">
        <ul className="space-y-0.5 text-xs">
          {scene.elements
            .filter((e) => e.role)
            .map((e) => (
              <li key={e.id} className="flex justify-between gap-2">
                <button className="truncate text-left text-ink-200 hover:text-accent" onClick={() => useEditor.getState().select([e.id])}>
                  {e.name}
                </button>
                <span className="shrink-0 text-ink-500">{ROLE_MAP[e.role!].label}</span>
              </li>
            ))}
        </ul>
        {!scene.elements.some((e) => e.role) && <p className="text-xs text-ink-500">None yet — open Make It Live.</p>}
      </Section>
    </>
  );
}

function AlignTools() {
  const { scene, selection, update } = useEditor();
  if (!scene || selection.length < 2) return null;
  const align = (mode: 'l' | 'c' | 'r' | 't' | 'm' | 'b') =>
    update((s) => {
      const els = s.elements.filter((e) => selection.includes(e.id));
      const b = boundsOf(els.map((e) => rotatedBounds(e)))!;
      for (const e of els) {
        const eb = rotatedBounds(e);
        let dx = 0;
        let dy = 0;
        if (mode === 'l') dx = b.x - eb.x;
        if (mode === 'c') dx = b.x + b.width / 2 - (eb.x + eb.width / 2);
        if (mode === 'r') dx = b.x + b.width - (eb.x + eb.width);
        if (mode === 't') dy = b.y - eb.y;
        if (mode === 'm') dy = b.y + b.height / 2 - (eb.y + eb.height / 2);
        if (mode === 'b') dy = b.y + b.height - (eb.y + eb.height);
        e.x += dx;
        e.y += dy;
      }
    });
  const btn = (m: 'l' | 'c' | 'r' | 't' | 'm' | 'b', Icon: typeof AlignStartVertical, title: string) => (
    <button className="rounded p-1.5 text-ink-300 hover:bg-ink-700 hover:text-ink-100" title={title} onClick={() => align(m)}>
      <Icon className="h-4 w-4" />
    </button>
  );
  return (
    <Section title={`${selection.length} selected`}>
      <div className="flex flex-wrap gap-0.5">
        {btn('l', AlignStartVertical, 'Align left')}
        {btn('c', AlignCenterVertical, 'Align centres horizontally')}
        {btn('r', AlignEndVertical, 'Align right')}
        {btn('t', AlignStartHorizontal, 'Align top')}
        {btn('m', AlignCenterHorizontal, 'Align middles')}
        {btn('b', AlignEndHorizontal, 'Align bottom')}
      </div>
    </Section>
  );
}

export function Inspector() {
  const { scene, selection, assets } = useEditor();
  const patch = usePatch();
  if (!scene) return null;
  const el = selection.length === 1 ? scene.elements.find((e) => e.id === selection[0]) : null;
  if (!selection.length) return <SceneSettings />;
  if (!el)
    return (
      <>
        <AlignTools />
        <Section title="Shared">
          <Row label="Opacity">
            <NumberField value={100} min={0} max={100} suffix="%" onChange={(v) => patch((e) => void (e.opacity = v / 100))} />
          </Row>
          <button className="flex items-center gap-1 text-xs text-red-300 hover:text-red-200" onClick={() => useEditor.getState().update((s) => removeElements(s, selection))}>
            <Trash2 className="h-3.5 w-3.5" /> Delete selected
          </button>
        </Section>
      </>
    );
  const parent = el.parentId ? scene.elements.find((e) => e.id === el.parentId) : null;
  const geo = (k: 'x' | 'y' | 'width' | 'height', v: number) =>
    useEditor.getState().update((s) => {
      const e = s.elements.find((x) => x.id === el.id)!;
      if (e.type === 'group' && (k === 'x' || k === 'y')) {
        const d = v - e[k];
        for (const c of s.elements) if (c.id === e.id || isDescendant(s, c, e.id)) c[k] += d;
      } else e[k] = Math.max(k === 'width' || k === 'height' ? 1 : -1e6, v);
    });

  return (
    <div className="pb-8">
      <Section title={el.type === 'group' ? 'Group' : el.type}>
        <input className="field-sm" value={el.name} onChange={(e) => patch((x) => void (x.name = e.target.value.slice(0, 120)), `name:${el.id}`)} aria-label="Name" />
        {parent && (
          <button className="text-[11px] text-ink-400 hover:text-accent" onClick={() => useEditor.getState().select([parent.id])}>
            ↑ Select parent group “{parent.name}”
          </button>
        )}
        {el.meta?.note && <p className="text-[11px] text-ink-400">{el.meta.note}</p>}
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <Toggle checked={el.visible} onChange={(v) => patch((x) => void (x.visible = v))} label="Visible" />
          <Toggle checked={el.locked} onChange={(v) => patch((x) => void (x.locked = v))} label="Locked" />
          <Toggle checked={el.restHidden} onChange={(v) => patch((x) => void (x.restHidden = v))} label="Only during animations" />
        </div>
      </Section>
      <Section title="Live data" right={el.role ? <Link2 className="h-3.5 w-3.5 text-accent" /> : undefined}>
        <Row label="Role">
          <RoleSelect el={el} />
        </Row>
        {el.role && <p className="text-[11px] text-ink-400">{ROLE_MAP[el.role].description}</p>}
        <BindingsEditor el={el} />
      </Section>
      <Section title="Position & size">
        <div className="grid grid-cols-2 gap-1">
          <NumberField label="X" value={el.x} onChange={(v) => geo('x', v)} />
          <NumberField label="Y" value={el.y} onChange={(v) => geo('y', v)} />
          <NumberField label="W" value={el.width} min={1} onChange={(v) => geo('width', v)} />
          <NumberField label="H" value={el.height} min={1} onChange={(v) => geo('height', v)} />
          <NumberField label="R" value={el.rotation} step={1} suffix="°" onChange={(v) => patch((x) => void (x.rotation = v))} />
          <NumberField label="K" value={el.skewX} min={-80} max={80} suffix="°" onChange={(v) => patch((x) => void (x.skewX = v))} />
        </div>
        <Row label="Opacity">
          <input type="range" min={0} max={100} value={Math.round(el.opacity * 100)} onChange={(e) => patch((x) => void (x.opacity = Number(e.target.value) / 100), `op:${el.id}`)} className="w-full accent-[var(--color-accent)]" />
        </Row>
        <Row label="Blend">
          <Select value={el.blendMode || 'normal'} onChange={(v) => patch((x) => void (x.blendMode = v))} options={['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'soft-light', 'hard-light', 'difference', 'plus-lighter'].map((b) => ({ value: b, label: b }))} />
        </Row>
      </Section>
      {el.type !== 'group' && el.type !== 'image' && (
        <Section title="Fill & stroke">
          <PaintEditor paint={el.fill} onChange={(p) => patch((x) => void (x.fill = p), `fill:${el.id}`)} />
          <StrokeEditor stroke={el.stroke} onChange={(s) => patch((x) => void (x.stroke = s), `stroke:${el.id}`)} />
          {(el.type === 'rect' || el.type === 'text') && (
            <Row label="Radius">
              <NumberField value={el.radius} min={0} max={1000} suffix="px" onChange={(v) => patch((x) => void (x.radius = v))} />
            </Row>
          )}
          <ShadowEditor shadow={el.shadow} onChange={(s) => patch((x) => void (x.shadow = s), `shadow:${el.id}`)} />
          {el.meta?.isMask && <p className="text-[11px] text-ink-400">Mask: covers baked-in artwork. Draw it slightly larger than the old text.</p>}
        </Section>
      )}
      {el.text && (
        <Section title="Text">
          <textarea className="field-sm min-h-[52px] font-mono" value={el.text.content} onChange={(e) => patch((x) => void (x.text!.content = e.target.value), `txt:${el.id}`)} aria-label="Text content" />
          {el.bindings.some((b) => b.target === 'text') && <p className="text-[11px] text-accent">Live: this text is replaced by {el.bindings.find((b) => b.target === 'text')!.field} on air.</p>}
          <Row label="Font">
            <select className="field-sm" value={el.text.fontFamily} onChange={(e) => patch((x) => void (x.text!.fontFamily = e.target.value))}>
              {[...BUNDLED_FONTS, ...scene.fonts.map((f) => f.family)].map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </Row>
          <div className="grid grid-cols-2 gap-1">
            <NumberField label="S" value={el.text.fontSize} min={1} max={1000} onChange={(v) => patch((x) => void (x.text!.fontSize = v))} />
            <Select value={String(el.text.fontWeight)} onChange={(v) => patch((x) => void (x.text!.fontWeight = Number(v)))} options={['300', '400', '500', '600', '700', '800', '900'].map((w) => ({ value: w, label: `Weight ${w}` }))} />
            <NumberField label="LS" value={el.text.letterSpacing} step={0.5} onChange={(v) => patch((x) => void (x.text!.letterSpacing = v))} />
            <NumberField label="LH" value={el.text.lineHeight} step={0.05} min={0.5} max={4} onChange={(v) => patch((x) => void (x.text!.lineHeight = v))} />
          </div>
          <Row label="Colour">
            <ColorField value={el.text.color} onChange={(c) => patch((x) => void (x.text!.color = c), `tc:${el.id}`)} />
          </Row>
          <div className="grid grid-cols-2 gap-1">
            <Select value={el.text.align} onChange={(v) => patch((x) => void (x.text!.align = v))} options={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centre' }, { value: 'right', label: 'Right' }]} />
            <Select value={el.text.verticalAlign} onChange={(v) => patch((x) => void (x.text!.verticalAlign = v))} options={[{ value: 'top', label: 'Top' }, { value: 'middle', label: 'Middle' }, { value: 'bottom', label: 'Bottom' }]} />
          </div>
          <Row label="Overflow">
            <Select value={el.text.fit} onChange={(v) => patch((x) => void (x.text!.fit = v))} options={[{ value: 'squeeze', label: 'Condense to fit' }, { value: 'shrink', label: 'Shrink to fit' }, { value: 'none', label: 'Wrap / overflow' }]} />
          </Row>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <Toggle checked={el.text.italic} onChange={(v) => patch((x) => void (x.text!.italic = v))} label="Italic" />
            <Toggle checked={el.text.uppercase} onChange={(v) => patch((x) => void (x.text!.uppercase = v))} label="Uppercase" />
            <Toggle checked={el.text.tabularNums} onChange={(v) => patch((x) => void (x.text!.tabularNums = v))} label="Fixed-width digits" />
          </div>
          <div className="text-[11px] text-ink-400">Text stroke</div>
          <StrokeEditor stroke={el.text.stroke} onChange={(s) => patch((x) => void (x.text!.stroke = s))} />
          <div className="text-[11px] text-ink-400">Text shadow</div>
          <ShadowEditor shadow={el.text.shadow} onChange={(s) => patch((x) => void (x.text!.shadow = s), `ts:${el.id}`)} />
        </Section>
      )}
      {el.image && (
        <Section title="Image">
          <Row label="Fit">
            <Select value={el.image.fit} onChange={(v) => patch((x) => void (x.image!.fit = v))} options={[{ value: 'contain', label: 'Contain' }, { value: 'cover', label: 'Cover' }, { value: 'fill', label: 'Stretch' }]} />
          </Row>
          <div className="grid grid-cols-4 gap-1">
            {assets
              .filter((a) => a.kind === 'image')
              .slice(0, 24)
              .map((a) => (
                <button key={a.id} className={`checker aspect-square overflow-hidden rounded border p-0.5 ${el.image!.assetId === a.id ? 'border-accent' : 'border-ink-700'}`} onClick={() => patch((x) => void (x.image!.assetId = a.id))} title={a.originalName}>
                  <img src={assetUrl(a.id)} alt="" className="h-full w-full object-contain" />
                </button>
              ))}
          </div>
          {el.bindings.some((b) => b.target === 'image') && <p className="text-[11px] text-accent">Live: the team logo replaces this image on air.</p>}
        </Section>
      )}
      <Section title="Animation" defaultOpen={Boolean(el.role)}>
        <AnimationQuick el={el} />
      </Section>
    </div>
  );
}

function isDescendant(scene: Scene, el: GraphicElement, ancestorId: string): boolean {
  let p = el.parentId;
  const seen = new Set<string>();
  while (p && !seen.has(p)) {
    if (p === ancestorId) return true;
    seen.add(p);
    p = scene.elements.find((e) => e.id === p)?.parentId ?? null;
  }
  return false;
}
