import { create } from 'zustand';
import {
  createSampleGameState,
  fitGroupsToChildren,
  TEMPLATE_AWAY,
  TEMPLATE_HOME,
  type GameState,
  type GraphicElement,
  type Scene,
} from '@bf/shared';
import { ApiError, endpoints, type Asset } from '../../lib/api';

export type Tool = 'select' | 'rect' | 'ellipse' | 'text' | 'polygon' | 'region' | 'mask' | 'hand';
export type SaveState = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict';
export type RightPanel = 'inspector' | 'live';

const HISTORY_LIMIT = 150;
let lastEdit: { key: string | null; at: number } = { key: null, at: 0 };

interface EditorStore {
  projectId: string | null;
  name: string;
  scene: Scene | null;
  rev: number | null;
  publishedVersion: number;
  hasUnpublished: boolean;
  selection: string[];
  tool: Tool;
  zoom: number;
  pan: { x: number; y: number };
  past: Scene[];
  future: Scene[];
  saveState: SaveState;
  saveError: string | null;
  assets: Asset[];
  showRestHidden: boolean;
  previewState: GameState;
  rightPanel: RightPanel;
  /** Region-detection candidates shown on the canvas (Make It Live). */
  candidates: Candidate[];

  load(projectId: string): Promise<void>;
  /** Mutate the scene. history=false while dragging; call checkpoint() once before. */
  update(mutate: (s: Scene) => void, opts?: { history?: boolean; coalesce?: string }): void;
  checkpoint(): void;
  undo(): void;
  redo(): void;
  select(ids: string[]): void;
  setTool(t: Tool): void;
  setView(zoom: number, pan: { x: number; y: number }): void;
  setAssets(a: Asset[]): void;
  set(patch: Partial<EditorStore>): void;
  markPublished(version: number): void;
}

export interface Candidate {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  kind: 'text' | 'largeText' | 'panel' | 'logo';
  confidence: number;
  complexBackground: boolean;
  fill: { top: string; bottom: string };
}

export const useEditor = create<EditorStore>((set, get) => ({
  projectId: null,
  name: '',
  scene: null,
  rev: null,
  publishedVersion: 0,
  hasUnpublished: false,
  selection: [],
  tool: 'select',
  zoom: 0.5,
  pan: { x: 40, y: 40 },
  past: [],
  future: [],
  saveState: 'saved',
  saveError: null,
  assets: [],
  showRestHidden: false,
  previewState: createSampleGameState(TEMPLATE_HOME, TEMPLATE_AWAY),
  rightPanel: 'inspector',
  candidates: [],

  async load(projectId) {
    const p = await endpoints.project(projectId);
    const assets = await endpoints.assets(projectId).catch(() => []);
    set({
      projectId,
      name: p.name,
      scene: p.draft,
      rev: p.draftRev,
      publishedVersion: p.publishedVersion,
      hasUnpublished: JSON.stringify(p.draft) !== JSON.stringify(p.published),
      selection: [],
      past: [],
      future: [],
      saveState: 'saved',
      saveError: null,
      assets,
      candidates: [],
    });
    // Preview with the project's real teams so logos/colours match what will air.
    endpoints
      .match(projectId)
      .then((m) => {
        const s = createSampleGameState(m.state.home, m.state.away);
        s.labels = m.state.labels;
        s.config = m.state.config;
        set({ previewState: s });
      })
      .catch(() => {});
  },

  update(mutate, opts = {}) {
    const cur = get().scene;
    if (!cur) return;
    const next = structuredClone(cur);
    mutate(next);
    fitGroupsToChildren(next);
    // Continuous edits (colour drags, typing) with the same key collapse into one undo step.
    const now = performance.now();
    const coalesced = opts.coalesce !== undefined && lastEdit.key === opts.coalesce && now - lastEdit.at < 900;
    lastEdit = { key: opts.coalesce ?? null, at: now };
    if (opts.history === false || coalesced) {
      set({ scene: next, saveState: 'dirty', hasUnpublished: true });
    } else {
      set({ scene: next, past: [...get().past.slice(-HISTORY_LIMIT), cur], future: [], saveState: 'dirty', hasUnpublished: true });
    }
    scheduleSave();
  },

  checkpoint() {
    const cur = get().scene;
    if (cur) set({ past: [...get().past.slice(-HISTORY_LIMIT), cur], future: [] });
  },

  undo() {
    const { past, scene, future } = get();
    if (!past.length || !scene) return;
    const prev = past[past.length - 1]!;
    set({ scene: prev, past: past.slice(0, -1), future: [scene, ...future], saveState: 'dirty', selection: get().selection.filter((id) => prev.elements.some((e) => e.id === id)) });
    scheduleSave();
  },

  redo() {
    const { past, scene, future } = get();
    if (!future.length || !scene) return;
    const next = future[0]!;
    set({ scene: next, past: [...past, scene], future: future.slice(1), saveState: 'dirty', selection: get().selection.filter((id) => next.elements.some((e) => e.id === id)) });
    scheduleSave();
  },

  select(ids) {
    set({ selection: ids });
  },
  setTool(tool) {
    set({ tool });
  },
  setView(zoom, pan) {
    set({ zoom: Math.min(8, Math.max(0.05, zoom)), pan });
  },
  setAssets(assets) {
    set({ assets });
  },
  set(patch) {
    set(patch);
  },
  markPublished(version) {
    set({ publishedVersion: version, hasUnpublished: false });
  },
}));

// ---- autosave ---------------------------------------------------------------

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saving = false;
let pending = false;

function scheduleSave(delay = 700) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void flushSave(), delay);
}

export async function flushSave(): Promise<boolean> {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  const st = useEditor.getState();
  if (!st.projectId || !st.scene || st.saveState === 'conflict') return false;
  if (st.saveState === 'saved') return true;
  if (saving) {
    pending = true;
    return false;
  }
  saving = true;
  const scene = st.scene;
  useEditor.setState({ saveState: 'saving' });
  try {
    const r = await endpoints.saveScene(st.projectId, scene, st.rev);
    const changedSince = useEditor.getState().scene !== scene;
    useEditor.setState({ rev: r.rev, saveState: changedSince ? 'dirty' : 'saved', saveError: null });
    return true;
  } catch (e) {
    const err = e as ApiError;
    if (err.code === 'REV_CONFLICT') useEditor.setState({ saveState: 'conflict', saveError: err.message });
    else if (err.status === 400 || err.status === 413) {
      // Not transient: retrying the same scene cannot succeed. Undo or fix, then the next edit saves again.
      useEditor.setState({ saveState: 'error', saveError: `Not saved: ${err.message}` });
    } else {
      useEditor.setState({ saveState: 'error', saveError: err.message });
      scheduleSave(3000);
    }
    return false;
  } finally {
    saving = false;
    if (pending || (useEditor.getState().saveState === 'dirty' && useEditor.getState().scene !== scene)) {
      pending = false;
      scheduleSave(200);
    }
  }
}

// Warn before closing the tab with unsaved edits.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (e) => {
    const s = useEditor.getState().saveState;
    if (s === 'dirty' || s === 'saving' || s === 'error') {
      void flushSave();
      e.preventDefault();
    }
  });
}

export function selectedElements(): GraphicElement[] {
  const { scene, selection } = useEditor.getState();
  if (!scene) return [];
  return scene.elements.filter((e) => selection.includes(e.id));
}
