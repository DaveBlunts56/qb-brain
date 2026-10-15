import { describe, expect, it } from "vitest";
import { apexHeight, ballAt, solveLaunch, timeToHeightDescending } from "../src/core/sim/ballistics";
import { leadTarget, throwSigma } from "../src/core/sim/passing";
import { CATCH_HEIGHT, RELEASE_HEIGHT, topSpeed } from "../src/core/sim/physique";
import { TEAMS } from "../src/core/data/teams";
import { getPlay } from "../src/core/data/playbook";
import { PlaySim, SIM_DT, NO_INPUT } from "../src/core/sim/playSim";
import { dist2 } from "../src/core/math/vec";
import type { Ratings } from "../src/core/data/types";

const qb = TEAMS[0].offense.QB.ratings;
const from = { x: 30, y: 26, z: RELEASE_HEIGHT };

describe("ball flight", () => {
  it("lands on target at catch height for every pass type", () => {
    for (const type of ["bullet", "touch", "lob"] as const) {
      const to = { x: 52, y: 18, z: CATCH_HEIGHT };
      const sol = solveLaunch(from, to, qb, type);
      expect(sol.underpowered).toBe(false);
      const p = ballAt(from, sol.vel, sol.flightTime);
      expect(p.x).toBeCloseTo(to.x, 3);
      expect(p.y).toBeCloseTo(to.y, 3);
      expect(p.z).toBeCloseTo(to.z, 3);
    }
  });

  it("bullets are flat and fast, lobs are high and slow", () => {
    const to = { x: 55, y: 26, z: CATCH_HEIGHT };
    const b = solveLaunch(from, to, qb, "bullet");
    const t = solveLaunch(from, to, qb, "touch");
    const l = solveLaunch(from, to, qb, "lob");
    expect(b.flightTime).toBeLessThan(t.flightTime);
    expect(t.flightTime).toBeLessThan(l.flightTime);
    expect(apexHeight(from, b.vel)).toBeLessThan(apexHeight(from, t.vel));
    expect(apexHeight(from, t.vel)).toBeLessThan(apexHeight(from, l.vel));
    // A lob clears a defender's reach (~2.65 yd) in the middle of its flight.
    expect(apexHeight(from, l.vel)).toBeGreaterThan(4);
  });

  it("arm strength limits range: a weak arm can't reach 75 yards", () => {
    const weak: Ratings = { ...qb, throwPower: 40 };
    const sol = solveLaunch(from, { x: from.x + 75, y: 26, z: CATCH_HEIGHT }, weak, "lob");
    expect(sol.underpowered).toBe(true);
    const land = ballAt(from, sol.vel, sol.flightTime);
    expect(land.z).toBeCloseTo(0, 3);
    expect(land.x - from.x).toBeLessThan(70);
  });

  it("finds the descending time through a height", () => {
    const sol = solveLaunch(from, { x: 50, y: 26, z: CATCH_HEIGHT }, qb, "touch");
    const t = timeToHeightDescending(from, sol.vel, CATCH_HEIGHT)!;
    expect(t).toBeCloseTo(sol.flightTime, 3);
    expect(timeToHeightDescending(from, sol.vel, 100)).toBeNull();
  });
});

describe("passing", () => {
  it("leads a receiver on a go route so ball and receiver meet", () => {
    const sim = new PlaySim(TEAMS[0], TEAMS[1], getPlay("four-verts"), false, { losX: 40, ballY: 26.67, firstDownX: 50, coverage: "cover2", isTry: false, seed: 1, reactionBias: 0 });
    sim.snap();
    for (let i = 0; i < 70; i++) sim.step(SIM_DT, NO_INPUT);
    const x = sim.get("O-X")!;
    const lead = leadTarget(sim.qb.pos, sim.qb.r, x, "touch");
    // Run the receiver forward the same amount of time and compare.
    for (let i = 0; i < Math.round(lead.flightTime / SIM_DT); i++) sim.step(SIM_DT, NO_INPUT);
    if (sim.phase === "live") expect(dist2(x.pos, lead.point)).toBeLessThan(2.5);
    expect(lead.point.x).toBeGreaterThan(x.pos.x - 10);
  });

  it("accuracy suffers on the run, across the body, and under pressure", () => {
    const fromP = { x: 30, y: 26 };
    const to = { x: 50, y: 26 };
    const still = throwSigma(fromP, to, { passer: qb, qbVel: { x: 0, y: 0 }, qbMaxSpeed: 8, pressure: 0, type: "bullet" });
    const running = throwSigma(fromP, to, { passer: qb, qbVel: { x: 0, y: 7 }, qbMaxSpeed: 8, pressure: 0, type: "bullet" });
    const backwards = throwSigma(fromP, to, { passer: qb, qbVel: { x: -7, y: 0 }, qbMaxSpeed: 8, pressure: 0, type: "bullet" });
    const pressured = throwSigma(fromP, to, { passer: qb, qbVel: { x: 0, y: 0 }, qbMaxSpeed: 8, pressure: 1, type: "bullet" });
    expect(running).toBeGreaterThan(still);
    expect(backwards).toBeGreaterThan(running);
    expect(pressured).toBeGreaterThan(still * 1.5);
  });

  it("better accuracy ratings throw tighter spirals", () => {
    const fromP = { x: 30, y: 26 };
    const to = { x: 55, y: 20 };
    const ctx = { qbVel: { x: 0, y: 0 }, qbMaxSpeed: 8, pressure: 0, type: "touch" as const };
    expect(throwSigma(fromP, to, { ...ctx, passer: { ...qb, throwAccuracy: 95 } })).toBeLessThan(throwSigma(fromP, to, { ...ctx, passer: { ...qb, throwAccuracy: 55 } }));
  });
});

describe("ratings", () => {
  it("speed ratings map to realistic top speeds", () => {
    const fast = topSpeed({ ...qb, speed: 99 });
    const slow = topSpeed({ ...qb, speed: 45 });
    expect(fast).toBeGreaterThan(10);
    expect(fast).toBeLessThan(11);
    expect(slow).toBeLessThan(8);
  });
});
