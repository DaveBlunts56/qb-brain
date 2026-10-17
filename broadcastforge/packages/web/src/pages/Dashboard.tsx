import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Copy, Download, FilePlus2, Import, MoreVertical, Pencil, PenTool, Radio, Sparkles, Trash2, Upload } from 'lucide-react';
import { createFootballTemplateScene, createSampleGameState, SOCKET, TEMPLATE_AWAY, TEMPLATE_HOME, type GameState, type Scene } from '@bf/shared';
import { io } from 'socket.io-client';
import { api, endpoints, type ProjectSummary } from '../lib/api';
import { Button, ConfirmDialog, Empty, Modal } from '../components/ui';
import { ScenePreview } from '../components/ScenePreview';
import { toast } from '../components/toast';
import { useCurrentProject } from '../app/AppShell';

const SAMPLE: GameState = createSampleGameState(TEMPLATE_HOME, TEMPLATE_AWAY);

function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ts).toLocaleDateString();
}

function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function ProjectCard({ p, onChanged }: { p: ProjectSummary; onChanged: () => void }) {
  const [scene, setScene] = useState<Scene | null>(null);
  const [menu, setMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(p.name);
  const nav = useNavigate();
  const setCurrent = useCurrentProject((s) => s.set);

  useEffect(() => {
    let alive = true;
    endpoints
      .project(p.id)
      .then((full) => alive && setScene(full.draft))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [p.id, p.updatedAt]);

  const open = (where: 'studio' | 'animate' | 'live') => {
    setCurrent(p.id, p.name);
    nav(`/projects/${p.id}/${where}`);
  };

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMenu(false);
    try {
      await fn();
      toast.success(ok);
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="group panel flex flex-col overflow-hidden transition hover:border-ink-500">
      <button className="checker relative aspect-video w-full overflow-hidden" onClick={() => open('studio')} aria-label={`Open ${p.name} in Studio`}>
        {scene ? <ScenePreview scene={scene} state={SAMPLE} className="absolute inset-0" /> : <div className="absolute inset-0 animate-pulse bg-ink-800" />}
        {p.hasUnpublishedChanges && <span className="absolute left-2 top-2 rounded bg-accent px-1.5 py-0.5 text-[10px] font-bold text-ink-950">UNPUBLISHED CHANGES</span>}
      </button>
      <div className="flex items-start gap-2 p-3">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <input
              className="field py-0.5"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                setRenaming(false);
                if (name.trim() && name !== p.name) void run(() => api.patch(`/api/projects/${p.id}`, { name: name.trim() }), 'Renamed');
              }}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          ) : (
            <div className="truncate font-semibold text-ink-100">{p.name}</div>
          )}
          <div className="mt-0.5 text-xs text-ink-400">
            American football · {p.width}×{p.height} · {timeAgo(p.updatedAt)}
          </div>
        </div>
        <div className="relative">
          <button className="rounded p-1 text-ink-400 hover:bg-ink-700 hover:text-ink-100" onClick={() => setMenu((m) => !m)} aria-label="Project menu">
            <MoreVertical className="h-4 w-4" />
          </button>
          {menu && (
            <div className="absolute right-0 top-8 z-20 w-44 overflow-hidden rounded-lg border border-ink-600 bg-ink-800 py-1 shadow-xl" onMouseLeave={() => setMenu(false)}>
              <MenuItem icon={Pencil} label="Rename" onClick={() => (setMenu(false), setRenaming(true))} />
              <MenuItem icon={Copy} label="Duplicate" onClick={() => run(() => api.post(`/api/projects/${p.id}/duplicate`), 'Project duplicated')} />
              <MenuItem
                icon={Download}
                label="Export"
                onClick={() =>
                  run(async () => {
                    const bundle = await api.get(`/api/projects/${p.id}/export`);
                    downloadJson(bundle, `${p.name.replace(/[^\w-]+/g, '_')}.bfproject.json`);
                  }, 'Project exported')
                }
              />
              <MenuItem icon={Trash2} label="Delete" danger onClick={() => (setMenu(false), setConfirmDelete(true))} />
            </div>
          )}
        </div>
      </div>
      <div className="grid grid-cols-3 border-t border-ink-700 text-xs">
        <button className="flex items-center justify-center gap-1.5 py-2 text-ink-200 hover:bg-ink-750" onClick={() => open('studio')}>
          <PenTool className="h-3.5 w-3.5" /> Studio
        </button>
        <button className="flex items-center justify-center gap-1.5 border-x border-ink-700 py-2 text-ink-200 hover:bg-ink-750" onClick={() => open('animate')}>
          <Sparkles className="h-3.5 w-3.5" /> Animate
        </button>
        <button className="flex items-center justify-center gap-1.5 py-2 font-semibold text-live hover:bg-live/10" onClick={() => open('live')}>
          <Radio className="h-3.5 w-3.5" /> Go live
        </button>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        title="Delete project?"
        danger
        confirmLabel="Delete forever"
        requireText="DELETE"
        message={
          <p>
            <b>{p.name}</b>, its uploaded artwork and its game history will be permanently deleted. Any OBS Browser Source pointing at this overlay will go blank.
          </p>
        }
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          void run(() => api.del(`/api/projects/${p.id}`), 'Project deleted');
        }}
      />
    </div>
  );
}

