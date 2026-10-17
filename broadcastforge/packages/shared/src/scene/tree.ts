import { createId } from '../util/id.js';
import type { GraphicElement, Scene } from './types.js';

/**
 * Scene tree helpers. Elements are stored flat; parentId links them into
 * groups and array order is paint order (later = on top) among siblings.
 * Child coordinates are absolute canvas coordinates; groups carry their own
 * bounding box which is kept in sync by `fitGroupToChildren`.
 */

export function byId(scene: Scene): Map<string, GraphicElement> {
  return new Map(scene.elements.map((e) => [e.id, e]));
}

export function childrenOf(scene: Scene, parentId: string | null): GraphicElement[] {
  return scene.elements.filter((e) => e.parentId === parentId);
}

export function descendantIds(scene: Scene, id: string): string[] {
  const out: string[] = [];
  const walk = (pid: string) => {
    for (const e of scene.elements) {
      if (e.parentId === pid) {
        out.push(e.id);
        walk(e.id);
      }
    }
  };
  walk(id);
  return out;
}

export function ancestors(scene: Scene, id: string): GraphicElement[] {
  const map = byId(scene);
  const out: GraphicElement[] = [];
  let cur = map.get(id);
  const seen = new Set<string>();
  while (cur?.parentId && !seen.has(cur.parentId)) {
    seen.add(cur.parentId);
    const p = map.get(cur.parentId);
    if (!p) break;
    out.push(p);
    cur = p;
  }
  return out;
}

/** Effective visibility/lock considering ancestors. */
export function isEffectivelyVisible(scene: Scene, el: GraphicElement): boolean {
  return el.visible && ancestors(scene, el.id).every((a) => a.visible);
}

export function isEffectivelyLocked(scene: Scene, el: GraphicElement): boolean {
  return el.locked || ancestors(scene, el.id).some((a) => a.locked);
}

