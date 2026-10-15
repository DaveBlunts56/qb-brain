import { describe, expect, it } from "vitest";
import {
  advanceQuarter, applyPlay, burnRunoff, callTimeout, downAndDistance, formatClock, newGame, newSeries, runoffFor,
  tickBetweenPlays, yardsToGo, type GameState, type PlayResultInput,
} from "../src/core/rules/gameState";
import { extraPointChance, fieldGoalChance, fieldGoalDistance, kickoffReturn, punt } from "../src/core/rules/specialTeams";
import { describeYardLine } from "../src/core/field";
import { Rng } from "../src/core/math/rng";
import { TEAMS } from "../src/core/data/teams";

const play = (kind: PlayResultInput["kind"], spot: number, extra: Partial<PlayResultInput> = {}): PlayResultInput => ({
  kind, spot, spotY: 26.67, elapsed: 5, clockStops: kind === "incomplete" || kind === "outOfBounds", ...extra,
});

function at(yardLine: number, down = 1, toGo = 10): GameState {
  const s = newSeries(newGame(5), "home", yardLine);
  s.down = down;
  s.lineToGain = Math.min(100, yardLine + toGo);
  return s;
}

describe("downs and distance", () => {
  it("starts a series at 1st & 10", () => {
    const s = at(25);
    expect(downAndDistance(s)).toBe("1st & 10");
    expect(yardsToGo(s)).toBe(10);
  });

  it("advances the down on a short gain and keeps the line to gain", () => {
    const { state, events } = applyPlay(at(25), play("tackle", 29));
    expect(state.down).toBe(2);
    expect(state.yardLine).toBe(29);
    expect(downAndDistance(state)).toBe("2nd & 6");
    expect(events).toEqual([]);
  });

  it("awards a first down when the line to gain is reached", () => {
    const { state, events } = applyPlay(at(25, 3, 4), play("tackle", 29.2));
    expect(state.down).toBe(1);
    expect(state.lineToGain).toBeCloseTo(39.2);
    expect(events.map((e) => e.kind)).toContain("firstDown");
  });

  it("an incomplete pass keeps the spot and uses a down", () => {
    const { state } = applyPlay(at(40, 2, 7), play("incomplete", 55));
    expect(state.yardLine).toBe(40);
    expect(state.down).toBe(3);
  });

  it("sacks lose yardage and keep the clock running", () => {
    const { state } = applyPlay(at(40, 1, 10), play("sack", 33));
    expect(state.yardLine).toBe(33);
    expect(downAndDistance(state)).toBe("2nd & 17");
    expect(state.clockRunning).toBe(true);
  });

  it("turns the ball over on downs from the defense's perspective", () => {
    const { state, events } = applyPlay(at(60, 4, 3), play("tackle", 61));
    expect(events.map((e) => e.kind)).toEqual(["turnoverOnDowns", "turnover"]);
    expect(state.possession).toBe("away");
    expect(state.yardLine).toBe(39);
    expect(state.down).toBe(1);
  });

  it("goal to go inside the 10", () => {
    const { state } = applyPlay(at(80, 1, 10), play("tackle", 93));
    expect(state.down).toBe(1);
    expect(state.lineToGain).toBe(100);
    expect(downAndDistance(state)).toBe("1st & Goal");
  });

  it("short yardage reads as inches", () => {
    const s = at(50, 3, 0.4);
    expect(downAndDistance(s)).toBe("3rd & Inches");
  });
});

describe("scoring", () => {
  it("touchdown is six for the offense and stops the clock", () => {
    const { state, events } = applyPlay(at(90), play("touchdown", 100));
    expect(state.score.home).toBe(6);
    expect(state.clockRunning).toBe(false);
    expect(events[0]).toEqual({ kind: "touchdown", team: "home" });
  });

  it("safety is two for the defense", () => {
    const { state } = applyPlay(at(3), play("safety", 0));
    expect(state.score.away).toBe(2);
  });

  it("interception changes possession at the return spot", () => {
    const { state, events } = applyPlay(at(30), play("interception", 55, { spotY: 10 }));
    expect(state.possession).toBe("away");
    expect(state.yardLine).toBe(45);
    expect(state.ballY).toBeGreaterThan(20); // spotted on the hash
    expect(events.map((e) => e.kind)).toContain("turnover");
  });

  it("interception touchback gives the defense the 20", () => {
    const { state } = applyPlay(at(70), play("interceptionTouchback", 105));
    expect(state.possession).toBe("away");
    expect(state.yardLine).toBe(20);
  });

  it("pick six scores for the defense", () => {
    const { state } = applyPlay(at(30), play("pickSix", 0));
    expect(state.score.away).toBe(6);
    expect(state.score.home).toBe(0);
  });
});

