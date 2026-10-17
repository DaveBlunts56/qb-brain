import { describe, expect, it } from 'vitest';
import {
  adjustClock,
  clockExpiresAt,
  clockRemaining,
  createClock,
  formatGameClock,
  formatPlayClock,
  parseClockInput,
  pauseClock,
  recoverClock,
  setClock,
  startClock,
  ServerTimeEstimator,
} from '../src/index.js';

const MAX = 99 * 60_000;

describe('clock math', () => {
  it('derives remaining time from anchors, not ticks', () => {
    let c = createClock(720_000, 1000, 0);
    c = startClock(c, 1000, 0);
    expect(clockRemaining(c, 1000)).toBe(720_000);
    expect(clockRemaining(c, 11_000)).toBe(710_000);
    // A huge stall (e.g. a frozen event loop) does not lose time.
    expect(clockRemaining(c, 1000 + 600_000)).toBe(120_000);
  });

  it('never goes negative and reports its expiry instant', () => {
    const c = startClock(createClock(5_000), 100, 0);
    expect(clockRemaining(c, 100 + 9_000)).toBe(0);
    expect(clockExpiresAt(c)).toBe(5_100);
    expect(clockExpiresAt(pauseClock(c, 200, 0))).toBeNull();
  });

  it('pause freezes the remaining time and restart re-anchors', () => {
    let c = startClock(createClock(60_000), 0, 0);
    c = pauseClock(c, 10_000, 0);
    expect(c.running).toBe(false);
    expect(clockRemaining(c, 999_999)).toBe(50_000);
    c = startClock(c, 20_000, 0);
    expect(clockRemaining(c, 25_000)).toBe(45_000);
  });

  it('start and pause are idempotent', () => {
    const running = startClock(createClock(60_000), 0, 0);
    expect(startClock(running, 5_000, 0)).toBe(running);
    const paused = createClock(60_000);
    expect(pauseClock(paused, 5_000, 0)).toBe(paused);
  });

  it('set keeps a running clock running (stadium sync) and clamps', () => {
    const running = startClock(createClock(600_000), 0, 0);
    const synced = setClock(running, 455_300, 30_000, 0, MAX);
    expect(synced.running).toBe(true);
    expect(clockRemaining(synced, 31_000)).toBe(454_300);
    expect(setClock(running, -50, 0, 0, MAX).remainingMs).toBe(0);
    expect(setClock(running, 0, 0, 0, MAX).running).toBe(false);
    expect(setClock(running, MAX * 2, 0, 0, MAX).remainingMs).toBe(MAX);
  });

  it('adjust nudges relative to the live value', () => {
    const running = startClock(createClock(100_000), 0, 0);
    const c = adjustClock(running, 1_000, 10_000, 0, MAX);
    expect(clockRemaining(c, 10_000)).toBe(91_000);
  });

  it('recovers a running clock after a restart using wall time', () => {
    const before = { running: true, remainingMs: 300_000, anchorMono: 999_999, anchorWall: 1_000_000 };
    const after = recoverClock(before, 5, 1_000_000 + 4_000);
    expect(after.running).toBe(true);
    expect(after.anchorMono).toBe(5);
    expect(after.remainingMs).toBe(296_000);
    const expired = recoverClock(before, 5, 1_000_000 + 400_000);
    expect(expired).toMatchObject({ running: false, remainingMs: 0 });
  });
});

describe('clock formatting', () => {
  it('rounds whole seconds up like a scoreboard', () => {
    expect(formatGameClock(720_000, true)).toBe('12:00');
    expect(formatGameClock(719_001, true)).toBe('12:00');
    expect(formatGameClock(719_000, true)).toBe('11:59');
    expect(formatGameClock(60_000, true)).toBe('1:00');
  });

  it('shows tenths under a minute when enabled', () => {
    expect(formatGameClock(59_990, true)).toBe('59.9');
    expect(formatGameClock(4_250, true)).toBe('4.2');
    expect(formatGameClock(0, true)).toBe('0.0');
    expect(formatGameClock(59_990, false)).toBe('1:00');
    expect(formatGameClock(4_250, false)).toBe('0:05');
  });

  it('formats the play clock', () => {
    expect(formatPlayClock(40_000)).toBe('40');
    expect(formatPlayClock(39_100)).toBe('40');
    expect(formatPlayClock(0)).toBe('0');
  });

  it('parses operator clock input', () => {
    expect(parseClockInput('12:00')).toBe(720_000);
    expect(parseClockInput('4:07')).toBe(247_000);
    expect(parseClockInput('0:45.3')).toBe(45_300);
    expect(parseClockInput('45.3')).toBe(45_300);
    expect(parseClockInput('45')).toBe(45_000);
    expect(parseClockInput('1207')).toBe(727_000);
    expect(parseClockInput('5:75')).toBeNull();
    expect(parseClockInput('abc')).toBeNull();
    expect(parseClockInput('')).toBeNull();
  });
});

describe('ServerTimeEstimator', () => {
  it('prefers the lowest-RTT sample', () => {
    const est = new ServerTimeEstimator();
    est.addSample(0, 10_050, 100); // rtt 100 -> offset 10_000
    est.addSample(1000, 11_005, 1010); // rtt 10 -> offset 10_000
    est.addSample(2000, 12_400, 2600); // rtt 600, skewed
    expect(est.offset(2600)).toBeCloseTo(10_000, 0);
    expect(est.bestRtt).toBe(10);
  });

  it('slews small corrections and snaps large ones', () => {
    const est = new ServerTimeEstimator({ slewPerSecondMs: 50, snapThresholdMs: 250 });
    est.addSample(0, 1010, 20); // rtt 20 -> offset 1000
    expect(est.offset(20)).toBe(1000);
    // A better (lower RTT) estimate 40ms away is approached at <= 50ms per second.
    est.addSample(100, 1145, 110); // rtt 10 -> offset 1040
    expect(est.offset(220)).toBeCloseTo(1010, 5);
    // A time-base jump beyond the snap threshold is applied at once.
    est.addSample(2000, 500_000, 2005); // rtt 5 -> offset 497_997.5
    expect(est.offset(2010)).toBeCloseTo(497_997.5, 5);
  });
});
