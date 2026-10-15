import type { Ratings } from "../data/types";
import type { Rng } from "../math/rng";
import { clamp01, dist2, dot2, len2, norm2, type Vec2 } from "../math/vec";
import { desiredHorizontalSpeed, solveLaunch } from "./ballistics";
import { steer } from "./movement";
import { baseThrowError, CATCH_HEIGHT, RELEASE_HEIGHT } from "./physique";
import { followRoute } from "./routeFollow";
import type { PassType, SimPlayer } from "./types";

const PREDICT_DT = 1 / 30;

/**
 * Predicts where a receiver will be over the next `horizon` seconds if he keeps running his
 * route. Uses the same steering model as the live sim, so passes thrown before the break land
 * where the receiver is going, not where he is.
 */
export function predictPath(p: SimPlayer, horizon = 4): Vec2[] {
  const ghost: SimPlayer = {
    ...p,
    pos: { ...p.pos },
    vel: { ...p.vel },
    route: p.route ? { ...p.route } : undefined,
    velHistory: [],
  };
  const out: Vec2[] = [{ ...ghost.pos }];
  const steps = Math.ceil(horizon / PREDICT_DT);
  for (let i = 0; i < steps; i++) {
    const moving = ghost.mode === "route" || ghost.mode === "trackBall" || ghost.mode === "carrier";
    const desired = moving && ghost.route ? followRoute(ghost).desired : { x: 0, y: 0 };
    steer(ghost, desired, PREDICT_DT);
    ghost.slowTimer = Math.max(0, ghost.slowTimer - PREDICT_DT);
    ghost.pos = { x: ghost.pos.x + ghost.vel.x * PREDICT_DT, y: ghost.pos.y + ghost.vel.y * PREDICT_DT };
    out.push({ ...ghost.pos });
  }
  return out;
}

function sample(path: Vec2[], t: number): Vec2 {
  const f = t / PREDICT_DT;
  const i = Math.floor(f);
  if (i >= path.length - 1) return path[path.length - 1];
  if (i < 0) return path[0];
  const k = f - i;
  return { x: path[i].x + (path[i + 1].x - path[i].x) * k, y: path[i].y + (path[i + 1].y - path[i].y) * k };
}

/**
 * Finds the spot where ball and receiver meet: iterate flight time ↔ receiver position.
 * `delay` is time until release (wind-up).
 */
export function leadTarget(from: Vec2, passer: Ratings, receiver: SimPlayer, type: PassType, delay = 0): { point: Vec2; flightTime: number } {
  const path = predictPath(receiver, 4.5);
  let T = dist2(from, receiver.pos) / desiredHorizontalSpeed(passer, type, dist2(from, receiver.pos));
  let point = sample(path, delay + T);
  for (let i = 0; i < 8; i++) {
    const sol = solveLaunch({ x: from.x, y: from.y, z: RELEASE_HEIGHT }, { x: point.x, y: point.y, z: CATCH_HEIGHT }, passer, type);
    const next = sample(path, delay + sol.flightTime);
    T = sol.flightTime;
    if (dist2(next, point) < 0.05) {
      point = next;
      break;
    }
    point = next;
  }
  return { point, flightTime: T };
}

export interface ErrorContext {
  passer: Ratings;
  /** QB velocity at release. */
  qbVel: Vec2;
  qbMaxSpeed: number;
  /** 0..1, how close the nearest free rusher is. */
  pressure: number;
  type: PassType;
}

/** Standard deviation (yards) of the throw's landing error. */
export function throwSigma(from: Vec2, to: Vec2, ctx: ErrorContext): number {
  const distance = dist2(from, to);
  const base = baseThrowError(ctx.passer);
  const distMul = 0.35 + (distance / 20) * 0.65;
  const speedFrac = clamp01(len2(ctx.qbVel) / Math.max(1, ctx.qbMaxSpeed));
  const throwDir = norm2({ x: to.x - from.x, y: to.y - from.y });
  // 0 = throwing where you're running, 1 = across your body, 2 = backward.
  const crossBody = speedFrac > 0.05 ? 1 - dot2(norm2(ctx.qbVel), throwDir) : 0;
  const movingMul = 1 + speedFrac * (0.45 + 0.55 * crossBody);
  const pressureMul = 1 + 0.9 * clamp01(ctx.pressure);
  const typeMul = ctx.type === "bullet" ? 1 : ctx.type === "touch" ? 1.05 : 1.2;
  return base * distMul * movingMul * pressureMul * typeMul;
}

/** Random landing offset: longer along the throw line (over/under-thrown) than side to side. */
export function throwError(from: Vec2, to: Vec2, ctx: ErrorContext, rng: Rng): Vec2 {
  const sigma = throwSigma(from, to, ctx);
  const dir = norm2({ x: to.x - from.x, y: to.y - from.y });
  const along = rng.gauss() * sigma * 1.15;
  const cross = rng.gauss() * sigma * 0.75;
  return { x: dir.x * along - dir.y * cross, y: dir.y * along + dir.x * cross };
}
