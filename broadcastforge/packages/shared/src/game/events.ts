import type { BallSpot, ClockId, Down, PeriodId, TeamInfo, TeamSide } from './types.js';

export const GRAPHIC_KINDS = [
  'touchdown',
  'fieldGoal',
  'safety',
  'extraPoint',
  'twoPoint',
  'firstDown',
  'turnover',
  'timeout',
  'penalty',
  'custom',
] as const;
export type GraphicKind = (typeof GRAPHIC_KINDS)[number];

export const GRAPHIC_LABELS: Record<GraphicKind, string> = {
  touchdown: 'Touchdown',
  fieldGoal: 'Field Goal',
  safety: 'Safety',
  extraPoint: 'Extra Point',
  twoPoint: '2-Point Conversion',
  firstDown: 'First Down',
  turnover: 'Turnover',
  timeout: 'Timeout',
  penalty: 'Penalty',
  custom: 'Custom Banner',
};

export interface EventPayloads {
  SCORE_CHANGED: { team: TeamSide; from: number; to: number; delta: number };
  TIMEOUTS_CHANGED: { team: TeamSide; from: number; to: number };
  TEAM_UPDATED: { team: TeamSide; fields: (keyof TeamInfo)[] };
  CLOCK_STARTED: { clock: ClockId; remainingMs: number };
  CLOCK_PAUSED: { clock: ClockId; remainingMs: number; reason: 'operator' | 'expired' | 'period' | 'reset' };
  CLOCK_SET: { clock: ClockId; remainingMs: number; previousMs: number };
  PERIOD_CHANGED: { from: PeriodId; to: PeriodId };
  POSSESSION_CHANGED: { from: TeamSide | null; to: TeamSide | null };
  DOWN_CHANGED: {
    down: Down | null;
    distance: number | null;
    goalToGo: boolean;
    ballOn: BallSpot | null;
    changed: ('down' | 'distance' | 'goalToGo' | 'ballOn')[];
  };
  FLAG_CHANGED: { on: boolean };
  OVERLAY_VISIBILITY_CHANGED: { visible: boolean };
  SITUATION_VISIBILITY_CHANGED: { visible: boolean };
  PLAY_CLOCK_VISIBILITY_CHANGED: { visible: boolean };
  LABEL_CHANGED: { key: string; value: string };
  CONFIG_CHANGED: { fields: string[] };
  TOUCHDOWN_TRIGGERED: { team: TeamSide };
  FIELD_GOAL_TRIGGERED: { team: TeamSide };
  SAFETY_TRIGGERED: { team: TeamSide };
  ANIMATION_TRIGGERED: { graphic: GraphicKind; team: TeamSide | null; text?: string };
  GRAPHICS_CLEARED: Record<string, never>;
  GAME_RESET: { keepTeams: boolean };
  STATE_RESTORED: { undoOfSeq: number; label: string };
}

export type BroadcastEventType = keyof EventPayloads;

/**
 * Persistent events describe a change to match state and are replayable
 * from state alone. Transient events are one-shot graphics cues: they are
 * never re-animated after a reconnect.
 */
export const TRANSIENT_EVENT_TYPES: ReadonlySet<BroadcastEventType> = new Set<BroadcastEventType>([
  'TOUCHDOWN_TRIGGERED',
  'FIELD_GOAL_TRIGGERED',
  'SAFETY_TRIGGERED',
  'ANIMATION_TRIGGERED',
  'GRAPHICS_CLEARED',
]);

export interface EventDraft<T extends BroadcastEventType = BroadcastEventType> {
  type: T;
  payload: EventPayloads[T];
}

export interface BroadcastEvent<T extends BroadcastEventType = BroadcastEventType> extends EventDraft<T> {
  id: string;
  matchId: string;
  seq: number;
  /** Server wall-clock epoch ms. */
  ts: number;
  persistent: boolean;
  commandId: string | null;
  origin: 'operator' | 'undo' | 'system';
}

export function draft<T extends BroadcastEventType>(type: T, payload: EventPayloads[T]): EventDraft<T> {
  return { type, payload };
}

/** Narrow a generic event to a specific type. */
export function isEvent<T extends BroadcastEventType>(e: EventDraft, type: T): e is EventDraft<T> {
  return e.type === type;
}

/** Map a graphic trigger to its specific event type, if one exists. */
export function graphicEventType(kind: GraphicKind): BroadcastEventType {
  switch (kind) {
    case 'touchdown':
      return 'TOUCHDOWN_TRIGGERED';
    case 'fieldGoal':
      return 'FIELD_GOAL_TRIGGERED';
    case 'safety':
      return 'SAFETY_TRIGGERED';
    default:
      return 'ANIMATION_TRIGGERED';
  }
}

/** Recover graphic kind and team from any graphics-cue event. */
export function graphicFromEvent(e: EventDraft): { kind: GraphicKind; team: TeamSide | null; text?: string } | null {
  if (isEvent(e, 'TOUCHDOWN_TRIGGERED')) return { kind: 'touchdown', team: e.payload.team };
  if (isEvent(e, 'FIELD_GOAL_TRIGGERED')) return { kind: 'fieldGoal', team: e.payload.team };
  if (isEvent(e, 'SAFETY_TRIGGERED')) return { kind: 'safety', team: e.payload.team };
  if (isEvent(e, 'ANIMATION_TRIGGERED')) return { kind: e.payload.graphic, team: e.payload.team, text: e.payload.text };
  return null;
}
