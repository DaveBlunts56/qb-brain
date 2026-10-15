import type { DefenseCall } from "../data/defense";
import type { Play } from "../data/playbook";
import type { Team } from "../data/types";
import { FIELD_LENGTH, FIELD_WIDTH, OPP_GOAL_X, OWN_GOAL_X } from "../field";
import { Rng } from "../math/rng";
import { add2, clamp, clamp01, dist2, len2, limit2, norm2, scale2, sub2, v2, type Vec2 } from "../math/vec";
import { solveLaunch, timeToHeightDescending, WINDUP, ballAt } from "./ballistics";
import { resolveBallContacts } from "./catching";
import { resolveCollisions, resolveTackles, startEngagements, updateEngagements, type Engagement } from "./contact";
import { defenseDesire } from "./defenseAI";
import { faceToward, seek, steer } from "./movement";
import { offenseDesire, pursuitDesire } from "./offenseAI";
import { leadTarget, throwError } from "./passing";
import { CATCH_HEIGHT, GRAVITY, REACH_HEIGHT, RELEASE_HEIGHT, throwReaction } from "./physique";
import { lineUp } from "./setup";
import type { BallState, Command, ControlInput, OutcomeKind, PassType, PlayOutcome, PlayPhase, SimConfig, SimEvent, SimPlayer } from "./types";

export const SIM_DT = 1 / 60;
const HISTORY = 40;
const DEAD_BALL_TIME = 1.1;
const MAX_AIM = 6;
export const NO_INPUT: ControlInput = { move: { x: 0, y: 0 }, commands: [] };

interface PendingThrow {
  targetId: string;
  passType: PassType;
  aim: Vec2;
  timer: number;
}

/**
 * One football play, from the pre-snap alignment to the dead ball.
 *
 * Phases: preSnap → live (QB or a runner has the ball) → passInAir → live (after a catch or
 * interception) → deadBall (whistle, players pull up) → result.
 *
 * The simulation is deterministic for a given seed and input sequence, runs at a fixed 60 Hz
 * step, and never touches rendering.
 */
export class PlaySim {
  readonly cfg: SimConfig;
  readonly rng: Rng;
  readonly play: Play;
  readonly flipped: boolean;
  readonly call: DefenseCall;
  readonly offenseTeam: Team;
  readonly defenseTeam: Team;

  phase: PlayPhase = "preSnap";
  /** Seconds since the snap. */
  time = 0;
  /** Seconds of live ball (clock runoff). */
  liveTime = 0;
  players: SimPlayer[];
  offense: SimPlayer[];
  defense: SimPlayer[];
  ball: BallState;
  engagements: Engagement[] = [];
  outcome: PlayOutcome | null = null;
  /** The player the joystick moves. */
  controlledId: string | null = null;
  passThrown = false;
  qbCrossedLos = false;
  pendingThrow: PendingThrow | null = null;
  lastBallDist = new Map<string, number>();
  receiverId: string | null = null;
  catchX: number | null = null;
  interceptorId: string | null = null;

  private events: SimEvent[] = [];
  private byId = new Map<string, SimPlayer>();
  private rusherIds = new Set<string>();
  private blockAssign = new Map<string, string>();
  private convoyAssign = new Map<string, string>();
  private deadTimer = 0;
  private dropPoint: Vec2;
  private autoDrop = true;
  private scrambleAt: number | null = null;
  private airYards = 0;

  constructor(offenseTeam: Team, defenseTeam: Team, play: Play, flipped: boolean, cfg: SimConfig) {
    this.cfg = cfg;
    this.rng = new Rng(cfg.seed);
    this.play = play;
    this.flipped = flipped;
    this.offenseTeam = offenseTeam;
    this.defenseTeam = defenseTeam;
    const lineup = lineUp(offenseTeam, defenseTeam, play, flipped, cfg);
    this.call = lineup.call;
    this.offense = lineup.offense;
    this.defense = lineup.defense;
    this.players = [...this.offense, ...this.defense];
    for (const p of this.players) this.byId.set(p.id, p);
    const qb = this.qb;
    this.dropPoint = v2(qb.pos.x - 2, qb.pos.y);
    this.ball = {
      state: "held", carrierId: qb.id,
      pos: { x: cfg.losX, y: cfg.ballY, z: 0.2 }, vel: { x: 0, y: 0, z: 0 },
      throwInfo: null, deflected: false, attempted: [], possession: "offense",
    };
  }

