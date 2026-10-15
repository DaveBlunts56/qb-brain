import { clamp, clamp01, dist2, len2 } from "../math/vec";
import { DIVE_RADIUS, REACH_HEIGHT, REACH_RADIUS } from "./physique";
import type { PlaySim } from "./playSim";
import type { SimPlayer } from "./types";

/**
 * Ball-in-air interaction. A player makes his play at the ball's closest approach to him while the
 * ball is at a catchable height. The first player the ball reaches gets the first chance; a tip
 * or drop pops the ball up and anyone (including a defender) can still catch it.
 */
export function resolveBallContacts(sim: PlaySim): void {
  const b = sim.ball;
  if (b.state !== "air") return;
  const z = b.pos.z;
  const catchable = z <= REACH_HEIGHT && z >= 0.1;
  const thrower = b.throwInfo?.throwerId;

  let best: { p: SimPlayer; d: number; diving: boolean } | null = null;
  for (const p of sim.players) {
    if (p.down || p.stun > 0 || p.id === thrower) continue;
    if (p.side === "offense" && !p.eligible) continue;
    if (b.attempted.includes(p.id)) continue;
    const d = dist2(p.pos, b.pos);
    const prev = sim.lastBallDist.get(p.id) ?? Infinity;
    sim.lastBallDist.set(p.id, d);
    if (!catchable) continue;
    // Can extend (dive) only when tracking the ball.
    const tracking = p.reacted && (p.mode === "trackBall" || p.mode === "attackBall");
    const reach = tracking ? DIVE_RADIUS : REACH_RADIUS;
    if (d > reach) continue;
    // Make the play at the closest approach, when it's right on him, or when the ball is about to die.
    // A dive is a last resort: only for a ball about to hit the ground out of normal reach.
    const closest = d > prev - 1e-4;
    const dying = z < 0.6 && b.vel.z < 0;
    const diving = d > REACH_RADIUS;
    if (diving ? !dying : !(closest || d < 0.35 || dying)) continue;
    if (!best || d < best.d) best = { p, d, diving };
  }
  if (!best) return;
  const { p, d, diving } = best;
  b.attempted.push(p.id);
  if (p.side === "offense") receiverAttempt(sim, p, d, diving);
  else defenderAttempt(sim, p, d, diving);
}

/** How hard the ball is to handle: distance from the body, velocity, height. */
function difficulty(sim: PlaySim, d: number, diving: boolean, hands: number): number {
  const b = sim.ball;
  let pen = 0;
  pen += 0.2 * Math.pow(Math.max(0, (Math.min(d, REACH_RADIUS) - 0.45) / (REACH_RADIUS - 0.45)), 1.5);
  if (diving) pen += 0.35;
  const speed = len2({ x: b.vel.x, y: b.vel.y });
  if (speed > 17) pen += (speed - 17) * 0.018 * (1.25 - hands);
  if (b.pos.z > 2.3) pen += 0.1;
  if (b.pos.z < 0.45) pen += 0.15;
  return pen;
}

function receiverAttempt(sim: PlaySim, p: SimPlayer, d: number, diving: boolean): void {
  if (!p.reacted) {
    // A teammate the ball wasn't meant for: it only matters if it hits him square.
    if (d < 0.4 && sim.rng.chance(0.3)) {
      if (sim.rng.chance(0.4)) sim.caught(p, false, false);
      else {
        sim.emit({ kind: "deflect", playerId: p.id });
        sim.popBall(0.7);
      }
    }
    return;
  }
  const hands = clamp01(p.r.catching / 99);
  let prob = 0.66 + 0.33 * hands - difficulty(sim, d, diving, hands);
  // Contested: aware defenders in position at the catch point (not just trailing).
  let contested = false;
  for (const def of sim.defense) {
    if (def.down || def.stun > 0 || !def.reacted) continue;
    const dd = dist2(def.pos, p.pos);
    if (dd > 1.25 || dist2(def.pos, sim.ball.pos) > d + 0.6) continue;
    contested = true;
    const skill = (def.r.manCoverage + def.r.zoneCoverage + def.r.awareness) / 297;
    prob -= 0.24 * (1 - dd / 1.25) * (0.5 + 0.7 * skill);
  }
  prob = clamp(prob, 0.02, 0.98);
  if (sim.rng.chance(prob)) {
    sim.caught(p, contested, diving);
  } else {
    sim.emit({ kind: "drop", playerId: p.id });
    sim.popBall(0.6);
    if (diving) p.stun = 0.6;
  }
}

function defenderAttempt(sim: PlaySim, p: SimPlayer, d: number, diving: boolean): void {
  if (!p.reacted) {
    // Ball hits a defender who isn't looking: sometimes it caroms off him.
    if (sim.rng.chance(0.22)) {
      sim.emit({ kind: "deflect", playerId: p.id });
      sim.popBall(1);
    }
    return;
  }
  const ballSkill = clamp01((p.r.catching * 0.65 + p.r.awareness * 0.35) / 99);
  const target = sim.ball.throwInfo ? sim.get(sim.ball.throwInfo.targetId) : undefined;
  // Undercutting the route (closer to the ball than the receiver) is the best INT position.
  const inFront = !target || dist2(target.pos, sim.ball.pos) > d + 0.5;
  // Most defended passes are broken up, not picked (about 4 PBUs per interception).
  let pInt = 0.24 * ballSkill - difficulty(sim, d, diving, ballSkill) * 0.8 + (inFront ? 0.05 : -0.08);
  pInt = clamp(pInt, 0.01, 0.6);
  const pBreak = clamp(0.5 + 0.3 * ballSkill - (diving ? 0.15 : 0), 0.2, 0.9);
  const roll = sim.rng.next();
  if (roll < pInt) {
    sim.intercepted(p);
  } else if (roll < pInt + (1 - pInt) * pBreak) {
    sim.emit({ kind: "deflect", playerId: p.id });
    sim.popBall(1);
    if (diving) p.stun = 0.6;
  } else if (diving) {
    p.stun = 0.6;
  }
}
