import { describe, expect, it } from "vitest";
import { COVERAGE_IDS, type CoverageId } from "../src/core/data/defense";
import { PLAYBOOK, getPlay } from "../src/core/data/playbook";
import { TEAMS } from "../src/core/data/teams";
import { Rng } from "../src/core/math/rng";
import { dist2 } from "../src/core/math/vec";
import { botInput, DEFAULT_BOT } from "../src/core/sim/bot";
import { NO_INPUT, PlaySim, SIM_DT } from "../src/core/sim/playSim";
import type { ControlInput, PlayOutcome } from "../src/core/sim/types";

function makeSim(playId = "smash", coverage: CoverageId = "cover3", seed = 1, flipped = false) {
  return new PlaySim(TEAMS[0], TEAMS[1], getPlay(playId), flipped, {
    losX: 40, ballY: 26.67, firstDownX: 50, coverage, isTry: false, seed, reactionBias: 0,
  });
}

function run(sim: PlaySim, input: (s: PlaySim) => ControlInput = () => NO_INPUT, maxSeconds = 30): PlayOutcome {
  if (sim.phase === "preSnap") sim.snap();
  for (let i = 0; i < maxSeconds / SIM_DT && sim.phase !== "result"; i++) sim.step(SIM_DT, input(sim));
  expect(sim.phase).toBe("result");
  return sim.outcome!;
}

/** Takes defenders out of the play (for controlled tests). */
function removeDefense(sim: PlaySim) {
  for (const d of sim.defense) {
    d.pos = { x: 115, y: 2 + d.pos.y * 0.01 };
    d.down = true;
  }
}

describe("play state machine", () => {
  it("lines up 7 on 7 and waits for the snap", () => {
    const sim = makeSim();
    expect(sim.offense).toHaveLength(7);
    expect(sim.defense).toHaveLength(7);
    expect(sim.phase).toBe("preSnap");
    const before = sim.players.map((p) => ({ ...p.pos }));
    for (let i = 0; i < 60; i++) sim.step(SIM_DT, NO_INPUT);
    sim.players.forEach((p, i) => expect(p.pos).toEqual(before[i]));
    // Offense is behind the ball, defense beyond it.
    for (const p of sim.offense) expect(p.pos.x).toBeLessThanOrEqual(40);
    for (const p of sim.defense) expect(p.pos.x).toBeGreaterThan(40);
    sim.snap();
    expect(sim.phase).toBe("live");
  });

  it("holding the ball forever ends in a sack", () => {
    const o = run(makeSim("four-verts", "cover1", 3));
    expect(o.kind).toBe("sack");
    expect(o.yards).toBeLessThan(0);
    expect(o.clockStops).toBe(false);
    expect(o.passAttempt).toBe(false);
  });

  it("goes pass in air → live → dead ball → result on a completion", () => {
    const sim = makeSim("slant-flat", "cover2", 4);
    removeDefense(sim);
    sim.snap();
    const phases = new Set<string>();
    let thrown = false;
    for (let i = 0; i < 1800 && sim.phase !== "result"; i++) {
      const cmds = !thrown && sim.time > 0.8 ? [{ kind: "throw" as const, targetId: "O-X", passType: "bullet" as const, aim: { x: 0, y: 0 } }] : [];
      if (cmds.length) thrown = true;
      sim.step(SIM_DT, { move: { x: 0, y: 0 }, commands: cmds });
      phases.add(sim.phase);
    }
    expect([...phases]).toEqual(expect.arrayContaining(["live", "passInAir", "deadBall", "result"]));
    const o = sim.outcome!;
    expect(o.completion).toBe(true);
    expect(o.receiverId).toBe("O-X");
    // Nobody to tackle him: he scores.
    expect(o.kind).toBe("touchdown");
  });

  it("is deterministic for a seed and input sequence", () => {
    const rngA = new Rng(42);
    const rngB = new Rng(42);
    const a = run(makeSim("mesh", "cover1", 99), (s) => botInput(s, rngA));
    const b = run(makeSim("mesh", "cover1", 99), (s) => botInput(s, rngB));
    expect(a).toEqual(b);
  });

  it("every play in the book runs against every coverage, both directions", () => {
    let i = 0;
    for (const play of PLAYBOOK) {
      for (const cov of COVERAGE_IDS) {
        for (const flipped of [false, true]) {
          const rng = new Rng(i);
          const o = run(makeSim(play.id, cov, 1000 + i++, flipped), (s) => botInput(s, rng));
          expect(Number.isFinite(o.spotX)).toBe(true);
          expect(Number.isFinite(o.yards)).toBe(true);
        }
      }
    }
  });
});

