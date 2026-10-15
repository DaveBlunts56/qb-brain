import type { KickerProfile } from "../data/types";
import type { Rng } from "../math/rng";
import { clamp, clamp01, lerp } from "../math/vec";

/**
 * Phase 1 special teams are resolved by rating-driven models (playable kicking is a later phase).
 * Each returns the probability or distribution it used so the UI can show it.
 */

/** Field goal distance: line of scrimmage to the goal posts (end zone + 7-yard snap). */
export function fieldGoalDistance(yardLine: number): number {
  return Math.round(100 - yardLine + 17);
}

export function fieldGoalChance(distance: number, k: KickerProfile): number {
  const power = clamp01(k.power / 99);
  const acc = clamp01(k.accuracy / 99);
  const maxRange = lerp(48, 64, power);
  if (distance > maxRange + 3) return 0;
  // Near-automatic inside 30; falls off toward the kicker's range.
  const base = distance <= 30 ? 0.97 : 0.97 - Math.pow((distance - 30) / (maxRange - 30 + 6), 2) * 0.75;
  return clamp(base * lerp(0.9, 1.04, acc), 0, 0.99);
}

export function extraPointChance(k: KickerProfile): number {
  // PAT from the 15 = a 33-yard kick.
  return fieldGoalChance(33, k);
}

export interface PuntResult {
  /** Receiving team's yard line after the punt and return. */
  receiverYardLine: number;
  gross: number;
  touchback: boolean;
  text: string;
}

export function punt(yardLine: number, k: KickerProfile, rng: Rng): PuntResult {
  const gross = Math.round(clamp(lerp(38, 49, clamp01(k.power / 99)) + rng.gauss() * 6, 22, 70));
  const landing = yardLine + gross;
  if (landing >= 100) {
    return { receiverYardLine: 20, gross, touchback: true, text: `Punt ${gross} yds, touchback` };
  }
  // Short fields get fair-caught; otherwise a return of 0–15 (rarely more).
  const ret = landing >= 88 ? 0 : Math.round(clamp(rng.gauss() * 5 + 7, 0, 30));
  const spot = Math.min(99, landing - ret);
  const recv = clamp(100 - spot, 1, 99);
  return { receiverYardLine: recv, gross, touchback: false, text: ret > 0 ? `Punt ${gross} yds, returned ${ret}` : `Punt ${gross} yds, fair catch` };
}

export interface KickoffResult {
  yardLine: number;
  text: string;
}

/** Kickoff received by the user: touchback to the 30 or a return. */
export function kickoffReturn(rng: Rng): KickoffResult {
  if (rng.chance(0.45)) return { yardLine: 30, text: "Touchback" };
  const yl = Math.round(clamp(27 + rng.gauss() * 7, 12, 60));
  return { yardLine: yl, text: `Returned to the ${yl}` };
}
