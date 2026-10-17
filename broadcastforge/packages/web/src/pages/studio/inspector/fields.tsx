import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Plus, X } from 'lucide-react';
import { isColorToken, type ColorValue, type Paint, type Shadow, type Stroke } from '@bf/shared';
import { NumberField } from '../../../components/ui';

export function Section({ title, children, defaultOpen = true, right }: { title: string; children: ReactNode; defaultOpen?: boolean; right?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-ink-750">
      <div className="flex items-center px-3 py-2">
        <button className="flex flex-1 items-center gap-1 text-left" onClick={() => setOpen(!open)}>
          {open ? <ChevronDown className="h-3.5 w-3.5 text-ink-400" /> : <ChevronRight className="h-3.5 w-3.5 text-ink-400" />}
          <span className="panel-title">{title}</span>
        </button>
        {right}
      </div>
      {open && <div className="space-y-2 px-3 pb-3">{children}</div>}
    </div>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[72px_1fr] items-center gap-2">
      <span className="truncate text-[11px] text-ink-400">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export const COLOR_TOKENS: { value: string; label: string }[] = [
  { value: '$home.primary', label: 'Home primary' },
  { value: '$home.secondary', label: 'Home secondary' },
  { value: '$home.text', label: 'Home text' },
  { value: '$away.primary', label: 'Away primary' },
  { value: '$away.secondary', label: 'Away secondary' },
  { value: '$away.text', label: 'Away text' },
  { value: '$possession.primary', label: 'Team with the ball' },
  { value: '$event.primary', label: 'Graphic team primary' },
  { value: '$event.secondary', label: 'Graphic team secondary' },
  { value: '$event.text', label: 'Graphic team text' },
];

function toHex6(c: string): string {
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  if (/^#[0-9a-f]{3}$/i.test(c)) return `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`;
  if (/^#[0-9a-f]{8}$/i.test(c)) return c.slice(0, 7);
  const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(c);
  if (m) return `#${[m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('')}`;
  return '#000000';
}

/** Colour input that also accepts live team-colour tokens. */
export function ColorField({ value, onChange }: { value: ColorValue; onChange: (v: string) => void }) {
  const token = isColorToken(value);
  return (
    <div className="flex items-center gap-1">
      {!token && <input type="color" className="h-6 w-7 shrink-0 cursor-pointer rounded border border-ink-600 bg-transparent" value={toHex6(value)} onChange={(e) => onChange(e.target.value)} aria-label="Pick colour" />}
      <select
        className="field-sm min-w-0 flex-1"
        value={token ? value : '__custom'}
        onChange={(e) => onChange(e.target.value === '__custom' ? (token ? '#ffffff' : value) : e.target.value)}
        title="Use a fixed colour or a live team colour"
      >
        <option value="__custom">{token ? 'Fixed colour…' : value}</option>
        <optgroup label="Live team colours">
          {COLOR_TOKENS.map((t) => (
            <option key={t.value} value={t.value}>
              ⚡ {t.label}
            </option>
          ))}
        </optgroup>
      </select>
    </div>
  );
}

export function PaintEditor({ paint, onChange }: { paint: Paint; onChange: (p: Paint) => void }) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-1 text-[11px]">
        {(['none', 'solid', 'linear'] as const).map((t) => (
          <button
            key={t}
            className={`rounded py-1 ${paint.type === t ? 'bg-ink-500 text-white' : 'bg-ink-750 text-ink-300 hover:bg-ink-700'}`}
            onClick={() => {
              if (t === paint.type) return;
              if (t === 'none') onChange({ type: 'none' });
              if (t === 'solid') onChange({ type: 'solid', color: paint.type === 'linear' ? paint.stops[0]!.color : '#2a2f3a' });
              if (t === 'linear') onChange({ type: 'linear', angle: 180, stops: [{ offset: 0, color: paint.type === 'solid' ? paint.color : '#2a2f3a' }, { offset: 1, color: '#0d0f13' }] });
            }}
          >
            {t === 'none' ? 'None' : t === 'solid' ? 'Solid' : 'Gradient'}
          </button>
        ))}
      </div>
      {paint.type === 'solid' && <ColorField value={paint.color} onChange={(color) => onChange({ type: 'solid', color })} />}
      {paint.type === 'linear' && (
        <div className="space-y-1.5">
          <div className="h-4 rounded" style={{ background: `linear-gradient(90deg, ${paint.stops.map((s) => `${s.color.startsWith('$') ? '#777' : s.color} ${s.offset * 100}%`).join(', ')})` }} />
          <Row label="Angle">
            <NumberField value={paint.angle} step={15} min={0} max={360} suffix="°" onChange={(angle) => onChange({ ...paint, angle })} />
          </Row>
          {paint.stops.map((s, i) => (
            <div key={i} className="flex items-center gap-1">
              <div className="w-14 shrink-0">
                <NumberField value={Math.round(s.offset * 100)} min={0} max={100} suffix="%" onChange={(v) => onChange({ ...paint, stops: paint.stops.map((x, j) => (j === i ? { ...x, offset: v / 100 } : x)) })} />
              </div>
              <div className="min-w-0 flex-1">
                <ColorField value={s.color} onChange={(color) => onChange({ ...paint, stops: paint.stops.map((x, j) => (j === i ? { ...x, color } : x)) })} />
              </div>
              {paint.stops.length > 2 && (
                <button className="text-ink-500 hover:text-red-300" onClick={() => onChange({ ...paint, stops: paint.stops.filter((_, j) => j !== i) })} aria-label="Remove stop">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
          {paint.stops.length < 6 && (
            <button className="flex items-center gap-1 text-[11px] text-ink-400 hover:text-ink-100" onClick={() => onChange({ ...paint, stops: [...paint.stops, { offset: 0.5, color: '#ffffff' }].sort((a, b) => a.offset - b.offset) })}>
              <Plus className="h-3 w-3" /> Add stop
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function StrokeEditor({ stroke, onChange }: { stroke: Stroke | null; onChange: (s: Stroke | null) => void }) {
  if (!stroke)
    return (
      <button className="text-[11px] text-ink-400 hover:text-ink-100" onClick={() => onChange({ color: '#ffffff', width: 2 })}>
        + Add stroke
      </button>
    );
  return (
    <div className="flex items-center gap-1">
      <div className="w-16 shrink-0">
        <NumberField value={stroke.width} min={0} max={200} step={0.5} suffix="px" onChange={(width) => onChange({ ...stroke, width })} />
      </div>
      <div className="min-w-0 flex-1">
        <ColorField value={stroke.color} onChange={(color) => onChange({ ...stroke, color })} />
      </div>
      <button className="text-ink-500 hover:text-red-300" onClick={() => onChange(null)} aria-label="Remove stroke">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function ShadowEditor({ shadow, onChange }: { shadow: Shadow | null; onChange: (s: Shadow | null) => void }) {
  if (!shadow)
    return (
      <button className="text-[11px] text-ink-400 hover:text-ink-100" onClick={() => onChange({ x: 0, y: 4, blur: 12, color: 'rgba(0,0,0,0.5)' })}>
        + Add shadow
      </button>
    );
  return (
    <div className="space-y-1">
      <div className="grid grid-cols-3 gap-1">
        <NumberField label="X" value={shadow.x} onChange={(x) => onChange({ ...shadow, x })} />
        <NumberField label="Y" value={shadow.y} onChange={(y) => onChange({ ...shadow, y })} />
        <NumberField label="B" value={shadow.blur} min={0} onChange={(blur) => onChange({ ...shadow, blur })} />
      </div>
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1">
          <ColorField value={shadow.color} onChange={(color) => onChange({ ...shadow, color })} />
        </div>
        <button className="text-ink-500 hover:text-red-300" onClick={() => onChange(null)} aria-label="Remove shadow">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
