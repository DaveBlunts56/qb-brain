import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ChevronDown, ChevronUp, Play, Square } from 'lucide-react';
import type { EventTimeline, TeamSide } from '@bf/shared';
import { useEditor } from '../studio/editorStore';
import { canvasRendererRef } from '../studio/EditorCanvas';
import { TimelineEditor } from './TimelineEditor';
import { ClipEditor } from './ClipEditor';
import { useTimelinePreview } from './usePreview';

/** Compact animation timeline at the bottom of the Studio. */
export function TimelineDock({ open, onToggle, projectId }: { open: boolean; onToggle: () => void; projectId: string }) {
  const { scene, update } = useEditor();
  const [tlId, setTlId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [team, setTeam] = useState<TeamSide>('home');
  const preview = useTimelinePreview(() => canvasRendererRef.current);

  useEffect(() => {
    if (scene && (!tlId || !scene.timelines.some((t) => t.id === tlId))) setTlId(scene.timelines.find((t) => t.trigger === 'touchdown')?.id ?? scene.timelines[0]?.id ?? null);
  }, [scene, tlId]);

  if (!scene) return null;
  const tl = scene.timelines.find((t) => t.id === tlId) ?? null;
  const change = (mutate: (t: EventTimeline) => void, coalesce?: string) =>
    update(
      (s) => {
        const t = s.timelines.find((x) => x.id === tlId);
        if (t) mutate(t);
      },
      coalesce ? { coalesce } : undefined,
    );
  const track = tl && selected.length === 1 ? tl.tracks.find((t) => t.id === selected[0]) : null;

  return (
    <div className={`flex shrink-0 flex-col border-t border-ink-800 bg-ink-900 ${open ? 'h-64' : 'h-9'}`}>
      <div className="flex items-center gap-2 px-2 py-1">
        <button className="flex items-center gap-1 text-xs font-semibold text-ink-200" onClick={onToggle}>
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />} Animation timeline
        </button>
        {open && (
          <>
            <select className="field-sm w-48" value={tlId ?? ''} onChange={(e) => (setTlId(e.target.value), setSelected([]))}>
              {scene.timelines.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.enabled ? '' : ' (off)'}
                </option>
              ))}
              {!scene.timelines.length && <option value="">No timelines — Generate animations</option>}
            </select>
            <select className="field-sm w-24" value={team} onChange={(e) => setTeam(e.target.value as TeamSide)} title="Team used for team-coloured graphics">
              <option value="home">Home</option>
              <option value="away">Away</option>
            </select>
            {preview.isPlaying ? (
              <button className="flex items-center gap-1 rounded bg-live px-2 py-0.5 text-xs font-semibold" onClick={preview.stop}>
                <Square className="h-3 w-3" /> Stop
              </button>
            ) : (
              <button className="flex items-center gap-1 rounded bg-ok px-2 py-0.5 text-xs font-semibold text-ink-950 disabled:opacity-30" disabled={!tl} onClick={() => tl && preview.play(tl, team)}>
                <Play className="h-3 w-3" /> Preview on canvas
              </button>
            )}
            <div className="flex-1" />
            <Link to={`/projects/${projectId}/animate`} className="text-xs text-accent hover:underline">
              Open full Animation Editor →
            </Link>
          </>
        )}
      </div>
      {open && tl && (
        <div className="flex min-h-0 flex-1 border-t border-ink-800">
          <TimelineEditor scene={scene} timeline={tl} selected={selected} onSelect={setSelected} onChange={change} playheadMs={preview.playhead} compact />
          {track && (
            <div className="w-72 shrink-0 overflow-y-auto border-l border-ink-800 p-2">
              <ClipEditor clip={track.clip} onChange={(c) => change((t) => void (t.tracks.find((x) => x.id === track.id)!.clip = c), `clip:${track.id}`)} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
