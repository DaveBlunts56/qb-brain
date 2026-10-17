import type { AnimationClip, Keyframe, ParamValue } from './types.js';

export type Direction = 'left' | 'right' | 'up' | 'down';

export interface PresetParamDef {
  key: string;
  label: string;
  type: 'number' | 'select' | 'color';
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
  default: ParamValue;
}

export interface PresetDef {
  id: string;
  name: string;
  family: 'Slide' | 'Roll' | 'Scale' | 'Fade' | 'Wipe' | 'Flip' | 'Glow' | 'Expand' | 'Pulse' | 'Flash' | 'Sweep';
  kind: 'in' | 'out' | 'emphasis';
  description: string;
  params: PresetParamDef[];
  durationMs: number;
  easing: string;
  build: (p: Record<string, ParamValue>) => Keyframe[];
  origin?: (p: Record<string, ParamValue>) => string;
  glowColor?: (p: Record<string, ParamValue>) => string;
}

const dirParam = (label: string, def: Direction): PresetParamDef => ({
  key: 'direction',
  label,
  type: 'select',
  options: ['left', 'right', 'up', 'down'],
  default: def,
});
const distParam = (def: number): PresetParamDef => ({ key: 'distance', label: 'Distance (px)', type: 'number', min: 0, max: 2000, step: 5, default: def });
const num = (p: Record<string, ParamValue>, k: string, d: number) => (typeof p[k] === 'number' ? (p[k] as number) : d);
const str = (p: Record<string, ParamValue>, k: string, d: string) => (typeof p[k] === 'string' ? (p[k] as string) : d);

function vector(dir: string, d: number): { x: number; y: number } {
  switch (dir) {
    case 'left':
      return { x: -d, y: 0 };
    case 'right':
      return { x: d, y: 0 };
    case 'up':
      return { x: 0, y: -d };
    default:
      return { x: 0, y: d };
  }
}

/** Clip insets that fully hide content, revealing *from* the given side. */
function hiddenClip(from: string): Partial<Keyframe> {
  switch (from) {
    case 'left':
      return { clipRight: 100 };
    case 'right':
      return { clipLeft: 100 };
    case 'up':
      return { clipBottom: 100 };
    default:
      return { clipTop: 100 };
  }
}

const opposite: Record<string, Direction> = { left: 'right', right: 'left', up: 'down', down: 'up' };

const originFor = (from: string) =>
  from === 'left' ? 'left center' : from === 'right' ? 'right center' : from === 'up' ? 'center top' : from === 'down' ? 'center bottom' : 'center center';

