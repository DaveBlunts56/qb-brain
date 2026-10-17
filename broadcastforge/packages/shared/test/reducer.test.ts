import { describe, expect, it } from 'vitest';
import {
  applyUndoPatch,
  clockRemaining,
  createInitialGameState,
  createUndoPatch,
  parseCommand,
  reduceGame,
  type GameCommand,
  type GameState,
  type ReduceContext,
} from '../src/index.js';

const ctx = (nowMono = 0): ReduceContext => ({ nowMono, nowWall: 1_700_000_000_000 + nowMono });

function run(state: GameState, ...cmds: GameCommand[]): GameState {
  let s = state;
  for (const c of cmds) {
    const r = reduceGame(s, c, ctx());
    expect(r.error).toBeUndefined();
    s = r.state;
  }
  return s;
}

describe('scoring', () => {
  it('adds points and emits a SCORE_CHANGED event derived from the diff', () => {
    const s0 = createInitialGameState();
    const r = reduceGame(s0, { type: 'score.add', team: 'home', delta: 6 }, ctx());
    expect(r.state.home.score).toBe(6);
    expect(s0.home.score).toBe(0); // pure: input untouched
    expect(r.events).toEqual([{ type: 'SCORE_CHANGED', payload: { team: 'home', from: 0, to: 6, delta: 6 } }]);
    expect(r.undoable).toBe(true);
    expect(r.label).toBe('HOME +6');
  });

  it('clamps scores to 0..999 and emits nothing for a no-op', () => {
    const s = run(createInitialGameState(), { type: 'score.add', team: 'away', delta: 3 });
    const r = reduceGame(s, { type: 'score.add', team: 'away', delta: -10 }, ctx());
    expect(r.state.away.score).toBe(0);
    const noop = reduceGame(r.state, { type: 'score.add', team: 'away', delta: -1 }, ctx());
    expect(noop.events).toEqual([]);
    expect(reduceGame(s, { type: 'score.set', team: 'away', value: 999 }, ctx()).state.away.score).toBe(999);
  });

  it('graphic triggers never change the score (no double counting)', () => {
    const s = run(createInitialGameState(), { type: 'score.add', team: 'home', delta: 6 });
    const r = reduceGame(s, { type: 'graphic.trigger', graphic: 'touchdown', team: 'home' }, ctx());
    expect(r.state.home.score).toBe(6);
    expect(r.events).toEqual([{ type: 'TOUCHDOWN_TRIGGERED', payload: { team: 'home' } }]);
    expect(r.undoable).toBe(false);
  });

  it('touchdown/field goal triggers need a team (falls back to possession)', () => {
    const s = createInitialGameState();
    expect(reduceGame(s, { type: 'graphic.trigger', graphic: 'fieldGoal' }, ctx()).error).toMatch(/team/);
    const withBall = run(s, { type: 'possession.set', team: 'away' });
    const r = reduceGame(withBall, { type: 'graphic.trigger', graphic: 'fieldGoal' }, ctx());
    expect(r.events[0]).toEqual({ type: 'FIELD_GOAL_TRIGGERED', payload: { team: 'away' } });
    const banner = reduceGame(s, { type: 'graphic.trigger', graphic: 'custom', text: 'Weather delay' }, ctx());
    expect(banner.events[0]).toEqual({ type: 'ANIMATION_TRIGGERED', payload: { graphic: 'custom', team: null, text: 'Weather delay' } });
  });
});

