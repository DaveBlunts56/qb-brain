import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { X } from 'lucide-react';

type Variant = 'default' | 'primary' | 'danger' | 'ghost' | 'live' | 'success';

const VARIANTS: Record<Variant, string> = {
  default: 'bg-ink-700 hover:bg-ink-600 text-ink-100 border border-ink-600',
  primary: 'bg-accent hover:brightness-110 text-ink-950 font-semibold border border-accent',
  danger: 'bg-live/15 hover:bg-live/30 text-red-300 border border-live/50',
  ghost: 'hover:bg-ink-700 text-ink-200 border border-transparent',
  live: 'bg-live hover:brightness-110 text-white font-semibold border border-live',
  success: 'bg-ok/90 hover:bg-ok text-ink-950 font-semibold border border-ok',
};

export function Button({
  variant = 'default',
  size = 'md',
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg' }) {
  const sz = size === 'sm' ? 'px-2 py-1 text-xs gap-1' : size === 'lg' ? 'px-4 py-2.5 text-base gap-2' : 'px-3 py-1.5 text-sm gap-1.5';
  return (
    <button
      className={`inline-flex select-none items-center justify-center rounded-md transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 ${VARIANTS[variant]} ${sz} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function IconButton({ title, active, className = '', children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { title: string; active?: boolean }) {
  return (
    <button
      title={title}
      aria-label={title}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition disabled:opacity-30 ${active ? 'bg-accent/20 text-accent' : 'text-ink-300 hover:bg-ink-700 hover:text-ink-100'} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Modal({ open, onClose, title, children, width = 'max-w-lg', footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; width?: string; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`flex max-h-[90vh] w-full ${width} flex-col overflow-hidden rounded-xl border border-ink-600 bg-ink-850 shadow-2xl`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="flex items-center justify-between border-b border-ink-700 px-5 py-3">
          <h2 className="font-display text-xl font-semibold tracking-wide">{title}</h2>
          <IconButton title="Close" onClick={onClose}>
            <X className="h-4 w-4" />
          </IconButton>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-ink-700 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/** Confirmation for disruptive actions. Optionally requires typing a word. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  danger,
  requireText,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  requireText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState('');
  useEffect(() => setText(''), [open]);
  const ok = !requireText || text.trim().toUpperCase() === requireText.toUpperCase();
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant={danger ? 'live' : 'primary'} disabled={!ok} onClick={onConfirm} autoFocus={!requireText}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-ink-200">
        {message}
        {requireText && (
          <div>
            <label className="label">Type {requireText} to confirm</label>
            <input className="field" value={text} onChange={(e) => setText(e.target.value)} autoFocus onKeyDown={(e) => e.key === 'Enter' && ok && onConfirm()} />
          </div>
        )}
      </div>
    </Modal>
  );
}

export function StatusDot({ state, label }: { state: 'ok' | 'warn' | 'error' | 'idle' | 'live'; label: string }) {
  const color = { ok: 'bg-ok', warn: 'bg-warn', error: 'bg-live', idle: 'bg-ink-500', live: 'bg-live live-pulse' }[state];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-200" title={label}>
      <span className={`h-2 w-2 rounded-full ${color}`} />
      <span className="truncate">{label}</span>
    </span>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className={`inline-flex cursor-pointer select-none items-center gap-2 text-sm ${disabled ? 'opacity-40' : ''}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition ${checked ? 'bg-accent' : 'bg-ink-600'}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </button>
      {label && <span className="text-ink-200">{label}</span>}
    </label>
  );
}

/** Number input that commits on blur/Enter and supports arrow-key nudging. */
export function NumberField({
  value,
  onChange,
  step = 1,
  min,
  max,
  className = 'field-sm',
  suffix,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  className?: string;
  suffix?: string;
  label?: string;
}) {
  const [text, setText] = useState(String(round(value)));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(String(round(value)));
  }, [value]);
  const commit = (t: string) => {
    const n = Number(t);
    if (!Number.isFinite(n)) return setText(String(round(value)));
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
    onChange(clamped);
    setText(String(round(clamped)));
  };
  return (
    <div className="relative flex items-center">
      {label && <span className="pointer-events-none absolute left-1.5 text-[10px] font-semibold text-ink-500">{label}</span>}
      <input
        className={`${className} ${label ? 'pl-5' : ''} ${suffix ? 'pr-6' : ''}`}
        value={text}
        inputMode="decimal"
        onFocus={() => (focused.current = true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => {
          focused.current = false;
          commit(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const d = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
            commit(String(round(value + d)));
          }
        }}
      />
      {suffix && <span className="pointer-events-none absolute right-1.5 text-[10px] text-ink-500">{suffix}</span>}
    </div>
  );
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}

export function Select<T extends string>({ value, onChange, options, className = 'field-sm' }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; className?: string }) {
  return (
    <select className={className} value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 p-8 text-center text-ink-400">
      {icon}
      <div className="font-medium text-ink-200">{title}</div>
      {children && <div className="max-w-sm text-sm">{children}</div>}
    </div>
  );
}

export function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Insecure LAN contexts lack the async clipboard API.
      const ta = document.createElement('textarea');
      ta.value = value;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="flex items-center gap-2">
      <input className="field font-mono text-xs" readOnly value={value} onFocus={(e) => e.target.select()} />
      <Button size="sm" onClick={copy} className="w-16 shrink-0">
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}
