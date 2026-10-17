/** Animatable properties. Transforms are in px/deg; clip insets in percent. */
export interface KeyframeProps {
  opacity?: number;
  x?: number;
  y?: number;
  scale?: number;
  scaleX?: number;
  scaleY?: number;
  rotate?: number;
  rotateX?: number;
  rotateY?: number;
  clipTop?: number;
  clipRight?: number;
  clipBottom?: number;
  clipLeft?: number;
  brightness?: number;
  /** Glow radius in px (rendered as a drop-shadow filter in `glowColor`). */
  glow?: number;
}

export const KEYFRAME_PROPS: (keyof KeyframeProps)[] = [
  'opacity',
  'x',
  'y',
  'scale',
  'scaleX',
  'scaleY',
  'rotate',
  'rotateX',
  'rotateY',
  'clipTop',
  'clipRight',
  'clipBottom',
  'clipLeft',
  'brightness',
  'glow',
];

export const KEYFRAME_DEFAULTS: Required<KeyframeProps> = {
  opacity: 1,
  x: 0,
  y: 0,
  scale: 1,
  scaleX: 1,
  scaleY: 1,
  rotate: 0,
  rotateX: 0,
  rotateY: 0,
  clipTop: 0,
  clipRight: 0,
  clipBottom: 0,
  clipLeft: 0,
  brightness: 1,
  glow: 0,
};

export interface Keyframe extends KeyframeProps {
  /** 0..1 position within the clip. */
  offset: number;
  /** Easing from this keyframe to the next (overrides the clip easing). */
  easing?: string;
}

export type ParamValue = number | string;

export interface AnimationClip {
  /** Preset id, or "custom" once keyframes were edited by hand. */
  preset: string;
  params: Record<string, ParamValue>;
  keyframes: Keyframe[];
  durationMs: number;
  easing: string;
  /** CSS transform-origin, e.g. "left center". */
  origin?: string;
  /** Colour used by glow keyframes (may be a colour token). */
  glowColor?: string;
}

export type UpdateStyle = 'roll' | 'slide' | 'flip' | 'fade' | 'scale' | 'none';
export type HighlightKind = 'none' | 'flash' | 'glow' | 'pulse';

/** How a bound value animates when it changes (scores, period, down...). */
export interface UpdateAnimation {
  style: UpdateStyle;
  direction: 'up' | 'down' | 'left' | 'right';
  durationMs: number;
  easing: string;
  highlight: HighlightKind;
  highlightColor: string;
  highlightMs: number;
}

export interface ElementAnimations {
  /** Played when a visibility binding turns the element on (flag, possession...). */
  enter: AnimationClip | null;
  /** Played when a visibility binding turns the element off. */
  exit: AnimationClip | null;
  update: UpdateAnimation | null;
}

export const TIMELINE_TRIGGERS = [
  'entrance',
  'exit',
  'touchdown',
  'fieldGoal',
  'safety',
  'extraPoint',
  'twoPoint',
  'firstDown',
  'turnover',
  'timeout',
  'penalty',
  'custom',
  'periodChange',
  'possessionChange',
  'scoreChange',
] as const;
export type TimelineTrigger = (typeof TIMELINE_TRIGGERS)[number];

export interface TimelineTrack {
  id: string;
  /**
   * Element id, or a team-relative alias resolved at play time:
   * "@event.score", "@event.panel", "@event.logo", "@event.abbr".
   */
  elementId: string;
  startMs: number;
  clip: AnimationClip;
}

export interface EventTimeline {
  id: string;
  name: string;
  trigger: TimelineTrigger;
  /** takeover: exclusive, prioritised, queued. accent: plays alongside anything. */
  mode: 'takeover' | 'accent' | 'visibility';
  priority: number;
  enabled: boolean;
  tracks: TimelineTrack[];
}

export interface AnimationPresetRecord {
  id: string;
  name: string;
  /** Saved clip; built-in presets are generated from PRESETS instead. */
  clip: AnimationClip;
  builtin: boolean;
  createdAt: number;
}