describe("routes", () => {
  it("receivers run distinct routes", () => {
    for (const play of PLAYBOOK) {
      const sim = makeSim(play.id, "cover2", 5);
      const routeNames = sim.receivers.map((r) => r.route!.def.name);
      expect(sim.receivers).toHaveLength(4);
      expect(new Set(routeNames).size).toBeGreaterThanOrEqual(2);
    }
  });

  it("receivers follow their route waypoints", () => {
    const sim = makeSim("smash", "cover2", 6);
    removeDefense(sim);
    sim.snap();
    for (let i = 0; i < 150; i++) sim.step(SIM_DT, NO_INPUT);
    // Hitch: settles near 5 yards; corner: deep and outside.
    const hitch = sim.get("O-X")!;
    const corner = sim.get("O-H")!;
    expect(hitch.pos.x - 40).toBeGreaterThan(3);
    expect(hitch.pos.x - 40).toBeLessThan(8);
    expect(corner.pos.x - 40).toBeGreaterThan(10);
    expect(corner.pos.y).toBeLessThan(sim.get("O-H")!.route!.points[0].y); // broke outside (top)
  });

  it("receivers stay in bounds on sideline-bound routes", () => {
    const sim = makeSim("slant-flat", "cover0", 7);
    removeDefense(sim);
    sim.snap();
    for (let i = 0; i < 300; i++) {
      sim.step(SIM_DT, NO_INPUT);
      for (const r of sim.receivers) {
        expect(r.pos.y).toBeGreaterThan(0);
        expect(r.pos.y).toBeLessThan(53.34);
      }
    }
  });
});

describe("defense", () => {
  it("man defenders keep receivers in front on vertical routes", () => {
    const sim = makeSim("four-verts", "cover1", 8);
    sim.snap();
    let behind = -Infinity;
    let lateral = 0;
    for (let i = 0; i < 95; i++) {
      sim.step(SIM_DT, NO_INPUT);
      for (const d of sim.defense) {
        if (d.mode !== "man" || !d.manTargetId) continue;
        const r = sim.get(d.manTargetId)!;
        behind = Math.max(behind, r.pos.x - d.pos.x);
        lateral = Math.max(lateral, Math.abs(r.pos.y - d.pos.y));
      }
    }
    // Nobody gets more than a step past his man in the first 1.6 seconds, and nobody is left alone.
    expect(behind).toBeLessThan(1.5);
    expect(lateral).toBeLessThan(3);
    expect(dist2(sim.get("D-CB1")!.pos, sim.get("O-X")!.pos)).toBeLessThan(2.5);
  });

  it("zone defenders drop to their landmarks", () => {
    const sim = makeSim("curl-flat", "cover3", 9);
    sim.snap();
    for (let i = 0; i < 90; i++) sim.step(SIM_DT, NO_INPUT);
    const fs = sim.get("D-FS")!;
    expect(fs.pos.x - 40).toBeGreaterThan(12); // deep middle third
    const cb1 = sim.get("D-CB1")!;
    expect(cb1.pos.x - 40).toBeGreaterThan(10); // bailing to the deep third
  });

  it("shows a different shell for each coverage family", () => {
    const deepSafeties = (cov: CoverageId) => makeSim("smash", cov, 10).defense.filter((d) => (d.slot === "FS" || d.slot === "SS") && d.pos.x - 40 >= 10).length;
    expect(deepSafeties("cover2")).toBe(2);
    expect(deepSafeties("cover4")).toBe(2);
    expect(deepSafeties("cover3")).toBe(1);
    expect(deepSafeties("cover1")).toBe(1);
    expect(deepSafeties("cover0")).toBe(0);
  });

  it("Cover 0 brings an extra rusher", () => {
    const sim = makeSim("smash", "cover0", 11);
    expect(sim.defense.filter((d) => d.mode === "rush")).toHaveLength(3);
  });
});

describe("ball carrier and scramble", () => {
  it("QB can scramble past the line, then can no longer throw", () => {
    const sim = makeSim("four-verts", "cover3", 12);
    sim.snap();
    // Escape outside the pocket, then turn upfield.
    const fwd: ControlInput = { move: { x: 1, y: 0.2 }, commands: [] };
    let crossed = false;
    for (let i = 0; i < 1800 && sim.phase !== "result"; i++) {
      sim.step(SIM_DT, i < 50 ? { move: { x: -0.2, y: 1 }, commands: [] } : fwd);
      if (sim.qbCrossedLos && !crossed) {
        crossed = true;
        expect(sim.canThrow).toBe(false);
        sim.step(SIM_DT, { move: fwd.move, commands: [{ kind: "throw", targetId: "O-X", passType: "bullet", aim: { x: 0, y: 0 } }] });
        expect(sim.passThrown).toBe(false);
      }
    }
    expect(crossed).toBe(true);
    expect(sim.outcome!.qbScramble).toBe(true);
    expect(sim.outcome!.passAttempt).toBe(false);
  });

  it("running out of bounds stops the clock at the spot", () => {
    const sim = makeSim("four-verts", "cover3", 13);
    removeDefense(sim);
    sim.snap();
    const o = run(sim, () => ({ move: { x: 0.3, y: -1 }, commands: [] }));
    expect(o.kind).toBe("outOfBounds");
    expect(o.clockStops).toBe(true);
  });

  it("juke cuts the carrier's direction and has a cooldown", () => {
    const sim = makeSim("slant-flat", "cover2", 14);
    removeDefense(sim);
    sim.snap();
    for (let i = 0; i < 40; i++) sim.step(SIM_DT, { move: { x: 1, y: 0 }, commands: [] });
    // QB can't juke in the pocket.
    sim.step(SIM_DT, { move: { x: 1, y: 0 }, commands: [{ kind: "juke" }] });
    expect(sim.qb.jukeTimer).toBe(0);
    // Past the line he can.
    for (let i = 0; i < 120 && !sim.qbCrossedLos; i++) sim.step(SIM_DT, { move: { x: 1, y: 0 }, commands: [] });
    expect(sim.qbCrossedLos).toBe(true);
    const before = { ...sim.qb.vel };
    sim.step(SIM_DT, { move: { x: 1, y: 1 }, commands: [{ kind: "juke" }] });
    expect(sim.qb.jukeTimer).toBeGreaterThan(0);
    expect(sim.qb.jukeCooldown).toBeGreaterThan(0.9);
    expect(Math.sign(sim.qb.vel.y)).not.toBe(Math.sign(before.y) || 0);
  });
});

