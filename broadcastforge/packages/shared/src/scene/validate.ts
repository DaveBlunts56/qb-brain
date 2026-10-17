import { z } from 'zod';
import { ELEMENT_TYPES, type Scene } from './types.js';
import { FIELD_ROLES } from './roles.js';
import { TIMELINE_TRIGGERS } from '../animation/types.js';
import { normalizeOrder } from './tree.js';

/**
 * Structural validation for scenes coming from the editor, project imports
 * or the API. It is deliberately strict about types and sizes (scenes are
 * rendered inside OBS) but permissive about optional fields.
 */
const finite = z.number().finite();
const color = z.string().max(120);
const id = z.string().min(1).max(64);

const paint = z.union([
  z.object({ type: z.literal('none') }),
  z.object({ type: z.literal('solid'), color }),
  z.object({
    type: z.literal('linear'),
    angle: finite,
    stops: z.array(z.object({ offset: finite, color })).min(1).max(16),
  }),
]);

const stroke = z.object({ color, width: finite.min(0).max(200) });
const shadow = z.object({ x: finite, y: finite, blur: finite.min(0).max(500), color });

const keyframe = z
  .object({ offset: finite.min(0).max(1), easing: z.string().max(80).optional() })
  .catchall(finite);

const clip = z.object({
  preset: z.string().max(40),
  params: z.record(z.string(), z.union([finite, z.string().max(80)])),
  keyframes: z.array(keyframe).max(32),
  durationMs: finite.min(0).max(60_000),
  easing: z.string().max(80),
  origin: z.string().max(40).optional(),
  glowColor: color.optional(),
});

const updateAnim = z.object({
  style: z.enum(['roll', 'slide', 'flip', 'fade', 'scale', 'none']),
  direction: z.enum(['up', 'down', 'left', 'right']),
  durationMs: finite.min(0).max(10_000),
  easing: z.string().max(80),
  highlight: z.enum(['none', 'flash', 'glow', 'pulse']),
  highlightColor: color,
  highlightMs: finite.min(0).max(10_000),
});

const binding = z.object({
  field: z.string().max(64),
  target: z.enum(['text', 'image', 'visible', 'fill', 'color']),
  format: z.string().max(120).optional(),
  index: finite.optional(),
  mode: z.enum(['hide', 'dim']).optional(),
  dimOpacity: finite.min(0).max(1).optional(),
});

const element = z.object({
  id,
  name: z.string().max(120),
  type: z.enum(ELEMENT_TYPES),
  parentId: id.nullable(),
  x: finite,
  y: finite,
  width: finite.min(0).max(20_000),
  height: finite.min(0).max(20_000),
  rotation: finite,
  opacity: finite.min(0).max(1),
  visible: z.boolean(),
  locked: z.boolean(),
  restHidden: z.boolean(),
  fill: paint,
  stroke: stroke.nullable(),
  radius: finite.min(0),
  skewX: finite.min(-80).max(80),
  shadow: shadow.nullable(),
  blendMode: z.string().max(24),
  text: z
    .object({
      content: z.string().max(2000),
      fontFamily: z.string().max(80),
      fontSize: finite.min(1).max(1000),
      fontWeight: finite.min(100).max(1000),
      italic: z.boolean(),
      color,
      align: z.enum(['left', 'center', 'right']),
      verticalAlign: z.enum(['top', 'middle', 'bottom']),
      letterSpacing: finite,
      lineHeight: finite.min(0.1).max(10),
      uppercase: z.boolean(),
      fit: z.enum(['none', 'shrink', 'squeeze']),
      tabularNums: z.boolean(),
      stroke: stroke.nullable(),
      shadow: shadow.nullable(),
    })
    .optional(),
  image: z.object({ assetId: id.nullable(), fit: z.enum(['contain', 'cover', 'fill']) }).optional(),
  path: z
    .object({
      d: z.string().max(200_000),
      viewBox: z.tuple([finite, finite, finite, finite]),
      fillRule: z.enum(['nonzero', 'evenodd']),
    })
    .optional(),
  polygon: z.object({ points: z.array(z.tuple([finite, finite])).max(2000) }).optional(),
  role: z.enum(FIELD_ROLES).nullable(),
  bindings: z.array(binding).max(16),
  anim: z.object({ enter: clip.nullable(), exit: clip.nullable(), update: updateAnim.nullable() }),
  meta: z
    .object({
      source: z.enum(['template', 'svg', 'psd', 'raster', 'user', 'generator']).optional(),
      isMask: z.boolean().optional(),
      isBaseArt: z.boolean().optional(),
      component: z.enum(['tdTakeover', 'eventBanner', 'flagPanel', 'sweep']).optional(),
      part: z.string().max(40).optional(),
      note: z.string().max(500).optional(),
      warnings: z.array(z.string().max(300)).max(20).optional(),
    })
    .optional(),
});

const timeline = z.object({
  id,
  name: z.string().max(120),
  trigger: z.enum(TIMELINE_TRIGGERS),
  mode: z.enum(['takeover', 'accent', 'visibility']),
  priority: finite,
  enabled: z.boolean(),
  tracks: z.array(z.object({ id, elementId: z.string().max(64), startMs: finite.min(0).max(120_000), clip })).max(200),
});

export const sceneSchema = z.object({
  version: z.literal(1),
  width: z.number().int().min(16).max(7680),
  height: z.number().int().min(16).max(4320),
  elements: z.array(element).max(2000),
  timelines: z.array(timeline).max(100),
  fonts: z.array(z.object({ family: z.string().max(80), assetId: id })).max(50),
  settings: z.object({
    safeZones: z.boolean(),
    snap: z.boolean(),
    grid: finite.min(1).max(500),
    editorBackground: color,
  }),
});

export function validateScene(input: unknown): { ok: true; scene: Scene } | { ok: false; error: string } {
  const r = sceneSchema.safeParse(input);
  if (!r.success) {
    const issue = r.error.issues[0];
    return { ok: false, error: issue ? `scene.${issue.path.join('.')}: ${issue.message}` : 'Invalid scene' };
  }
  const scene = r.data as Scene;
  const ids = new Set<string>();
  for (const el of scene.elements) {
    if (ids.has(el.id)) return { ok: false, error: `Duplicate element id ${el.id}` };
    ids.add(el.id);
  }
  normalizeOrder(scene);
  return { ok: true, scene };
}

/** Asset ids referenced by a scene (images and fonts). */
export function sceneAssetIds(scene: Scene): string[] {
  const out = new Set<string>();
  for (const el of scene.elements) if (el.image?.assetId) out.add(el.image.assetId);
  for (const f of scene.fonts) out.add(f.assetId);
  return [...out];
}
