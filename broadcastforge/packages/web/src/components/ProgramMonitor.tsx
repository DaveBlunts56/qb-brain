import { useState } from 'react';
import { ExternalLink, Grid2x2, RotateCw } from 'lucide-react';
import { IconButton } from './ui';

/**
 * Shows the *actual* overlay page (the same URL OBS loads) in an iframe, so
 * the operator sees exactly what is on air rather than a re-render.
 */
export function ProgramMonitor({ projectId, label = 'PROGRAM', live, className = '' }: { projectId: string; label?: string; live?: boolean; className?: string }) {
  const [checker, setChecker] = useState(true);
  const [nonce, setNonce] = useState(0);
  const src = `/overlay/${projectId}?status=0${checker ? '&checker=1' : ''}&n=${nonce}`;
  return (
    <div className={`overflow-hidden rounded-lg border ${live ? 'border-live/70' : 'border-ink-600'} bg-black ${className}`}>
      <div className="flex items-center justify-between border-b border-ink-700 bg-ink-900 px-2 py-1">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold tracking-widest ${live ? 'bg-live text-white' : 'bg-ink-700 text-ink-300'}`}>{label}</span>
        <div className="flex items-center">
          <IconButton title="Toggle transparency checkerboard" active={checker} onClick={() => setChecker((c) => !c)} className="h-6 w-6">
            <Grid2x2 className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton title="Reload preview" onClick={() => setNonce((n) => n + 1)} className="h-6 w-6">
            <RotateCw className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton title="Open overlay in a new window (press F for fullscreen)" onClick={() => window.open(`/overlay/${projectId}?checker=1`, '_blank')} className="h-6 w-6">
            <ExternalLink className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      </div>
      <div className="relative aspect-video w-full">
        <iframe key={src} title="Program output" src={src} className="absolute inset-0 h-full w-full border-0" />
      </div>
    </div>
  );
}
