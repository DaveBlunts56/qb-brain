import { clamp, clamp01, dist2, dot2, len2, norm2, sub2, type Vec2 } from "../math/vec";
import { PLAYER_RADIUS, TACKLE_RANGE } from "./physique";
import type { PlaySim } from "./playSim";
import type { SimPlayer } from "./types";

export interface Engagement {
  blockerId: string;
  defenderId: string;
  /** Seconds engaged. */
  t: number;
  /** Unit vector from blocker to defender when the block started. */
  axis: Vec2;
}

const ENGAGE_RANGE = 1.05;
const LUNGE_RANGE = 1.75;

function canEngage(p: SimPlayer): boolean {
  return !p.engagedWith && !p.down && p.stun <= 0;
}

/** Start blocks: any blocker with an assignment in range locks up with that defender. */
export function startEngagements(sim: PlaySim): void {
  for (const b of sim.players) {
    if (!canEngage(b)) continue;
    let target: SimPlayer | null = null;
    if (b.mode === "passBlock") target = sim.blockTargetFor(b);
    else if (b.mode === "convoy") target = sim.convoyTargetFor(b);
    if (!target || !canEngage(target) || target.id === sim.ball.carrierId) continue;
    if (dist2(b.pos, target.pos) > ENGAGE_RANGE) continue;
    const axis = norm2(sub2(target.pos, b.pos));
    sim.engagements.push({ blockerId: b.id, defenderId: target.id, t: 0, axis });
    b.engagedWith = target.id;
    target.engagedWith = b.id;
    b.mode = "engaged";
    target.mode = "engaged";
    // Momentum is absorbed by the collision.
    const avg = { x: (b.vel.x * b.mass + target.vel.x * target.mass) / (b.mass + target.mass), y: (b.vel.y * b.mass + target.vel.y * target.mass) / (b.mass + target.mass) };
    b.vel = { ...avg };
    target.vel = { ...avg };
  }
}

/**
 * Engaged pairs move together. The defender drives toward his goal (QB or ball carrier) with a
 * speed set by the rating difference, and sheds the block at a rate that grows with it.
 */
export function updateEngagements(sim: PlaySim, dt: number): void {
  const keep: Engagement[] = [];
  for (const e of sim.engagements) {
    const b = sim.get(e.blockerId);
    const d = sim.get(e.defenderId);
    if (!b || !d) continue;
    e.t += dt;
    const goal = sim.carrier ?? sim.qb;
    const passRush = d.slot === "DL1" || d.slot === "DL2" || sim.wasRusher(d.id);
    const attack = passRush && !sim.passThrown ? d.r.passRush : (d.r.strength + d.r.tackling) / 2;
    const hold = b.slot === "OL1" || b.slot === "OL2" ? b.r.passBlock : b.r.passBlock * 0.65 + b.r.strength * 0.35;
    const diff = attack - hold;

    // Pocket push: the pair drifts toward the defender's goal when he's winning.
    const center = { x: (b.pos.x + d.pos.x) / 2, y: (b.pos.y + d.pos.y) / 2 };
    const toGoal = norm2(sub2(goal.pos, center));
    const strengthEdge = (d.r.strength - b.r.strength) * 0.01;
    // An even pass-rush matchup walks the blocker back ~1 yd/s; a mismatch collapses the pocket fast.
    const push = passRush && !sim.passThrown ? clamp(0.85 + diff * 0.05 + strengthEdge, 0.1, 2.4) : clamp(0.3 + diff * 0.04 + strengthEdge, -0.4, 1.6);
    const move = { x: toGoal.x * push * dt, y: toGoal.y * push * dt };
    center.x += move.x;
    center.y += move.y;
    // Keep the blocker on the goal side of the defender.
    const axis = norm2(sub2(center, goal.pos));
    const half = PLAYER_RADIUS * 0.95;
    b.pos = { x: center.x - axis.x * half, y: center.y - axis.y * half };
    d.pos = { x: center.x + axis.x * half, y: center.y + axis.y * half };
    b.vel = { x: move.x / dt, y: move.y / dt };
    d.vel = { ...b.vel };
    e.axis = { x: axis.x, y: axis.y };

    // Shed hazard per second.
    let rate = (passRush && !sim.passThrown ? 0.2 : 0.8) * Math.pow(2, diff / 12);
    // Quick wins off the snap are rare; the rush builds as the play goes on.
    rate *= Math.min(1, 0.3 + e.t * 0.38) * (1 + e.t * 0.12);
    if (sim.passThrown && passRush) rate *= 2.5; // linemen disengage to chase the ball
    if (sim.carrier && dist2(center, sim.carrier.pos) > 9 && sim.ball.carrierId !== sim.qb.id) rate *= 3;
    const shed = sim.rng.chance(rate * dt) || b.down || d.down || b.stun > 0;
    if (shed) {
      b.engagedWith = null;
      d.engagedWith = null;
      b.stun = Math.max(b.stun, passRush ? 0.75 : 0.5);
      // Defender wins: he rips past the blocker's shoulder toward his goal with a burst.
      const side = { x: -axis.y, y: axis.x };
      const s = sim.rng.chance(0.5) ? 1 : -1;
      d.pos = { x: b.pos.x - axis.x * 0.5 + side.x * s * 0.6, y: b.pos.y - axis.y * 0.5 + side.y * s * 0.6 };
      const toGoal2 = norm2(sub2(goal.pos, d.pos));
      d.vel = { x: toGoal2.x * 3.5, y: toGoal2.y * 3.5 };
      sim.afterShed(b, d);
      sim.emit({ kind: "shed", playerId: d.id });
    } else {
      keep.push(e);
    }
  }
  sim.engagements = keep;
}