describe("clock", () => {
  it("live time comes off the clock", () => {
    const s = at(25);
    s.clock = 100;
    const { state } = applyPlay(s, play("tackle", 28, { elapsed: 6.5 }));
    expect(state.clock).toBeCloseTo(93.5);
  });

  it("in-bounds plays start a between-play runoff that a quick snap can save", () => {
    const { state } = applyPlay(at(25), play("tackle", 28));
    expect(state.clockRunning).toBe(true);
    expect(state.runoff).toBe(runoffFor(state.quarterLength));
    const before = state.clock;
    tickBetweenPlays(state, 1, 3);
    expect(state.clock).toBeCloseTo(before - 3);
    // The runoff is capped no matter how long the player waits.
    for (let i = 0; i < 100; i++) tickBetweenPlays(state, 1, 3);
    expect(state.clock).toBeCloseTo(before - runoffFor(state.quarterLength));
  });

  it("incomplete passes stop the clock", () => {
    const { state } = applyPlay(at(25), play("incomplete", 25));
    expect(state.clockRunning).toBe(false);
    const c = state.clock;
    tickBetweenPlays(state, 5);
    expect(state.clock).toBe(c);
  });

  it("timeouts stop the running clock and are limited", () => {
    const { state } = applyPlay(at(25), play("tackle", 28));
    expect(callTimeout(state, "home")).toBe(true);
    expect(state.clockRunning).toBe(false);
    expect(state.timeouts.home).toBe(2);
    // Can't call one with the clock already stopped.
    expect(callTimeout(state, "home")).toBe(false);
  });

  it("quarters advance, halftime resets timeouts, fourth quarter ends the game", () => {
    const s = newGame(3);
    s.timeouts.home = 0;
    s.clock = 0;
    expect(advanceQuarter(s)).toBe("nextQuarter");
    expect(s.quarter).toBe(2);
    expect(s.clock).toBe(180);
    s.clock = 0;
    expect(advanceQuarter(s)).toBe("halftime");
    expect(s.quarter).toBe(3);
    expect(s.timeouts.home).toBe(3);
    s.clock = 0;
    advanceQuarter(s);
    s.clock = 0;
    expect(advanceQuarter(s)).toBe("final");
  });

  it("burnRunoff drains what's left", () => {
    const { state } = applyPlay(at(25), play("tackle", 28));
    const c = state.clock;
    burnRunoff(state);
    expect(state.clock).toBeCloseTo(c - runoffFor(state.quarterLength));
  });

  it("formats the clock", () => {
    expect(formatClock(125)).toBe("2:05");
    expect(formatClock(0.2)).toBe("0:01");
    expect(formatClock(-3)).toBe("0:00");
  });
});

describe("field position", () => {
  it("describes yard lines from the offense's view", () => {
    expect(describeYardLine(25)).toBe("OWN 25");
    expect(describeYardLine(50)).toBe("50");
    expect(describeYardLine(65)).toBe("OPP 35");
  });
});

describe("special teams", () => {
  const k = TEAMS[0].kicker;

  it("field goal distance adds the end zone and snap", () => {
    expect(fieldGoalDistance(75)).toBe(42);
  });

  it("field goal chances fall with distance and are zero far out of range", () => {
    expect(fieldGoalChance(25, k)).toBeGreaterThan(0.9);
    expect(fieldGoalChance(50, k)).toBeLessThan(fieldGoalChance(35, k));
    expect(fieldGoalChance(75, k)).toBe(0);
    expect(extraPointChance(k)).toBeGreaterThan(0.85);
  });

  it("punts flip field position with a touchback at the 20", () => {
    const rng = new Rng(3);
    for (let i = 0; i < 200; i++) {
      const p = punt(70, TEAMS[0].punter, rng);
      expect(p.receiverYardLine).toBeGreaterThanOrEqual(1);
      expect(p.receiverYardLine).toBeLessThanOrEqual(99);
      if (p.touchback) expect(p.receiverYardLine).toBe(20);
    }
    const avg = Array.from({ length: 300 }, () => punt(30, TEAMS[0].punter, rng).receiverYardLine).reduce((a, b) => a + b, 0) / 300;
    expect(avg).toBeGreaterThan(20);
    expect(avg).toBeLessThan(45);
  });

  it("kickoff returns land in a sensible range", () => {
    const rng = new Rng(9);
    for (let i = 0; i < 200; i++) {
      const r = kickoffReturn(rng);
      expect(r.yardLine).toBeGreaterThanOrEqual(12);
      expect(r.yardLine).toBeLessThanOrEqual(60);
    }
  });
});