describe('timeouts', () => {
  it('timeout.call charges a timeout, stops the clock and cues a graphic', () => {
    let s = createInitialGameState();
    s = run(s, { type: 'period.set', period: 'Q1' });
    s = reduceGame(s, { type: 'clock.start', clock: 'game' }, ctx(0)).state;
    const r = reduceGame(s, { type: 'timeout.call', team: 'away' }, ctx(5_000));
    expect(r.state.away.timeouts).toBe(2);
    expect(r.state.gameClock.running).toBe(false);
    expect(r.state.gameClock.remainingMs).toBe(720_000 - 5_000);
    expect(r.events.map((e) => e.type)).toEqual(['TIMEOUTS_CHANGED', 'CLOCK_PAUSED', 'ANIMATION_TRIGGERED']);
  });

  it('refuses a timeout when none are left', () => {
    const s = run(createInitialGameState(), { type: 'timeouts.set', team: 'home', value: 0 });
    expect(reduceGame(s, { type: 'timeout.call', team: 'home' }, ctx()).error).toMatch(/no timeouts/);
  });
});

describe('periods', () => {
  it('advancing resets the game clock to the period length, paused', () => {
    let s = createInitialGameState();
    s = run(s, { type: 'period.set', period: 'Q1' });
    s = reduceGame(s, { type: 'clock.start', clock: 'game' }, ctx(0)).state;
    const r = reduceGame(s, { type: 'period.step', direction: 1 }, ctx(30_000));
    expect(r.state.period).toBe('Q2');
    expect(r.state.gameClock).toMatchObject({ running: false, remainingMs: 720_000 });
    const pause = r.events.find((e) => e.type === 'CLOCK_PAUSED');
    expect(pause?.payload).toMatchObject({ reason: 'period' });
  });

  it('resets timeouts at the half and in overtime only when moving forward', () => {
    let s = createInitialGameState();
    s = run(s, { type: 'period.set', period: 'Q2' }, { type: 'timeouts.set', team: 'home', value: 0 });
    s = run(s, { type: 'period.set', period: 'HALF' });
    expect(s.home.timeouts).toBe(0);
    s = run(s, { type: 'period.step', direction: 1 });
    expect(s.period).toBe('Q3');
    expect(s.home.timeouts).toBe(3);
    s = run(s, { type: 'timeouts.set', team: 'home', value: 1 }, { type: 'period.step', direction: -1 });
    expect(s.home.timeouts).toBe(1); // going back does not refill
    s = run(s, { type: 'period.set', period: 'OT1' });
    expect(s.home.timeouts).toBe(1);
    expect(s.away.timeouts).toBe(1);
  });

  it('NFHS overtime is untimed: the game clock refuses to start', () => {
    const s = run(createInitialGameState(), { type: 'period.set', period: 'OT1' });
    expect(s.gameClock.remainingMs).toBe(0);
    expect(reduceGame(s, { type: 'clock.start', clock: 'game' }, ctx()).error).toMatch(/does not run/);
  });

  it('rejects unknown periods', () => {
    expect(reduceGame(createInitialGameState(), { type: 'period.set', period: 'Q7' }, ctx()).error).toBeDefined();
  });
});

