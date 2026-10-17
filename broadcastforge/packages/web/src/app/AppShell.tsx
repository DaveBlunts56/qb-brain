import { Suspense, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useMatch } from 'react-router';
import { Cable, Clapperboard, LayoutGrid, PenTool, Radio, Settings, Sparkles } from 'lucide-react';
import { endpoints, type SystemInfo } from '../lib/api';
import { create } from 'zustand';

/** The last project the user worked on, so nav links keep their context. */
export const useCurrentProject = create<{ id: string | null; name: string; set: (id: string, name: string) => void }>((set) => ({
  id: localStorageGet('bf.lastProject'),
  name: '',
  set: (id, name) => {
    localStorageSet('bf.lastProject', id);
    set({ id, name });
  },
}));

function localStorageGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function localStorageSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode */
  }
}

export const useSystemInfo = create<{ info: SystemInfo | null; load: () => Promise<void> }>((set) => ({
  info: null,
  load: async () => {
    try {
      set({ info: await endpoints.info() });
    } catch {
      /* shown elsewhere */
    }
  },
}));

function NavItem({ to, icon: Icon, label, disabled }: { to: string; icon: typeof Radio; label: string; disabled?: boolean }) {
  if (disabled)
    return (
      <span className="flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-[10px] font-medium text-ink-600" title={`${label} — open a project first`}>
        <Icon className="h-5 w-5" />
        {label}
      </span>
    );
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-[10px] font-medium transition ${isActive ? 'bg-ink-700 text-accent' : 'text-ink-300 hover:bg-ink-800 hover:text-ink-100'}`
      }
    >
      <Icon className="h-5 w-5" />
      {label}
    </NavLink>
  );
}

export function AppShell() {
  const match = useMatch('/projects/:id/*');
  const current = useCurrentProject();
  const { info, load } = useSystemInfo();
  const loc = useLocation();
  const [online, setOnline] = useState(true);
  const pid = match?.params.id ?? current.id;

  useEffect(() => {
    void load();
  }, [load]);

  // Nav links need a project: default to the most recently edited one (or forget a deleted one).
  useEffect(() => {
    endpoints
      .projects()
      .then((list) => {
        const st = useCurrentProject.getState();
        const known = list.find((p) => p.id === st.id);
        if (known) st.set(known.id, known.name);
        else if (list[0]) st.set(list[0].id, list[0].name);
      })
      .catch(() => {});
  }, [loc.pathname]);

  useEffect(() => {
    if (match?.params.id && match.params.id !== current.id) {
      endpoints
        .project(match.params.id)
        .then((p) => current.set(p.id, p.name))
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match?.params.id]);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  const fullBleed = /\/(studio|animate|live)$/.test(loc.pathname);

  return (
    <div className="flex h-full">
      <nav className="flex w-[72px] shrink-0 flex-col items-stretch gap-1 border-r border-ink-800 bg-ink-900 px-1.5 py-3" aria-label="Main">
        <div className="mb-3 flex flex-col items-center" title="BroadcastForge Studio">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-live to-accent font-display text-lg font-bold text-white">BF</div>
        </div>
        <NavItem to="/" icon={LayoutGrid} label="Projects" />
        <NavItem to={pid ? `/projects/${pid}/studio` : '/'} icon={PenTool} label="Studio" disabled={!pid} />
        <NavItem to={pid ? `/projects/${pid}/animate` : '/'} icon={Sparkles} label="Animate" disabled={!pid} />
        <NavItem to={pid ? `/projects/${pid}/live` : '/'} icon={Radio} label="Live" disabled={!pid} />
        <NavItem to="/obs" icon={Cable} label="OBS" />
        <div className="flex-1" />
        <NavItem to="/settings" icon={Settings} label="Settings" />
        <div className="mt-2 text-center text-[9px] text-ink-500" title={info ? `BroadcastForge ${info.version}` : ''}>
          <Clapperboard className="mx-auto mb-0.5 h-3 w-3" />v{info?.version ?? '…'}
        </div>
      </nav>
      <main className={`min-w-0 flex-1 ${fullBleed ? 'overflow-hidden' : 'overflow-y-auto'}`}>
        {!online && <div className="bg-warn px-4 py-1 text-center text-xs font-semibold text-ink-950">This device is offline. The overlay keeps its last state; reconnect to control it.</div>}
        <Suspense fallback={<div className="p-8 text-ink-400">Loading…</div>}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
