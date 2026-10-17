import type { TeamSide } from '../game/types.js';
import type { FieldRole } from '../scene/roles.js';
import type { GraphicElement, Scene } from '../scene/types.js';

/** Components that only appear during animations (never part of the resting scorebug). */
const TRANSIENT_COMPONENTS = new Set(['tdTakeover', 'eventBanner', 'sweep']);

export function isTransientComponent(el: GraphicElement): boolean {
  return el.restHidden || TRANSIENT_COMPONENTS.has(el.meta?.component ?? '');
}

/**
 * The elements that make up the resting scorebug, as animation targets.
 * If the whole bug is wrapped in a single group, its children are used so
 * entrances can stagger section by section.
 */
export function bugRoots(scene: Scene): GraphicElement[] {
  const top = scene.elements.filter((e) => e.parentId === null && e.visible && !isTransientComponent(e));
  if (top.length === 1 && top[0]!.type === 'group') {
    const kids = scene.elements.filter((e) => e.parentId === top[0]!.id && e.visible && !isTransientComponent(e));
    if (kids.length) return kids;
  }
  return top;
}

const ALIAS_ROLE: Record<string, string> = {
  '@event.score': 'Score',
  '@event.panel': 'Panel',
  '@event.logo': 'Logo',
  '@event.abbr': 'Abbr',
  '@event.name': 'Name',
  '@event.timeouts': 'Timeout',
  '@event.possession': 'Possession',
};

export const TRACK_ALIASES = [
  { id: '@bug', label: 'Whole scorebug (each section)' },
  { id: '@event.panel', label: "Event team's colour panel" },
  { id: '@event.score', label: "Event team's score" },
  { id: '@event.logo', label: "Event team's logo" },
  { id: '@event.abbr', label: "Event team's abbreviation" },
  { id: '@event.name', label: "Event team's name" },
  { id: '@event.timeouts', label: "Event team's timeout pips" },
  { id: '@event.possession', label: "Event team's possession marker" },
];

/** Resolve a track target (element id or alias) to concrete element ids. */
export function resolveTrackTargets(scene: Scene, target: string, team: TeamSide | null): string[] {
  if (!target.startsWith('@')) return scene.elements.some((e) => e.id === target) ? [target] : [];
  if (target === '@bug') return bugRoots(scene).map((e) => e.id);
  const suffix = ALIAS_ROLE[target];
  if (!suffix || !team) return [];
  const role = `${team}${suffix}` as FieldRole;
  return scene.elements.filter((e) => e.role === role).map((e) => e.id);
}

export function trackTargetLabel(scene: Scene, target: string): string {
  if (target.startsWith('@')) return TRACK_ALIASES.find((a) => a.id === target)?.label ?? target;
  return scene.elements.find((e) => e.id === target)?.name ?? '(missing element)';
}
