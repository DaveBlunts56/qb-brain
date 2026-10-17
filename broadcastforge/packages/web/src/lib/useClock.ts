import { useEffect, useState } from 'react';
import { clockRemaining, formatGameClock, formatPlayClock, type ClockState } from '@bf/shared';

/**
 * Locally rendered clock text, derived from the authoritative anchors and the
 * estimated server time on every animation frame (no tick counting).
 * Re-renders only when the visible string changes.
 */
export function useClockText(clock: ClockState | undefined, now: (() => number) | undefined, kind: 'game' | 'play', tenths = true): { text: string; ms: number } {
  const [value, setValue] = useState({ text: '', ms: 0 });
  useEffect(() => {
    if (!clock) return;
    let raf = 0;
    let last = '';
    const tick = () => {
      const ms = clockRemaining(clock, now ? now() : performance.now());
      const text = kind === 'game' ? formatGameClock(ms, tenths) : formatPlayClock(ms);
      if (text !== last) {
        last = text;
        setValue({ text, ms });
      }
      if (clock.running) raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [clock, now, kind, tenths]);
  return value;
}