describe('clock commands', () => {
  it('emits CLOCK_STARTED / CLOCK_PAUSED / CLOCK_SET', () => {
    let s = run(createInitialGameState(), { type: 'period.set', period: 'Q1' });
    let r = reduceGame(s, { type: 'clock.start', clock: 'game' }, ctx(100));
    expect(r.events).toEqual([{ type: 'CLOCK_STARTED', payload: { clock: 'game', remainingMs: 720_000 } }]);
    s = r.state;
    r = reduceGame(s, { type: 'clock.set', clock: 'game', ms: 600_000 }, ctx(1_100));
    expect(r.events[0]).toMatchObject({ type: 'CLOCK_SET', payload: { clock: 'game', remainingMs: 600_000, previousMs: 719_000 } });
    expect(r.state.gameClock.running).toBe(true);
    s = r.state;
    r = reduceGame(s, { type: 'clock.pause', clock: 'game' }, ctx(2_100));
    expect(r.events[0]).toMatchObject({ type: 'CLOCK_PAUSED', payload: { remainingMs: 599_000, reason: 'operator' } });
  });

  it('toggle starts and stops', () => {
    let s = run(createInitialGameState(), { type: 'period.set', period: 'Q1' });
    s = reduceGame(s, { type: 'clock.toggle', clock: 'game' }, ctx(0)).state;
    expect(s.gameClock.running).toBe(true);
    s = reduceGame(s, { type: 'clock.toggle', clock: 'game' }, ctx(1000)).state;
    expect(s.gameClock.running).toBe(false);
    expect(s.gameClock.remainingMs).toBe(719_000);
  });

  it('expire only stops a clock that really reached zero', () => {
    let s = run(createInitialGameState(), { type: 'period.set', period: 'Q1' }, { type: 'clock.set', clock: 'game', ms: 3_000 });
    s = reduceGame(s, { type: 'clock.start', clock: 'game' }, ctx(0)).state;
    // A stale expiry timer firing early (after a +10s adjustment) is ignored.
    const early = reduceGame(s, { type: 'clock.expire', clock: 'game' }, ctx(1_000));
    expect(early.state.gameClock.running).toBe(true);
    expect(early.events).toEqual([]);
    const r = reduceGame(s, { type: 'clock.expire', clock: 'game' }, ctx(3_000));
    expect(r.state.gameClock).toMatchObject({ running: false, remainingMs: 0 });
    expect(r.events[0]).toMatchObject({ type: 'CLOCK_PAUSED', payload: { reason: 'expired' } });
    expect(reduceGame(r.state, { type: 'clock.start', clock: 'game' }, ctx(4_000)).error).toMatch(/zero/);
  });

  it('play clock reset uses configured seconds and can auto start', () => {
    const s = createInitialGameState();
    const r = reduceGame(s, { type: 'clock.reset', clock: 'play', seconds: 25, autoStart: true }, ctx(50));
    expect(r.state.playClock).toMatchObject({ running: true, remainingMs: 25_000, anchorMono: 50 });
    expect(clockRemaining(r.state.playClock, 10_050)).toBe(15_000);
  });
});

describe('down, distance and possession', () => {
  it('first down computes goal-to-go near the goal line', () => {
    let s = run(createInitialGameState(), { type: 'possession.set', team: 'home' }, { type: 'situation.set', ballOn: { side: 'away', yardLine: 7 } });
    s = run(s, { type: 'firstDown' });
    expect(s).toMatchObject({ down: 1, distance: 7, goalToGo: true });
    s = run(s, { type: 'situation.set', ballOn: { side: 'home', yardLine: 30 } }, { type: 'firstDown' });
    expect(s).toMatchObject({ down: 1, distance: 10, goalToGo: false });
  });

  it('next down stops at 4th', () => {
    let s = run(createInitialGameState(), { type: 'down.next' });
    expect(s.down).toBe(1);
    s = run(s, { type: 'down.next' }, { type: 'down.next' }, { type: 'down.next' }, { type: 'down.next' });
    expect(s.down).toBe(4);
  });

  it('possession toggle and team swap keep the situation consistent', () => {
    let s = run(createInitialGameState(), { type: 'possession.toggle' });
    expect(s.possession).toBe('home');
    s = run(s, { type: 'possession.toggle' }, { type: 'situation.set', ballOn: { side: 'home', yardLine: 20 } });
    expect(s.possession).toBe('away');
    const r = reduceGame(s, { type: 'team.swap' }, ctx());
    expect(r.state.possession).toBe('home');
    expect(r.state.ballOn).toEqual({ side: 'away', yardLine: 20 });
    expect(r.state.home.abbreviation).toBe('AWAY');
  });

  it('emits DOWN_CHANGED with the list of changed fields', () => {
    const r = reduceGame(createInitialGameState(), { type: 'situation.set', down: 3, distance: 6 }, ctx());
    expect(r.events).toEqual([
      { type: 'DOWN_CHANGED', payload: { down: 3, distance: 6, goalToGo: false, ballOn: null, changed: ['down', 'distance'] } },
    ]);
  });

  it('ball on the 50 has no side', () => {
    const s = run(createInitialGameState(), { type: 'situation.set', ballOn: { side: 'home', yardLine: 50 } });
    expect(s.ballOn).toEqual({ side: null, yardLine: 50 });
  });
});