describe("turnovers", () => {
  it("after an interception the user controls the nearest teammate and the returner runs the other way", () => {
    const sim = makeSim("four-verts", "cover3", 21);
    sim.snap();
    for (let i = 0; i < 40; i++) sim.step(SIM_DT, NO_INPUT);
    const fs = sim.get("D-FS")!;
    sim.intercepted(fs);
    expect(sim.ball.possession).toBe("defense");
    expect(sim.carrier?.id).toBe("D-FS");
    const ctl = sim.controlled!;
    expect(ctl.side).toBe("offense");
    const nearest = Math.min(...sim.offense.map((o) => dist2(o.pos, fs.pos)));
    expect(dist2(ctl.pos, fs.pos)).toBeCloseTo(nearest, 5);
    // Joystick steers the chaser; the returner turns and heads for the other end zone.
    const before = { ...ctl.pos };
    for (let i = 0; i < 60 && sim.phase === "live"; i++) sim.step(SIM_DT, { move: { x: 0, y: 1 }, commands: [] });
    if (sim.phase === "live") {
      expect(ctl.pos.y).toBeGreaterThan(before.y + 1);
      expect(fs.vel.x).toBeLessThan(0);
    }
    const o = run(sim);
    expect(["interception", "pickSix"]).toContain(o.kind);
    expect(o.clockStops).toBe(true);
  });

  it("an interception on a two-point try ends the play immediately", () => {
    const sim = new PlaySim(TEAMS[0], TEAMS[1], getPlay("smash"), false, { losX: 108, ballY: 26.67, firstDownX: 110, coverage: "cover1", isTry: true, seed: 3, reactionBias: 0 });
    sim.snap();
    sim.step(SIM_DT, NO_INPUT);
    sim.intercepted(sim.get("D-SS")!);
    expect(sim.phase).toBe("deadBall");
    expect(sim.outcome!.kind).toBe("interception");
  });
});

describe("statistical sanity (no scripted outcomes)", () => {
  it("a window-reading QB completes most passes but not all, with real turnovers and sacks", () => {
    const rng = new Rng(77);
    const tally: Record<string, number> = {};
    let att = 0, comp = 0, yards = 0;
    const N = 360;
    for (let i = 0; i < N; i++) {
      const play = PLAYBOOK[i % PLAYBOOK.length];
      const cov = COVERAGE_IDS[i % COVERAGE_IDS.length];
      const o = run(makeSim(play.id, cov, 5000 + i, i % 3 === 0), (s) => botInput(s, rng));
      tally[o.kind] = (tally[o.kind] ?? 0) + 1;
      if (o.passAttempt) att++;
      if (o.completion) comp++;
      yards += o.yards;
    }
    const pct = comp / att;
    expect(pct).toBeGreaterThan(0.5);
    expect(pct).toBeLessThan(0.92);
    expect(tally.incomplete ?? 0).toBeGreaterThan(N * 0.05);
    const ints = (tally.interception ?? 0) + (tally.pickSix ?? 0) + (tally.interceptionTouchback ?? 0);
    expect(ints).toBeGreaterThan(0);
    expect(ints / att).toBeLessThan(0.1);
    expect(yards / N).toBeGreaterThan(3);
    expect(yards / N).toBeLessThan(25);
  });

  it("holding the ball invites pressure: a slow QB takes many more sacks", () => {
    const quick = new Rng(1);
    const slow = new Rng(1);
    let quickSacks = 0, slowSacks = 0;
    for (let i = 0; i < 120; i++) {
      const play = PLAYBOOK[i % PLAYBOOK.length];
      if (run(makeSim(play.id, "cover4", 7000 + i), (s) => botInput(s, quick)).kind === "sack") quickSacks++;
      if (run(makeSim(play.id, "cover4", 7000 + i), (s) => botInput(s, slow, { ...DEFAULT_BOT, minTime: 3.5, maxTime: 6, openMargin: 0.6 })).kind === "sack") slowSacks++;
    }
    expect(slowSacks).toBeGreaterThan(quickSacks + 10);
  });
});
