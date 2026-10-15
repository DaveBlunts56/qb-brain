import type { Position, Ratings } from "../data/types";
import { clamp01, lerp } from "../math/vec";

/**
 * Converts ratings into physical quantities. Units: yards, seconds.
 * A 99-speed player tops out around 10.5 yd/s (about 21.5 mph); a 45-speed lineman near 7.5.
 */
export function topSpeed(r: Ratings): number {
  return 5.9 + Math.pow(clamp01(r.speed / 99), 1.3) * 4.6;
}

export function acceleration(r: Ratings): number {
  return lerp(6.0, 12.5, clamp01(r.acceleration / 99));
}

export function massFor(position: Position): number {
  switch (position) {
    case "OL": case "DL": return 2.0;
    case "TE": case "LB": return 1.4;
    case "QB": case "RB": case "S": return 1.15;
    default: return 1.0;
  }
}

/** Bullet-pass horizontal speed in yd/s. NFL fastballs are ~27–29 yd/s. */
export function bulletSpeed(r: Ratings): number {
  return lerp(18.5, 26.5, clamp01(r.throwPower / 99));
}

/** Maximum launch speed (3D). Limits how far a QB can throw (range ≈ v²/g). */
export function maxLaunchSpeed(r: Ratings): number {
  return lerp(22.5, 30.5, clamp01(r.throwPower / 99));
}

/** Base pass error (yards of spread at a 20-yard throw) from accuracy. */
export function baseThrowError(r: Ratings): number {
  return lerp(1.7, 0.42, clamp01(r.throwAccuracy / 99));
}

/** Seconds before a defender reacts to a thrown ball. */
export function throwReaction(r: Ratings): number {
  return lerp(0.42, 0.14, clamp01(r.awareness / 99));
}

export const PLAYER_RADIUS = 0.45;
export const GRAVITY = 10.72; // yd/s² (32.17 ft/s²)
export const RELEASE_HEIGHT = 2.0; // yd (6 ft)
export const CATCH_HEIGHT = 1.3; // yd (chest)
export const REACH_HEIGHT = 2.65; // yd, max height a player can catch/deflect (jumping)
export const REACH_RADIUS = 0.95; // yd, horizontal catch radius
export const DIVE_RADIUS = 1.7; // yd, extended reach with a dive
export const TACKLE_RANGE = 1.0; // yd
