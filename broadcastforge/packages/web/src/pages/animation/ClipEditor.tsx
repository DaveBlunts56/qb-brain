import { useEffect, useState } from 'react';
import { Plus, Save, X } from 'lucide-react';
import {
  EASINGS,
  KEYFRAME_PROPS,
  PRESETS,
  PRESET_MAP,
  buildClip,
  easingBezier,
  evalBezier,
  rebuildClip,
  type AnimationClip,
  type Keyframe,
  type KeyframeProps,
} from '@bf/shared';
import { api, endpoints, type SavedPreset } from '../../lib/api';
import { NumberField } from '../../components/ui';
import { toast } from '../../components/toast';
import { ColorField, Row } from '../studio/inspector/fields';

export function EasingCurve({ easing, className = '' }: { easing: string; className?: string }) {
  const b = easingBezier(easing);
  const pts: string[] = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    const y = b ? evalBezier(b, t) : t;
    pts.push(`${4 + t * 92},${66 - y * 52}`);
  }
  return (
    <svg viewBox="0 0 100 80" className={`rounded bg-ink-900 ${className}`} aria-label={`Easing curve ${easing}`}>
      <line x1="4" y1="66" x2="96" y2="66" stroke="#313843" strokeWidth="1" />
      <line x1="4" y1="14" x2="96" y2="14" stroke="#313843" strokeWidth="1" strokeDasharray="2 2" />
      <polyline points={pts.join(' ')} fill="none" stroke="#f5b301" strokeWidth="2" />
    </svg>
  );
}

const PROP_LABELS: Record<keyof KeyframeProps, string> = {
  opacity: 'Opacity',
  x: 'Move X',
  y: 'Move Y',
  scale: 'Scale',
  scaleX: 'Scale X',
  scaleY: 'Scale Y',
  rotate: 'Rotate',
  rotateX: 'Rotate X (3D)',
  rotateY: 'Rotate Y (3D)',
  clipTop: 'Clip top %',
  clipRight: 'Clip right %',
  clipBottom: 'Clip bottom %',
  clipLeft: 'Clip left %',
  brightness: 'Brightness',
  glow: 'Glow px',
};

export function usePresets(): [SavedPreset[], () => void] {
  const [presets, setPresets] = useState<SavedPreset[]>([]);
  const load = () => {
    endpoints
      .presets()
      .then(setPresets)
      .catch(() => {});
  };
  useEffect(load, []);
  return [presets, load];
}