  // ---------------------------------------------------------------- accessors

  get(id: string): SimPlayer | undefined {
    return this.byId.get(id);
  }

  get qb(): SimPlayer {
    return this.byId.get("O-QB")!;
  }

  get carrier(): SimPlayer | null {
    return this.ball.state === "held" && this.ball.carrierId ? this.byId.get(this.ball.carrierId) ?? null : null;
  }

  get receivers(): SimPlayer[] {
    return this.offense.filter((p) => p.eligible).sort((a, b) => a.marker - b.marker);
  }

  get controlled(): SimPlayer | null {
    return this.controlledId ? this.byId.get(this.controlledId) ?? null : null;
  }

  /** True while the user can still throw (QB has the ball behind the line). */
  get canThrow(): boolean {
    return this.phase === "live" && !this.passThrown && !this.pendingThrow && this.ball.carrierId === this.qb.id && !this.qbCrossedLos && !this.qb.down;
  }

  wasRusher(id: string): boolean {
    return this.rusherIds.has(id);
  }

  emit(e: SimEvent): void {
    this.events.push(e);
  }

  /** Returns and clears the events since the last call (for sound/effects). */
  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  // ---------------------------------------------------------------- snap

  snap(): void {
    if (this.phase !== "preSnap") return;
    this.phase = "live";
    this.controlledId = this.qb.id;
    this.qb.mode = "qb";
    for (const p of this.players) {
      if (p.side === "offense") {
        if (p.slot === "OL1" || p.slot === "OL2") p.mode = "passBlock";
        else if (p.eligible) p.mode = p.route?.protectUntil !== undefined ? "passBlock" : "route";
      } else if (p.mode === "rush") {
        this.rusherIds.add(p.id);
      } else if (p.mode === "man" && p.manTargetId) {
        p.manCushion = p.pos.x - this.get(p.manTargetId)!.pos.x;
      }
    }
    this.pressJams();
    this.emit({ kind: "snap" });
  }

  /** Press corners try to jam receivers at the line; a good jam slows the release. */
  private pressJams(): void {
    for (const d of this.defense) {
      if (d.mode !== "man" || !d.manTargetId) continue;
      const r = this.get(d.manTargetId);
      if (!r || dist2(d.pos, r.pos) > 2.2) continue;
      const p = clamp(0.3 + (d.r.strength + d.r.manCoverage - r.r.strength - r.r.routeRunning) / 300, 0.08, 0.7);
      if (this.rng.chance(p)) r.slowTimer = this.rng.range(0.25, 0.5);
    }
  }

  // ---------------------------------------------------------------- main step

  step(dt: number = SIM_DT, input: ControlInput = NO_INPUT): void {
    if (this.phase === "preSnap" || this.phase === "result") return;
    this.time += dt;
    if (this.phase === "deadBall") {
      for (const p of this.players) {
        steer(p, v2(), dt);
        p.pos = add2(p.pos, scale2(p.vel, dt));
      }
      this.deadTimer -= dt;
      if (this.deadTimer <= 0) this.phase = "result";
      return;
    }
    this.liveTime += dt;
    this.handleCommands(input);
    this.updateTimers(dt);
    this.updatePendingThrow(dt);
    if (this.isDead()) return;

    // Decide and move.
    for (const p of this.players) {
      if (p.engagedWith) continue;
      const { vel, cut } = this.desireFor(p, input);
      steer(p, vel, dt, cut);
    }
    for (const p of this.players) {
      if (p.engagedWith) continue;
      p.pos = add2(p.pos, scale2(p.vel, dt));
      if (p.id !== this.ball.carrierId) {
        p.pos.x = clamp(p.pos.x, -2, FIELD_LENGTH + 2);
        p.pos.y = clamp(p.pos.y, -3, FIELD_WIDTH + 3);
      }
    }
    updateEngagements(this, dt);
    startEngagements(this);
    resolveCollisions(this);
    this.updateFacingAndHistory();

    this.updateBall(dt);
    if (this.isDead()) return;
    this.checkCarrier();
    if (this.isDead()) return;
    resolveTackles(this);
  }

  private isDead(): boolean {
    return this.phase === "deadBall" || this.phase === "result";
  }

