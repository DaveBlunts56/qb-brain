import { useEffect, useRef } from 'react';
import type { GameState, Scene } from '@bf/shared';
import { assetUrl } from '../lib/api';
import { SceneRenderer } from '../render/SceneRenderer';

/**
 * React wrapper around the overlay renderer for thumbnails and previews.
 * Uses the exact same rendering code as the OBS overlay.
 */
export function ScenePreview({
  scene,
  state,
  className = '',
  showRestHidden = false,
  now,
  animate = false,
  onRenderer,
  mode = 'preview',
}: {
  scene: Scene | null;
  state: GameState | null;
  className?: string;
  showRestHidden?: boolean;
  now?: () => number;
  animate?: boolean;
  onRenderer?: (r: SceneRenderer | null) => void;
  mode?: 'preview' | 'editor';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<SceneRenderer | null>(null);
  const nowRef = useRef(now);
  nowRef.current = now;

  useEffect(() => {
    const r = new SceneRenderer(ref.current!, {
      mode,
      fit: 'contain',
      assetUrl,
      now: () => (nowRef.current ? nowRef.current() : performance.now()),
      showRestHidden,
    });
    rendererRef.current = r;
    onRenderer?.(r);
    return () => {
      onRenderer?.(null);
      r.destroy();
      rendererRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    if (scene) rendererRef.current?.setScene(scene);
  }, [scene]);

  useEffect(() => {
    if (state) rendererRef.current?.setState(state, animate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  useEffect(() => {
    rendererRef.current?.setShowRestHidden(showRestHidden);
  }, [showRestHidden]);

  return <div ref={ref} className={`relative overflow-hidden ${className}`} />;
}
