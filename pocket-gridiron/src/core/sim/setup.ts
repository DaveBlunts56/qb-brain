import { DEFENSE_CALLS, zoneSpec, type DefenseCall, type ZoneId } from "../data/defense";
import { FORMATIONS, type Play } from "../data/playbook";
import { ROUTES } from "../data/routes";
import type { DefSlot, OffSlot, PlayerProfile, SkillSlot, Team } from "../data/types";
import { FIELD_WIDTH } from "../field";
import { clamp, norm2, sub2, v2, type Vec2 } from "../math/vec";
import { acceleration, massFor, topSpeed } from "./physique";
import type { RouteState, SimConfig, SimPlayer, TeamSide } from "./types";

function makePlayer(profile: PlayerProfile, side: TeamSide, slot: OffSlot | DefSlot, pos: Vec2): SimPlayer {
  const facing = side === "offense" ? v2(1, 0) : v2(-1, 0);
  return {
    id: `${side === "offense" ? "O" : "D"}-${slot}`,
    side, slot, profile, r: profile.ratings,
    pos, vel: v2(), facing,
    maxSpeed: topSpeed(profile.ratings), accel: acceleration(profile.ratings), mass: massFor(profile.position),
    eligible: false, mode: "idle", marker: -1,
    reactTimer: 0, reacted: false, engagedWith: null, stun: 0, tackleCooldown: 0, down: false,
    jukeTimer: 0, jukeCooldown: 0, jukeDir: v2(), diveTimer: 0, slowTimer: 0,
    velHistory: [], goal: { x: pos.x, y: pos.y },
  };
}

/** Builds absolute route waypoints for a receiver aligned at `align`. */
export function buildRoute(routeId: keyof typeof ROUTES, align: Vec2, losX: number, ballY: number): RouteState {
  const def = ROUTES[routeId];
  // Receivers above the ball (smaller y) treat -y as "outside". Backs aligned on the ball use their offset side.
  const outsideSign = align.y < ballY - 0.1 ? -1 : 1;
  const points = def.points.map((p) => ({
    x: losX + p.d,
    y: clamp(align.y + p.w * outsideSign, 2.5, FIELD_WIDTH - 2.5),
  }));
  const last = points[points.length - 1];
  const prev = points.length > 1 ? points[points.length - 2] : align;
  const exitDir = norm2(sub2(last, prev));
  return { def, points, index: 0, exitDir, outsideSign, protectUntil: routeId === "block" ? 1.1 : undefined };
}

export interface Lineup {
  offense: SimPlayer[];
  defense: SimPlayer[];
  call: DefenseCall;
}

/**
 * Lines up both teams for a play.
 * flipped mirrors the formation across the ball (trips right becomes trips left).
 */
export function lineUp(off: Team, def: Team, play: Play, flipped: boolean, cfg: SimConfig): Lineup {
  const form = FORMATIONS[play.formation];
  const los = cfg.losX;
  const by = cfg.ballY;
  const m = flipped ? -1 : 1;
  const offense: SimPlayer[] = [];

  const qb = makePlayer(off.offense.QB, "offense", "QB", v2(los + form.qb.dx, by + form.qb.dy * m));
  qb.mode = "idle";
  offense.push(qb);
  offense.push(makePlayer(off.offense.OL1, "offense", "OL1", v2(los - 0.6, by - 1.1)));
  offense.push(makePlayer(off.offense.OL2, "offense", "OL2", v2(los - 0.6, by + 1.1)));

  const skills = (Object.keys(form.skill) as SkillSlot[]).map((slot) => {
    const a = form.skill[slot]!;
    const pos = v2(los + a.dx, clamp(by + a.dy * m, 1.5, FIELD_WIDTH - 1.5));
    const p = makePlayer(off.offense[slot], "offense", slot, pos);
    p.eligible = true;
    const routeId = play.routes[slot] ?? "checkdown";
    p.route = buildRoute(routeId, pos, los, by);
    return p;
  });
  // Markers follow the receivers top-to-bottom so the on-screen buttons match the field.
  [...skills].sort((a, b) => a.pos.y - b.pos.y).forEach((p, i) => (p.marker = i));
  offense.push(...skills);

  const call = DEFENSE_CALLS[cfg.coverage];
  const defense = alignDefense(def, call, skills, cfg);
  return { offense, defense, call };
}

/** Receivers numbered outside-in on each side of the ball. */
function numberReceivers(skills: SimPlayer[], ballY: number) {
  const left = skills.filter((p) => p.pos.y < ballY - 0.1 && p.slot !== "RB").sort((a, b) => a.pos.y - b.pos.y);
  const right = skills.filter((p) => p.pos.y >= ballY - 0.1 && p.slot !== "RB").sort((a, b) => b.pos.y - a.pos.y);
  const backs = skills.filter((p) => p.slot === "RB");
  return { left, right, backs };
}

