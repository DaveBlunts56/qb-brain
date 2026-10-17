import { deriveEvents, type ReduceContext } from './reducer.js';
import type { EventDraft } from './events.js';
import { TEAM_SIDES, type GameState } from './types.js';

/**
 * Field-level inverse patches for operator undo. Undo restores only the
 * fields the original action changed, so undoing "+6" two minutes later
 * reverts the score without rewinding a game clock that kept running.
 */
export type UndoPatch = Record<string, unknown>;

const TOP_LEVEL_PATHS = [
  'period',
  'down',
  'distance',
  'goalToGo',
  'ballOn',
  'possession',
  'flag',
  'situationVisible',
  'playClockVisible',
  'labels',
  'config',
] as const;

const TEAM_KEYS = [
  'name',
  'mascot',
  'abbreviation',
  'record',
  'primaryColor',
  'secondaryColor',
  'textColor',
  'logoAssetId',
  'score',
  'timeouts',
] as const;

function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), obj);
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) cur = cur[keys[i]!] as Record<string, unknown>;
  cur[keys[keys.length - 1]!] = structuredClone(value);
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function createUndoPatch(before: GameState, after: GameState): UndoPatch {
  const patch: UndoPatch = {};
  const paths: string[] = [...TOP_LEVEL_PATHS];
  for (const side of TEAM_SIDES) for (const k of TEAM_KEYS) paths.push(`${side}.${k}`);
  // Clocks are only restored when they were stopped on both sides of the
  // change (e.g. a period change reset them). A running clock is never rewound.
  for (const clock of ['gameClock', 'playClock'] as const) {
    if (!before[clock].running && !after[clock].running) paths.push(clock);
  }
  for (const path of paths) {
    const b = getPath(before, path);
    if (!same(b, getPath(after, path))) patch[path] = structuredClone(b);
  }
  return patch;
}

export function applyUndoPatch(state: GameState, patch: UndoPatch, ctx: ReduceContext): { state: GameState; events: EventDraft[] } {
  const next = structuredClone(state) as unknown as Record<string, unknown>;
  for (const [path, value] of Object.entries(patch)) {
    if (path === 'gameClock' || path === 'playClock') {
      const clock = value as GameState['gameClock'];
      setPath(next, path, { ...clock, running: false, anchorMono: ctx.nowMono, anchorWall: ctx.nowWall });
    } else {
      setPath(next, path, value);
    }
  }
  const after = next as unknown as GameState;
  return { state: after, events: deriveEvents(state, after, ctx) };
}

export function isEmptyPatch(patch: UndoPatch): boolean {
  return Object.keys(patch).length === 0;
}
