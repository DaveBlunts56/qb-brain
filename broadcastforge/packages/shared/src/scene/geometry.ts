import type { GraphicElement, Scene } from './types.js';
import { isEffectivelyLocked, isEffectivelyVisible } from './tree.js';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Convert a canvas point into an element's local, unrotated coordinates. */
export function toLocal(el: Rect & { rotation: number }, p: Point): Point {
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  const a = (-el.rotation * Math.PI) / 180;
  const dx = p.x - cx;
  const dy = p.y - cy;
  return {
    x: dx * Math.cos(a) - dy * Math.sin(a) + el.width / 2,
    y: dx * Math.sin(a) + dy * Math.cos(a) + el.height / 2,
  };
}

export function pointInPolygon(p: Point, pts: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]!;
    const [xj, yj] = pts[j]!;
    if (yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi || 1e-9) + xi) inside = !inside;
  }
  return inside;
}

/** Accurate hit test respecting rotation, ellipses and polygon outlines. */
export function hitTestElement(el: GraphicElement, p: Point, tolerance = 0): boolean {
  const l = toLocal(el, p);
  if (l.x < -tolerance || l.y < -tolerance || l.x > el.width + tolerance || l.y > el.height + tolerance) return false;
  if (el.type === 'ellipse') {
    const rx = el.width / 2 + tolerance;
    const ry = el.height / 2 + tolerance;
    const nx = (l.x - el.width / 2) / rx;
    const ny = (l.y - el.height / 2) / ry;
    return nx * nx + ny * ny <= 1;
  }
  if (el.type === 'polygon' && el.polygon && el.polygon.points.length >= 3) {
    return pointInPolygon(l, el.polygon.points);
  }
  return true;
}

/**
 * Topmost selectable element under a point. Groups are never returned
 * directly (their children are); hidden and locked elements are skipped.
 */
export function hitTestScene(scene: Scene, p: Point, opts: { includeLocked?: boolean; tolerance?: number } = {}): GraphicElement | null {
  for (let i = scene.elements.length - 1; i >= 0; i--) {
    const el = scene.elements[i]!;
    if (el.type === 'group') continue;
    if (!isEffectivelyVisible(scene, el)) continue;
    if (!opts.includeLocked && isEffectivelyLocked(scene, el)) continue;
    if (hitTestElement(el, p, opts.tolerance ?? 0)) return el;
  }
  return null;
}

/** Axis-aligned bounding box of a (possibly rotated) element. */
export function rotatedBounds(el: Rect & { rotation: number }): Rect {
  if (!el.rotation) return { x: el.x, y: el.y, width: el.width, height: el.height };
  const a = (el.rotation * Math.PI) / 180;
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  const corners = [
    [-el.width / 2, -el.height / 2],
    [el.width / 2, -el.height / 2],
    [el.width / 2, el.height / 2],
    [-el.width / 2, el.height / 2],
  ].map(([x, y]) => [cx + x! * Math.cos(a) - y! * Math.sin(a), cy + x! * Math.sin(a) + y! * Math.cos(a)]);
  const xs = corners.map((c) => c[0]!);
  const ys = corners.map((c) => c[1]!);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export interface SnapGuide {
  axis: 'x' | 'y';
  /** Canvas coordinate of the guide line. */
  pos: number;
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: SnapGuide[];
}

/** Lines that a moving box may snap to: canvas edges/centre, safe zones, other elements. */
export function snapTargets(scene: Scene, excludeIds: Set<string>, safeZones: boolean): { xs: number[]; ys: number[] } {
  const xs = [0, scene.width / 2, scene.width];
  const ys = [0, scene.height / 2, scene.height];
  if (safeZones) {
    for (const z of safeZoneRects(scene.width, scene.height)) {
      xs.push(z.rect.x, z.rect.x + z.rect.width);
      ys.push(z.rect.y, z.rect.y + z.rect.height);
    }
  }
  for (const el of scene.elements) {
    if (excludeIds.has(el.id) || !el.visible || el.meta?.isBaseArt) continue;
    const b = rotatedBounds(el);
    xs.push(b.x, b.x + b.width / 2, b.x + b.width);
    ys.push(b.y, b.y + b.height / 2, b.y + b.height);
  }
  return { xs, ys };
}

/** Snap a moving rect's edges/centre to the nearest targets within threshold. */
export function snapRect(rect: Rect, targets: { xs: number[]; ys: number[] }, threshold: number): SnapResult {
  const mine = {
    x: [rect.x, rect.x + rect.width / 2, rect.x + rect.width],
    y: [rect.y, rect.y + rect.height / 2, rect.y + rect.height],
  };
  const best = (vals: number[], ts: number[]) => {
    let d = Infinity;
    let pos = 0;
    for (const v of vals)
      for (const t of ts) {
        const diff = t - v;
        if (Math.abs(diff) < Math.abs(d)) {
          d = diff;
          pos = t;
        }
      }
    return { d, pos };
  };
  const bx = best(mine.x, targets.xs);
  const by = best(mine.y, targets.ys);
  const guides: SnapGuide[] = [];
  let dx = 0;
  let dy = 0;
  if (Math.abs(bx.d) <= threshold) {
    dx = bx.d;
    guides.push({ axis: 'x', pos: bx.pos });
  }
  if (Math.abs(by.d) <= threshold) {
    dy = by.d;
    guides.push({ axis: 'y', pos: by.pos });
  }
  return { dx, dy, guides };
}

/** SMPTE-style action-safe (93%) and title-safe (90%) areas. */
export function safeZoneRects(width: number, height: number): { name: string; rect: Rect }[] {
  const zone = (pct: number) => {
    const w = width * pct;
    const h = height * pct;
    return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h };
  };
  return [
    { name: 'Action safe', rect: zone(0.93) },
    { name: 'Title safe', rect: zone(0.9) },
  ];
}
