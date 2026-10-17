import { describe, expect, it } from 'vitest';
import { TakeoverController, ToggleLane, ValueLane, type Cancelable, type LaneClock } from '../src/index.js';

/** Deterministic fake clock with manually advanced time. */
class FakeClock implements LaneClock {
  t = 0;
  private timers: { at: number; fn: () => void; id: number }[] = [];
  private nextId = 1;
  now = () => this.t;
  setTimeout = (fn: () => void, ms: number) => {
    const id = this.nextId++;
    this.timers.push({ at: this.t + ms, fn, id });
    return id;
  };
  clearTimeout = (h: unknown) => {
    this.timers = this.timers.filter((t) => t.id !== h);
  };
  advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      this.timers.sort((a, b) => a.at - b.at);
      const next = this.timers[0];
      if (!next || next.at > end) break;
      this.timers.shift();
      this.t = next.at;
      next.fn();
    }
    this.t = end;
  }
}

interface FakeAnim extends Cancelable {
  label: string;
  cancelled: boolean;
  reversed: boolean;
  finish(): void;
}

function fakeRunner<A extends unknown[]>(log: FakeAnim[], label: (...a: A) => string, reversible = false) {
  return (...args: [...A, () => void]): Cancelable => {
    const done = args[args.length - 1] as () => void;
    const a: FakeAnim = {
      label: label(...(args.slice(0, -1) as A)),
      cancelled: false,
      reversed: false,
      cancel() {
        a.cancelled = true;
      },
      finish() {
        if (!a.cancelled) done();
      },
    };
    if (reversible) {
      a.reverse = (onDone) => {
        a.reversed = true;
        a.finish = () => {
          if (!a.cancelled) onDone();
        };
        return true;
      };
    }
    log.push(a);
    return a;
  };
}

describe('ValueLane (score digits)', () => {
  it('animates from the displayed value to the new one', () => {
    const clock = new FakeClock();
    const log: FakeAnim[] = [];
    const set: number[] = [];
    const lane = new ValueLane<number>(0, fakeRunner(log, (f: number, t: number) => `${f}->${t}`), (v) => set.push(v), clock, 120);
    lane.update(6, true);
    expect(log.map((a) => a.label)).toEqual(['0->6']);
    expect(lane.isAnimating).toBe(true);
    log[0]!.finish();
    expect(lane.isAnimating).toBe(false);
  });

  it('coalesces rapid presses into one clean transition to the latest value', () => {
    const clock = new FakeClock();
    const log: FakeAnim[] = [];
    const lane = new ValueLane<number>(0, fakeRunner(log, (f: number, t: number) => `${f}->${t}`), () => {}, clock, 120);
    lane.update(1, true); // starts immediately
    clock.advance(20);
    lane.update(2, true); // within 120ms: deferred
    clock.advance(20);
    lane.update(3, true); // replaces pending
    expect(log.map((a) => a.label)).toEqual(['0->1']);
    clock.advance(100);
    expect(log.map((a) => a.label)).toEqual(['0->1', '1->3']);
    expect(log[0]!.cancelled).toBe(true); // interrupted, not queued behind
    expect(lane.target).toBe(3);
  });

  it('ignores stale done callbacks from cancelled animations', () => {
    const clock = new FakeClock();
    const log: FakeAnim[] = [];
    const lane = new ValueLane<number>(0, fakeRunner(log, (f: number, t: number) => `${f}->${t}`), () => {}, clock, 0);
    lane.update(1, true);
    lane.update(2, true);
    const first = log[0]!;
    first.cancelled = false; // simulate a late 'finished' from a cancelled WAAPI animation
    first.finish();
    expect(lane.isAnimating).toBe(true); // still tracking the 1->2 animation
  });

  it('non-animated updates (reconnect snapshots) apply instantly and cancel motion', () => {
    const clock = new FakeClock();
    const log: FakeAnim[] = [];
    const set: number[] = [];
    const lane = new ValueLane<number>(0, fakeRunner(log, (f: number, t: number) => `${f}->${t}`), (v) => set.push(v), clock, 0);
    lane.update(7, true);
    lane.update(14, false);
    expect(log[0]!.cancelled).toBe(true);
    expect(set).toEqual([14]);
    expect(lane.target).toBe(14);
    lane.update(14, true);
    expect(log).toHaveLength(1); // same value: nothing to animate
  });

  it('a value that returns to the on-screen value while pending does not animate', () => {
    const clock = new FakeClock();
    const log: FakeAnim[] = [];
    const lane = new ValueLane<number>(0, fakeRunner(log, (f: number, t: number) => `${f}->${t}`), () => {}, clock, 120);
    lane.update(6, true);
    clock.advance(10);
    lane.update(7, true); // pending
    lane.update(6, true); // undo before it showed
    clock.advance(200);
    expect(log.map((a) => a.label)).toEqual(['0->6']);
  });
});

