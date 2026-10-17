import { easingToCss } from './easing.js';
import { KEYFRAME_DEFAULTS, KEYFRAME_PROPS, type Keyframe, type KeyframeProps } from './types.js';

export type CssKeyframe = Record<string, string | number>;

/**
 * Fill in every property used anywhere in the clip on every keyframe so the
 * browser interpolates component-wise. Missing values are linearly
 * interpolated between the nearest keyframes that define them.
 */
export function normalizeKeyframes(kfs: Keyframe[]): (Required<KeyframeProps> & { offset: number; easing?: string })[] {
  const sorted = [...kfs].sort((a, b) => a.offset - b.offset);
  const used = KEYFRAME_PROPS.filter((p) => sorted.some((k) => k[p] !== undefined));
  return sorted.map((kf) => {
    const out = { ...KEYFRAME_DEFAULTS, offset: Math.min(1, Math.max(0, kf.offset)), easing: kf.easing } as Required<KeyframeProps> & {
      offset: number;
      easing?: string;
    };
    for (const p of used) {
      if (kf[p] !== undefined) {
        out[p] = kf[p]!;
        continue;
      }
      const prev = [...sorted].reverse().find((k) => k.offset <= kf.offset && k[p] !== undefined);
      const next = sorted.find((k) => k.offset >= kf.offset && k[p] !== undefined);
      if (prev && next && next.offset !== prev.offset) {
        const t = (kf.offset - prev.offset) / (next.offset - prev.offset);
        out[p] = prev[p]! + (next[p]! - prev[p]!) * t;
      } else {
        out[p] = (prev ?? next)![p]!;
      }
    }
    return out;
  });
}

const r = (n: number) => Math.round(n * 1000) / 1000;

/** Convert keyframes to Web Animations API keyframes. */
export function keyframesToCss(kfs: Keyframe[], opts: { glowColor?: string } = {}): CssKeyframe[] {
  if (!kfs.length) return [];
  const norm = normalizeKeyframes(kfs);
  const used = new Set(KEYFRAME_PROPS.filter((p) => kfs.some((k) => k[p] !== undefined)));
  const uses3d = used.has('rotateX') || used.has('rotateY');
  const usesTransform = ['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotate', 'rotateX', 'rotateY'].some((p) => used.has(p as keyof KeyframeProps));
  const usesClip = ['clipTop', 'clipRight', 'clipBottom', 'clipLeft'].some((p) => used.has(p as keyof KeyframeProps));
  const usesFilter = used.has('brightness') || used.has('glow');
  const glowColor = opts.glowColor ?? '#ffffff';

  return norm.map((k) => {
    const css: CssKeyframe = { offset: k.offset };
    if (used.has('opacity')) css.opacity = r(k.opacity);
    if (usesTransform) {
      css.transform =
        `${uses3d ? 'perspective(600px) ' : ''}translate(${r(k.x)}px, ${r(k.y)}px) ` +
        `scale(${r(k.scale * k.scaleX)}, ${r(k.scale * k.scaleY)}) rotate(${r(k.rotate)}deg)` +
        (uses3d ? ` rotateX(${r(k.rotateX)}deg) rotateY(${r(k.rotateY)}deg)` : '');
    }
    if (usesClip) css.clipPath = `inset(${r(k.clipTop)}% ${r(k.clipRight)}% ${r(k.clipBottom)}% ${r(k.clipLeft)}%)`;
    if (usesFilter) css.filter = `brightness(${r(k.brightness)}) drop-shadow(0px 0px ${r(k.glow)}px ${glowColor})`;
    if (k.easing) css.easing = easingToCss(k.easing);
    return css;
  });
}

/** Properties a clip animates (used to decide which layers are affected). */
export function clipUsesProps(kfs: Keyframe[]): Set<keyof KeyframeProps> {
  return new Set(KEYFRAME_PROPS.filter((p) => kfs.some((k) => k[p] !== undefined)));
}
