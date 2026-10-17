import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import {
  Circle,
  Eye,
  EyeOff,
  Hand,
  Import,
  Maximize,
  MousePointer2,
  Pentagon,
  Radio,
  Redo2,
  ScanLine,
  Send,
  Square,
  SquareDashed,
  Type,
  Undo2,
  Zap,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { duplicateElements, groupElements, removeElements, reorderElement, translateElements, ungroup } from '@bf/shared';
import { endpoints } from '../../lib/api';
import { Button, IconButton } from '../../components/ui';
import { toast } from '../../components/toast';
import { isTypingTarget } from '../../lib/hotkeys';
import { flushSave, useEditor, type Tool } from './editorStore';
import { EditorCanvas, topLevelSelection } from './EditorCanvas';
import { LayersPanel } from './LayersPanel';
import { AssetsPanel } from './AssetsPanel';
import { Inspector } from './inspector/Inspector';
import { MakeItLivePanel } from './MakeItLive';
import { ImportDialog } from './ImportDialog';
import { GeneratorDialog } from './GeneratorDialog';
import { TimelineDock } from '../animation/TimelineDock';

const TOOLS: { id: Tool; icon: typeof Square; label: string; key: string }[] = [
  { id: 'select', icon: MousePointer2, label: 'Select / move', key: 'V' },
  { id: 'hand', icon: Hand, label: 'Pan (or hold Space)', key: 'H' },
  { id: 'rect', icon: Square, label: 'Rectangle', key: 'M' },
  { id: 'ellipse', icon: Circle, label: 'Ellipse', key: 'O' },
  { id: 'text', icon: Type, label: 'Text', key: 'T' },
  { id: 'polygon', icon: Pentagon, label: 'Polygon / region outline', key: 'P' },
  { id: 'region', icon: SquareDashed, label: 'Region (mark a live area)', key: 'R' },
  { id: 'mask', icon: ScanLine, label: 'Mask (cover baked-in content)', key: 'K' },
];

function SaveIndicator() {
  const { saveState, saveError } = useEditor();
  const map = {
    saved: ['bg-ok', 'Saved'],
    dirty: ['bg-warn', 'Unsaved'],
    saving: ['bg-info live-pulse', 'Saving…'],
    error: ['bg-live', 'Save failed — retrying'],
    conflict: ['bg-live', 'Changed elsewhere'],
  } as const;
  const [dot, label] = map[saveState];
  return (
    <span className="flex items-center gap-1.5 text-xs text-ink-300" title={saveError ?? ''}>
      <span className={`h-2 w-2 rounded-full ${dot}`} /> {label}
      {saveState === 'conflict' && (
        <button className="ml-1 text-accent underline" onClick={() => location.reload()}>
          Reload
        </button>
      )}
    </span>
  );
}

export function Studio() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const st = useEditor();
  const { scene, zoom, tool, rightPanel, hasUnpublished, past, future } = st;
  const [leftTab, setLeftTab] = useState<'layers' | 'assets'>('layers');
  const [importOpen, setImportOpen] = useState(params.get('import') === '1');
  const [genOpen, setGenOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [dockOpen, setDockOpen] = useState(true);

  useEffect(() => {
    st.load(id).catch((e) => setError((e as Error).message));
    return () => void flushSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const publish = useCallback(async () => {
    setPublishing(true);
    try {
      if (!(await flushSave()) && useEditor.getState().saveState !== 'saved') throw new Error('Could not save before publishing.');
      const r = await endpoints.publish(id);
      useEditor.getState().markPublished(r.version);
      toast.success(`Published v${r.version} — the live overlay updated.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPublishing(false);
    }
  }, [id]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || document.querySelector('[role="dialog"]')) return;
      const s = useEditor.getState();
      if (!s.scene) return;
      const mod = e.ctrlKey || e.metaKey;
      const sel = s.selection;
      if (mod && e.code === 'KeyZ') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (mod && e.code === 'KeyY') {
        e.preventDefault();
        s.redo();
        return;
      }
      if (mod && e.code === 'KeyS') {
        e.preventDefault();
        void flushSave();
        return;
      }
      if (mod && e.code === 'KeyA') {
        e.preventDefault();
        s.select(s.scene.elements.filter((x) => x.parentId === null && !x.locked).map((x) => x.id));
        return;
      }
      if (mod && e.code === 'Digit0') {
        e.preventDefault();
        window.dispatchEvent(new Event('bf:fit'));
        return;
      }
      if (mod && e.code === 'Digit1') {
        e.preventDefault();
        s.setView(1, s.pan);
        return;
      }
      if (sel.length) {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          s.update((sc) => removeElements(sc, sel));
          s.select([]);
          return;
        }
        if (mod && e.code === 'KeyD') {
          e.preventDefault();
          let ids: string[] = [];
          s.update((sc) => void (ids = duplicateElements(sc, topLevelSelection(sc, sel))));
          s.select(ids);
          return;
        }
        if (mod && e.code === 'KeyG') {
          e.preventDefault();
          if (e.shiftKey) {
            let kids: string[] = [];
            s.update((sc) => void (kids = sel.flatMap((g) => ungroup(sc, g))));
            s.select(kids);
          } else {
            let gid: string | null = null;
            s.update((sc) => void (gid = groupElements(sc, topLevelSelection(sc, sel))));
            if (gid) s.select([gid]);
          }
          return;
        }
        if (mod && (e.code === 'BracketRight' || e.code === 'BracketLeft')) {
          e.preventDefault();
          const d = e.code === 'BracketRight' ? (e.shiftKey ? 'front' : 1) : e.shiftKey ? 'back' : -1;
          s.update((sc) => sel.forEach((x) => reorderElement(sc, x, d)));
          return;
        }
        const nudge = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
        if (nudge) {
          e.preventDefault();
          const k = e.shiftKey ? 10 : 1;
          s.update((sc) => translateElements(sc, topLevelSelection(sc, sel).filter((x) => !sc.elements.find((el) => el.id === x)?.locked), nudge[0]! * k, nudge[1]! * k), { coalesce: 'nudge' });
          return;
        }
        if (e.key === 'Escape') {
          s.select([]);
          return;
        }
      }
      if (!mod && !e.altKey) {
        const t = TOOLS.find((x) => x.key === e.key.toUpperCase());
        if (t) s.setTool(t.id);
        if (e.key === 'Escape') s.setTool('select');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (error)
    return (
      <div className="p-10 text-ink-300">
        {error} <Link to="/" className="text-accent underline">Back to projects</Link>
      </div>
    );
  if (!scene) return <div className="p-10 text-ink-400">Loading project…</div>;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-ink-800 bg-ink-900 px-3 py-1.5">
        <div className="mr-2 min-w-0">
          <div className="truncate text-sm font-semibold">{st.name}</div>
          <div className="text-[10px] text-ink-400">
            Studio · {scene.width}×{scene.height}
          </div>
        </div>
        <div className="flex items-center gap-0.5 rounded-lg border border-ink-700 bg-ink-850 p-0.5" role="toolbar" aria-label="Tools">
          {TOOLS.map((t) => (
            <IconButton key={t.id} title={`${t.label} (${t.key})`} active={tool === t.id} onClick={() => st.setTool(t.id)}>
              <t.icon className="h-4 w-4" />
            </IconButton>
          ))}
        </div>
        <div className="flex items-center gap-0.5">
          <IconButton title="Undo (Ctrl+Z)" onClick={st.undo} disabled={!past.length}>
            <Undo2 className="h-4 w-4" />
          </IconButton>
          <IconButton title="Redo (Ctrl+Shift+Z)" onClick={st.redo} disabled={!future.length}>
            <Redo2 className="h-4 w-4" />
          </IconButton>
        </div>
        <div className="flex items-center gap-0.5 text-xs text-ink-300">
          <IconButton title="Zoom out" onClick={() => st.setView(zoom / 1.25, st.pan)}>
            <ZoomOut className="h-4 w-4" />
          </IconButton>
          <span className="w-10 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
          <IconButton title="Zoom in" onClick={() => st.setView(zoom * 1.25, st.pan)}>
            <ZoomIn className="h-4 w-4" />
          </IconButton>
          <IconButton title="Fit (Ctrl+0)" onClick={() => window.dispatchEvent(new Event('bf:fit'))}>
            <Maximize className="h-4 w-4" />
          </IconButton>
        </div>
        <IconButton title={st.showRestHidden ? 'Hide animation-only graphics (TOUCHDOWN etc.)' : 'Show animation-only graphics (TOUCHDOWN etc.) for editing'} active={st.showRestHidden} onClick={() => st.set({ showRestHidden: !st.showRestHidden })}>
          {st.showRestHidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
        </IconButton>
        <div className="flex-1" />
        <SaveIndicator />
        <Button size="sm" onClick={() => setImportOpen(true)}>
          <Import className="h-4 w-4" /> Import design
        </Button>
        <Button size="sm" variant={rightPanel === 'live' ? 'primary' : 'default'} onClick={() => st.set({ rightPanel: rightPanel === 'live' ? 'inspector' : 'live' })}>
          <Zap className="h-4 w-4" /> Make It Live
        </Button>
        <Button size="sm" variant={hasUnpublished ? 'live' : 'default'} onClick={publish} disabled={publishing} title="Send this design to the live overlay (OBS)">
          <Send className="h-4 w-4" /> {publishing ? 'Publishing…' : hasUnpublished ? 'Publish to air' : 'Published'}
        </Button>
        <Link to={`/projects/${id}/live`} className="rounded-md p-1.5 text-live hover:bg-ink-700" title="Open the Control Room">
          <Radio className="h-4 w-4" />
        </Link>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-64 shrink-0 flex-col border-r border-ink-800 bg-ink-900">
          <div className="flex border-b border-ink-800 text-xs">
            {(['layers', 'assets'] as const).map((t) => (
              <button key={t} className={`flex-1 py-2 font-semibold capitalize ${leftTab === t ? 'border-b-2 border-accent text-ink-100' : 'text-ink-400 hover:text-ink-200'}`} onClick={() => setLeftTab(t)}>
                {t}
              </button>
            ))}
          </div>
          {leftTab === 'layers' ? <LayersPanel /> : <AssetsPanel />}
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <EditorCanvas />
          <TimelineDock open={dockOpen} onToggle={() => setDockOpen(!dockOpen)} projectId={id} />
        </div>
        <aside className="w-72 shrink-0 overflow-y-auto border-l border-ink-800 bg-ink-900">{rightPanel === 'live' ? <MakeItLivePanel onGenerate={() => setGenOpen(true)} /> : <Inspector />}</aside>
      </div>
      <ImportDialog
        open={importOpen}
        onClose={() => {
          setImportOpen(false);
          if (params.get('import')) setParams({});
        }}
        onImported={() => st.set({ rightPanel: 'live' })}
      />
      <GeneratorDialog open={genOpen} onClose={() => setGenOpen(false)} scene={scene} apply={(s) => st.update((cur) => Object.assign(cur, s))} />
    </div>
  );
}
