import { describe, expect, it } from "vitest";
import { PLAYBOOK } from "../src/core/data/playbook";
import { TEAMS } from "../src/core/data/teams";
import { Match, type MatchOptions } from "../src/core/match";
import { Rng } from "../src/core/math/rng";
import { simulateCpuDrive } from "../src/core/rules/cpuDrive";
import { newGame, newSeries } from "../src/core/rules/gameState";
import { botInput } from "../src/core/sim/bot";

const opts = (seed = 1, extra: Partial<MatchOptions> = {}): MatchOptions => ({
  home: TEAMS[0], away: TEAMS[1], quarterMinutes: 3, difficulty: "pro", seed, ...extra,
});

/** Plays the user's side with the autopilot: picks plays, kicks on 4th down, kicks PATs. */
function autoplay(m: Match, rng: Rng, maxSteps = 5000): string[] {
  const flows: string[] = [];
  for (let step = 0; step < maxSteps && m.flow.kind !== "final"; step++) {
    flows.push(m.flow.kind);
    switch (m.flow.kind) {
      case "kickoff":
      case "result":
      case "cpuDrive":
      case "quarter":
        m.continue();
        break;
      case "playCall":
        if (m.fourthDown && m.state.yardLine >= 62) m.fieldGoal();
        else if (m.fourthDown && m.state.yardLine < 50) m.punt();
        else m.selectPlay(PLAYBOOK[step % PLAYBOOK.length].id, step % 2 === 0);
        break;
      case "preSnap":
        m.runPlay((s) => botInput(s, rng));
        break;
      case "pat":
        m.choosePat(step % 5 === 0 ? "two" : "kick");
        break;
      default:
        throw new Error("stuck in " + m.flow.kind);
    }
  }
  return flows;
}