describe('overlay and emergency', () => {
  it('emergency clear hides the overlay and emits GRAPHICS_CLEARED', () => {
    const r = reduceGame(createInitialGameState(), { type: 'graphics.clear' }, ctx());
    expect(r.state.overlayVisible).toBe(false);
    expect(r.events.map((e) => e.type)).toEqual(['OVERLAY_VISIBILITY_CHANGED', 'GRAPHICS_CLEARED']);
  });

  it('game reset keeps team identity when asked, but zeroes scores', () => {
    const s = run(
      createInitialGameState(),
      { type: 'team.update', team: 'home', patch: { name: 'Ironwood', abbreviation: 'IRW' } },
      { type: 'score.add', team: 'home', delta: 14 },
      { type: 'period.set', period: 'Q3' },
    );
    const keep = reduceGame(s, { type: 'game.reset', keepTeams: true }, ctx()).state;
    expect(keep).toMatchObject({ period: 'PRE', home: { name: 'Ironwood', score: 0 } });
    const wipe = reduceGame(s, { type: 'game.reset', keepTeams: false }, ctx()).state;
    expect(wipe.home.name).toBe('Home');
  });
});

describe('undo patches', () => {
  it('undo restores only the changed fields, leaving a running clock alone', () => {
    let s = run(createInitialGameState(), { type: 'period.set', period: 'Q1' });
    s = reduceGame(s, { type: 'clock.start', clock: 'game' }, ctx(0)).state;
    const before = s;
    const r = reduceGame(s, { type: 'score.add', team: 'home', delta: 6 }, ctx(1_000));
    const patch = createUndoPatch(before, r.state);
    expect(patch).toEqual({ 'home.score': 0 });
    // Time passes; the clock keeps running.
    const undone = applyUndoPatch(r.state, patch, ctx(30_000));
    expect(undone.state.home.score).toBe(0);
    expect(undone.state.gameClock.running).toBe(true);
    expect(clockRemaining(undone.state.gameClock, 30_000)).toBe(690_000);
    expect(undone.events).toEqual([{ type: 'SCORE_CHANGED', payload: { team: 'home', from: 6, to: 0, delta: -6 } }]);
  });

  it('undoing a period change restores the stopped clock and timeouts', () => {
    let s = run(createInitialGameState(), { type: 'period.set', period: 'Q2' }, { type: 'clock.set', clock: 'game', ms: 0 }, { type: 'timeouts.set', team: 'away', value: 1 });
    const r = reduceGame(s, { type: 'period.set', period: 'Q3' }, ctx(0));
    const patch = createUndoPatch(s, r.state);
    s = applyUndoPatch(r.state, patch, ctx(5_000)).state;
    expect(s.period).toBe('Q2');
    expect(s.gameClock.remainingMs).toBe(0);
    expect(s.away.timeouts).toBe(1);
  });
});

describe('command validation', () => {
  it('accepts valid commands and rejects malformed input', () => {
    expect(parseCommand({ type: 'score.add', team: 'home', delta: 6 }).ok).toBe(true);
    expect(parseCommand({ type: 'score.add', team: 'visitors', delta: 6 }).ok).toBe(false);
    expect(parseCommand({ type: 'score.add', team: 'home', delta: 1.5 }).ok).toBe(false);
    expect(parseCommand({ type: 'team.update', team: 'home', patch: { primaryColor: 'red' } }).ok).toBe(false);
    expect(parseCommand({ type: 'team.update', team: 'home', patch: { evil: true } }).ok).toBe(false);
    expect(parseCommand({ type: 'nope' }).ok).toBe(false);
    expect(parseCommand(null).ok).toBe(false);
  });
});