describe('ToggleLane (flag, possession, scorebug)', () => {
  it('reverses an in-flight animation instead of jumping', () => {
    const log: FakeAnim[] = [];
    const settled: boolean[] = [];
    const lane = new ToggleLane(false, fakeRunner(log, (s: boolean) => (s ? 'enter' : 'exit'), true), (s) => settled.push(s));
    lane.set(true, true);
    lane.set(false, true); // operator flips the flag off mid-entrance
    expect(log.map((a) => a.label)).toEqual(['enter']);
    expect(log[0]!.reversed).toBe(true);
    log[0]!.finish();
    expect(settled).toEqual([false]);
    expect(lane.isAnimating).toBe(false);
  });

  it('cancels and restarts when reversing is unsupported', () => {
    const log: FakeAnim[] = [];
    const settled: boolean[] = [];
    const lane = new ToggleLane(false, fakeRunner(log, (s: boolean) => (s ? 'enter' : 'exit')), (s) => settled.push(s));
    lane.set(true, true);
    lane.set(false, true);
    expect(log.map((a) => a.label)).toEqual(['enter', 'exit']);
    expect(log[0]!.cancelled).toBe(true);
    log[0]!.finish(); // cancelled: ignored
    log[1]!.finish();
    expect(settled).toEqual([false]);
  });

  it('ignores repeated sets and settles instantly when not animating', () => {
    const log: FakeAnim[] = [];
    const settled: boolean[] = [];
    const lane = new ToggleLane(true, fakeRunner(log, (s: boolean) => String(s)), (s) => settled.push(s));
    lane.set(true, true);
    expect(log).toHaveLength(0);
    lane.set(false, false);
    expect(settled).toEqual([false]);
  });
});

describe('TakeoverController (touchdown & banners)', () => {
  const setup = () => {
    const clock = new FakeClock();
    const log: FakeAnim[] = [];
    const ctl = new TakeoverController(
      fakeRunner(log, (r: { key: string }) => r.key),
      clock,
      { dedupeWindowMs: 1500, maxQueue: 2, staleMs: 10_000 },
    );
    const req = (key: string, priority: number) => ({ key, priority, at: clock.now(), data: null });
    return { clock, log, ctl, req };
  };

  it('ignores an accidental double press', () => {
    const { ctl, req, clock, log } = setup();
    expect(ctl.request(req('touchdown:home', 100))).toBe('started');
    clock.advance(300);
    expect(ctl.request(req('touchdown:home', 100))).toBe('duplicate');
    expect(log).toHaveLength(1);
    clock.advance(2000);
    expect(ctl.request(req('touchdown:home', 100))).toBe('preempted'); // deliberate replay later
  });

  it('higher priority preempts, lower priority queues and plays next', () => {
    const { ctl, req, log } = setup();
    ctl.request(req('fieldGoal:home', 80));
    expect(ctl.request(req('touchdown:away', 100))).toBe('preempted');
    expect(log[0]!.cancelled).toBe(true);
    expect(ctl.request(req('timeout:home', 30))).toBe('queued');
    expect(ctl.active?.key).toBe('touchdown:away');
    log[1]!.finish();
    expect(ctl.active?.key).toBe('timeout:home');
  });

  it('keeps a short, priority-ordered queue', () => {
    const { ctl, req } = setup();
    ctl.request(req('touchdown:home', 100));
    ctl.request(req('firstDown:home', 20));
    ctl.request(req('timeout:away', 30));
    ctl.request(req('penalty:x', 40));
    expect(ctl.queued.map((q) => q.key)).toEqual(['penalty:x', 'timeout:away']);
  });

  it('drops queued graphics that went stale', () => {
    const { ctl, req, clock, log } = setup();
    ctl.request(req('touchdown:home', 100));
    ctl.request(req('timeout:away', 30));
    clock.advance(20_000);
    log[0]!.finish();
    expect(ctl.active).toBeNull();
    expect(log).toHaveLength(1);
  });

  it('emergency clear cancels the active graphic and empties the queue', () => {
    const { ctl, req, log } = setup();
    ctl.request(req('touchdown:home', 100));
    ctl.request(req('timeout:away', 30));
    ctl.clear();
    expect(log[0]!.cancelled).toBe(true);
    expect(ctl.active).toBeNull();
    expect(ctl.queued).toHaveLength(0);
    log[0]!.finish(); // late callback is ignored
    expect(ctl.active).toBeNull();
  });

  it('handles synchronously finishing (empty) timelines', () => {
    const clock = new FakeClock();
    const ctl = new TakeoverController((_r, done) => {
      done();
      return { cancel() {} };
    }, clock);
    expect(ctl.request({ key: 'a', priority: 1, at: 0, data: null })).toBe('started');
    expect(ctl.active).toBeNull();
  });
});

describe('synchronous runners', () => {
  it('ValueLane and ToggleLane do not stay "animating" when a runner finishes immediately', () => {
    const v = new ValueLane<number>(0, (_f, _t, done) => {
      done();
      return { cancel() {} };
    }, () => {}, new FakeClock(), 0);
    v.update(1, true);
    expect(v.isAnimating).toBe(false);
    const settled: boolean[] = [];
    const t = new ToggleLane(false, (_s, done) => {
      done();
      return { cancel() {} };
    }, (s) => settled.push(s));
    t.set(true, true);
    expect(t.isAnimating).toBe(false);
    expect(settled).toEqual([true]);
  });
});

describe('ValueLane snapshots during a transition', () => {
  it('a non-animated re-apply of the current value does not cut the running roll', () => {
    const clock = new FakeClock();
    const log: FakeAnim[] = [];
    const set: number[] = [];
    const lane = new ValueLane<number>(0, fakeRunner(log, (f: number, t: number) => `${f}->${t}`), (v) => set.push(v), clock, 0);
    lane.update(6, true);
    lane.update(6, false); // snapshot arriving right after the event
    expect(log[0]!.cancelled).toBe(false);
    expect(set).toEqual([]);
  });
});
