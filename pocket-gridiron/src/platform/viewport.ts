/**
 * Viewport, safe areas and iOS Safari touch hygiene.
 *
 * The canvas is rendered at device resolution (capped at 2x) and displayed at CSS size, so pixel
 * art stays crisp and text stays sharp. Safe-area insets come from env(safe-area-inset-*), read
 * through a hidden probe element in index.html.
 */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ViewportInfo {
  /** CSS pixel size of the play area. */
  cssWidth: number;
  cssHeight: number;
  /** Device pixels per CSS pixel used for the canvas. */
  dpr: number;
  /** Safe-area insets in CSS pixels. */
  safe: Insets;
  portrait: boolean;
}

export const MAX_DPR = 3;

export function readSafeArea(): Insets {
  const el = document.getElementById("safe-probe");
  if (!el) return { top: 0, right: 0, bottom: 0, left: 0 };
  const cs = getComputedStyle(el);
  const px = (v: string) => Math.max(0, parseFloat(v) || 0);
  return { top: px(cs.paddingTop), right: px(cs.paddingRight), bottom: px(cs.paddingBottom), left: px(cs.paddingLeft) };
}

export function readViewport(): ViewportInfo {
  const vv = window.visualViewport;
  const cssWidth = Math.max(1, Math.round(vv ? vv.width : window.innerWidth));
  const cssHeight = Math.max(1, Math.round(vv ? vv.height : window.innerHeight));
  const dpr = Math.min(MAX_DPR, Math.max(1, window.devicePixelRatio || 1));
  return { cssWidth, cssHeight, dpr, safe: readSafeArea(), portrait: cssHeight > cssWidth && cssWidth < 900 };
}

/** Stops page scroll, pinch zoom, double-tap zoom and the iOS callout during play. */
export function lockTouchGestures(): void {
  const opts: AddEventListenerOptions = { passive: false };
  const prevent = (e: Event) => {
    // Let the error panel scroll if it is ever shown.
    if ((e.target as HTMLElement | null)?.closest?.("#fatal")) return;
    e.preventDefault();
  };
  document.addEventListener("touchmove", prevent, opts);
  document.addEventListener("gesturestart", prevent, opts);
  document.addEventListener("gesturechange", prevent, opts);
  document.addEventListener("gestureend", prevent, opts);
  document.addEventListener("dblclick", prevent, opts);
  document.addEventListener("contextmenu", prevent, opts);
  // iOS double-tap-to-zoom on quick successive touchend events.
  let lastEnd = 0;
  document.addEventListener("touchend", (e) => {
    const now = performance.now();
    if (now - lastEnd < 350 && e.touches.length === 0) e.preventDefault();
    lastEnd = now;
  }, opts);
  window.addEventListener("scroll", () => window.scrollTo(0, 0));
}

/** Calls back (debounced) whenever the visible size, orientation or safe area may have changed. */
export function onViewportChange(cb: (v: ViewportInfo) => void): void {
  let t = 0;
  const fire = () => {
    clearTimeout(t);
    t = window.setTimeout(() => cb(readViewport()), 120);
  };
  window.addEventListener("resize", fire);
  window.addEventListener("orientationchange", fire);
  window.visualViewport?.addEventListener("resize", fire);
  // iOS reports the new size late after rotation.
  window.addEventListener("orientationchange", () => setTimeout(fire, 450));
}
