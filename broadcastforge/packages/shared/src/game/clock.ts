import type { ClockState } from './types.js';

/**
 * Pure clock math. "mono" values are milliseconds on the *server's*
 * monotonic clock (performance.now() on the backend). Nothing here counts
 * ticks: remaining time is always derived from anchors, so a stalled timer,
 * a background tab or a dropped socket never makes the clock drift.
 */

export function createClock(remainingMs: number, nowMono = 0, nowWall = 0): ClockState {
  return { running: false, remainingMs: Math.max(0, remainingMs), anchorMono: nowMono, anchorWall: nowWall };
}

export function clockRemaining(clock: ClockState, nowMono: number): number {
  if (!clock.running) return clock.remainingMs;
  const elapsed = Math.max(0, nowMono - clock.anchorMono);
  return Math.max(0, clock.remainingMs - elapsed);
}

export function startClock(clock: ClockState, nowMono: number, nowWall: number): ClockState {
  if (clock.running) return clock;
  return { running: true, remainingMs: clock.remainingMs, anchorMono: nowMono, anchorWall: nowWall };
}

export function pauseClock(clock: ClockState, nowMono: number, nowWall: number): ClockState {
  if (!clock.running) return clock;
  return { running: false, remainingMs: clockRemaining(clock, nowMono), anchorMono: nowMono, anchorWall: nowWall };
}

/** Set the clock to an exact value, keeping its running state (used to sync to the stadium clock). */
export function setClock(clock: ClockState, remainingMs: number, nowMono: number, nowWall: number, maxMs: number): ClockState {
  return {
    running: clock.running && remainingMs > 0,
    remainingMs: clamp(Math.round(remainingMs), 0, maxMs),
    anchorMono: nowMono,
    anchorWall: nowWall,
  };
}

export function adjustClock(clock: ClockState, deltaMs: number, nowMono: number, nowWall: number, maxMs: number): ClockState {
  return setClock(clock, clockRemaining(clock, nowMono) + deltaMs, nowMono, nowWall, maxMs);
}

/** Server-monotonic time at which a running clock reaches zero, or null. */
export function clockExpiresAt(clock: ClockState): number | null {
  if (!clock.running) return null;
  return clock.anchorMono + clock.remainingMs;
}

/**
 * Re-anchor a clock loaded from storage after a server restart. The old
 * monotonic anchor is meaningless in the new process, so elapsed time is
 * recovered from wall-clock time instead.
 */
export function recoverClock(clock: ClockState, nowMono: number, nowWall: number): ClockState {
  if (!clock.running) return { ...clock, anchorMono: nowMono, anchorWall: nowWall };
  const elapsed = Math.max(0, nowWall - clock.anchorWall);
  const remaining = Math.max(0, clock.remainingMs - elapsed);
  return { running: remaining > 0, remainingMs: remaining, anchorMono: nowMono, anchorWall: nowWall };
}

/**
 * Football scoreboard formatting: whole seconds rounded *up* (12:00 shows for
 * the first second after the snap), switching to SS.t under a minute when
 * tenths are enabled.
 */
export function formatGameClock(ms: number, showTenthsUnderMinute: boolean): string {
  const safe = Math.max(0, ms);
  if (showTenthsUnderMinute && safe < 60_000) {
    const tenths = Math.floor(safe / 100);
    return `${Math.floor(tenths / 10)}.${tenths % 10}`;
  }
  const totalSeconds = Math.ceil(safe / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function formatPlayClock(ms: number): string {
  return String(Math.ceil(Math.max(0, ms) / 1000));
}

/**
 * Parse operator input for the game clock. Accepts "12:00", "4:07", "45",
 * "0:45.3", "45.3", "1207" (=12:07). Returns ms or null when invalid.
 */
export function parseClockInput(input: string): number | null {
  const s = input.trim();
  if (!s) return null;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{1,2}):(\d{1,2})(?:\.(\d))?$/))) {
    const minutes = Number(m[1]);
    const seconds = Number(m[2]);
    if (seconds >= 60) return null;
    return (minutes * 60 + seconds) * 1000 + (m[3] ? Number(m[3]) * 100 : 0);
  }
  if ((m = s.match(/^(\d{1,2})\.(\d)$/))) {
    return Number(m[1]) * 1000 + Number(m[2]) * 100;
  }
  if ((m = s.match(/^(\d{3,4})$/))) {
    const minutes = Math.floor(Number(m[1]) / 100);
    const seconds = Number(m[1]) % 100;
    if (seconds >= 60) return null;
    return (minutes * 60 + seconds) * 1000;
  }
  if ((m = s.match(/^(\d{1,2})$/))) return Number(m[1]) * 1000;
  return null;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
