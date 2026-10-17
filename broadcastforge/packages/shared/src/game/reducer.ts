import { adjustClock, clockRemaining, pauseClock, setClock, startClock } from './clock.js';
import type { GameCommand } from './commands.js';
import { draft, graphicEventType, type EventDraft, type EventPayloads } from './events.js';
import { downAndDistanceText, yardsToGoal } from './format.js';
import { isOvertime, isTimedPeriod, isValidPeriod, periodIndex, periodLabel, periodLengthMs, stepPeriod } from './period.js';
import { createInitialGameState, teamInfoOf } from './state.js';
import { LIMITS, TEAM_SIDES, otherSide, type ClockState, type Down, type GameState, type TeamInfo, type TeamSide } from './types.js';

export interface ReduceContext {
  /** Server monotonic time (ms). */
  nowMono: number;
  /** Server wall-clock time (epoch ms). */
  nowWall: number;
}

export interface ReduceResult {
  state: GameState;
  events: EventDraft[];
  /** Human readable description for history / undo button. */
  label: string;
  undoable: boolean;
  error?: string;
}

const UNDOABLE = new Set<GameCommand['type']>([
  'score.add',
  'score.set',
  'team.update',
  'team.swap',
  'timeouts.set',
  'timeouts.adjust',
  'timeout.call',
  'period.set',
  'period.step',
  'situation.set',
  'down.next',
  'firstDown',
  'possession.set',
  'possession.toggle',
  'flag.set',
  'label.set',
  'config.update',
]);

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const teamName = (s: GameState, side: TeamSide) => s[side].abbreviation || side.toUpperCase();

/**
 * Apply one operator/system command to the game state. Pure: returns a new
 * state plus the broadcast events describing exactly what changed. Persistent
 * events are *derived from the state diff*, so events can never disagree with
 * state; graphics cues are appended as transient events.
 */
