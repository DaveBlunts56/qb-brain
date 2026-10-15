import { CENTER_Y, spotBetweenHashes } from "../field";
import { clamp } from "../math/vec";

/**
 * Game rules as pure functions over a plain GameState. Everything here is deterministic and
 * independent of the simulation and rendering, so it is easy to test.
 *
 * Field position is always stored from the perspective of the team with the ball:
 * yardLine 25 = "own 25", 75 = "opponent 25", 100 = opponent goal line.
 */
export type TeamKey = "home" | "away";

export const other = (t: TeamKey): TeamKey => (t === "home" ? "away" : "home");

export interface GameState {
  quarter: number;
  /** Seconds left in the quarter. */
  clock: number;
  quarterLength: number;
  score: Record<TeamKey, number>;
  possession: TeamKey;
  yardLine: number;
  /** Absolute y of the ball (which hash) for the next snap. */
  ballY: number;
  down: number;
  /** Yard line (offense perspective) the offense must reach for a first down. ≥100 means goal to go. */
  lineToGain: number;
  timeouts: Record<TeamKey, number>;
  /** True if the clock keeps running between plays (after an in-bounds play). */
  clockRunning: boolean;
  /** Seconds of between-play runoff still allowed before the next snap. */
  runoff: number;
}

export type RuleEvent =
  | { kind: "firstDown" }
  | { kind: "turnoverOnDowns" }
  | { kind: "touchdown"; team: TeamKey }
  | { kind: "safety"; team: TeamKey }
  | { kind: "turnover"; reason: "interception" | "downs" | "punt" | "missedFG" }
  | { kind: "fieldGoal"; team: TeamKey; good: boolean; distance: number }
  | { kind: "extraPoint"; team: TeamKey; good: boolean; points: number }
  | { kind: "endQuarter"; quarter: number }
  | { kind: "halftime" }
  | { kind: "final" };

export const TIMEOUTS_PER_HALF = 3;

/** Seconds of game clock that run between plays (huddle + play clock), scaled to quarter length. */
export function runoffFor(quarterLength: number): number {
  return clamp(Math.round(quarterLength * 0.06), 6, 40);
}

export function newGame(quarterMinutes: number, receiving: TeamKey = "home"): GameState {
  const quarterLength = Math.round(quarterMinutes * 60);
  return {
    quarter: 1, clock: quarterLength, quarterLength,
    score: { home: 0, away: 0 },
    possession: receiving, yardLine: 25, ballY: CENTER_Y, down: 1, lineToGain: 35,
    timeouts: { home: TIMEOUTS_PER_HALF, away: TIMEOUTS_PER_HALF },
    clockRunning: false, runoff: 0,
  };
}

export function yardsToGo(s: GameState): number {
  return Math.max(0, Math.min(s.lineToGain, 100) - s.yardLine);
}

export function isGoalToGo(s: GameState): boolean {
  return s.lineToGain >= 100;
}

/** "1st & 10", "3rd & 2", "2nd & Goal", "4th & Inches". */
export function downAndDistance(s: GameState): string {
  const ord = ["1st", "2nd", "3rd", "4th"][s.down - 1] ?? `${s.down}th`;
  if (isGoalToGo(s)) return `${ord} & Goal`;
  const togo = yardsToGo(s);
  if (togo < 0.75) return `${ord} & Inches`;
  return `${ord} & ${Math.round(togo)}`;
}

/** Starts a fresh series for the offense at a yard line. */
export function newSeries(s: GameState, team: TeamKey, yardLine: number, ballY = CENTER_Y): GameState {
  const yl = clamp(yardLine, 1, 99);
  return { ...s, possession: team, yardLine: yl, ballY, down: 1, lineToGain: Math.min(100, yl + 10) };
}

export interface PlayResultInput {
  kind: "tackle" | "outOfBounds" | "incomplete" | "sack" | "touchdown" | "interception" | "interceptionTouchback" | "pickSix" | "safety";
  /** Where the ball is dead, as a yard line from the offense's own goal line. */
  spot: number;
  /** Absolute y of the dead ball. */
  spotY: number;
  elapsed: number;
  clockStops: boolean;
}

/**
 * Applies a scrimmage play to the game state: clock, score, downs, possession.
 * Kicks after scores (PAT, kickoff) are handled by the match flow.
 */
