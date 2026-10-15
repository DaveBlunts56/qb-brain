import { FIELD_WIDTH } from "../field";
import { add2, clamp, clamp01, closestOnSegment, dist2, len2, lerp, norm2, scale2, sub2, v2, type Vec2 } from "../math/vec";
import { currentTopSpeed, seek } from "./movement";
import type { Desire } from "./offenseAI";
import { pursuitDesire, runToDaylight } from "./offenseAI";
import type { PlaySim } from "./playSim";
import type { SimPlayer } from "./types";

/** AI for defenders (and for any defender carrying an interception). */
export function defenseDesire(sim: PlaySim, p: SimPlayer): Desire {
  switch (p.mode) {
    case "rush":
      return { vel: rushDesire(sim, p), cut: 0 };
    case "man":
      return { vel: manDesire(sim, p), cut: (p.r.manCoverage / 99) * 0.3 };
    case "zone":
      return { vel: zoneDesire(sim, p), cut: 0.1 };
    case "attackBall":
      return { vel: attackBallDesire(sim, p), cut: 0.2 };
    case "pursuit":
      return { vel: pursuitDesire(sim, p), cut: 0.15 };
    case "carrier":
      return { vel: runToDaylight(sim, p, -1), cut: 0.2 };
    case "convoy": {
      const c = sim.carrier;
      const t = sim.convoyTargetFor(p);
      if (c && t) return { vel: seek(p, add2(t.pos, scale2(norm2(sub2(c.pos, t.pos)), 0.8)), 1, 0.4), cut: 0 };
      if (c) return { vel: seek(p, v2(c.pos.x - 5, p.pos.y), 0.6, 2), cut: 0 };
      return { vel: v2(), cut: 0 };
    }
    default:
      return { vel: v2(), cut: 0 };
  }
}

/** Free rusher: attack the QB's throwing lane, staying a little outside to keep him in the pocket. */
function rushDesire(sim: PlaySim, p: SimPlayer): Vec2 {
  const target = sim.carrier ?? sim.qb;
  const lane = p.slot === "DL1" ? -0.7 : p.slot === "DL2" ? 0.7 : 0;
  const d = dist2(p.pos, target.pos);
  const aim = d > 3 ? v2(target.pos.x, target.pos.y + lane) : add2(target.pos, scale2(target.vel, 0.2));
  return seek(p, aim, 1, 0);
}

/**
 * Man coverage. The defender sees the receiver's velocity with a reaction delay (better cover
 * skills = shorter delay; better route running = longer). That lag is what opens windows at breaks.
 */
function manDesire(sim: PlaySim, p: SimPlayer): Vec2 {
  const rec = sim.get(p.manTargetId ?? "");
  if (!rec || rec.down) return zoneLikeHold(sim, p);
  // His man stayed in to block: become a robber in the middle.
  if (rec.mode === "passBlock") return seek(p, v2(sim.cfg.losX + 6, sim.cfg.ballY), 0.7, 1.5);
  const lag = clamp(lerp(0.32, 0.1, p.r.manCoverage / 99) + (rec.r.routeRunning / 99) * 0.12 + sim.cfg.reactionBias, 0.04, 0.6);
  // The lag delays reading a change of direction, not the receiver's speed: a corner matches the
  // release, then has to recognize the break.
  const idx = Math.min(rec.velHistory.length - 1, Math.round(lag * 60));
  const lagged = idx >= 0 ? rec.velHistory[idx] : rec.vel;
  const lagDir = len2(lagged) > 0.5 ? norm2(lagged) : v2(1, 0);
  const seenVel = scale2(lagDir, len2(rec.vel));
  const predicted = add2(rec.pos, scale2(seenVel, 0.35));
  const inside = Math.sign(sim.cfg.ballY - rec.pos.y) || 1;
  const depth = rec.pos.x - sim.cfg.losX;
  // Cushion: start at the alignment gap and give it up as the receiver closes. With no deep help
  // (Cover 0) or on deep routes, finish on top; otherwise trail underneath.
  const finish = sim.call.id === "cover0" || depth > 14 ? 1.0 : -0.4;
  const gap0 = p.manCushion ?? 1;
  const cushion = Math.max(finish, gap0 - 3.5 * sim.time);
  const target = v2(predicted.x + cushion, predicted.y + inside * 0.7);
  return seek(p, target, 1, 0.5);
}

