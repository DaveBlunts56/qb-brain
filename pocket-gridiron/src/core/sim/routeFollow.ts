import { FIELD_WIDTH } from "../field";
import { dist2, scale2, type Vec2 } from "../math/vec";
import { currentTopSpeed, seek } from "./movement";
import type { SimPlayer } from "./types";

export interface RouteStep {
  desired: Vec2;
  settled: boolean;
}

/**
 * Desired velocity for a receiver running his route. Advances the waypoint index as he passes
 * each break. Pure with respect to everything except p.route.index, so it can drive predictions.
 */
export function followRoute(p: SimPlayer): RouteStep {
  const rs = p.route;
  if (!rs) return { desired: { x: 0, y: 0 }, settled: true };
  while (rs.index < rs.points.length) {
    const wp = rs.points[rs.index];
    const last = rs.index === rs.points.length - 1;
    const reach = last && rs.def.end === "settle" ? 0.45 : 0.8;
    if (dist2(p.pos, wp) < reach) {
      rs.index++;
      continue;
    }
    const pace = rs.def.points[rs.index].pace ?? 1;
    // Settle routes throttle down into the final spot; everything else runs through the break.
    return { desired: seek(p, wp, pace, last && rs.def.end === "settle" ? 1.6 : 0), settled: false };
  }
  if (rs.def.end === "continue") {
    let dir = rs.exitDir;
    // Don't run out of bounds: bend upfield along the sideline early enough to kill lateral momentum.
    const brake = (p.vel.y * p.vel.y) / (2 * p.accel) + 1.8;
    if ((dir.y < 0 && p.pos.y < brake) || (dir.y > 0 && p.pos.y > FIELD_WIDTH - brake)) dir = { x: 1, y: 0 };
    // Don't run out the back of the end zone.
    if (p.pos.x > 116.5 && dir.x > 0) return { desired: { x: 0, y: dir.y * currentTopSpeed(p) * 0.5 }, settled: false };
    return { desired: scale2(dir, currentTopSpeed(p)), settled: false };
  }
  return { desired: { x: 0, y: 0 }, settled: true };
}
