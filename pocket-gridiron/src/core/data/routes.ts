/**
 * Route library. A route is a list of waypoints relative to the receiver's alignment:
 *   d = depth from the line of scrimmage in yards (positive = downfield)
 *   w = lateral yards from the alignment, positive = toward the receiver's own sideline ("outside")
 * The play is mirrored automatically for receivers on the other side of the ball.
 *
 * end:
 *   "continue" — keep running in the direction of the last leg (go, post, crossers, outs)
 *   "settle"   — stop, face the QB and work away from the nearest defender (curl, hitch, sit)
 */
export interface RoutePoint {
  d: number;
  w: number;
  /** Fraction of top speed on the leg leading to this point (default 1). Used to "sell" a stem. */
  pace?: number;
}

export interface RouteDef {
  name: string;
  points: RoutePoint[];
  end: "continue" | "settle";
}

export type RouteId =
  | "go" | "seam" | "slant" | "quickOut" | "out" | "dig" | "curl" | "hitch" | "corner" | "post"
  | "flat" | "arrow" | "shallow" | "drag" | "cross" | "stick" | "sit" | "wheel" | "swing" | "checkdown"
  | "angle" | "comeback" | "sail" | "block";

export const ROUTES: Record<RouteId, RouteDef> = {
  go: { name: "GO", end: "continue", points: [{ d: 4, w: 0.8 }, { d: 50, w: 1.4 }] },
  seam: { name: "SEAM", end: "continue", points: [{ d: 4, w: 0 }, { d: 50, w: -0.6 }] },
  slant: { name: "SLANT", end: "continue", points: [{ d: 2.5, w: 0 }, { d: 8, w: -6 }] },
  quickOut: { name: "QUICK OUT", end: "continue", points: [{ d: 5, w: 0 }, { d: 4.5, w: 6 }] },
  out: { name: "OUT", end: "continue", points: [{ d: 10, w: 0, pace: 0.95 }, { d: 9.5, w: 7 }] },
  dig: { name: "DIG", end: "continue", points: [{ d: 12, w: 0, pace: 0.95 }, { d: 12.5, w: -14 }] },
  curl: { name: "CURL", end: "settle", points: [{ d: 12, w: 0 }, { d: 10.5, w: -1.2 }] },
  hitch: { name: "HITCH", end: "settle", points: [{ d: 6, w: 0 }, { d: 5, w: -0.3 }] },
  corner: { name: "CORNER", end: "continue", points: [{ d: 10, w: 0, pace: 0.95 }, { d: 21, w: 9 }] },
  post: { name: "POST", end: "continue", points: [{ d: 12, w: 0, pace: 0.95 }, { d: 30, w: -10 }] },
  flat: { name: "FLAT", end: "continue", points: [{ d: 1, w: 2.5 }, { d: 3, w: 9 }] },
  arrow: { name: "ARROW", end: "continue", points: [{ d: 2, w: 2 }, { d: 5.5, w: 10 }] },
  shallow: { name: "SHALLOW", end: "continue", points: [{ d: 2, w: -2 }, { d: 3.5, w: -18 }] },
  drag: { name: "DRAG", end: "continue", points: [{ d: 3, w: -2 }, { d: 5.5, w: -18 }] },
  cross: { name: "CROSS", end: "continue", points: [{ d: 8, w: -1 }, { d: 15, w: -18 }] },
  stick: { name: "STICK", end: "settle", points: [{ d: 6, w: 0 }, { d: 6, w: 1.2 }] },
  sit: { name: "SIT", end: "settle", points: [{ d: 9, w: 0 }, { d: 9, w: -0.8 }] },
  wheel: { name: "WHEEL", end: "continue", points: [{ d: 1, w: 3 }, { d: 5, w: 6 }, { d: 45, w: 6.5 }] },
  swing: { name: "SWING", end: "continue", points: [{ d: -1, w: 4 }, { d: 1.5, w: 10 }] },
  checkdown: { name: "CHECK", end: "settle", points: [{ d: 1.5, w: -1 }, { d: 4, w: -2 }] },
  angle: { name: "ANGLE", end: "continue", points: [{ d: 1, w: 3 }, { d: 5, w: -3 }] },
  comeback: { name: "COMEBACK", end: "settle", points: [{ d: 15, w: 0 }, { d: 13, w: 2.5 }] },
  sail: { name: "SAIL", end: "continue", points: [{ d: 6, w: -0.5 }, { d: 13, w: 8 }] },
  /** Pass protection: stays home to pick up a blitzer, then leaks out to a checkdown. */
  block: { name: "PROTECT", end: "settle", points: [{ d: 2, w: -1 }, { d: 4, w: -2 }] },
};
