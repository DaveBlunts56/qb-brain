import type { Ratings } from "../data/types";
import type { Vec2, Vec3 } from "../math/vec";
import { bulletSpeed, GRAVITY, maxLaunchSpeed } from "./physique";
import type { PassType } from "./types";

/** Horizontal speed of each pass type as a fraction of the passer's bullet speed. */
export const PASS_SPEED_FACTOR: Record<PassType, number> = { bullet: 1.0, touch: 0.74, lob: 0.55 };

/** Wind-up before the ball leaves the hand (seconds). Lofted throws take a touch longer. */
export const WINDUP: Record<PassType, number> = { bullet: 0.1, touch: 0.14, lob: 0.18 };

export interface LaunchSolution {
  vel: Vec3;
  /** Time to reach the target point at the target height (or to land, if underpowered). */
  flightTime: number;
  /** True when the passer's arm can't get the ball there; it will fall short. */
  underpowered: boolean;
}

/** Desired horizontal speed for a throw of this type and distance. Short throws are taken off a bit. */
export function desiredHorizontalSpeed(r: Ratings, type: PassType, distance: number): number {
  const base = bulletSpeed(r) * PASS_SPEED_FACTOR[type];
  // QBs don't throw a 5-yard pass at full velocity.
  const cap = type === "bullet" ? 13 + distance * 0.75 : type === "touch" ? 10 + distance * 0.55 : 8 + distance * 0.4;
  return Math.max(7, Math.min(base, cap));
}

/**
 * Solves the launch velocity to put the ball at `to` (with its z as the arrival height).
 * If the throw needs more than the passer's max launch speed, uses the flattest max-effort arc
 * that reaches, or a 45° max-distance heave that falls short.
 */
export function solveLaunch(from: Vec3, to: Vec3, r: Ratings, type: PassType): LaunchSolution {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const d = Math.max(0.01, Math.hypot(dx, dy));
  const dz = to.z - from.z;
  const ux = dx / d;
  const uy = dy / d;
  const g = GRAVITY;
  const vMax = maxLaunchSpeed(r);

  let vh = desiredHorizontalSpeed(r, type, d);
  let T = d / vh;
  let vz = (dz + (g * T * T) / 2) / T;
  if (Math.hypot(vh, vz) <= vMax) {
    return { vel: { x: ux * vh, y: uy * vh, z: vz }, flightTime: T, underpowered: false };
  }

  // Max-effort throw: find the angle that hits the target at speed vMax.
  const v2 = vMax * vMax;
  const disc = v2 * v2 - g * (g * d * d + 2 * dz * v2);
  if (disc >= 0) {
    const theta = Math.atan((v2 - Math.sqrt(disc)) / (g * d));
    vh = vMax * Math.cos(theta);
    vz = vMax * Math.sin(theta);
    T = d / vh;
    return { vel: { x: ux * vh, y: uy * vh, z: vz }, flightTime: T, underpowered: false };
  }
  // Out of range: 45° heave, lands short.
  vh = vMax * Math.SQRT1_2;
  vz = vMax * Math.SQRT1_2;
  const tLand = (vz + Math.sqrt(vz * vz + 2 * g * from.z)) / g;
  return { vel: { x: ux * vh, y: uy * vh, z: vz }, flightTime: tLand, underpowered: true };
}

/** Ball position after t seconds of free flight (no drag). */
export function ballAt(pos: Vec3, vel: Vec3, t: number): Vec3 {
  return { x: pos.x + vel.x * t, y: pos.y + vel.y * t, z: pos.z + vel.z * t - (GRAVITY * t * t) / 2 };
}

/** Time until the ball descends through height h, or null if it never gets that high. */
export function timeToHeightDescending(pos: Vec3, vel: Vec3, h: number): number | null {
  const disc = vel.z * vel.z + 2 * GRAVITY * (pos.z - h);
  if (disc < 0) return null;
  const t = (vel.z + Math.sqrt(disc)) / GRAVITY;
  return t >= 0 ? t : null;
}

/** Peak height of a trajectory. */
export function apexHeight(pos: Vec3, vel: Vec3): number {
  return vel.z > 0 ? pos.z + (vel.z * vel.z) / (2 * GRAVITY) : pos.z;
}

export function horizontal(v: Vec3): Vec2 {
  return { x: v.x, y: v.y };
}
