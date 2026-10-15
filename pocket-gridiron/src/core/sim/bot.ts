import type { Rng } from "../math/rng";
import { dist2, type Vec2 } from "../math/vec";
import { ballAt, solveLaunch, WINDUP } from "./ballistics";
import { leadTarget } from "./passing";
import { CATCH_HEIGHT, REACH_HEIGHT, RELEASE_HEIGHT, throwReaction } from "./physique";
import type { PlaySim } from "./playSim";
import type { Command, ControlInput, PassType, SimPlayer } from "./types";

/**
 * An autopilot quarterback that reads throwing windows. Used by tests (to play thousands of
 * snaps), by the title-screen demo, and as the seed of the CPU offense in a later phase.
 */
export interface BotOptions {
  /** Earliest time to consider throwing. */
  minTime: number;
  /** Throw by this time no matter what. */
  maxTime: number;
  /** Window (seconds of defender lag) that counts as open. */
  openMargin: number;
  /** Random noise in the read (0 = perfect). */
  noise: number;
}

export const DEFAULT_BOT: BotOptions = { minTime: 0.8, maxTime: 2.9, openMargin: 0.15, noise: 0.1 };

export function separation(sim: PlaySim, id: string): number {
  const r = sim.get(id);
  if (!r) return 0;
  let best = Infinity;
  for (const d of sim.defense) if (!d.down) best = Math.min(best, dist2(d.pos, r.pos));
  return best;
}

export interface ThrowRead {
  targetId: string;
  passType: PassType;
  /** Seconds the closest defender would be late to the catchable part of the ball's path. */
  margin: number;
  depth: number;
}

/**
 * How open is this throw? Samples the ball's path where it is low enough to be played and asks
 * how long each defender needs to get there (including his reaction to the throw).
 */
export function readThrow(sim: PlaySim, r: SimPlayer, passType: PassType): ThrowRead {
  const qb = sim.qb;
  const from = { x: qb.pos.x, y: qb.pos.y };
  const lead = leadTarget(from, qb.r, r, passType, WINDUP[passType]);
  const from3 = { x: from.x, y: from.y, z: RELEASE_HEIGHT };
  const sol = solveLaunch(from3, { x: lead.point.x, y: lead.point.y, z: CATCH_HEIGHT }, qb.r, passType);
  let margin = Infinity;
  const steps = 14;
  for (let i = 1; i <= steps; i++) {
    const t = (sol.flightTime * i) / steps;
    const b = ballAt(from3, sol.vel, t);
    if (b.z > REACH_HEIGHT || dist2(b, from) < 4) continue;
    const tb = t + WINDUP[passType];
    for (const d of sim.defense) {
      if (d.down) continue;
      margin = Math.min(margin, timeToSpot(d, b) - tb);
    }
  }
  if (sol.underpowered) margin = -1;
  // Out of bounds catch points are worthless.
  if (lead.point.y < 0.8 || lead.point.y > 52.5) margin = -1;
  return { targetId: r.id, passType, margin, depth: lead.point.x - sim.cfg.losX };
}

/** Rough time for a defender to get a hand on a spot: react, kill his current momentum, run. */
function timeToSpot(d: SimPlayer, spot: Vec2): number {
  const react = throwReaction(d.r);
  const p = { x: d.pos.x + d.vel.x * react, y: d.pos.y + d.vel.y * react };
  const dx = spot.x - p.x;
  const dy = spot.y - p.y;
  const dist = Math.hypot(dx, dy);
  const reach = Math.max(0, dist - 0.9);
  if (reach === 0) return react;
  const away = -(d.vel.x * dx + d.vel.y * dy) / dist;
  const turn = Math.max(0, away) / d.accel;
  const ramp = Math.min(d.maxSpeed / (2 * d.accel), reach / d.maxSpeed);
  return react + turn + ramp + reach / d.maxSpeed;
}

export function bestRead(sim: PlaySim, rng: Rng, noise = 0): ThrowRead | null {
  let best: ThrowRead | null = null;
  let bestScore = -Infinity;
  for (const r of sim.receivers) {
    if (r.mode === "passBlock" || r.down) continue;
    const d = dist2(r.pos, sim.qb.pos);
    const types: PassType[] = d < 12 ? ["bullet", "touch"] : d < 25 ? ["bullet", "touch", "lob"] : ["touch", "lob"];
    for (const t of types) {
      const read = readThrow(sim, r, t);
      const score = Math.min(read.margin, 1.2) + read.depth * 0.012 + rng.range(-noise, noise);
      if (score > bestScore) { bestScore = score; best = { ...read, margin: read.margin + rng.range(-noise, noise) }; }
    }
  }
  return best;
}

export function botInput(sim: PlaySim, rng: Rng, opts: BotOptions = DEFAULT_BOT): ControlInput {
  const commands: Command[] = [];
  const move: Vec2 = { x: 0, y: 0 };
  // Read every 0.1 s (reads are expensive).
  if (sim.canThrow && sim.time >= opts.minTime && Math.round(sim.time * 60) % 6 === 0) {
    const read = bestRead(sim, rng, opts.noise);
    const late = sim.time >= opts.maxTime || sim.pressureOnQb() > 0.55;
    if (read && (read.margin >= opts.openMargin || late)) {
      commands.push({ kind: "throw", targetId: read.targetId, passType: read.passType, aim: { x: 0, y: 0 } });
    }
  }
  return { move, commands };
}