export function reduceGame(state: GameState, cmd: GameCommand, ctx: ReduceContext): ReduceResult {
  const s: GameState = structuredClone(state);
  const transient: EventDraft[] = [];
  let label: string = cmd.type;
  let pauseReason: EventPayloads['CLOCK_PAUSED']['reason'] = 'operator';
  const fail = (error: string): ReduceResult => ({ state, events: [], label, undoable: false, error });
  const { nowMono, nowWall } = ctx;
  const clockKey = (id: 'game' | 'play'): 'gameClock' | 'playClock' => (id === 'game' ? 'gameClock' : 'playClock');
  const maxFor = (id: 'game' | 'play') => (id === 'game' ? LIMITS.maxClockMs : LIMITS.maxPlayClockMs);

  switch (cmd.type) {
    case 'score.add': {
      const t = s[cmd.team];
      t.score = clamp(t.score + cmd.delta, 0, LIMITS.maxScore);
      label = `${teamName(s, cmd.team)} ${cmd.delta >= 0 ? '+' : ''}${cmd.delta}`;
      break;
    }
    case 'score.set':
      s[cmd.team].score = cmd.value;
      label = `${teamName(s, cmd.team)} score = ${cmd.value}`;
      break;
    case 'team.update':
      Object.assign(s[cmd.team], cmd.patch);
      label = `Edit ${cmd.team} team`;
      break;
    case 'team.swap': {
      const home = s.home;
      s.home = s.away;
      s.away = home;
      if (s.possession) s.possession = otherSide(s.possession);
      if (s.ballOn?.side) s.ballOn = { ...s.ballOn, side: otherSide(s.ballOn.side) };
      label = 'Swap home/away';
      break;
    }
    case 'timeouts.set':
      s[cmd.team].timeouts = cmd.value;
      label = `${teamName(s, cmd.team)} timeouts = ${cmd.value}`;
      break;
    case 'timeouts.adjust':
      s[cmd.team].timeouts = clamp(s[cmd.team].timeouts + cmd.delta, 0, LIMITS.maxTimeouts);
      label = `${teamName(s, cmd.team)} timeouts ${cmd.delta >= 0 ? '+' : ''}${cmd.delta}`;
      break;
    case 'timeout.call': {
      const t = s[cmd.team];
      if (t.timeouts <= 0) return fail(`${teamName(s, cmd.team)} has no timeouts left`);
      t.timeouts -= 1;
      // A charged timeout stops the game clock.
      s.gameClock = pauseClock(s.gameClock, nowMono, nowWall);
      transient.push(draft('ANIMATION_TRIGGERED', { graphic: 'timeout', team: cmd.team }));
      label = `${teamName(s, cmd.team)} timeout`;
      break;
    }
    case 'period.set':
    case 'period.step': {
      const to = cmd.type === 'period.set' ? cmd.period : stepPeriod(s.period, cmd.direction, s.config);
      if (!isValidPeriod(to, s.config)) return fail(`Unknown period "${to}"`);
      if (to === s.period) return noChange(state, `Period ${periodLabel(to)}`, UNDOABLE.has(cmd.type));
      changePeriod(s, to, ctx);
      pauseReason = 'period';
      label = `Period ${periodLabel(to)}`;
      break;
    }
    case 'clock.start': {
      const key = clockKey(cmd.clock);
      if (cmd.clock === 'game' && !isTimedPeriod(s.period, s.config) && s.period !== 'PRE')
        return fail(`The game clock does not run during ${periodLabel(s.period)}`);
      if (clockRemaining(s[key], nowMono) <= 0) return fail('Clock is at zero — set or reset it first');
      s[key] = startClock(s[key], nowMono, nowWall);
      label = `Start ${cmd.clock} clock`;
      break;
    }
    case 'clock.pause':
      s[clockKey(cmd.clock)] = pauseClock(s[clockKey(cmd.clock)], nowMono, nowWall);
      label = `Stop ${cmd.clock} clock`;
      break;
    case 'clock.toggle': {
      const key = clockKey(cmd.clock);
      const sub: GameCommand = s[key].running ? { type: 'clock.pause', clock: cmd.clock } : { type: 'clock.start', clock: cmd.clock };
      return reduceGame(state, sub, ctx);
    }
    case 'clock.set':
      s[clockKey(cmd.clock)] = setClock(s[clockKey(cmd.clock)], cmd.ms, nowMono, nowWall, maxFor(cmd.clock));
      label = `Set ${cmd.clock} clock`;
      break;
    case 'clock.adjust':
      s[clockKey(cmd.clock)] = adjustClock(s[clockKey(cmd.clock)], cmd.deltaMs, nowMono, nowWall, maxFor(cmd.clock));
      label = `Adjust ${cmd.clock} clock ${cmd.deltaMs >= 0 ? '+' : ''}${(cmd.deltaMs / 1000).toFixed(1)}s`;
      break;
    case 'clock.reset': {
      if (cmd.clock === 'game') {
        s.gameClock = { running: false, remainingMs: periodLengthMs(s.period, s.config), anchorMono: nowMono, anchorWall: nowWall };
        pauseReason = 'reset';
      } else {
        const seconds = cmd.seconds ?? s.config.playClockSeconds;
        const base: ClockState = { running: false, remainingMs: seconds * 1000, anchorMono: nowMono, anchorWall: nowWall };
        s.playClock = cmd.autoStart ? startClock(base, nowMono, nowWall) : base;
        pauseReason = 'reset';
      }
      label = `Reset ${cmd.clock} clock`;
      break;
    }
    case 'clock.expire': {
      const key = clockKey(cmd.clock);
      // Only expire if the clock really reached zero; a late timer after a
      // "set" or "+10s" must not stop a clock that still has time.
      if (!s[key].running || clockRemaining(s[key], nowMono) > 25) return noChange(state, 'Clock expiry ignored', false);
      s[key] = { running: false, remainingMs: 0, anchorMono: nowMono, anchorWall: nowWall };
      pauseReason = 'expired';
      label = `${cmd.clock} clock expired`;
      break;
    }
    case 'playClock.visibility':
      s.playClockVisible = cmd.visible;
      label = cmd.visible ? 'Show play clock' : 'Hide play clock';
      break;
    case 'situation.set': {
      if (cmd.down !== undefined) s.down = cmd.down as Down | null;
      if (cmd.distance !== undefined) s.distance = cmd.distance;
      if (cmd.goalToGo !== undefined) s.goalToGo = cmd.goalToGo;
      if (cmd.ballOn !== undefined) s.ballOn = cmd.ballOn ? { side: cmd.ballOn.yardLine >= 50 ? null : cmd.ballOn.side, yardLine: cmd.ballOn.yardLine } : null;
      label = describeSituation(s);
      break;
    }
    case 'down.next':
      s.down = (s.down ? Math.min(4, s.down + 1) : 1) as Down;
      label = describeSituation(s);
      break;
    case 'firstDown': {
      s.down = 1;
      const toGoal = yardsToGoal(s.ballOn, s.possession);
      if (toGoal !== null && toGoal <= 10) {
        s.goalToGo = true;
        s.distance = toGoal;
      } else {
        s.goalToGo = false;
        s.distance = 10;
      }
      label = describeSituation(s);
      break;
    }
    case 'situation.visibility':
      s.situationVisible = cmd.visible;
      label = cmd.visible ? 'Show down & distance' : 'Hide down & distance';
      break;
    case 'possession.set':
      s.possession = cmd.team;
      label = cmd.team ? `Possession ${teamName(s, cmd.team)}` : 'Clear possession';
      break;
    case 'possession.toggle':
      s.possession = s.possession ? otherSide(s.possession) : 'home';
      label = `Possession ${teamName(s, s.possession)}`;
      break;
    case 'flag.set':
      s.flag = cmd.on;
      label = cmd.on ? 'FLAG on' : 'FLAG off';
      break;
    case 'overlay.visibility':
      s.overlayVisible = cmd.visible;
      label = cmd.visible ? 'Show scorebug' : 'Hide scorebug';
      break;
    case 'label.set':
      if (cmd.value) s.labels[cmd.key] = cmd.value;
      else delete s.labels[cmd.key];
      label = `Label ${cmd.key}`;
      break;
    case 'config.update': {
      const before = s.config;
      s.config = { ...s.config, ...cmd.patch };
      // If the clock is sitting untouched at a full period, follow the new period length.
      if (!s.gameClock.running && s.gameClock.remainingMs === periodLengthMs(s.period, before)) {
        s.gameClock = { ...s.gameClock, remainingMs: periodLengthMs(s.period, s.config) };
      }
      if (!s.playClock.running && s.playClock.remainingMs === before.playClockSeconds * 1000) {
        s.playClock = { ...s.playClock, remainingMs: s.config.playClockSeconds * 1000 };
      }
      label = 'Game settings';
      break;
    }
    case 'graphic.trigger': {
      const team = cmd.team ?? s.possession ?? null;
      const type = graphicEventType(cmd.graphic);
      if (type !== 'ANIMATION_TRIGGERED') {
        if (!team) return fail('Choose which team scored');
        transient.push(draft(type as 'TOUCHDOWN_TRIGGERED', { team }));
      } else {
        transient.push(draft('ANIMATION_TRIGGERED', { graphic: cmd.graphic, team, ...(cmd.text ? { text: cmd.text } : {}) }));
      }
      label = `${cmd.graphic} graphic${team ? ` (${teamName(s, team)})` : ''}`;
      break;
    }
    case 'graphics.clear':
      s.overlayVisible = false;
      transient.push(draft('GRAPHICS_CLEARED', {}));
      label = 'EMERGENCY CLEAR';
      break;
    case 'game.reset': {
      const fresh = createInitialGameState({
        home: cmd.keepTeams ? teamInfoOf(s.home) : undefined,
        away: cmd.keepTeams ? teamInfoOf(s.away) : undefined,
        config: s.config,
        nowMono,
        nowWall,
        overlayVisible: s.overlayVisible,
      });
      transient.push(draft('GAME_RESET', { keepTeams: cmd.keepTeams }));
      return {
        state: fresh,
        events: [...deriveEvents(state, fresh, ctx, 'reset'), ...transient],
        label: 'Reset game',
        undoable: false,
      };
    }
    case 'undo':
      return fail('Undo is handled by the match runtime');
  }

  return {
    state: s,
    events: [...deriveEvents(state, s, ctx, pauseReason), ...transient],
    label,
    undoable: UNDOABLE.has(cmd.type),
  };
}

