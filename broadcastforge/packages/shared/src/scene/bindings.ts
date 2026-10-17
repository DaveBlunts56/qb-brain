import { formatGameClock, formatPlayClock, clockRemaining } from '../game/clock.js';
import { GRAPHIC_LABELS, type GraphicKind } from '../game/events.js';
import { ballOnText, distanceText, downAndDistanceText, downText } from '../game/format.js';
import { periodLabel, periodShowsClock } from '../game/period.js';
import type { GameState, TeamSide, TeamState } from '../game/types.js';
import type { ColorValue, FieldBinding, GraphicElement, Paint } from './types.js';

export interface EventContext {
  kind: GraphicKind;
  team: TeamSide | null;
  title: string;
  text?: string;
}

export interface BindingContext {
  state: GameState;
  /** Display strings for clocks, computed by the renderer from synchronised server time. */
  clocks: { game: string; play: string };
  event: EventContext | null;
}

export function eventContextFor(kind: GraphicKind, team: TeamSide | null, text?: string): EventContext {
  const title = kind === 'custom' ? (text ?? '').toUpperCase() : GRAPHIC_LABELS[kind].toUpperCase();
  return { kind, team, title, text };
}

/** Clock strings at a given server-monotonic time. */
export function clockStrings(state: GameState, serverMono: number): { game: string; play: string } {
  return {
    game: formatGameClock(clockRemaining(state.gameClock, serverMono), state.config.showTenthsUnderMinute),
    play: formatPlayClock(clockRemaining(state.playClock, serverMono)),
  };
}

export function fullName(team: TeamState): string {
  return [team.name, team.mascot].filter(Boolean).join(' ');
}

function teamField(team: TeamState, side: TeamSide, key: string, state: GameState): string | number | boolean | null {
  switch (key) {
    case 'score':
      return team.score;
    case 'name':
      return team.name;
    case 'mascot':
      return team.mascot;
    case 'fullName':
      return fullName(team);
    case 'abbreviation':
      return team.abbreviation;
    case 'record':
      return team.record;
    case 'logo':
      return team.logoAssetId;
    case 'primaryColor':
      return team.primaryColor;
    case 'secondaryColor':
      return team.secondaryColor;
    case 'textColor':
      return team.textColor;
    case 'timeouts':
      return team.timeouts;
    case 'hasPossession':
      return state.possession === side;
    default:
      return null;
  }
}

export function resolveField(key: string, ctx: BindingContext): string | number | boolean | null {
  const s = ctx.state;
  if (key.startsWith('home.') || key.startsWith('away.')) {
    const side = key.slice(0, 4) as TeamSide;
    return teamField(s[side], side, key.slice(5), s);
  }
  if (key.startsWith('event.team.')) {
    const side = ctx.event?.team;
    if (!side) return key.endsWith('Color') ? '#30343c' : key.endsWith('logo') ? null : '';
    return teamField(s[side], side, key.slice('event.team.'.length), s);
  }
  if (key.startsWith('label.')) return s.labels[key.slice(6)] ?? '';
  switch (key) {
    case 'gameClock':
      return ctx.clocks.game;
    case 'gameClockVisible':
      return periodShowsClock(s.period, s.config);
    case 'gameClockRunning':
      return s.gameClock.running;
    case 'playClock':
      return ctx.clocks.play;
    case 'playClockVisible':
      return s.playClockVisible;
    case 'period':
      return periodLabel(s.period);
    case 'down':
      return downText(s.down);
    case 'distance':
      return distanceText(s.distance, s.goalToGo);
    case 'downDistance':
      return downAndDistanceText(s);
    case 'ballOn':
      return ballOnText(s);
    case 'showSituation':
      return s.situationVisible && s.down !== null && !s.flag;
    case 'flag':
      return s.flag;
    case 'event.title':
      return ctx.event?.title ?? '';
    case 'event.text':
      return ctx.event?.text ?? '';
    default:
      return null;
  }
}

const TOKEN_RE = /^\$(home|away|event|possession)\.(primary|secondary|text)$/;

/** Resolve colour tokens like "$home.primary" to concrete CSS colours. */
export function resolveColor(value: ColorValue, ctx: BindingContext | null): string {
  const m = TOKEN_RE.exec(value);
  if (!m) return value;
  if (!ctx) return m[2] === 'text' ? '#ffffff' : m[2] === 'primary' ? '#3a3f4a' : '#20232a';
  let side: TeamSide | null;
  if (m[1] === 'event') side = ctx.event?.team ?? null;
  else if (m[1] === 'possession') side = ctx.state.possession;
  else side = m[1] as TeamSide;
  if (!side) return m[2] === 'text' ? '#ffffff' : m[2] === 'primary' ? '#3a3f4a' : '#20232a';
  const team = ctx.state[side];
  return m[2] === 'primary' ? team.primaryColor : m[2] === 'secondary' ? team.secondaryColor : team.textColor;
}

export function isColorToken(value: string): boolean {
  return TOKEN_RE.test(value);
}

export function paintUsesTokens(paint: Paint): boolean {
  if (paint.type === 'solid') return isColorToken(paint.color);
  if (paint.type === 'linear') return paint.stops.some((s) => isColorToken(s.color));
  return false;
}

export function formatTemplate(format: string | undefined, value: unknown): string {
  const v = value === null || value === undefined ? '' : String(value);
  if (!format) return v;
  return format.replace(/\{value\}/g, v);
}

export interface ResolvedBindings {
  text?: string;
  imageAssetId?: string | null;
  /** false = hidden by a visibility binding. */
  visible: boolean;
  /** Opacity multiplier when dimmed by a "dim" visibility binding. */
  dim: number | null;
  fill?: string;
  color?: string;
}

export function resolveBindings(el: GraphicElement, ctx: BindingContext): ResolvedBindings {
  const out: ResolvedBindings = { visible: true, dim: null };
  for (const b of el.bindings) applyBinding(b, ctx, out);
  return out;
}

function applyBinding(b: FieldBinding, ctx: BindingContext, out: ResolvedBindings) {
  const value = resolveField(b.field, ctx);
  switch (b.target) {
    case 'text':
      out.text = formatTemplate(b.format, value);
      break;
    case 'image':
      out.imageAssetId = typeof value === 'string' && value ? value : null;
      break;
    case 'fill':
      if (typeof value === 'string' && value) out.fill = value;
      break;
    case 'color':
      if (typeof value === 'string' && value) out.color = value;
      break;
    case 'visible': {
      const on = b.index !== undefined ? Number(value) >= b.index : Boolean(value);
      if (!on) {
        if (b.mode === 'dim') out.dim = Math.min(out.dim ?? 1, b.dimOpacity ?? 0.25);
        else out.visible = false;
      }
      break;
    }
  }
}

/** True when an element's displayed content depends on live clock time. */
export function usesClock(el: GraphicElement): boolean {
  return el.bindings.some((b) => b.field === 'gameClock' || b.field === 'playClock');
}