  private desireFor(p: SimPlayer, input: ControlInput): { vel: Vec2; cut: number } {
    if (p.down) return { vel: v2(), cut: 0 };
    if (p.id === this.controlledId) return { vel: this.controlledDesire(p, input.move), cut: 0.3 };
    if (p.id === this.qb.id && this.ball.carrierId !== p.id) {
      // QB after the throw: drift, then join pursuit on a turnover.
      if (p.mode === "pursuit") return { vel: pursuitDesire(this, p), cut: 0 };
      return { vel: scale2(p.vel, 0.5), cut: 0 };
    }
    return p.side === "offense" ? offenseDesire(this, p) : defenseDesire(this, p);
  }

  private controlledDesire(p: SimPlayer, move: Vec2): Vec2 {
    const mag = Math.min(1, len2(move));
    const top = p.maxSpeed * (p.slowTimer > 0 ? 0.55 : 1);
    if (p.stun > 0) return v2();
    if (p.diveTimer > 0) return scale2(norm2(p.vel), top * 1.1);
    if (p.jukeTimer > 0) return scale2(p.jukeDir, top);
    // QB in the pocket.
    if (p.id === this.qb.id && this.ball.carrierId === p.id && !this.qbCrossedLos) {
      if (this.pendingThrow) return v2();
      if (mag > 0.15) {
        this.autoDrop = false;
        return scale2(norm2(move), top * mag);
      }
      if (this.autoDrop) {
        if (dist2(p.pos, this.dropPoint) < 0.3) this.autoDrop = false;
        return seek(p, this.dropPoint, 0.7, 0.8);
      }
      return v2();
    }
    if (this.ball.carrierId === p.id) {
      if (mag > 0.15) return scale2(norm2(move), top * Math.min(1, mag * 1.15));
      return v2(top * (p.side === "offense" ? 1 : -1), 0); // auto-run toward the goal line
    }
    // Chasing an interception return: joystick steers, otherwise auto-pursue.
    if (mag > 0.15) return scale2(norm2(move), top * mag);
    return pursuitDesire(this, p);
  }

  private updateTimers(dt: number): void {
    for (const p of this.players) {
      if (p.stun > 0) p.stun = Math.max(0, p.stun - dt);
      if (p.tackleCooldown > 0) p.tackleCooldown = Math.max(0, p.tackleCooldown - dt);
      if (p.slowTimer > 0) p.slowTimer = Math.max(0, p.slowTimer - dt);
      if (p.jukeTimer > 0) p.jukeTimer = Math.max(0, p.jukeTimer - dt);
      if (p.jukeCooldown > 0) p.jukeCooldown = Math.max(0, p.jukeCooldown - dt);
      if (p.diveTimer > 0) {
        p.diveTimer -= dt;
        if (p.diveTimer <= 0 && this.ball.carrierId === p.id) {
          p.diveTimer = 0;
          this.endPlayAtCarrier(p);
          return;
        }
      }
      // Reaction to the thrown ball.
      if (this.ball.state === "air" && !p.reacted) {
        p.reactTimer -= dt;
        if (p.reactTimer <= 0) {
          p.reacted = true;
          if (p.side === "defense" && !p.engagedWith && p.mode !== "carrier") p.mode = "attackBall";
          else if (p.side === "offense" && this.ball.throwInfo?.targetId === p.id) p.mode = "trackBall";
        }
      }
    }
    // RB pass protection leaks out into his route once the rush is picked up.
    for (const p of this.offense) {
      if (p.eligible && p.mode === "passBlock" && p.route?.protectUntil !== undefined && this.time > p.route.protectUntil && !this.passThrown) {
        p.mode = "route";
      }
    }
    // Scramble: coverage players peel off to chase once they see the QB cross the line.
    if (this.scrambleAt !== null && !this.passThrown) {
      for (const d of this.defense) {
        if ((d.mode === "man" || d.mode === "zone") && this.time - this.scrambleAt > throwReaction(d.r) + 0.15) d.mode = "pursuit";
      }
    }
  }

  // ---------------------------------------------------------------- commands

  private handleCommands(input: ControlInput): void {
    for (const c of input.commands) this.command(c, input.move);
  }