function noChange(state: GameState, label: string, undoable: boolean): ReduceResult {
  return { state, events: [], label, undoable };
}

function describeSituation(s: GameState): string {
  return downAndDistanceText(s) || 'Down & distance';
}

function changePeriod(s: GameState, to: string, ctx: ReduceContext) {
  const from = s.period;
  const forward = periodIndex(to, s.config) > periodIndex(from, s.config);
  s.period = to;
  s.gameClock = { running: false, remainingMs: periodLengthMs(to, s.config), anchorMono: ctx.nowMono, anchorWall: ctx.nowWall };
  s.playClock = { ...pauseClock(s.playClock, ctx.nowMono, ctx.nowWall) };
  if (forward) {
    const crossed = (target: string) => periodIndex(from, s.config) < periodIndex(target, s.config) && periodIndex(to, s.config) >= periodIndex(target, s.config);
    if (isOvertime(to)) {
      for (const side of TEAM_SIDES) s[side].timeouts = s.config.overtimeTimeouts;
    } else if (s.config.resetTimeoutsAtHalf && crossed('Q3')) {
      for (const side of TEAM_SIDES) s[side].timeouts = s.config.timeoutsPerHalf;
    } else if (crossed('Q1') && from === 'PRE') {
      for (const side of TEAM_SIDES) s[side].timeouts = s.config.timeoutsPerHalf;
    }
  }
  if (to === 'FINAL' || to === 'HALF') s.flag = false;
}

