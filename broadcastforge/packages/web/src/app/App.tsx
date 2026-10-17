import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { Toaster } from '../components/toast';
import { AppShell } from './AppShell';
import { Dashboard } from '../pages/Dashboard';

const ControlRoom = lazy(() => import('../pages/ControlRoom').then((m) => ({ default: m.ControlRoom })));
const Studio = lazy(() => import('../pages/studio/Studio').then((m) => ({ default: m.Studio })));
const AnimationEditor = lazy(() => import('../pages/animation/AnimationEditor').then((m) => ({ default: m.AnimationEditor })));
const ObsPage = lazy(() => import('../pages/ObsPage').then((m) => ({ default: m.ObsPage })));
const SettingsPage = lazy(() => import('../pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const PairPage = lazy(() => import('../pages/PairPage').then((m) => ({ default: m.PairPage })));

function Loading() {
  return <div className="flex h-full items-center justify-center text-sm text-ink-400">Loading…</div>;
}

export function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/pair" element={<PairPage />} />
          <Route element={<AppShell />}>
            <Route index element={<Dashboard />} />
            <Route path="projects/:id/studio" element={<Studio />} />
            <Route path="projects/:id/animate" element={<AnimationEditor />} />
            <Route path="projects/:id/live" element={<ControlRoom />} />
            <Route path="obs" element={<ObsPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<div className="p-10 text-ink-300">Page not found.</div>} />
          </Route>
        </Routes>
      </Suspense>
      <Toaster />
    </BrowserRouter>
  );
}