/** Soft-body separation so players don't overlap (rubs and traffic emerge from this). */
export function resolveCollisions(sim: PlaySim): void {
  const ps = sim.players;
  const minD = PLAYER_RADIUS * 2;
  for (let i = 0; i < ps.length; i++) {
    const a = ps[i];
    for (let j = i + 1; j < ps.length; j++) {
      const b = ps[j];
      if (a.engagedWith === b.id) continue;
      const dx = b.pos.x - a.pos.x;
      const dy = b.pos.y - a.pos.y;
      const d = Math.hypot(dx, dy);
      if (!(d < minD) || d < 1e-6) continue;
      // Tackle candidates are allowed to touch; contact here represents bodies, not wraps.
      const overlap = (minD - d) * 0.5;
      const nx = dx / d;
      const ny = dy / d;
      // A planted player holds his ground against someone running into him.
      const ma = a.mass * (len2(a.vel) < 1.5 ? 2.5 : 1);
      const mb = b.mass * (len2(b.vel) < 1.5 ? 2.5 : 1);
      const wa = mb / (ma + mb);
      const wb = ma / (ma + mb);
      if (!a.engagedWith && !a.down) a.pos = { x: a.pos.x - nx * overlap * wa * 2, y: a.pos.y - ny * overlap * wa * 2 };
      if (!b.engagedWith && !b.down) b.pos = { x: b.pos.x + nx * overlap * wb * 2, y: b.pos.y + ny * overlap * wb * 2 };
    }
  }
}

/**
 * Tackling. Every eligible defender in range of the carrier gets one attempt (then a cooldown).
 * Probability comes from tackling vs elusiveness, angle, help, and the carrier's state.
 */
export function resolveTackles(sim: PlaySim): void {
  const c = sim.carrier;
  if (!c) return;
  const foes = c.side === "offense" ? sim.defense : sim.offense;
  for (const t of foes) {
    if (sim.phase !== "live") return;
    if (t.down || t.engagedWith || t.stun > 0 || t.tackleCooldown > 0) continue;
    const d = dist2(t.pos, c.pos);
    if (d > LUNGE_RANGE) continue;
    // Beyond arm's length a defender only lunges if he can't otherwise close the gap.
    const lunge = d > TACKLE_RANGE;
    if (lunge) {
      const toCarrier = norm2(sub2(c.pos, t.pos));
      const closing = dot2(sub2(t.vel, c.vel), toCarrier);
      if (closing > 0.6) continue;
    }
    const pocketQb = c.id === sim.qb.id && !sim.qbCrossedLos;
    let p = 0.84 + (t.r.tackling - c.r.elusiveness) / 160 + (t.r.strength - c.r.strength) / 450;
    // Still securing the catch / stumbling: easy to wrap up.
    if (c.slowTimer > 0) p += 0.15;
    if (pocketQb) p += 0.18;
    // Help: other tacklers closing in.
    let help = 0;
    for (const o of foes) if (o !== t && !o.down && !o.engagedWith && dist2(o.pos, c.pos) < 2.2) help++;
    p += Math.min(2, help) * 0.12;
    // Arm tackle from behind is weaker.
    const toTackler = sub2(t.pos, c.pos);
    if (len2(c.vel) > 3 && dot2(norm2(c.vel), norm2(toTackler)) < -0.3) p -= 0.1;
    if (c.jukeTimer > 0) p -= 0.42 * clamp01(c.r.elusiveness / 99);
    if (c.stun > 0 || c.diveTimer > 0) p += 0.3;
    if (lunge) p *= 0.75 - ((d - TACKLE_RANGE) / (LUNGE_RANGE - TACKLE_RANGE)) * 0.25;
    p = clamp(p, 0.06, 0.97);
    if (sim.rng.chance(p)) {
      sim.tackled(c, t);
      return;
    }
    // A missed lunge leaves him on the turf for a moment.
    t.stun = lunge ? 0.9 : 0.55;
    t.tackleCooldown = lunge ? 1.4 : 1.0;
    c.slowTimer = Math.max(c.slowTimer, 0.22);
    sim.emit({ kind: "missedTackle", tacklerId: t.id, carrierId: c.id });
  }
}