describe("match flow", () => {
  it("opens with the user receiving the kickoff", () => {
    const m = new Match(opts());
    expect(m.flow.kind).toBe("kickoff");
    expect(m.state.possession).toBe("home");
    expect(m.state.down).toBe(1);
    m.continue();
    expect(m.flow.kind).toBe("playCall");
  });

  it("play call → pre-snap → live → result", () => {
    const m = new Match(opts(2));
    m.continue();
    m.selectPlay("mesh");
    expect(m.flow.kind).toBe("preSnap");
    expect(m.sim).not.toBeNull();
    // Changing the play keeps the defensive call.
    const cov = m.coverage;
    m.changePlay();
    m.selectPlay("smash");
    expect(m.coverage).toBe(cov);
    m.snap();
    expect(m.flow.kind).toBe("live");
    const rng = new Rng(2);
    m.runPlay((s) => botInput(s, rng));
    expect(m.flow.kind).toBe("result");
    expect(m.lastOutcome).not.toBeNull();
  });

  it("the between-play clock runs after a tackle, a timeout stops it", () => {
    const m = new Match(opts(3));
    m.continue();
    // Force an in-bounds play: hold the ball until sacked.
    m.selectPlay("four-verts");
    m.runPlay(() => ({ move: { x: 0, y: 0 }, commands: [] }));
    expect(m.lastOutcome!.kind).toBe("sack");
    m.continue();
    expect(m.flow.kind).toBe("playCall");
    expect(m.state.clockRunning).toBe(true);
    const c = m.state.clock;
    m.update(1, { x: 0, y: 0 });
    expect(m.state.clock).toBeLessThan(c);
    expect(m.canTimeout).toBe(true);
    expect(m.timeout()).toBe(true);
    const c2 = m.state.clock;
    m.update(1, { x: 0, y: 0 });
    expect(m.state.clock).toBe(c2);
    expect(m.state.timeouts.home).toBe(2);
  });

  it("fourth down: punting hands the CPU the ball and their drive runs", () => {
    const m = new Match(opts(4));
    m.continue();
    m.state.down = 4;
    m.punt();
    expect(m.flow.kind).toBe("result");
    expect(m.state.possession).toBe("away");
    m.continue();
    expect(m.flow.kind).toBe("cpuDrive");
    m.continue();
    expect(["kickoff", "quarter", "final"]).toContain(m.flow.kind);
    if (m.flow.kind === "kickoff") expect(m.state.possession).toBe("home");
  });

  it("a short field goal is usually good and scores 3", () => {
    let made = 0;
    for (let seed = 0; seed < 40; seed++) {
      const m = new Match(opts(100 + seed));
      m.continue();
      m.state.yardLine = 88;
      m.state.down = 4;
      m.fieldGoal();
      if (m.state.score.home === 3) made++;
    }
    expect(made).toBeGreaterThan(30);
  });

  it("touchdown leads to a PAT choice; a 2-point try is a real snap from the 2", () => {
    const m = new Match(opts(5));
    m.continue();
    m.state = newSeries(m.state, "home", 97);
    m.selectPlay("slant-flat");
    const sim = m.sim!;
    for (const d of sim.defense) { d.pos = { x: 119, y: 50 }; d.down = true; }
    const rng = new Rng(5);
    m.runPlay((s) => botInput(s, rng));
    expect(m.lastOutcome!.kind).toBe("touchdown");
    expect(m.state.score.home).toBe(6);
    m.continue();
    expect(m.flow.kind).toBe("pat");
    m.choosePat("two");
    expect(m.isTry).toBe(true);
    expect(m.downText).toBe("2-PT TRY");
    expect(m.state.yardLine).toBe(98);
    m.selectPlay("slant-flat");
    m.runPlay((s) => botInput(s, rng));
    expect(m.isTry).toBe(false);
    expect([6, 8]).toContain(m.state.score.home);
  });

  it("plays complete games to a final whistle", () => {
    for (let seed = 0; seed < 6; seed++) {
      const m = new Match(opts(200 + seed, { difficulty: (["rookie", "pro", "allpro"] as const)[seed % 3] }));
      const flows = autoplay(m, new Rng(seed));
      expect(m.flow.kind).toBe("final");
      expect(m.state.quarter).toBe(4);
      expect(flows).toContain("cpuDrive");
      expect(flows.filter((f) => f === "quarter").length).toBeGreaterThanOrEqual(1); // halftime at least
      expect(m.stats.passAtt).toBeGreaterThan(5);
      const total = m.state.score.home + m.state.score.away;
      expect(total).toBeGreaterThanOrEqual(0);
      expect(total).toBeLessThan(150);
    }
  });

  it("a full offensive drive ends in a score or a change of possession", () => {
    const m = new Match(opts(9));
    m.continue();
    const rng = new Rng(9);
    let guard = 0;
    while (guard++ < 200) {
      if (m.flow.kind === "playCall") {
        if (m.fourthDown) m.state.down = 4;
        m.selectPlay(PLAYBOOK[guard % PLAYBOOK.length].id);
      }
      if (m.flow.kind === "preSnap") m.runPlay((s) => botInput(s, rng));
      if (m.flow.kind === "result") {
        const changed = m.state.possession === "away" || m.lastOutcome?.kind === "touchdown";
        if (changed) break;
        m.continue();
      }
      if (m.flow.kind === "quarter") m.continue();
    }
    const o = m.lastOutcome!;
    expect(o.kind === "touchdown" || m.state.possession === "away").toBe(true);
  });
});

describe("CPU drive model", () => {
  it("produces every kind of result and uses game clock", () => {
    const rng = new Rng(4);
    const ends = new Set<string>();
    let points = 0;
    for (let i = 0; i < 300; i++) {
      const s = newSeries(newGame(5), "away", 25);
      const d = simulateCpuDrive(s, TEAMS[1], TEAMS[0], rng);
      ends.add(d.end);
      points += d.points;
      expect(d.timeUsed).toBeGreaterThan(0);
      expect(d.state.clock).toBeLessThanOrEqual(s.clock);
    }
    expect(ends).toEqual(expect.objectContaining(new Set(["touchdown", "fieldGoal", "punt"])));
    const ppd = points / 300;
    expect(ppd).toBeGreaterThan(0.8);
    expect(ppd).toBeLessThan(4);
  });
});