function zoneLikeHold(sim: PlaySim, p: SimPlayer): Vec2 {
  return seek(p, v2(sim.cfg.losX + 7, sim.cfg.ballY), 0.7, 1.5);
}

/** Zone coverage: drop to the landmark, then wall off or carry receivers entering the zone. */
function zoneDesire(sim: PlaySim, p: SimPlayer): Vec2 {
  const z = p.zone;
  if (!z) return zoneLikeHold(sim, p);
  const los = sim.cfg.losX;
  const qb = sim.qb;
  const landmark = v2(los + z.depth, z.y);
  const lo = z.y - z.halfWidth - 1.5;
  const hi = z.y + z.halfWidth + 1.5;
  // Zone discipline: recognition improves with zone coverage rating.
  const read = clamp01(p.r.zoneCoverage / 99);
  let target: Vec2;

  const threats = sim.offense.filter((r) => r.eligible && !r.down && r.mode !== "passBlock" && r.pos.y > lo && r.pos.y < hi);
  if (z.kind === "deep") {
    // Stay deeper than the deepest threat in (or near) the zone.
    let deepest: SimPlayer | null = null;
    for (const r of threats) if (r.pos.x > los + 6 && (!deepest || r.pos.x > deepest.pos.x)) deepest = r;
    if (deepest) {
      const cushion = lerp(3.2, 2.0, read);
      const y = clamp(lerp(deepest.pos.y, z.y, 0.25) + Math.sign(sim.cfg.ballY - deepest.pos.y) * 0.6, lo, hi);
      // Hold the landmark depth; once a receiver threatens it, bail and keep him in front.
      target = v2(Math.max(los + z.depth, deepest.pos.x + cushion + Math.max(0, deepest.vel.x) * 0.45), y);
    } else {
      target = landmark;
    }
  } else {
    // Underneath: get between the QB and the most dangerous receiver in the zone.
    let best: SimPlayer | null = null;
    let bestScore = Infinity;
    for (const r of threats) {
      if (r.pos.x > los + z.depth + 9 || r.pos.x < los - 2) continue;
      const score = dist2(r.pos, landmark) - (r.pos.x - los) * 0.15;
      if (score < bestScore) { bestScore = score; best = r; }
    }
    if (best) {
      const toQb = norm2(sub2(qb.pos, best.pos));
      const wall = add2(add2(best.pos, scale2(best.vel, 0.3 * read)), scale2(toQb, lerp(2.2, 1.3, read)));
      target = v2(clamp(wall.x, los + 1, los + z.depth + 5), clamp(wall.y, lo - 2, hi + 2));
    } else {
      // Sit at the landmark, leaning toward where the QB is looking (his body).
      target = v2(landmark.x, lerp(landmark.y, qb.pos.y, 0.15));
    }
  }
  target.y = clamp(target.y, 0.8, FIELD_WIDTH - 0.8);
  return seek(p, target, 0.92, 1.2);
}

/** Thrown ball: break on the catch point. Defenders who can't get there take a pursuit angle. */
function attackBallDesire(sim: PlaySim, p: SimPlayer): Vec2 {
  const t = sim.ball.throwInfo;
  if (!t || sim.ball.state !== "air") return pursuitDesire(sim, p);
  const speed = Math.max(1, currentTopSpeed(p));
  // The ball is catchable along its descent from the high point to the catch point. Undercut it
  // (meet it upstream of the receiver) if there's time; otherwise go to the catch point.
  const spot = closestOnSegment(p.pos, t.highPoint, t.catchPoint);
  const along = dist2(t.highPoint, spot) / Math.max(0.01, dist2(t.highPoint, t.catchPoint));
  const arrive = t.highTime + (t.catchTime - t.highTime) * (Number.isFinite(along) ? along : 1);
  if (dist2(p.pos, spot) / speed < arrive - sim.time + 0.1) return seek(p, spot, 1, 0.3);
  const remaining = Math.max(0, t.catchTime - sim.time);
  const d = dist2(p.pos, t.catchPoint);
  const canMakeIt = d / speed < remaining + 0.35;
  if (canMakeIt) return seek(p, t.catchPoint, 1, 0.3);
  // Too far: aim a few yards past the catch point toward our end zone to make the tackle.
  const target = sim.get(t.targetId);
  const beyond = v2(t.catchPoint.x + 3, target ? lerp(t.catchPoint.y, target.pos.y, 0.3) : t.catchPoint.y);
  return seek(p, beyond, 1, 0);
}
