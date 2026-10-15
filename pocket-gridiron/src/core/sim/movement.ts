import { angleBetween, clamp01, len2, lerp, norm2, scale2, sub2, type Vec2 } from "../math/vec";
import type { SimPlayer } from "./types";

/** Effective top speed right now (slowed, stunned, carrying). */
export function currentTopSpeed(p: SimPlayer): number {
  let s = p.maxSpeed;
  if (p.slowTimer > 0) s *= 0.55;
  if (p.mode === "carrier") s *= 0.95; // carrying the ball costs a step
  if (p.down || p.stun > 0) s = 0;
  return s;
}

/**
 * Desired velocity to reach `target`, slowing inside `arrive` yards so players settle instead of
 * orbiting their spot.
 */
export function seek(p: SimPlayer, target: Vec2, speedFrac = 1, arrive = 1.2): Vec2 {
  const to = sub2(target, p.pos);
  const d = len2(to);
  if (d < 0.05) return { x: 0, y: 0 };
  const top = currentTopSpeed(p) * speedFrac;
  const speed = d < arrive ? top * (d / arrive) : top;
  return scale2(to, speed / d);
}

/**
 * Accelerates the player's velocity toward `desired`, limited by acceleration.
 * Sharp cuts use agility (and route running for receivers on routes): this is what makes breaks
 * create separation and keeps big players from turning on a dime.
 */
export function steer(p: SimPlayer, desired: Vec2, dt: number, cutBonus = 0): void {
  // Never let a bad input poison the simulation.
  if (!Number.isFinite(desired.x) || !Number.isFinite(desired.y)) desired = { x: 0, y: 0 };
  if (!Number.isFinite(p.vel.x) || !Number.isFinite(p.vel.y)) p.vel = { x: 0, y: 0 };
  const top = currentTopSpeed(p);
  const want = len2(desired) > top ? scale2(norm2(desired), top) : desired;
  const speed = len2(p.vel);
  let a = p.accel;
  if (speed > 1.5 && angleBetween(p.vel, want) > 0.7) {
    a *= lerp(0.7, 1.2, clamp01(p.r.agility / 99)) + cutBonus;
  }
  // Braking is easier than accelerating.
  if (len2(want) < speed) a *= 1.6;
  const dv = sub2(want, p.vel);
  const dl = len2(dv);
  const maxDv = a * dt;
  if (dl <= maxDv) {
    p.vel = { x: want.x, y: want.y };
  } else {
    p.vel = { x: p.vel.x + (dv.x / dl) * maxDv, y: p.vel.y + (dv.y / dl) * maxDv };
  }
}

/** Turn the player's facing toward a direction (smoothly). */
export function faceToward(p: SimPlayer, dir: Vec2, rate = 0.25): void {
  const d = norm2(dir);
  if (d.x === 0 && d.y === 0) return;
  const f = { x: p.facing.x + (d.x - p.facing.x) * rate, y: p.facing.y + (d.y - p.facing.y) * rate };
  const n = norm2(f);
  if (n.x !== 0 || n.y !== 0) p.facing = n;
}