export const PRESETS: PresetDef[] = [
  {
    id: 'fadeIn',
    name: 'Fade in',
    family: 'Fade',
    kind: 'in',
    description: 'Opacity 0 → 1.',
    params: [],
    durationMs: 300,
    easing: 'easeOut',
    build: () => [{ offset: 0, opacity: 0 }, { offset: 1, opacity: 1 }],
  },
  {
    id: 'fadeOut',
    name: 'Fade out',
    family: 'Fade',
    kind: 'out',
    description: 'Opacity 1 → 0.',
    params: [],
    durationMs: 250,
    easing: 'easeIn',
    build: () => [{ offset: 0, opacity: 1 }, { offset: 1, opacity: 0 }],
  },
  {
    id: 'slideIn',
    name: 'Slide in',
    family: 'Slide',
    kind: 'in',
    description: 'Slides in from a side while fading in.',
    params: [dirParam('From', 'down'), distParam(40)],
    durationMs: 450,
    easing: 'easeOutCubic',
    build: (p) => {
      const v = vector(str(p, 'direction', 'down'), num(p, 'distance', 40));
      return [
        { offset: 0, opacity: 0, x: v.x, y: v.y },
        { offset: 0.6, opacity: 1 },
        { offset: 1, opacity: 1, x: 0, y: 0 },
      ];
    },
  },
  {
    id: 'slideOut',
    name: 'Slide out',
    family: 'Slide',
    kind: 'out',
    description: 'Slides out towards a side while fading out.',
    params: [dirParam('Towards', 'down'), distParam(40)],
    durationMs: 300,
    easing: 'easeInCubic',
    build: (p) => {
      const v = vector(str(p, 'direction', 'down'), num(p, 'distance', 40));
      return [
        { offset: 0, opacity: 1, x: 0, y: 0 },
        { offset: 0.4, opacity: 1 },
        { offset: 1, opacity: 0, x: v.x, y: v.y },
      ];
    },
  },
  {
    id: 'rollIn',
    name: 'Roll in',
    family: 'Roll',
    kind: 'in',
    description: 'Rolls in like a drum around the horizontal axis.',
    params: [{ key: 'direction', label: 'From', type: 'select', options: ['up', 'down'], default: 'down' }, distParam(20)],
    durationMs: 450,
    easing: 'easeOutCubic',
    build: (p) => {
      const down = str(p, 'direction', 'down') === 'down';
      const d = num(p, 'distance', 20);
      return [
        { offset: 0, opacity: 0, y: down ? d : -d, rotateX: down ? -80 : 80 },
        { offset: 1, opacity: 1, y: 0, rotateX: 0 },
      ];
    },
  },
  {
    id: 'rollOut',
    name: 'Roll out',
    family: 'Roll',
    kind: 'out',
    description: 'Rolls away around the horizontal axis.',
    params: [{ key: 'direction', label: 'Towards', type: 'select', options: ['up', 'down'], default: 'up' }, distParam(20)],
    durationMs: 350,
    easing: 'easeInCubic',
    build: (p) => {
      const up = str(p, 'direction', 'up') === 'up';
      const d = num(p, 'distance', 20);
      return [
        { offset: 0, opacity: 1, y: 0, rotateX: 0 },
        { offset: 1, opacity: 0, y: up ? -d : d, rotateX: up ? 80 : -80 },
      ];
    },
  },
  {
    id: 'scaleIn',
    name: 'Scale in',
    family: 'Scale',
    kind: 'in',
    description: 'Grows from a smaller size.',
    params: [{ key: 'from', label: 'Start scale', type: 'number', min: 0, max: 3, step: 0.05, default: 0.4 }],
    durationMs: 400,
    easing: 'backOut',
    build: (p) => [
      { offset: 0, opacity: 0, scale: num(p, 'from', 0.4) },
      { offset: 0.5, opacity: 1 },
      { offset: 1, opacity: 1, scale: 1 },
    ],
  },
  {
    id: 'scaleOut',
    name: 'Scale out',
    family: 'Scale',
    kind: 'out',
    description: 'Shrinks away.',
    params: [{ key: 'to', label: 'End scale', type: 'number', min: 0, max: 3, step: 0.05, default: 0.5 }],
    durationMs: 250,
    easing: 'easeInCubic',
    build: (p) => [
      { offset: 0, opacity: 1, scale: 1 },
      { offset: 1, opacity: 0, scale: num(p, 'to', 0.5) },
    ],
  },
  {
    id: 'wipeIn',
    name: 'Wipe in',
    family: 'Wipe',
    kind: 'in',
    description: 'Reveals with a hard-edged wipe.',
    params: [dirParam('From', 'left')],
    durationMs: 400,
    easing: 'easeOutExpo',
    build: (p) => [
      { offset: 0, ...hiddenClip(str(p, 'direction', 'left')) },
      { offset: 1, clipTop: 0, clipRight: 0, clipBottom: 0, clipLeft: 0 },
    ],
  },
  {
    id: 'wipeOut',
    name: 'Wipe out',
    family: 'Wipe',
    kind: 'out',
    description: 'Hides with a hard-edged wipe.',
    params: [dirParam('Towards', 'right')],
    durationMs: 300,
    easing: 'easeInCubic',
    build: (p) => [
      { offset: 0, clipTop: 0, clipRight: 0, clipBottom: 0, clipLeft: 0 },
      // Wiping out towards the right means the content disappears from the left edge.
      { offset: 1, ...hiddenClip(opposite[str(p, 'direction', 'right')] ?? 'left') },
    ],
  },
  {
    id: 'flipIn',
    name: 'Flip in',
    family: 'Flip',
    kind: 'in',
    description: 'Flips into view in 3D.',
    params: [{ key: 'axis', label: 'Axis', type: 'select', options: ['x', 'y'], default: 'x' }],
    durationMs: 450,
    easing: 'easeOutCubic',
    build: (p) => {
      const k = str(p, 'axis', 'x') === 'x' ? 'rotateX' : 'rotateY';
      return [
        { offset: 0, opacity: 0, [k]: -90 },
        { offset: 0.3, opacity: 1 },
        { offset: 1, opacity: 1, [k]: 0 },
      ];
    },
  },
  {
    id: 'flipOut',
    name: 'Flip out',
    family: 'Flip',
    kind: 'out',
    description: 'Flips out of view in 3D.',
    params: [{ key: 'axis', label: 'Axis', type: 'select', options: ['x', 'y'], default: 'x' }],
    durationMs: 350,
    easing: 'easeInCubic',
    build: (p) => {
      const k = str(p, 'axis', 'x') === 'x' ? 'rotateX' : 'rotateY';
      return [
        { offset: 0, opacity: 1, [k]: 0 },
        { offset: 0.7, opacity: 1 },
        { offset: 1, opacity: 0, [k]: 90 },
      ];
    },
  },
  {
    id: 'expandIn',
    name: 'Expand',
    family: 'Expand',
    kind: 'in',
    description: 'Panel grows out from an edge or the centre.',
    params: [
      { key: 'axis', label: 'Axis', type: 'select', options: ['x', 'y'], default: 'x' },
      { key: 'from', label: 'From', type: 'select', options: ['center', 'left', 'right', 'up', 'down'], default: 'center' },
    ],
    durationMs: 450,
    easing: 'easeOutExpo',
    build: (p) => {
      const k = str(p, 'axis', 'x') === 'x' ? 'scaleX' : 'scaleY';
      return [
        { offset: 0, [k]: 0, opacity: 1 },
        { offset: 1, [k]: 1, opacity: 1 },
      ];
    },
    origin: (p) => originFor(str(p, 'from', 'center')),
  },
  {
    id: 'collapseOut',
    name: 'Collapse',
    family: 'Expand',
    kind: 'out',
    description: 'Panel shrinks into an edge or the centre.',
    params: [
      { key: 'axis', label: 'Axis', type: 'select', options: ['x', 'y'], default: 'x' },
      { key: 'to', label: 'Towards', type: 'select', options: ['center', 'left', 'right', 'up', 'down'], default: 'center' },
    ],
    durationMs: 300,
    easing: 'easeInCubic',
    build: (p) => {
      const k = str(p, 'axis', 'x') === 'x' ? 'scaleX' : 'scaleY';
      return [
        { offset: 0, [k]: 1 },
        { offset: 1, [k]: 0 },
      ];
    },
    origin: (p) => originFor(str(p, 'to', 'center')),
  },
  {
    id: 'glow',
    name: 'Glow',
    family: 'Glow',
    kind: 'emphasis',
    description: 'Brief coloured glow and brightness lift.',
    params: [
      { key: 'size', label: 'Glow size (px)', type: 'number', min: 0, max: 80, step: 1, default: 18 },
      { key: 'color', label: 'Glow colour', type: 'color', default: '#ffffff' },
    ],
    durationMs: 700,
    easing: 'easeInOut',
    build: (p) => [
      { offset: 0, glow: 0, brightness: 1 },
      { offset: 0.35, glow: num(p, 'size', 18), brightness: 1.35 },
      { offset: 1, glow: 0, brightness: 1 },
    ],
    glowColor: (p) => str(p, 'color', '#ffffff'),
  },
  {
    id: 'pulse',
    name: 'Pulse',
    family: 'Pulse',
    kind: 'emphasis',
    description: 'Quick scale pulse.',
    params: [{ key: 'scale', label: 'Peak scale', type: 'number', min: 0.5, max: 3, step: 0.05, default: 1.25 }],
    durationMs: 450,
    easing: 'easeInOut',
    build: (p) => [
      { offset: 0, scale: 1 },
      { offset: 0.4, scale: num(p, 'scale', 1.25) },
      { offset: 1, scale: 1 },
    ],
  },
  {
    id: 'flash',
    name: 'Flash',
    family: 'Flash',
    kind: 'emphasis',
    description: 'Brightness flash (accent on team panels).',
    params: [{ key: 'intensity', label: 'Peak brightness', type: 'number', min: 1, max: 4, step: 0.1, default: 1.8 }],
    durationMs: 500,
    easing: 'easeOut',
    build: (p) => [
      { offset: 0, brightness: 1 },
      { offset: 0.2, brightness: num(p, 'intensity', 1.8) },
      { offset: 1, brightness: 1 },
    ],
  },
  {
    id: 'sweep',
    name: 'Light sweep',
    family: 'Sweep',
    kind: 'emphasis',
    description: 'Moves a highlight across (use on a gradient shine element).',
    params: [distParam(200)],
    durationMs: 700,
    easing: 'easeInOut',
    build: (p) => {
      const d = num(p, 'distance', 200);
      return [
        { offset: 0, x: -d, opacity: 0 },
        { offset: 0.25, opacity: 1 },
        { offset: 0.75, opacity: 1 },
        { offset: 1, x: d, opacity: 0 },
      ];
    },
  },
];