  private command(c: Command, move: Vec2): void {
    const p = this.controlled;
    if (!p) return;
    if (c.kind === "throw") {
      if (!this.canThrow) return;
      const target = this.get(c.targetId);
      if (!target || !target.eligible) return;
      this.pendingThrow = { targetId: c.targetId, passType: c.passType, aim: limit2(c.aim, MAX_AIM), timer: WINDUP[c.passType] };
      this.qb.mode = "throwing";
      this.emit({ kind: "windup", passType: c.passType });
    } else if (c.kind === "juke") {
      if (this.ball.carrierId !== p.id || p.jukeCooldown > 0 || p.down || p.stun > 0) return;
      if (p.id === this.qb.id && !this.qbCrossedLos) return;
      const fwd = len2(p.vel) > 0.5 ? norm2(p.vel) : v2(p.side === "offense" ? 1 : -1, 0);
      const perp = v2(-fwd.y, fwd.x);
      let side = move.x * perp.x + move.y * perp.y;
      if (Math.abs(side) < 0.2) {
        // No stick direction: cut away from the closest defender.
        const foe = this.closestFoe(p);
        side = foe ? -Math.sign((foe.pos.x - p.pos.x) * perp.x + (foe.pos.y - p.pos.y) * perp.y) || 1 : 1;
      }
      p.jukeDir = norm2(add2(scale2(perp, Math.sign(side) * 0.9), scale2(fwd, 0.5)));
      p.jukeTimer = 0.32;
      p.jukeCooldown = 1.1;
      p.vel = scale2(p.jukeDir, Math.max(3, len2(p.vel) * 0.85));
      const elus = clamp01(p.r.elusiveness / 99);
      for (const d of this.players) {
        if (d.side === p.side || d.down || d.engagedWith) continue;
        if (dist2(d.pos, p.pos) > 3.5) continue;
        if (this.rng.chance(clamp(0.2 + 0.55 * elus - 0.3 * (d.r.awareness / 99), 0.05, 0.75))) d.stun = Math.max(d.stun, 0.3);
      }
      this.emit({ kind: "juke", playerId: p.id });
    } else if (c.kind === "dive") {
      if (this.ball.carrierId !== p.id || p.down || p.diveTimer > 0) return;
      if (p.id === this.qb.id && !this.qbCrossedLos) return;
      p.diveTimer = 0.38;
      const fwd = len2(p.vel) > 0.5 ? norm2(p.vel) : v2(p.side === "offense" ? 1 : -1, 0);
      p.vel = scale2(fwd, len2(p.vel) + 1.2);
    }
  }