function alignDefense(def: Team, call: DefenseCall, skills: SimPlayer[], cfg: SimConfig): SimPlayer[] {
  const los = cfg.losX;
  const by = cfg.ballY;
  const { left, right, backs } = numberReceivers(skills, by);
  const strongRight = right.length >= left.length;
  const P = (slot: DefSlot, x: number, y: number) =>
    makePlayer(def.defense[slot], "defense", slot, v2(los + x, clamp(y, 1.0, FIELD_WIDTH - 1.0)));

  // --- Man matchups (used by any defender with a man assignment) ---
  const man: Partial<Record<DefSlot, SimPlayer>> = {};
  const pool = [...skills];
  const take = (p: SimPlayer | undefined) => {
    if (!p) return undefined;
    const i = pool.indexOf(p);
    if (i >= 0) pool.splice(i, 1);
    return p;
  };
  man.CB1 = take(left[0] ?? right[right.length - 1]);
  man.CB2 = take(right[0] ?? left[left.length - 1]);
  const strong = strongRight ? right : left;
  const weak = strongRight ? left : right;
  man.SS = take(strong.find((p) => pool.includes(p)) ?? weak.find((p) => pool.includes(p)) ?? backs.find((p) => pool.includes(p)));
  const lbOrFs: DefSlot = call.assignments.LB.kind === "man" ? "LB" : "FS";
  man[lbOrFs] = take(pool[0]);

  // Strong-side rotation: mirror L/R zone landmarks for the underneath players when the strength is left.
  const mirrorZone = (z: ZoneId): ZoneId => {
    if (strongRight) return z;
    const swap: Partial<Record<ZoneId, ZoneId>> = { curlFlatL: "curlFlatR", curlFlatR: "curlFlatL" };
    return swap[z] ?? z;
  };

  const out: SimPlayer[] = [];
  for (const slot of ["DL1", "DL2", "LB", "CB1", "CB2", "SS", "FS"] as DefSlot[]) {
    const a = call.assignments[slot];
    let p: SimPlayer;
    if (slot === "DL1") p = P(slot, 0.9, by - 2.1);
    else if (slot === "DL2") p = P(slot, 0.9, by + 2.1);
    else if (a.kind === "rush") p = P(slot, 3.2, by + (strongRight ? 0.8 : -0.8)); // walked up blitzer
    else if (a.kind === "man") {
      const target = man[slot];
      if (target) {
        const inside = Math.sign(by - target.pos.y) || 1;
        const press = slot.startsWith("CB") && (call.id === "cover0" || call.id === "cover1");
        const depth = press ? 1.3 : slot === "LB" ? 4.5 : 5.5;
        p = P(slot, depth, target.pos.y + inside * (press ? 0.6 : 1.2));
        p.manTargetId = target.id;
      } else {
        p = P(slot, 6, by);
      }
      p.mode = "man";
    } else {
      const zid = mirrorZone(a.zone);
      const z = zoneSpec(zid, by);
      p = P(slot, 0, 0);
      p.zone = z;
      // Pre-snap alignment shows the shell; zone defenders then drop to their landmark after the snap.
      const pos = zoneAlignment(slot, z.id, call.id, left, right, by);
      p.pos = v2(los + pos.x, clamp(pos.y, 1.0, FIELD_WIDTH - 1.0));
      p.mode = "zone";
    }
    if (a.kind === "rush") p.mode = "rush";
    p.goal = { ...p.pos };
    out.push(p);
  }
  return out;
}

/** Where a zone defender stands before the snap (relative x from LOS, absolute y). */
function zoneAlignment(slot: DefSlot, zone: ZoneId, cov: string, left: SimPlayer[], right: SimPlayer[], by: number): Vec2 {
  const outerL = left[0]?.pos.y ?? by - 14;
  const outerR = right[0]?.pos.y ?? by + 14;
  switch (slot) {
    case "CB1": return v2(cov === "cover2" ? 5 : 7, outerL - (cov === "cover2" ? 1.5 : 1.0));
    case "CB2": return v2(cov === "cover2" ? 5 : 7, outerR + (cov === "cover2" ? 1.5 : 1.0));
    case "FS":
    case "SS": {
      if (zone.startsWith("deepHalf") || zone.startsWith("deepQtrM")) {
        const sideL = zone.endsWith("L") || zone === "deepQtrML";
        return v2(cov === "cover4" ? 10 : 12, by + (sideL ? -9 : 9));
      }
      if (zone === "deepThirdM") return v2(13, by);
      // rotated-down strong safety
      const y = zone.endsWith("R") ? (right[1]?.pos.y ?? by + 7) : (left[1]?.pos.y ?? by - 7);
      return v2(6.5, y + (zone.endsWith("R") ? 1 : -1));
    }
    case "LB":
    default:
      if (zone === "hook") return v2(5, by);
      return v2(5, zone.endsWith("L") ? by - 4 : by + 4);
  }
}