export function applyPlay(prev: GameState, r: PlayResultInput): { state: GameState; events: RuleEvent[] } {
  const events: RuleEvent[] = [];
  const offense = prev.possession;
  const defense = other(offense);
  let s: GameState = { ...prev, score: { ...prev.score }, timeouts: { ...prev.timeouts } };
  s.clock = Math.max(0, s.clock - r.elapsed);
  s.clockRunning = !r.clockStops;
  s.runoff = s.clockRunning ? runoffFor(s.quarterLength) : 0;

  switch (r.kind) {
    case "touchdown":
      s.score[offense] += 6;
      s.clockRunning = false;
      s.runoff = 0;
      events.push({ kind: "touchdown", team: offense });
      return { state: s, events };
    case "pickSix":
      s.score[defense] += 6;
      s.clockRunning = false;
      s.runoff = 0;
      s.possession = defense;
      events.push({ kind: "turnover", reason: "interception" }, { kind: "touchdown", team: defense });
      return { state: s, events };
    case "safety":
      s.score[defense] += 2;
      s.clockRunning = false;
      s.runoff = 0;
      events.push({ kind: "safety", team: defense });
      return { state: s, events };
    case "interception": {
      s.clockRunning = false;
      s.runoff = 0;
      s = newSeries(s, defense, 100 - r.spot, spotBetweenHashes(r.spotY));
      events.push({ kind: "turnover", reason: "interception" });
      return { state: s, events };
    }
    case "interceptionTouchback":
      s.clockRunning = false;
      s.runoff = 0;
      s = newSeries(s, defense, 20);
      events.push({ kind: "turnover", reason: "interception" });
      return { state: s, events };
    default:
      break;
  }

  // Scrimmage play that ends in the field of play (or incomplete).
  const spot = r.kind === "incomplete" ? prev.yardLine : clamp(r.spot, 0.5, 99.5);
  const ballY = r.kind === "incomplete" ? prev.ballY : spotBetweenHashes(r.spotY);
  if (spot >= s.lineToGain) {
    s = { ...s, yardLine: spot, ballY, down: 1, lineToGain: Math.min(100, spot + 10) };
    events.push({ kind: "firstDown" });
  } else if (s.down >= 4) {
    s.clockRunning = false;
    s.runoff = 0;
    s = newSeries(s, defense, 100 - spot, ballY);
    events.push({ kind: "turnoverOnDowns" }, { kind: "turnover", reason: "downs" });
  } else {
    s = { ...s, yardLine: spot, ballY, down: s.down + 1 };
  }
  return { state: s, events };
}

/**
 * Runs the clock between plays (huddle + play clock). Real seconds are accelerated; the offense
 * saves time by snapping sooner. Returns true if the quarter ran out.
 */
export function tickBetweenPlays(s: GameState, realDt: number, rate = 3): boolean {
  if (!s.clockRunning || s.runoff <= 0 || s.clock <= 0) return s.clock <= 0;
  const drain = Math.min(s.runoff, realDt * rate, s.clock);
  s.clock -= drain;
  s.runoff -= drain;
  return s.clock <= 0;
}

/** Applies the rest of the runoff instantly (used when skipping ahead or by CPU drives). */
export function burnRunoff(s: GameState): void {
  if (!s.clockRunning) return;
  const drain = Math.min(s.runoff, s.clock);
  s.clock -= drain;
  s.runoff = 0;
}

export function callTimeout(s: GameState, team: TeamKey): boolean {
  if (s.timeouts[team] <= 0 || !s.clockRunning || s.clock <= 0) return false;
  s.timeouts[team] -= 1;
  s.clockRunning = false;
  s.runoff = 0;
  return true;
}

export type QuarterTransition = "none" | "nextQuarter" | "halftime" | "final";

/** Called when the clock hits zero (after the play in progress ends). */
export function advanceQuarter(s: GameState): QuarterTransition {
  if (s.clock > 0) return "none";
  if (s.quarter >= 4) return "final";
  s.quarter += 1;
  s.clock = s.quarterLength;
  s.clockRunning = false;
  s.runoff = 0;
  if (s.quarter === 3) {
    s.timeouts = { home: TIMEOUTS_PER_HALF, away: TIMEOUTS_PER_HALF };
    return "halftime";
  }
  return "nextQuarter";
}

export function formatClock(seconds: number): string {
  const t = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(t / 60);
  const sec = t % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