function MenuItem({ icon: Icon, label, onClick, danger }: { icon: typeof Copy; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-ink-700 ${danger ? 'text-red-300' : 'text-ink-100'}`} onClick={onClick}>
      <Icon className="h-4 w-4" /> {label}
    </button>
  );
}

type Start = 'football' | 'import' | 'blank';

function NewProjectWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState('Friday Night Football');
  const [res, setRes] = useState<'1080p' | '720p'>('1080p');
  const [start, setStart] = useState<Start>('football');
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const setCurrent = useCurrentProject((s) => s.set);
  const templatePreview = useMemo(() => createFootballTemplateScene(), []);

  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  const create = async () => {
    setBusy(true);
    try {
      const [width, height] = res === '1080p' ? [1920, 1080] : [1280, 720];
      const p = await endpoints.createProject({ name: name.trim() || 'Untitled', width, height, template: start === 'football' ? 'football' : 'blank' });
      setCurrent(p.id, p.name);
      onClose();
      nav(`/projects/${p.id}/${start === 'football' ? 'live' : 'studio'}${start === 'import' ? '?import=1' : ''}`);
      toast.success(start === 'football' ? 'Example scorebug ready. Try the score buttons!' : 'Project created');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const Option = ({ value, title, desc, children }: { value: Start; title: string; desc: string; children?: React.ReactNode }) => (
    <button onClick={() => setStart(value)} className={`flex flex-col overflow-hidden rounded-lg border text-left transition ${start === value ? 'border-accent ring-1 ring-accent' : 'border-ink-600 hover:border-ink-400'}`}>
      <div className="checker relative aspect-video w-full">{children}</div>
      <div className="p-2.5">
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-xs text-ink-400">{desc}</div>
      </div>
    </button>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New scorebug project"
      width="max-w-3xl"
      footer={
        <>
          {step > 0 && <Button onClick={() => setStep(step - 1)}>Back</Button>}
          {step < 2 ? (
            <Button variant="primary" onClick={() => setStep(step + 1)} disabled={!name.trim()}>
              Next
            </Button>
          ) : (
            <Button variant="primary" onClick={create} disabled={busy}>
              {busy ? 'Creating…' : 'Create project'}
            </Button>
          )}
        </>
      }
    >
      <div className="mb-4 flex gap-2 text-xs">
        {['Basics', 'Canvas', 'Start from'].map((s, i) => (
          <span key={s} className={`rounded-full px-2.5 py-1 ${i === step ? 'bg-accent text-ink-950 font-semibold' : i < step ? 'bg-ink-700 text-ink-200' : 'bg-ink-800 text-ink-500'}`}>
            {i + 1}. {s}
          </span>
        ))}
      </div>
      {step === 0 && (
        <div className="space-y-4">
          <div>
            <label className="label">Project name</label>
            <input className="field" value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={80} />
          </div>
          <div>
            <label className="label">Sport</label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <button className="rounded-lg border border-accent bg-accent/10 px-3 py-2 text-sm font-semibold">🏈 American football</button>
              {['Basketball', 'Soccer', 'Volleyball'].map((s) => (
                <button key={s} disabled className="rounded-lg border border-ink-700 px-3 py-2 text-sm text-ink-500" title="Coming soon">
                  {s} <span className="block text-[10px]">coming soon</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {step === 1 && (
        <div className="grid grid-cols-2 gap-3">
          {(['1080p', '720p'] as const).map((r) => (
            <button key={r} onClick={() => setRes(r)} className={`rounded-lg border p-4 text-left ${res === r ? 'border-accent ring-1 ring-accent' : 'border-ink-600 hover:border-ink-400'}`}>
              <div className="font-display text-2xl font-bold">{r === '1080p' ? '1920 × 1080' : '1280 × 720'}</div>
              <div className="text-xs text-ink-400">{r === '1080p' ? 'Full HD — recommended for most OBS setups' : 'HD — lighter on older streaming PCs'}</div>
            </button>
          ))}
          <p className="col-span-2 text-xs text-ink-400">Match this to OBS → Settings → Video → Base (Canvas) Resolution for pixel-perfect graphics.</p>
        </div>
      )}
      {step === 2 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Option value="football" title="Gridiron Pro example" desc="Complete animated football scorebug. Fully editable.">
            <ScenePreview scene={templatePreview} state={SAMPLE} className="absolute inset-0" />
          </Option>
          <Option value="import" title="Import my design" desc="PNG, JPEG, WebP, SVG or PSD, then Make It Live.">
            <div className="absolute inset-0 flex items-center justify-center text-ink-400">
              <Upload className="h-10 w-10" />
            </div>
          </Option>
          <Option value="blank" title="Blank canvas" desc="Build from shapes and text.">
            <div className="absolute inset-0 flex items-center justify-center text-ink-500">
              <FilePlus2 className="h-10 w-10" />
            </div>
          </Option>
        </div>
      )}
    </Modal>
  );
}

export function Dashboard() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wizard, setWizard] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setProjects(await endpoints.projects());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
    // Live refresh when another window changes projects.
    const s = io({ transports: ['websocket', 'polling'] });
    s.on('connect', () => s.emit(SOCKET.staffJoin, {}));
    s.on(SOCKET.projectsChanged, () => void load());
    return () => void s.disconnect();
  }, [load]);

  const importFile = async (file: File) => {
    try {
      if (file.size > 80 * 1024 * 1024) throw new Error('File is too large');
      const bundle = JSON.parse(await file.text());
      await api.post('/api/projects/import', bundle);
      toast.success(`Imported ${file.name}`);
      void load();
    } catch (e) {
      toast.error(e instanceof SyntaxError ? 'That file is not a BroadcastForge project (.bfproject.json).' : (e as Error).message);
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-bold tracking-wide">Projects</h1>
          <p className="mt-1 text-sm text-ink-400">Scorebug designs, their live games and their OBS overlays. Everything is stored on this computer.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => fileRef.current?.click()}>
            <Import className="h-4 w-4" /> Import project
          </Button>
          <Button variant="primary" onClick={() => setWizard(true)}>
            <FilePlus2 className="h-4 w-4" /> New project
          </Button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importFile(f);
            e.target.value = '';
          }}
        />
      </div>
      {error && <div className="mb-6 rounded-lg border border-live/50 bg-live/10 p-4 text-sm text-red-200">{error}</div>}
      {projects === null && !error && <div className="text-ink-400">Loading projects…</div>}
      {projects?.length === 0 && (
        <Empty icon={<FilePlus2 className="h-10 w-10" />} title="No projects yet">
          <Button variant="primary" className="mt-3" onClick={() => setWizard(true)}>
            Create your first scorebug
          </Button>
        </Empty>
      )}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {projects?.map((p) => (
          <ProjectCard key={p.id} p={p} onChanged={load} />
        ))}
      </div>
      <div className="mt-10 grid gap-4 text-sm text-ink-300 md:grid-cols-3">
        <Link to="/obs" className="panel p-4 hover:border-ink-500">
          <div className="font-semibold text-ink-100">1 · Connect OBS</div>
          Add the overlay as a Browser Source automatically, or copy its URL.
        </Link>
        <div className="panel p-4">
          <div className="font-semibold text-ink-100">2 · Design & animate</div>
          Import your artwork, map live fields with Make It Live, then generate animations.
        </div>
        <div className="panel p-4">
          <div className="font-semibold text-ink-100">3 · Go live</div>
          Run the game from the Control Room on this computer or a paired tablet.
        </div>
      </div>
      <NewProjectWizard open={wizard} onClose={() => setWizard(false)} />
    </div>
  );
}