/** Edits one animation clip: preset & parameters, timing, easing and raw keyframes. */
export function ClipEditor({ clip, onChange, onPreview }: { clip: AnimationClip; onChange: (c: AnimationClip) => void; onPreview?: () => void }) {
  const [saved, reloadSaved] = usePresets();
  const def = PRESET_MAP[clip.preset];
  const usedProps = KEYFRAME_PROPS.filter((p) => clip.keyframes.some((k) => k[p] !== undefined));
  const [addProp, setAddProp] = useState<keyof KeyframeProps>('opacity');

  const setParam = (key: string, value: number | string) => onChange(rebuildClip({ ...clip, params: { ...clip.params, [key]: value } }));
  const setKeyframes = (keyframes: Keyframe[]) => onChange({ ...clip, preset: 'custom', keyframes: [...keyframes].sort((a, b) => a.offset - b.offset) });

  const savePreset = async () => {
    const name = prompt('Name this animation preset:', def ? `${def.name} (custom)` : 'My animation');
    if (!name?.trim()) return;
    try {
      await api.post('/api/presets', { name: name.trim(), clip });
      toast.success(`Saved preset "${name.trim()}"`);
      reloadSaved();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="space-y-2 text-xs">
      <Row label="Preset">
        <select
          className="field-sm"
          value={clip.preset.startsWith('saved:') ? clip.preset : clip.preset}
          onChange={(e) => {
            const v = e.target.value;
            if (v.startsWith('saved:')) {
              const p = saved.find((s) => `saved:${s.id}` === v);
              if (p) onChange({ ...p.clip, preset: 'custom' });
            } else if (v !== 'custom') onChange({ ...buildClip(v), durationMs: clip.durationMs });
          }}
        >
          {['in', 'out', 'emphasis'].map((kind) => (
            <optgroup key={kind} label={kind === 'in' ? 'Enter' : kind === 'out' ? 'Exit' : 'Emphasis'}>
              {PRESETS.filter((p) => p.kind === kind).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.family} · {p.name}
                </option>
              ))}
            </optgroup>
          ))}
          {saved.length > 0 && (
            <optgroup label="My presets">
              {saved.map((s) => (
                <option key={s.id} value={`saved:${s.id}`}>
                  ★ {s.name}
                </option>
              ))}
            </optgroup>
          )}
          <option value="custom">Custom keyframes</option>
        </select>
      </Row>
      {def?.params.map((p) => (
        <Row key={p.key} label={p.label}>
          {p.type === 'select' ? (
            <select className="field-sm" value={String(clip.params[p.key] ?? p.default)} onChange={(e) => setParam(p.key, e.target.value)}>
              {p.options!.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ) : p.type === 'color' ? (
            <ColorField value={String(clip.params[p.key] ?? p.default)} onChange={(v) => setParam(p.key, v)} />
          ) : (
            <NumberField value={Number(clip.params[p.key] ?? p.default)} min={p.min} max={p.max} step={p.step} onChange={(v) => setParam(p.key, v)} />
          )}
        </Row>
      ))}
      <Row label="Duration">
        <NumberField value={clip.durationMs} min={0} max={60000} step={50} suffix="ms" onChange={(durationMs) => onChange({ ...clip, durationMs })} />
      </Row>
      <Row label="Easing">
        <select className="field-sm" value={clip.easing in EASINGS ? clip.easing : '__custom'} onChange={(e) => e.target.value !== '__custom' && onChange({ ...clip, easing: e.target.value })}>
          {Object.entries(EASINGS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
          {!(clip.easing in EASINGS) && <option value="__custom">{clip.easing}</option>}
        </select>
      </Row>
      <div className="grid grid-cols-[72px_1fr] items-center gap-2">
        <EasingCurve easing={clip.easing} className="h-14 w-[72px]" />
        <input className="field-sm font-mono" placeholder="cubic-bezier(0.2, 0.8, 0.2, 1)" value={clip.easing in EASINGS ? '' : clip.easing} onChange={(e) => e.target.value && onChange({ ...clip, easing: e.target.value })} title="Custom cubic-bezier easing" />
      </div>
      <Row label="Origin">
        <select className="field-sm" value={clip.origin ?? 'center center'} onChange={(e) => onChange({ ...clip, origin: e.target.value })}>
          {['center center', 'left center', 'right center', 'center top', 'center bottom', 'left top', 'right bottom'].map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </Row>
      {clip.keyframes.some((k) => k.glow !== undefined) && (
        <Row label="Glow colour">
          <ColorField value={clip.glowColor ?? '#ffffff'} onChange={(glowColor) => onChange({ ...clip, glowColor })} />
        </Row>
      )}

      <div className="pt-1">
        <div className="mb-1 flex items-center justify-between">
          <span className="panel-title">Keyframes</span>
          <button className="flex items-center gap-1 text-[11px] text-ink-400 hover:text-ink-100" onClick={() => setKeyframes([...clip.keyframes, { offset: 0.5 }])}>
            <Plus className="h-3 w-3" /> Keyframe
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="text-ink-400">
                <th className="pr-1 text-left font-normal">at %</th>
                {usedProps.map((p) => (
                  <th key={p} className="px-0.5 text-left font-normal">
                    {PROP_LABELS[p]}
                    <button className="ml-0.5 text-ink-600 hover:text-red-300" onClick={() => setKeyframes(clip.keyframes.map(({ [p]: _drop, ...rest }) => rest as Keyframe))} aria-label={`Remove ${p}`}>
                      ×
                    </button>
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {clip.keyframes.map((k, i) => (
                <tr key={i}>
                  <td className="w-12 pr-1">
                    <NumberField value={Math.round(k.offset * 100)} min={0} max={100} onChange={(v) => setKeyframes(clip.keyframes.map((x, j) => (j === i ? { ...x, offset: v / 100 } : x)))} />
                  </td>
                  {usedProps.map((p) => (
                    <td key={p} className="w-14 px-0.5">
                      <input
                        className="field-sm px-1"
                        placeholder="–"
                        value={k[p] ?? ''}
                        onChange={(e) => {
                          const raw = e.target.value;
                          const v = raw === '' ? undefined : Number(raw);
                          if (raw !== '' && !Number.isFinite(v)) return;
                          setKeyframes(clip.keyframes.map((x, j) => (j === i ? { ...x, [p]: v } : x)));
                        }}
                      />
                    </td>
                  ))}
                  <td>
                    {clip.keyframes.length > 2 && (
                      <button className="text-ink-500 hover:text-red-300" onClick={() => setKeyframes(clip.keyframes.filter((_, j) => j !== i))} aria-label="Remove keyframe">
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-1 flex items-center gap-1">
          <select className="field-sm w-auto" value={addProp} onChange={(e) => setAddProp(e.target.value as keyof KeyframeProps)}>
            {KEYFRAME_PROPS.filter((p) => !usedProps.includes(p)).map((p) => (
              <option key={p} value={p}>
                {PROP_LABELS[p]}
              </option>
            ))}
          </select>
          <button
            className="rounded bg-ink-700 px-2 py-1 text-[11px] hover:bg-ink-600"
            onClick={() => {
              const first = clip.keyframes[0];
              if (!first) return;
              setKeyframes(clip.keyframes.map((k, i) => (i === 0 ? { ...k, [addProp]: addProp === 'opacity' || addProp.startsWith('scale') || addProp === 'brightness' ? 1 : 0 } : k)));
            }}
          >
            + Animate property
          </button>
        </div>
        {clip.preset === 'custom' && <p className="mt-1 text-[10px] text-ink-500">Editing keyframes turns this into a custom animation.</p>}
      </div>
      <div className="flex gap-1 pt-1">
        {onPreview && (
          <button className="flex-1 rounded bg-ink-700 py-1.5 font-semibold hover:bg-ink-600" onClick={onPreview}>
            ▶ Preview
          </button>
        )}
        <button className="flex items-center gap-1 rounded bg-ink-700 px-2 py-1.5 hover:bg-ink-600" onClick={savePreset} title="Save as a reusable preset">
          <Save className="h-3.5 w-3.5" /> Save preset
        </button>
      </div>
    </div>
  );
}