export const PRESET_MAP: Record<string, PresetDef> = Object.fromEntries(PRESETS.map((p) => [p.id, p]));

export function presetDefaults(def: PresetDef): Record<string, ParamValue> {
  return Object.fromEntries(def.params.map((p) => [p.key, p.default]));
}

/** Build a clip from a preset, with optional parameter and timing overrides. */
export function buildClip(
  presetId: string,
  params: Record<string, ParamValue> = {},
  overrides: Partial<Pick<AnimationClip, 'durationMs' | 'easing' | 'origin'>> = {},
): AnimationClip {
  const def = PRESET_MAP[presetId];
  if (!def) throw new Error(`Unknown animation preset "${presetId}"`);
  const p = { ...presetDefaults(def), ...params };
  return {
    preset: presetId,
    params: p,
    keyframes: def.build(p),
    durationMs: overrides.durationMs ?? def.durationMs,
    easing: overrides.easing ?? def.easing,
    origin: overrides.origin ?? def.origin?.(p),
    glowColor: def.glowColor?.(p),
  };
}

/** Rebuild keyframes after params change (no-op for custom clips). */
export function rebuildClip(clip: AnimationClip): AnimationClip {
  const def = PRESET_MAP[clip.preset];
  if (!def) return clip;
  const p = { ...presetDefaults(def), ...clip.params };
  return { ...clip, params: p, keyframes: def.build(p), origin: def.origin?.(p) ?? clip.origin, glowColor: def.glowColor?.(p) ?? clip.glowColor };
}
