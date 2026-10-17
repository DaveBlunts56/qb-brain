import { useEffect, useState } from 'react';
import { api } from './api';

export const HOTKEY_ACTIONS: { id: string; label: string; group: string }[] = [
  { id: 'away.+1', label: 'Away +1', group: 'Score' },
  { id: 'away.+2', label: 'Away +2', group: 'Score' },
  { id: 'away.+3', label: 'Away +3', group: 'Score' },
  { id: 'away.+6', label: 'Away +6', group: 'Score' },
  { id: 'home.+1', label: 'Home +1', group: 'Score' },
  { id: 'home.+2', label: 'Home +2', group: 'Score' },
  { id: 'home.+3', label: 'Home +3', group: 'Score' },
  { id: 'home.+6', label: 'Home +6', group: 'Score' },
  { id: 'clock.toggle', label: 'Start / stop game clock', group: 'Clock' },
  { id: 'playClock.reset40', label: 'Play clock long (reset & start)', group: 'Clock' },
  { id: 'playClock.reset25', label: 'Play clock short (reset & start)', group: 'Clock' },
  { id: 'possession.toggle', label: 'Switch possession', group: 'Situation' },
  { id: 'down.next', label: 'Next down', group: 'Situation' },
  { id: 'firstDown', label: '1st & 10', group: 'Situation' },
  { id: 'flag.toggle', label: 'Flag on/off', group: 'Situation' },
  { id: 'overlay.toggle', label: 'Show / hide scorebug', group: 'Graphics' },
  { id: 'undo', label: 'Undo last action', group: 'General' },
];

/** Normalised combo string for a keyboard event, e.g. "Ctrl+Shift+KeyZ". */
export function comboFromEvent(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(e.code);
  return parts.join('+');
}

export function comboLabel(combo: string): string {
  return combo
    .split('+')
    .map((p) => p.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Arrow/, '').replace('Ctrl', navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl'))
    .join('+');
}

export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

export function useHotkeyMap(): [Record<string, string>, (m: Record<string, string>) => void] {
  const [map, setMap] = useState<Record<string, string>>({});
  useEffect(() => {
    api
      .get<Record<string, string>>('/api/settings/hotkeys')
      .then(setMap)
      .catch(() => {});
  }, []);
  return [map, setMap];
}

/** Bind action handlers to the configured hotkeys. Ignored while typing or when a dialog is open. */
export function useHotkeys(map: Record<string, string>, handlers: Record<string, () => void>, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const byCombo = new Map<string, string>();
    for (const [action, combo] of Object.entries(map)) if (combo) byCombo.set(combo, action);
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || isTypingTarget(e.target)) return;
      if (document.querySelector('[role="dialog"]')) return;
      const action = byCombo.get(comboFromEvent(e));
      if (!action || !handlers[action]) return;
      e.preventDefault();
      handlers[action]();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [map, handlers, enabled]);
}
