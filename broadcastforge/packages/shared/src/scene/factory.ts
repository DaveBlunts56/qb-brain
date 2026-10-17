import { createId } from '../util/id.js';
import type { ElementAnimations } from '../animation/types.js';
import type { ElementType, GraphicElement, Scene, TextProps } from './types.js';

export const DEFAULT_FONT = 'Barlow Condensed';

export const BUNDLED_FONTS = ['Barlow Condensed', 'Oswald', 'Teko', 'Bebas Neue', 'Roboto Condensed', 'Inter'] as const;

export function emptyAnimations(): ElementAnimations {
  return { enter: null, exit: null, update: null };
}

export function defaultTextProps(overrides: Partial<TextProps> = {}): TextProps {
  return {
    content: 'Text',
    fontFamily: DEFAULT_FONT,
    fontSize: 40,
    fontWeight: 700,
    italic: false,
    color: '#ffffff',
    align: 'center',
    verticalAlign: 'middle',
    letterSpacing: 0,
    lineHeight: 1,
    uppercase: true,
    fit: 'squeeze',
    tabularNums: true,
    stroke: null,
    shadow: null,
    ...overrides,
  };
}

export function createElement(type: ElementType, overrides: Partial<GraphicElement> = {}): GraphicElement {
  const base: GraphicElement = {
    id: createId('el'),
    name: type[0]!.toUpperCase() + type.slice(1),
    type,
    parentId: null,
    x: 0,
    y: 0,
    width: 200,
    height: 80,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    restHidden: false,
    fill: type === 'rect' || type === 'ellipse' || type === 'polygon' || type === 'path' ? { type: 'solid', color: '#2a2f3a' } : { type: 'none' },
    stroke: null,
    radius: 0,
    skewX: 0,
    shadow: null,
    blendMode: 'normal',
    role: null,
    bindings: [],
    anim: emptyAnimations(),
  };
  if (type === 'text') base.text = defaultTextProps();
  if (type === 'image') base.image = { assetId: null, fit: 'contain' };
  if (type === 'polygon') base.polygon = { points: [[0, 0], [200, 0], [200, 80], [0, 80]] };
  if (type === 'path') base.path = { d: 'M0 0 H200 V80 H0 Z', viewBox: [0, 0, 200, 80], fillRule: 'nonzero' };
  return { ...base, ...overrides, text: overrides.text ?? base.text, image: overrides.image ?? base.image };
}

export function createScene(width = 1920, height = 1080): Scene {
  return {
    version: 1,
    width,
    height,
    elements: [],
    timelines: [],
    fonts: [],
    settings: { safeZones: true, snap: true, grid: 10, editorBackground: '#3b4f3a' },
  };
}

/** Rescale a whole scene (e.g. 1080p template -> 720p project). */
export function scaleScene(scene: Scene, width: number, height: number): Scene {
  const k = Math.min(width / scene.width, height / scene.height);
  const s = structuredClone(scene);
  s.width = width;
  s.height = height;
  for (const el of s.elements) {
    el.x = Math.round(el.x * k * 100) / 100;
    el.y = Math.round(el.y * k * 100) / 100;
    el.width = Math.round(el.width * k * 100) / 100;
    el.height = Math.round(el.height * k * 100) / 100;
    el.radius *= k;
    if (el.stroke) el.stroke.width *= k;
    if (el.shadow) {
      el.shadow.x *= k;
      el.shadow.y *= k;
      el.shadow.blur *= k;
    }
    if (el.text) {
      el.text.fontSize = Math.round(el.text.fontSize * k * 10) / 10;
      el.text.letterSpacing *= k;
      if (el.text.stroke) el.text.stroke.width *= k;
      if (el.text.shadow) {
        el.text.shadow.x *= k;
        el.text.shadow.y *= k;
        el.text.shadow.blur *= k;
      }
    }
    if (el.polygon) el.polygon.points = el.polygon.points.map(([x, y]) => [x * k, y * k]);
  }
  for (const tl of s.timelines) {
    for (const tr of tl.tracks) {
      for (const kf of tr.clip.keyframes) {
        if (kf.x !== undefined) kf.x *= k;
        if (kf.y !== undefined) kf.y *= k;
        if (kf.glow !== undefined) kf.glow *= k;
      }
      if (typeof tr.clip.params.distance === 'number') tr.clip.params.distance *= k;
    }
  }
  for (const el of s.elements) {
    for (const clip of [el.anim.enter, el.anim.exit]) {
      if (!clip) continue;
      for (const kf of clip.keyframes) {
        if (kf.x !== undefined) kf.x *= k;
        if (kf.y !== undefined) kf.y *= k;
      }
      if (typeof clip.params.distance === 'number') clip.params.distance *= k;
    }
  }
  return s;
}