const TEAM_INFO_KEYS: (keyof TeamInfo)[] = [
  'name',
  'mascot',
  'abbreviation',
  'record',
  'primaryColor',
  'secondaryColor',
  'textColor',
  'logoAssetId',
];

/** Derive persistent broadcast events from the difference between two states. */
export function deriveEvents(
  before: GameState,
  after: GameState,
  ctx: ReduceContext,
  pauseReason: EventPayloads['CLOCK_PAUSED']['reason'] = 'operator',
): EventDraft[] {
  const out: EventDraft[] = [];
  if (before.overlayVisible !== after.overlayVisible)
    out.push(draft('OVERLAY_VISIBILITY_CHANGED', { visible: after.overlayVisible }));
  for (const side of TEAM_SIDES) {
    const b = before[side];
    const a = after[side];
    const fields = TEAM_INFO_KEYS.filter((k) => b[k] !== a[k]);
    if (fields.length) out.push(draft('TEAM_UPDATED', { team: side, fields }));
    if (b.score !== a.score) out.push(draft('SCORE_CHANGED', { team: side, from: b.score, to: a.score, delta: a.score - b.score }));
    if (b.timeouts !== a.timeouts) out.push(draft('TIMEOUTS_CHANGED', { team: side, from: b.timeouts, to: a.timeouts }));
  }
  if (before.period !== after.period) out.push(draft('PERIOD_CHANGED', { from: before.period, to: after.period }));
  out.push(...clockEvents('game', before.gameClock, after.gameClock, ctx, pauseReason));
  out.push(...clockEvents('play', before.playClock, after.playClock, ctx, pauseReason));
  if (before.possession !== after.possession) out.push(draft('POSSESSION_CHANGED', { from: before.possession, to: after.possession }));
  const changed: EventPayloads['DOWN_CHANGED']['changed'] = [];
  if (before.down !== after.down) changed.push('down');
  if (before.distance !== after.distance) changed.push('distance');
  if (before.goalToGo !== after.goalToGo) changed.push('goalToGo');
  if (JSON.stringify(before.ballOn) !== JSON.stringify(after.ballOn)) changed.push('ballOn');
  if (changed.length)
    out.push(draft('DOWN_CHANGED', { down: after.down, distance: after.distance, goalToGo: after.goalToGo, ballOn: after.ballOn, changed }));
  if (before.flag !== after.flag) out.push(draft('FLAG_CHANGED', { on: after.flag }));
  if (before.situationVisible !== after.situationVisible)
    out.push(draft('SITUATION_VISIBILITY_CHANGED', { visible: after.situationVisible }));
  if (before.playClockVisible !== after.playClockVisible)
    out.push(draft('PLAY_CLOCK_VISIBILITY_CHANGED', { visible: after.playClockVisible }));
  const labelKeys = new Set([...Object.keys(before.labels), ...Object.keys(after.labels)]);
  for (const key of labelKeys) {
    if (before.labels[key] !== after.labels[key]) out.push(draft('LABEL_CHANGED', { key, value: after.labels[key] ?? '' }));
  }
  const configFields = Object.keys(after.config).filter(
    (k) => before.config[k as keyof typeof before.config] !== after.config[k as keyof typeof after.config],
  );
  if (configFields.length) out.push(draft('CONFIG_CHANGED', { fields: configFields }));
  return out;
}

function clockEvents(
  clock: 'game' | 'play',
  b: ClockState,
  a: ClockState,
  ctx: ReduceContext,
  pauseReason: EventPayloads['CLOCK_PAUSED']['reason'],
): EventDraft[] {
  if (!b.running && a.running) return [draft('CLOCK_STARTED', { clock, remainingMs: a.remainingMs })];
  if (b.running && !a.running) return [draft('CLOCK_PAUSED', { clock, remainingMs: a.remainingMs, reason: pauseReason })];
  if (a.anchorMono !== b.anchorMono || a.remainingMs !== b.remainingMs) {
    const previousMs = clockRemaining(b, ctx.nowMono);
    const nowMs = clockRemaining(a, ctx.nowMono);
    if (previousMs !== nowMs) return [draft('CLOCK_SET', { clock, remainingMs: nowMs, previousMs })];
  }
  return [];
}
