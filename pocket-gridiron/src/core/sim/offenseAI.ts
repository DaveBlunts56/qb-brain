import { FIELD_WIDTH } from "../field";
import { add2, clamp, dist2, len2, norm2, scale2, sub2, v2, type Vec2 } from "../math/vec";
import { currentTopSpeed, seek } from "./movement";
import type { PlaySim } from "./playSim";
import { followRoute } from "./routeFollow";
import type { SimPlayer } from "./types";

export interface Desire {
  vel: Vec2;
  /** Extra cutting ability (route running on breaks). */
  cut: number;
}

const still = (): Desire => ({ vel: v2(), cut: 0 });

/** AI for offensive players the user isn't controlling. */
export function offenseDesire(sim: PlaySim, p: SimPlayer): Desire {
  switch (p.mode) {
    case "passBlock":
      return { vel: passBlockDesire(sim, p), cut: 0 };
    case "route": {
      const step = followRoute(p);
      if (step.settled) p.mode = "settled";
      return { vel: step.desired, cut: (p.r.routeRunning / 99) * 0.45 - 0.1 };
    }
    case "settled":
      return { vel: settleDesire(sim, p), cut: 0 };
    case "trackBall":
      return { vel: trackBallDesire(sim, p), cut: 0.2 };
    case "convoy":
      return { vel: convoyDesire(sim, p), cut: 0 };
    case "pursuit":
      return { vel: pursuitDesire(sim, p), cut: 0.1 };
    case "carrier":
      // AI carrier (only when the user isn't controlling him): run to daylight.
      return { vel: runToDaylight(sim, p, 1), cut: 0.2 };
    default:
      return still();
  }
}

/** Pass protection: get between the assigned rusher and the quarterback. */
function passBlockDesire(sim: PlaySim, p: SimPlayer): Vec2 {
  const qb = sim.qb;
  const target = sim.blockTargetFor(p);
  if (!target) {
    // Nobody to block: hold a spot in front of the QB (or leak out if a back).
    const home = v2(qb.pos.x + 2.2, qb.pos.y + (p.slot === "OL1" ? -1.2 : p.slot === "OL2" ? 1.2 : 0));
    return seek(p, home, 0.6, 1);
  }
  const toQb = norm2(sub2(qb.pos, target.pos));
  const spot = add2(target.pos, scale2(toQb, 0.95));
  return seek(p, spot, 1, 0.5);
}

/** Settled receivers drift away from the nearest defender to present a window. */
function settleDesire(sim: PlaySim, p: SimPlayer): Vec2 {
  const anchor = p.route?.points[p.route.points.length - 1] ?? p.pos;
  let near: SimPlayer | null = null;
  let nd = 4.5;
  for (const d of sim.defense) {
    const dd = dist2(d.pos, p.pos);
    if (dd < nd) { nd = dd; near = d; }
  }
  let spot = anchor;
  if (near) {
    const away = norm2(sub2(p.pos, near.pos));
    spot = { x: anchor.x + clamp(away.x * 1.2, -1, 0.5), y: anchor.y + clamp(away.y * 2.2, -2.2, 2.2) };
  }
  spot.y = clamp(spot.y, 1.2, FIELD_WIDTH - 1.2);
  return seek(p, spot, 0.45, 1.2);
}

/** Receiver adjusting to the thrown ball: get to the catch point, then come back to the ball. */
function trackBallDesire(sim: PlaySim, p: SimPlayer): Vec2 {
  const t = sim.ball.throwInfo;
  if (!t) return v2();
  const remaining = Math.max(0, t.catchTime - sim.time);
  const d = dist2(p.pos, t.catchPoint);
  const top = currentTopSpeed(p);
  if (top <= 0 || d < 0.4) return v2();
  // Arrive on time: if he'd be early by a lot, he throttles; otherwise full speed.
  const needed = remaining > 0.05 ? d / remaining : top;
  // Aim to get there early and settle under it.
  const speedFrac = clamp(Math.max(needed * 1.4, top * 0.6) / top, 0.5, 1);
  return seek(p, t.catchPoint, speedFrac, 0.6);
}

/** Lead block for the ball carrier: pick off the most dangerous pursuer. */
function convoyDesire(sim: PlaySim, p: SimPlayer): Vec2 {
  const c = sim.carrier;
  if (!c) return v2();
  const threat = sim.convoyTargetFor(p);
  if (threat) {
    const toCarrier = norm2(sub2(c.pos, threat.pos));
    return seek(p, add2(threat.pos, scale2(toCarrier, 0.8)), 1, 0.4);
  }
  // Nobody to block: jog alongside, a few yards ahead of the carrier.
  const dir = c.side === "offense" ? 1 : -1;
  return seek(p, v2(c.pos.x + 5 * dir, p.pos.y), 0.6, 2);
}

/** Chase the ball carrier with a pursuit angle (used by offense after an interception). */
export function pursuitDesire(sim: PlaySim, p: SimPlayer): Vec2 {
  const c = sim.carrier;
  if (!c) return v2();
  const d = dist2(p.pos, c.pos);
  const lead = Math.min(1.3, d / Math.max(4, currentTopSpeed(p))) * (0.5 + 0.5 * (p.r.awareness / 99));
  const aim = add2(c.pos, scale2(c.vel, lead));
  return seek(p, aim, 1, 0);
}

/**
 * Open-field running for an AI ball carrier: head for the goal line, steer away from tacklers and
 * the sideline.
 */
export function runToDaylight(sim: PlaySim, p: SimPlayer, goalDir: 1 | -1): Vec2 {
  let dir = v2(goalDir, 0);
  const foes = p.side === "offense" ? sim.defense : sim.offense;
  for (const f of foes) {
    if (f.down || f.engagedWith) continue;
    const off = sub2(p.pos, f.pos);
    const d = len2(off);
    if (d > 7 || d < 0.01) continue;
    // Only defenders in front (or level) matter for cutting.
    if ((f.pos.x - p.pos.x) * goalDir < -1.5) continue;
    const w = (7 - d) / 7;
    dir = add2(dir, scale2(norm2({ x: 0, y: off.y || (p.pos.y < FIELD_WIDTH / 2 ? 1 : -1) }), w * 1.4));
  }
  if (p.pos.y < 3) dir.y += (3 - p.pos.y) * 0.5;
  if (p.pos.y > FIELD_WIDTH - 3) dir.y -= (p.pos.y - (FIELD_WIDTH - 3)) * 0.5;
  return scale2(norm2(dir), currentTopSpeed(p));
}
