import type { Team } from "../data/types";
import { describeYardLine } from "../field";
import type { Rng } from "../math/rng";
import { clamp } from "../math/vec";
import { other, runoffFor, type GameState } from "./gameState";
import { extraPointChance, fieldGoalChance, fieldGoalDistance, punt } from "./specialTeams";

/**
 * Phase 1 resolves the CPU's offensive possessions with a play-by-play statistical model driven by
 * the two teams' unit ratings (the user plays offense; playable defense arrives in Phase 3).
 * Every play still advances the real game clock, downs and field position.
 */
export type CpuDriveEnd = "touchdown" | "fieldGoal" | "missedFieldGoal" | "punt" | "interception" | "fumble" | "downs" | "endOfHalf";

export interface CpuDriveResult {
  end: CpuDriveEnd;
  /** Points scored by the CPU on the drive (incl. PAT). */
  points: number;
  plays: number;
  yards: number;
  timeUsed: number;
  startYardLine: number;
  /** User's starting yard line if the CPU gave the ball back without scoring, else null (kickoff). */
  userYardLine: number | null;
  highlights: string[];
  summary: string;
  /** Game state after the drive (clock, quarter, score). Possession/field set by the match. */
  state: GameState;
}

const LIVE_SECONDS = 5.5;

export function simulateCpuDrive(start: GameState, offense: Team, defense: Team, rng: Rng, edgeBonus = 0): CpuDriveResult {
  const s: GameState = { ...start, score: { ...start.score }, timeouts: { ...start.timeouts } };
  const cpu = s.possession;
  const startYL = s.yardLine;
  let yl = s.yardLine;
  let down = 1;
  let lineToGain = Math.min(100, yl + 10);
  let plays = 0;
  let timeUsed = 0;
  const highlights: string[] = [];
  const edge = (offense.offenseRating - defense.defenseRating) / 10 + edgeBonus;
  const runoff = runoffFor(s.quarterLength);
  const halfEnds = () => s.quarter === 2 || s.quarter === 4;

  const spend = (secs: number): boolean => {
    // Returns true if the half/game ended.
    let left = secs;
    while (left > 0) {
      const used = Math.min(left, s.clock);
      s.clock -= used;
      timeUsed += used;
      left -= used;
      if (s.clock <= 0) {
        if (halfEnds()) return true;
        s.quarter += 1;
        s.clock = s.quarterLength;
      }
    }
    return false;
  };

  const finish = (end: CpuDriveEnd, points: number, userYL: number | null, summary: string): CpuDriveResult => ({
    end, points, plays, yards: Math.round(yl - startYL), timeUsed, startYardLine: startYL,
    userYardLine: userYL, highlights, summary, state: s,
  });

  for (let guard = 0; guard < 40; guard++) {
    const togo = lineToGain - yl;
    // Fourth down decisions.
    if (down === 4) {
      const fgDist = fieldGoalDistance(yl);
      const fgP = fieldGoalChance(fgDist, offense.kicker);
      const trailingLate = s.quarter === 4 && s.clock < 240 && s.score[cpu] < s.score[other(cpu)];
      const goForIt = (togo <= 1 && yl >= 40) || (trailingLate && fgP < 0.5) || (togo <= 2 && yl >= 60 && fgP < 0.6);
      if (!goForIt && fgP >= 0.45) {
        plays++;
        const ended = spend(LIVE_SECONDS);
        const good = rng.chance(fgP);
        if (good) {
          s.score[cpu] += 3;
          highlights.push(`${fgDist}-yd field goal is good`);
          return finish("fieldGoal", 3, null, `${offense.name} kick a ${fgDist}-yard field goal`);
        }
        highlights.push(`${fgDist}-yd field goal is no good`);
        const userYL = Math.max(20, 100 - (yl - 7));
        if (ended) return finish("endOfHalf", 0, null, `${fgDist}-yard field goal no good as time expires`);
        return finish("missedFieldGoal", 0, userYL, `${offense.name} miss a ${fgDist}-yard field goal`);
      }
      if (!goForIt) {
        plays++;
        const p = punt(yl, offense.punter, rng);
        const ended = spend(LIVE_SECONDS + 2);
        highlights.push(p.text);
        if (ended) return finish("endOfHalf", 0, null, "Punt as time expires");
        return finish("punt", 0, p.receiverYardLine, `${offense.name} punt (${p.text.toLowerCase()})`);
      }
    }

    // A scrimmage play.
    plays++;
    let gain = 0;
    let clockStops = false;
    const pass = rng.chance(togo >= 7 ? 0.68 : 0.52);
    if (pass) {
      const r = rng.next();
      const pSack = 0.065 - edge * 0.006;
      const pInt = 0.024 - edge * 0.003;
      const pComp = clamp(0.62 + edge * 0.035, 0.45, 0.78);
      if (r < pSack) {
        gain = -Math.round(rng.range(3, 9));
      } else if (r < pSack + pInt) {
        const spend1 = spend(LIVE_SECONDS);
        const ret = Math.round(clamp(rng.gauss() * 8 + 6, 0, 40));
        const spot = clamp(yl + rng.range(5, 20), 1, 99);
        const userYL = clamp(100 - spot + ret, 1, 99);
        highlights.push(`Intercepted! Returned to the ${describeYardLine(userYL)}`);
        if (spend1) return finish("endOfHalf", 0, null, "Interception as time expires");
        return finish("interception", 0, Math.round(userYL), `Your defense intercepts ${offense.name}`);
      } else if (r < pSack + pInt + (1 - pSack - pInt) * pComp) {
        gain = Math.round(clamp(rng.gauss() * 6 + 9 + edge * 0.8, 1, 35));
        if (rng.chance(0.06 + edge * 0.01)) gain = Math.round(rng.range(25, 65));
      } else {
        clockStops = true; // incomplete
      }
    } else {
      gain = Math.round(clamp(rng.gauss() * 3.5 + 4.1 + edge * 0.4, -4, 15));
      if (rng.chance(0.04 + edge * 0.006)) gain = Math.round(rng.range(12, 50));
      if (rng.chance(0.009)) {
        const spend1 = spend(LIVE_SECONDS);
        const spot = clamp(yl + Math.max(0, gain), 1, 99);
        highlights.push("Fumble! Your defense recovers");
        if (spend1) return finish("endOfHalf", 0, null, "Fumble as time expires");
        return finish("fumble", 0, Math.round(100 - spot), `${offense.name} fumble, your ball`);
      }
    }
    yl = clamp(yl + gain, 0.5, 100);
    if (gain >= 20) highlights.push(`${pass ? "Pass" : "Run"} for ${gain} yds to the ${describeYardLine(Math.min(99, yl))}`);
    if (yl >= 100) {
      spend(LIVE_SECONDS); // a touchdown counts even if it ends the half
      s.score[cpu] += 6;
      const pat = rng.chance(extraPointChance(offense.kicker));
      if (pat) s.score[cpu] += 1;
      highlights.push(`Touchdown${pat ? "" : " (PAT missed)"}`);
      return finish("touchdown", pat ? 7 : 6, null, `${offense.name} touchdown${pat ? "" : ", extra point no good"}`);
    }
    if (yl <= 0) yl = 0.5; // sacks don't produce safeties in the drive model
    if (spend(LIVE_SECONDS + (clockStops ? 0 : runoff))) {
      return finish("endOfHalf", 0, null, `${offense.name} run out the clock`);
    }
    if (yl >= lineToGain) {
      down = 1;
      lineToGain = Math.min(100, yl + 10);
    } else if (down === 4) {
      highlights.push("Stopped on fourth down");
      return finish("downs", 0, Math.round(100 - yl), `Your defense stops ${offense.name} on downs`);
    } else {
      down++;
    }
  }
  return finish("punt", 0, 20, `${offense.name} punt`);
}
