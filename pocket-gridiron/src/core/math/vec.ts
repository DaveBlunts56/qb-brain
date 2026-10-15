/** Minimal 2D/3D vector helpers. Plain objects keep the simulation easy to clone, test and serialize. */

export interface Vec2 { x: number; y: number }
export interface Vec3 { x: number; y: number; z: number }

export const v2 = (x = 0, y = 0): Vec2 => ({ x, y });
export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const copy2 = (a: Vec2): Vec2 => ({ x: a.x, y: a.y });
export const add2 = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub2 = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale2 = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const len2 = (a: Vec2): number => Math.hypot(a.x, a.y);
export const dist2 = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const dot2 = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v: number): number => clamp(v, 0, 1);

export function norm2(a: Vec2): Vec2 {
  const l = Math.hypot(a.x, a.y);
  return l > 1e-9 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
}

/** Limit a vector's length. */
export function limit2(a: Vec2, max: number): Vec2 {
  const l = Math.hypot(a.x, a.y);
  return l > max && l > 0 ? { x: (a.x / l) * max, y: (a.y / l) * max } : { x: a.x, y: a.y };
}

export function lerp2(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Angle between two direction vectors in radians (0..PI). */
export function angleBetween(a: Vec2, b: Vec2): number {
  const la = len2(a), lb = len2(b);
  if (la < 1e-9 || lb < 1e-9) return 0;
  return Math.acos(clamp(dot2(a, b) / (la * lb), -1, 1));
}

/** Closest point on segment AB to P. */
export function closestOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const ab = sub2(b, a);
  const l2 = ab.x * ab.x + ab.y * ab.y;
  if (l2 < 1e-9) return copy2(a);
  const t = clamp(((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / l2, 0, 1);
  return { x: a.x + ab.x * t, y: a.y + ab.y * t };
}
