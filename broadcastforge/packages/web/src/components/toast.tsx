import { create } from 'zustand';
import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';
import { createId } from '@bf/shared';

export interface Toast {
  id: string;
  kind: 'info' | 'success' | 'error' | 'warn';
  message: string;
  action?: { label: string; run: () => void };
  ttl: number;
}

interface ToastStore {
  toasts: Toast[];
  push: (t: Omit<Toast, 'id' | 'ttl'> & { ttl?: number }) => string;
  dismiss: (id: string) => void;
}

export const useToasts = create<ToastStore>((set, get) => ({
  toasts: [],
  push: (t) => {
    const id = createId('t');
    const ttl = t.ttl ?? (t.kind === 'error' ? 7000 : 3500);
    set({ toasts: [...get().toasts.slice(-4), { ...t, id, ttl }] });
    setTimeout(() => get().dismiss(id), ttl);
    return id;
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((x) => x.id !== id) }),
}));

export const toast = {
  info: (message: string, action?: Toast['action'], ttl?: number) => useToasts.getState().push({ kind: 'info', message, action, ttl }),
  success: (message: string, action?: Toast['action']) => useToasts.getState().push({ kind: 'success', message, action }),
  error: (message: string) => useToasts.getState().push({ kind: 'error', message }),
  warn: (message: string) => useToasts.getState().push({ kind: 'warn', message }),
};

export function Toaster() {
  const { toasts, dismiss } = useToasts();
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(420px,calc(100vw-2rem))] flex-col gap-2" role="status" aria-live="polite">
      {toasts.map((t) => {
        const Icon = t.kind === 'success' ? CheckCircle2 : t.kind === 'error' || t.kind === 'warn' ? TriangleAlert : Info;
        const color = t.kind === 'success' ? 'text-ok' : t.kind === 'error' ? 'text-live' : t.kind === 'warn' ? 'text-warn' : 'text-info';
        return (
          <div key={t.id} className="pointer-events-auto flex items-start gap-3 rounded-lg border border-ink-600 bg-ink-800/95 px-3 py-2.5 shadow-2xl backdrop-blur">
            <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${color}`} />
            <div className="flex-1 text-sm text-ink-100">{t.message}</div>
            {t.action && (
              <button
                className="shrink-0 rounded bg-accent px-2 py-0.5 text-xs font-bold text-ink-950 hover:brightness-110"
                onClick={() => {
                  t.action!.run();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            <button className="text-ink-400 hover:text-ink-100" onClick={() => dismiss(t.id)} aria-label="Dismiss">
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