/** Elements in paint order with depth, as displayed in a layer panel (top first). */
export function layerTree(scene: Scene): { el: GraphicElement; depth: number }[] {
  const out: { el: GraphicElement; depth: number }[] = [];
  const walk = (pid: string | null, depth: number) => {
    const kids = childrenOf(scene, pid).reverse();
    for (const k of kids) {
      out.push({ el: k, depth });
      if (k.type === 'group') walk(k.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function boundsOf(els: Pick<GraphicElement, 'x' | 'y' | 'width' | 'height'>[]): { x: number; y: number; width: number; height: number } | null {
  if (!els.length) return null;
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const e of els) {
    x0 = Math.min(x0, e.x);
    y0 = Math.min(y0, e.y);
    x1 = Math.max(x1, e.x + e.width);
    y1 = Math.max(y1, e.y + e.height);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Recompute group boxes bottom-up so they enclose their children. */
export function fitGroupsToChildren(scene: Scene): void {
  const map = byId(scene);
  const depth = (e: GraphicElement) => ancestors(scene, e.id).length;
  const groups = scene.elements.filter((e) => e.type === 'group').sort((a, b) => depth(b) - depth(a));
  for (const g of groups) {
    const kids = scene.elements.filter((e) => e.parentId === g.id);
    const b = boundsOf(kids);
    if (!b) continue;
    const el = map.get(g.id)!;
    el.x = b.x;
    el.y = b.y;
    el.width = b.width;
    el.height = b.height;
  }
}

/** Move an element and (for groups) all its descendants by dx/dy. */
export function translateElements(scene: Scene, ids: string[], dx: number, dy: number): void {
  const all = new Set<string>();
  for (const id of ids) {
    all.add(id);
    for (const d of descendantIds(scene, id)) all.add(d);
  }
  for (const e of scene.elements) {
    if (all.has(e.id)) {
      e.x += dx;
      e.y += dy;
    }
  }
  fitGroupsToChildren(scene);
}

/** Resize a group by scaling its descendants proportionally. */
export function resizeElement(scene: Scene, id: string, next: { x: number; y: number; width: number; height: number }): void {
  const el = scene.elements.find((e) => e.id === id);
  if (!el) return;
  if (el.type === 'group') {
    const sx = el.width ? next.width / el.width : 1;
    const sy = el.height ? next.height / el.height : 1;
    for (const d of descendantIds(scene, id)) {
      const c = scene.elements.find((e) => e.id === d)!;
      c.x = next.x + (c.x - el.x) * sx;
      c.y = next.y + (c.y - el.y) * sy;
      c.width *= sx;
      c.height *= sy;
      if (c.polygon) c.polygon.points = c.polygon.points.map(([px, py]) => [px * sx, py * sy]);
    }
  } else if (el.polygon) {
    const sx = el.width ? next.width / el.width : 1;
    const sy = el.height ? next.height / el.height : 1;
    el.polygon.points = el.polygon.points.map(([px, py]) => [px * sx, py * sy]);
  }
  Object.assign(el, next);
  fitGroupsToChildren(scene);
}

export function removeElements(scene: Scene, ids: string[]): void {
  const all = new Set<string>();
  for (const id of ids) {
    all.add(id);
    for (const d of descendantIds(scene, id)) all.add(d);
  }
  scene.elements = scene.elements.filter((e) => !all.has(e.id));
  for (const tl of scene.timelines) tl.tracks = tl.tracks.filter((t) => !all.has(t.elementId));
  fitGroupsToChildren(scene);
}

/** Duplicate elements (with descendants); returns ids of the new top-level copies. */
export function duplicateElements(scene: Scene, ids: string[], offset = 20): string[] {
  const idMap = new Map<string, string>();
  const created: GraphicElement[] = [];
  const roots: string[] = [];
  const copy = (el: GraphicElement, parentId: string | null) => {
    const nid = createId('el');
    idMap.set(el.id, nid);
    const c: GraphicElement = { ...structuredClone(el), id: nid, parentId, x: el.x + offset, y: el.y + offset, name: el.name };
    created.push(c);
    for (const k of scene.elements.filter((e) => e.parentId === el.id)) copy(k, nid);
    return nid;
  };
  for (const id of ids) {
    const el = scene.elements.find((e) => e.id === id);
    if (!el) continue;
    roots.push(copy(el, el.parentId));
  }
  scene.elements.push(...created);
  return roots;
}

export function groupElements(scene: Scene, ids: string[], name = 'Group'): string | null {
  const els = scene.elements.filter((e) => ids.includes(e.id));
  if (!els.length) return null;
  // Group siblings only: use the parent of the first element.
  const parentId = els[0]!.parentId;
  const siblings = els.filter((e) => e.parentId === parentId);
  const b = boundsOf(siblings)!;
  const gid = createId('el');
  const firstIndex = Math.max(...siblings.map((s) => scene.elements.indexOf(s)));
  const group: GraphicElement = {
    id: gid,
    name,
    type: 'group',
    parentId,
    ...b,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    restHidden: false,
    fill: { type: 'none' },
    stroke: null,
    radius: 0,
    skewX: 0,
    shadow: null,
    blendMode: 'normal',
    role: null,
    bindings: [],
    anim: { enter: null, exit: null, update: null },
  };
  scene.elements.splice(firstIndex + 1, 0, group);
  // Move children after the group so paint order is preserved inside it.
  const moving = siblings.map((s) => s.id);
  const kids = scene.elements.filter((e) => moving.includes(e.id));
  scene.elements = scene.elements.filter((e) => !moving.includes(e.id));
  const gi = scene.elements.findIndex((e) => e.id === gid);
  for (const k of kids) k.parentId = gid;
  scene.elements.splice(gi + 1, 0, ...kids);
  return gid;
}

export function ungroup(scene: Scene, groupId: string): string[] {
  const g = scene.elements.find((e) => e.id === groupId);
  if (!g || g.type !== 'group') return [];
  const kids = scene.elements.filter((e) => e.parentId === groupId);
  for (const k of kids) k.parentId = g.parentId;
  scene.elements = scene.elements.filter((e) => e.id !== groupId);
  return kids.map((k) => k.id);
}

/** Move an element within its siblings. delta +1 = up (towards front). */
export function reorderElement(scene: Scene, id: string, delta: number | 'front' | 'back'): void {
  const el = scene.elements.find((e) => e.id === id);
  if (!el) return;
  const siblings = scene.elements.filter((e) => e.parentId === el.parentId);
  const i = siblings.indexOf(el);
  let j = delta === 'front' ? siblings.length - 1 : delta === 'back' ? 0 : i + delta;
  j = Math.max(0, Math.min(siblings.length - 1, j));
  if (i === j) return;
  const target = siblings[j]!;
  // Collect the subtree being moved so groups move with their children.
  const subtree = new Set([id, ...descendantIds(scene, id)]);
  const moving = scene.elements.filter((e) => subtree.has(e.id));
  scene.elements = scene.elements.filter((e) => !subtree.has(e.id));
  let insertAt = scene.elements.indexOf(target);
  if (j > i) {
    // after target's subtree
    const targetSub = new Set([target.id, ...descendantIds(scene, target.id)]);
    let last = insertAt;
    scene.elements.forEach((e, idx) => {
      if (targetSub.has(e.id)) last = idx;
    });
    insertAt = last + 1;
  }
  scene.elements.splice(insertAt, 0, ...moving);
}

/** Order elements so each parent precedes its children (needed by renderers). */
export function normalizeOrder(scene: Scene): void {
  const out: GraphicElement[] = [];
  const walk = (pid: string | null) => {
    for (const e of scene.elements) {
      if (e.parentId === pid) {
        out.push(e);
        walk(e.id);
      }
    }
  };
  walk(null);
  // Orphans (missing parent) are re-attached at the root.
  const placed = new Set(out.map((e) => e.id));
  for (const e of scene.elements) {
    if (!placed.has(e.id)) {
      e.parentId = null;
      out.push(e);
    }
  }
  scene.elements = out;
}
