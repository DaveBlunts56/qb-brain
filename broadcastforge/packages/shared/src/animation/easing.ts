export const EASINGS: Record<string, { label: string; css: string; bezier: [number, number, number, number] | null }> = {
  linear: { label: 'Linear', css: 'linear', bezier: [0, 0, 1, 1] },
  ease: { label: 'Ease', css: 'ease', bezier: [0.25, 0.1, 0.25, 1] },
  easeIn: { label: 'Ease in', css: 'cubic-bezier(0.42, 0, 1, 1)', bezier: [0.42, 0, 1, 1] },
  easeOut: { label: 'Ease out', css: 'cubic-bezier(0, 0, 0.58, 1)', bezier: [0, 0, 0.58, 1] },
  easeInOut: { label: 'Ease in-out', css: 'cubic-bezier(0.42, 0, 0.58, 1)', bezier: [0.42, 0, 0.58, 1] },
  easeInCubic: { label: 'Cubic in', css: 'cubic-bezier(0.32, 0, 0.67, 0)', bezier: [0.32, 0, 0.67, 0] },
  easeOutCubic: { label: 'Cubic out', css: 'cubic-bezier(0.33, 1, 0.68, 1)', bezier: [0.33, 1, 0.68, 1] },
  easeInOutCubic: { label: 'Cubic in-out', css: 'cubic-bezier(0.65, 0, 0.35, 1)', bezier: [0.65, 0, 0.35, 1] },
  easeInExpo: { label: 'Expo in', css: 'cubic-bezier(0.7, 0, 0.84, 0)', bezier: [0.7, 0, 0.84, 0] },
  easeOutExpo: { label: 'Expo out', css: 'cubic-bezier(0.16, 1, 0.3, 1)', bezier: [0.16, 1, 0.3, 1] },
  easeInOutExpo: { label: 'Expo in-out', css: 'cubic-bezier(0.87, 0, 0.13, 1)', bezier: [0.87, 0, 0.13, 1] },
  backIn: { label: 'Back in (anticipate)', css: 'cubic-bezier(0.36, 0, 0.66, -0.56)', bezier: [0.36, 0, 0.66, -0.56] },
  backOut: { label: 'Back out (overshoot)', css: 'cubic-bezier(0.34, 1.56, 0.64, 1)', bezier: [0.34, 1.56, 0.64, 1] },
  snap: { label: 'Snap', css: 'cubic-bezier(0.8, 0, 0.2, 1)', bezier: [0.8, 0, 0.2, 1] },
};

const BEZIER_RE = /^cubic-bezier\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)$/;
const STEPS_RE = /^steps\(\s*\d{1,3}\s*(,\s*(start|end|jump-start|jump-end|jump-none|jump-both))?\s*\)$/;

/** Convert a named or literal easing into a safe CSS easing string. */
export function easingToCss(easing: string | undefined): string {
  if (!easing) return 'linear';
  const named = EASINGS[easing];
  if (named) return named.css;
  const s = easing.trim();
  const m = BEZIER_RE.exec(s);
  if (m) {
    const [x1, y1, x2, y2] = m.slice(1).map(Number) as [number, number, number, number];
    if ([x1, x2].every((v) => v >= 0 && v <= 1) && [y1, y2].every((v) => Number.isFinite(v))) return `cubic-bezier(${x1}, ${y1}, ${x2}, ${y2})`;
  }
  if (STEPS_RE.test(s)) return s;
  return 'linear';
}

export function easingBezier(easing: string): [number, number, number, number] | null {
  const named = EASINGS[easing];
  if (named) return named.bezier;
  const m = BEZIER_RE.exec(easing.trim());
  return m ? (m.slice(1).map(Number) as [number, number, number, number]) : null;
}

/** Evaluate a cubic bezier easing at t (for curve previews and tests). */
export function evalBezier([x1, y1, x2, y2]: [number, number, number, number], t: number): number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (u: number) => ((ax * u + bx) * u + cx) * u;
  const sy = (u: number) => ((ay * u + by) * u + cy) * u;
  let u = t;
  for (let i = 0; i < 8; i++) {
    const x = sx(u) - t;
    const d = (3 * ax * u + 2 * bx) * u + cx;
    if (Math.abs(x) < 1e-6 || Math.abs(d) < 1e-6) break;
    u -= x / d;
  }
  return sy(Math.min(1, Math.max(0, u)));
}