  private closestFoe(p: SimPlayer): SimPlayer | null {
    let best: SimPlayer | null = null;
    let bd = Infinity;
    for (const o of this.players) {
      if (o.side === p.side || o.down) continue;
      const d = dist2(o.pos, p.pos);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  // ---------------------------------------------------------------- throwing

  private updatePendingThrow(dt: number): void {
    const t = this.pendingThrow;
    if (!t) return;
    t.timer -= dt;
    if (t.timer > 0) return;
    this.pendingThrow = null;
    if (this.ball.carrierId !== this.qb.id || this.qb.down) return;
    this.release(t);
  }

  /** Pressure: 0 (clean pocket) .. 1 (free rusher in his face). */
  pressureOnQb(): number {
    let p = 0;
    for (const d of this.defense) {
      if (d.engagedWith || d.down) continue;
      const dd = dist2(d.pos, this.qb.pos);
      p = Math.max(p, clamp01((3.5 - dd) / 2.5));
    }
    return p;
  }

  private release(t: PendingThrow): void {
    const qb = this.qb;
    const target = this.get(t.targetId)!;
    const from = { ...qb.pos };
    const lead = leadTarget(from, qb.r, target, t.passType);
    // QBs aim inside the boundary unless the user deliberately leads the ball out.
    const leadPoint = { x: Math.min(lead.point.x, FIELD_LENGTH - 1), y: clamp(lead.point.y, 1.2, FIELD_WIDTH - 1.2) };
    const aimPoint = add2(leadPoint, t.aim);
    const err = throwError(from, aimPoint, {
      passer: qb.r, qbVel: qb.vel, qbMaxSpeed: qb.maxSpeed, pressure: this.pressureOnQb(), type: t.passType,
    }, this.rng);
    const spot = add2(aimPoint, err);
    const from3 = { x: from.x, y: from.y, z: RELEASE_HEIGHT };
    const sol = solveLaunch(from3, { x: spot.x, y: spot.y, z: CATCH_HEIGHT }, qb.r, t.passType);
    const tc = timeToHeightDescending(from3, sol.vel, CATCH_HEIGHT) ?? sol.flightTime;
    const cp = ballAt(from3, sol.vel, tc);
    const th = Math.min(tc, timeToHeightDescending(from3, sol.vel, REACH_HEIGHT - 0.25) ?? tc);
    const hp = ballAt(from3, sol.vel, th);

    this.ball.state = "air";
    this.ball.carrierId = null;
    this.ball.pos = from3;
    this.ball.vel = sol.vel;
    this.ball.attempted = [];
    this.ball.throwInfo = {
      throwerId: qb.id, targetId: target.id, type: t.passType, from, aimPoint,
      catchPoint: { x: cp.x, y: cp.y }, catchTime: this.time + tc, releaseTime: this.time,
      highPoint: { x: hp.x, y: hp.y }, highTime: this.time + th,
      airYards: cp.x - this.cfg.losX,
    };
    this.airYards = cp.x - this.cfg.losX;
    this.passThrown = true;
    this.phase = "passInAir";
    this.controlledId = null;
    qb.mode = "idle";
    this.lastBallDist.clear();
    for (const p of this.players) {
      p.reacted = false;
      if (p.side === "defense") {
        let rt = throwReaction(p.r) + this.cfg.reactionBias;
        // Man defenders with their back to the QB are late to find the ball.
        if (p.mode === "man") {
          const toQb = norm2(sub2(qb.pos, p.pos));
          if (p.facing.x * toQb.x + p.facing.y * toQb.y < 0) rt += 0.22;
        }
        p.reactTimer = Math.max(0.05, rt);
      } else if (p.id === target.id) {
        p.reactTimer = 0.06 + (1 - p.r.awareness / 99) * 0.18;
      } else {
        p.reactTimer = 99; // other receivers keep running their routes
      }
    }
    this.emit({ kind: "throw", passType: t.passType, targetId: target.id });
  }

  // ---------------------------------------------------------------- ball

  private updateBall(dt: number): void {
    const b = this.ball;
    if (b.state === "held") {
      const c = this.carrier;
      if (c) b.pos = { x: c.pos.x + c.facing.x * 0.3, y: c.pos.y + c.facing.y * 0.3, z: 1.1 };
      return;
    }
    if (b.state !== "air") return;
    const sub = 3;
    const h = dt / sub;
    for (let i = 0; i < sub; i++) {
      b.pos = { x: b.pos.x + b.vel.x * h, y: b.pos.y + b.vel.y * h, z: b.pos.z + b.vel.z * h - (GRAVITY * h * h) / 2 };
      b.vel = { x: b.vel.x, y: b.vel.y, z: b.vel.z - GRAVITY * h };
      resolveBallContacts(this);
      if (b.state !== "air" || this.isDead()) return;
      if (b.pos.z <= 0) {
        b.pos.z = 0;
        this.incomplete("ground");
        return;
      }
      if (b.pos.y < -4 || b.pos.y > FIELD_WIDTH + 4 || b.pos.x > FIELD_LENGTH + 3 || b.pos.x < -3) {
        this.incomplete("outOfBounds");
        return;
      }
    }
  }

  /** Tipped or dropped ball: pops up with most of its speed gone. */
  popBall(strength: number): void {
    const b = this.ball;
    b.deflected = true;
    b.vel = {
      x: b.vel.x * 0.22 + this.rng.range(-1.6, 1.6) * strength,
      y: b.vel.y * 0.22 + this.rng.range(-1.6, 1.6) * strength,
      z: this.rng.range(1.6, 3.6) * strength,
    };
    this.lastBallDist.clear();
  }

  caught(p: SimPlayer, contested: boolean, diving: boolean): void {
    const b = this.ball;
    const inBounds = p.pos.y >= 0 && p.pos.y <= FIELD_WIDTH && p.pos.x <= FIELD_LENGTH;
    if (!inBounds) {
      this.emit({ kind: "catch", playerId: p.id, contested, diving });
      this.incomplete("outOfBounds");
      return;
    }
    b.state = "held";
    b.carrierId = p.id;
    b.possession = "offense";
    this.receiverId = p.id;
    this.catchX = p.pos.x;
    this.phase = "live";
    this.controlledId = p.id;
    p.mode = "carrier";
    // Securing the ball costs a step (more if he had to fight for it).
    if (diving) p.stun = 0.55;
    else p.slowTimer = Math.max(p.slowTimer, contested ? 0.5 : 0.32);
    this.emit({ kind: "catch", playerId: p.id, contested, diving });
    for (const o of this.offense) {
      if (o === p) continue;
      if (o.mode === "engaged" || o.engagedWith) continue;
      if (o.eligible || o.slot === "OL1" || o.slot === "OL2") o.mode = "convoy";
    }
    for (const d of this.defense) if (!d.engagedWith) d.mode = "pursuit";
    if (p.pos.x >= OPP_GOAL_X) this.touchdown("offense");
  }

  intercepted(p: SimPlayer): void {
    const b = this.ball;
    this.interceptorId = p.id;
    this.emit({ kind: "interception", playerId: p.id });
    if (this.cfg.isTry) {
      b.state = "dead";
      this.finish("interception", this.cfg.losX, this.cfg.ballY);
      return;
    }
    b.state = "held";
    b.carrierId = p.id;
    b.possession = "defense";
    this.phase = "live";
    p.mode = "carrier";
    // Interception in (or near the back of) the end zone: take a knee for a touchback.
    if (p.pos.x >= OPP_GOAL_X) {
      this.emit({ kind: "touchback" });
      this.finish("interceptionTouchback", p.pos.x, p.pos.y);
      return;
    }
    // Change of possession: every block breaks off and everyone swaps roles.
    for (const pl of this.players) pl.engagedWith = null;
    this.engagements = [];
    for (const d of this.defense) if (d !== p) d.mode = "convoy";
    for (const o of this.offense) o.mode = "pursuit";
    // User takes over the closest teammate to chase the returner.
    let best: SimPlayer | null = null;
    let bd = Infinity;
    for (const o of this.offense) {
      if (o.down || o.stun > 0) continue;
      const d = dist2(o.pos, p.pos);
      if (d < bd) { bd = d; best = o; }
    }
    this.controlledId = best?.id ?? null;
  }

  private incomplete(reason: "ground" | "outOfBounds"): void {
    this.ball.state = "dead";
    this.ball.vel = { x: 0, y: 0, z: 0 };
    this.emit({ kind: "incomplete", reason });
    this.finish("incomplete", this.cfg.losX, this.cfg.ballY);
  }

  // ---------------------------------------------------------------- carrier & scoring

  private checkCarrier(): void {
    const c = this.carrier;
    if (!c) return;
    if (c.side === "offense") {
      if (c.id === this.qb.id && !this.qbCrossedLos && !this.passThrown && c.pos.x > this.cfg.losX + 0.3) {
        this.qbCrossedLos = true;
        this.scrambleAt = this.time;
        c.mode = "carrier";
      }
      const inBounds = c.pos.y >= 0 && c.pos.y <= FIELD_WIDTH;
      if (inBounds && c.pos.x >= OPP_GOAL_X) {
        this.touchdown("offense");
        return;
      }
      if (!inBounds) {
        this.emit({ kind: "outOfBounds", playerId: c.id });
        this.endPlayAtCarrier(c, true);
      }
    } else {
      const inBounds = c.pos.y >= 0 && c.pos.y <= FIELD_WIDTH;
      if (inBounds && c.pos.x <= OWN_GOAL_X) {
        this.touchdown("defense");
        return;
      }
      if (!inBounds) {
        this.emit({ kind: "outOfBounds", playerId: c.id });
        this.endPlayAtCarrier(c, true);
      }
    }
  }

  private touchdown(side: "offense" | "defense"): void {
    const c = this.carrier;
    this.emit({ kind: "touchdown", side });
    if (side === "offense") this.finish("touchdown", OPP_GOAL_X, c?.pos.y ?? this.cfg.ballY);
    else this.finish("pickSix", OWN_GOAL_X, c?.pos.y ?? this.cfg.ballY);
  }

  /** Called by the tackle model. */
  tackled(c: SimPlayer, by: SimPlayer): void {
    const sack = c.id === this.qb.id && !this.qbCrossedLos && !this.passThrown;
    this.emit({ kind: "tackle", tacklerId: by.id, carrierId: c.id, sack });
    by.down = true;
    this.endPlayAtCarrier(c);
  }

  private endPlayAtCarrier(c: SimPlayer, outOfBounds = false): void {
    c.down = !outOfBounds;
    const dir = c.side === "offense" ? 1 : -1;
    // Forward progress: the ball is spotted where the carrier's momentum took it.
    const fall = outOfBounds ? 0 : clamp(c.vel.x * dir * 0.08, -0.2, 0.8) * dir;
    const x = c.pos.x + fall;
    const y = clamp(c.pos.y, 0, FIELD_WIDTH);
    if (c.side === "offense") {
      if (x <= OWN_GOAL_X) {
        this.emit({ kind: "safety" });
        this.finish("safety", OWN_GOAL_X, y);
        return;
      }
      const sack = c.id === this.qb.id && !this.qbCrossedLos && !this.passThrown;
      this.finish(sack ? "sack" : outOfBounds ? "outOfBounds" : "tackle", Math.min(x, OPP_GOAL_X - 0.5), y);
    } else {
      if (x >= OPP_GOAL_X) {
        this.emit({ kind: "touchback" });
        this.finish("interceptionTouchback", x, y);
        return;
      }
      this.finish("interception", Math.max(x, OWN_GOAL_X + 0.5), y);
    }
  }

  // ---------------------------------------------------------------- AI support

  /** Pass protection assignment for a blocker: sticky, re-picked when the man is gone. */
  blockTargetFor(b: SimPlayer): SimPlayer | null {
    const cur = this.blockAssign.get(b.id);
    const curP = cur ? this.get(cur) : undefined;
    if (curP && !curP.down && (curP.engagedWith === null || curP.engagedWith === b.id) && this.isThreatToQb(curP)) return curP;
    // Pick the most dangerous unblocked rusher not already assigned to another blocker.
    const taken = new Set<string>();
    for (const [k, v] of this.blockAssign) if (k !== b.id) taken.add(v);
    let best: SimPlayer | null = null;
    let score = Infinity;
    for (const d of this.defense) {
      if (d.down || d.engagedWith || !this.isThreatToQb(d) || taken.has(d.id)) continue;
      // Linemen block the man in front of them; backs look for the blitzer.
      const s = dist2(d.pos, b.pos) + dist2(d.pos, this.qb.pos) * 0.5;
      if (s < score) { score = s; best = d; }
    }
    if (best) this.blockAssign.set(b.id, best.id);
    else this.blockAssign.delete(b.id);
    return best;
  }

  private isThreatToQb(d: SimPlayer): boolean {
    return d.mode === "rush" || (d.mode === "engaged" && this.rusherIds.has(d.id)) || (this.rusherIds.has(d.id) && d.mode === "pursuit");
  }

  /** Lead-block assignment: the closest pursuer heading for the carrier. */
  convoyTargetFor(b: SimPlayer): SimPlayer | null {
    const c = this.carrier;
    if (!c) return null;
    const cur = this.convoyAssign.get(b.id);
    const curP = cur ? this.get(cur) : undefined;
    if (curP && !curP.down && (!curP.engagedWith || curP.engagedWith === b.id) && dist2(curP.pos, c.pos) < 12) return curP;
    const foes = c.side === "offense" ? this.defense : this.offense;
    const taken = new Set<string>();
    for (const [k, v] of this.convoyAssign) if (k !== b.id) taken.add(v);
    let best: SimPlayer | null = null;
    let score = Infinity;
    for (const f of foes) {
      if (f.down || f.engagedWith || taken.has(f.id)) continue;
      const toCarrier = dist2(f.pos, c.pos);
      if (toCarrier > 12) continue;
      const s = dist2(f.pos, b.pos) + toCarrier * 0.6;
      if (s < score && dist2(f.pos, b.pos) < 8) { score = s; best = f; }
    }
    if (best) this.convoyAssign.set(b.id, best.id);
    else this.convoyAssign.delete(b.id);
    return best;
  }

  /** Called when a defender sheds a block. */
  afterShed(blocker: SimPlayer, defender: SimPlayer): void {
    const runner = this.carrier;
    const qbHasBall = runner?.id === this.qb.id && !this.qbCrossedLos;
    // The player who got free goes after the ball; the beaten blocker resets.
    if (this.ball.state === "air") defender.mode = "attackBall";
    else if (qbHasBall) defender.mode = this.rusherIds.has(defender.id) ? "rush" : "pursuit";
    else defender.mode = "pursuit";
    blocker.mode = qbHasBall && blocker.side === "offense" ? "passBlock" : "convoy";
    this.blockAssign.delete(blocker.id);
    this.convoyAssign.delete(blocker.id);
  }

  private updateFacingAndHistory(): void {
    const qb = this.qb;
    for (const p of this.players) {
      p.velHistory.unshift({ x: p.vel.x, y: p.vel.y });
      if (p.velHistory.length > HISTORY) p.velHistory.pop();
      const speed = len2(p.vel);
      if (p.id === qb.id && this.ball.carrierId === qb.id && !this.qbCrossedLos) {
        // Eyes downfield in the pocket.
        faceToward(p, speed > 2 ? add2(norm2(p.vel), v2(1.2, 0)) : v2(1, 0), 0.2);
      } else if (p.mode === "zone" || p.mode === "rush" && speed < 1) {
        faceToward(p, sub2(qb.pos, p.pos), 0.15);
      } else if (p.mode === "man" && p.manTargetId) {
        const r = this.get(p.manTargetId);
        if (r) faceToward(p, speed > 2 ? p.vel : sub2(r.pos, p.pos), 0.2);
      } else if (p.mode === "settled") {
        faceToward(p, sub2(qb.pos, p.pos), 0.2);
      } else if (speed > 0.6) {
        faceToward(p, p.vel, 0.3);
      }
      p.goal = { x: p.pos.x + p.vel.x * 0.3, y: p.pos.y + p.vel.y * 0.3 };
    }
  }

  // ---------------------------------------------------------------- outcome

  private finish(kind: OutcomeKind, spotX: number, spotY: number): void {
    if (this.isDead()) return;
    this.phase = "deadBall";
    this.deadTimer = DEAD_BALL_TIME;
    this.pendingThrow = null;
    this.controlledId = null;
    for (const p of this.players) {
      p.engagedWith = null;
      if (p.mode !== "carrier") p.mode = "idle";
    }
    this.engagements = [];
    if (this.ball.state === "held") this.ball.state = "dead";
    this.emit({ kind: "whistle" });
    const yards = kind === "incomplete" || kind.startsWith("interception") || kind === "pickSix" ? 0 : spotX - this.cfg.losX;
    const completion = this.receiverId !== null;
    const outcome: PlayOutcome = {
      kind, spotX, spotY, yards,
      elapsed: this.liveTime,
      clockStops: kind !== "tackle" && kind !== "sack",
      passAttempt: this.passThrown,
      completion,
      receiverId: this.receiverId,
      airYards: completion ? (this.catchX ?? spotX) - this.cfg.losX : this.passThrown ? this.airYards : 0,
      yardsAfterCatch: completion && this.catchX !== null ? spotX - this.catchX : 0,
      qbScramble: this.qbCrossedLos,
      text: "",
    };
    outcome.text = this.describe(outcome);
    this.outcome = outcome;
  }

  private label(id: string | null): string {
    const p = id ? this.get(id) : undefined;
    if (!p) return "";
    const last = p.profile.name.split(" ").slice(-1)[0];
    return `#${p.profile.number} ${last}`;
  }

  private describe(o: PlayOutcome): string {
    const gain = Math.round(o.yards);
    const y = (n: number) => (n === 0 ? "no gain" : n > 0 ? `${n} yd${n === 1 ? "" : "s"}` : `loss of ${-n}`);
    const target = this.ball.throwInfo ? this.label(this.ball.throwInfo.targetId) : "";
    switch (o.kind) {
      case "incomplete": return `Incomplete, intended for ${target}`;
      case "sack": return `Sacked for ${y(gain)}`;
      case "touchdown": return o.completion ? `Touchdown! ${this.label(o.receiverId)} scores` : `Touchdown! ${this.label(this.qb.id)} runs it in`;
      case "pickSix": return `Intercepted by ${this.label(this.interceptorId)} and returned for a TD`;
      case "interception": return `Intercepted by ${this.label(this.interceptorId)}`;
      case "interceptionTouchback": return `Intercepted in the end zone by ${this.label(this.interceptorId)}`;
      case "safety": return "Safety! Tackled in the end zone";
      case "outOfBounds":
      case "tackle": {
        const how = o.kind === "outOfBounds" ? ", out of bounds" : "";
        if (o.completion) return `Complete to ${this.label(o.receiverId)}, ${y(gain)}${how}`;
        return `${this.label(this.qb.id)} scrambles, ${y(gain)}${how}`;
      }
    }
  }
}
