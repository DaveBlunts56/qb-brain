import { useCallback, useEffect, useRef, useState } from 'react';
import type { Cancelable, EventTimeline, TeamSide } from '@bf/shared';
import type { SceneRenderer } from '../../render/SceneRenderer';
import { timelineDuration } from './TimelineEditor';

/** Play a timeline on a renderer with a moving playhead; replay and reset. */
export function useTimelinePreview(getRenderer: () => SceneRenderer | null) {
  const [playhead, setPlayhead] = useState<number | null>(null);
  const playing = useRef<Cancelable | null>(null);
  const raf = useRef(0);

  const stop = useCallback(() => {
    cancelAnimationFrame(raf.current);
    playing.current?.cancel();
    playing.current = null;
    setPlayhead(null);
  }, []);

  const play = useCallback(
    (tl: EventTimeline, team: TeamSide | null) => {
      const r = getRenderer();
      if (!r) return;
      stop();
      const total = timelineDuration(tl);
      const t0 = performance.now();
      playing.current = r.previewTimeline(tl, team, () => {
        cancelAnimationFrame(raf.current);
        setPlayhead(null);
      });
      const tick = () => {
        const t = performance.now() - t0;
        setPlayhead(Math.min(t, total));
        if (t < total) raf.current = requestAnimationFrame(tick);
      };
      tick();
    },
    [getRenderer, stop],
  );

  useEffect(() => stop, [stop]);
  return { playhead, play, stop, isPlaying: playhead !== null };
}
