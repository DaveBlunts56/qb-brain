import type { RouteId } from "./routes";
import type { SkillSlot } from "./types";

/**
 * Formations place the QB, two linemen and four eligible receivers relative to the ball.
 *   dx = yards behind (-) or on (0) the line of scrimmage
 *   dy = yards from the ball across the field (negative = toward the top sideline / QB's left)
 */
export interface Alignment {
  dx: number;
  dy: number;
}

export interface Formation {
  id: string;
  name: string;
  qb: Alignment;
  skill: Partial<Record<SkillSlot, Alignment>>;
}

export const FORMATIONS: Record<string, Formation> = {
  spread: {
    id: "spread", name: "GUN SPREAD",
    qb: { dx: -5, dy: 0 },
    skill: { X: { dx: -0.4, dy: -17 }, H: { dx: -1.2, dy: -9 }, Y: { dx: -1.2, dy: 9 }, Z: { dx: -0.4, dy: 17 } },
  },
  trips: {
    id: "trips", name: "GUN TRIPS RT",
    qb: { dx: -5, dy: 0 },
    skill: { X: { dx: -0.4, dy: -17 }, Y: { dx: -1.2, dy: 6 }, H: { dx: -1.2, dy: 11 }, Z: { dx: -0.4, dy: 18 } },
  },
  ace: {
    id: "ace", name: "GUN ACE",
    qb: { dx: -5, dy: 0 },
    skill: { X: { dx: -0.4, dy: -17 }, H: { dx: -1.2, dy: -9 }, Z: { dx: -0.4, dy: 17 }, RB: { dx: -5, dy: 1.6 } },
  },
  bunch: {
    id: "bunch", name: "GUN BUNCH RT",
    qb: { dx: -5, dy: 0 },
    skill: { X: { dx: -0.4, dy: -17 }, Y: { dx: -0.4, dy: 7 }, H: { dx: -1.6, dy: 8.2 }, Z: { dx: -1.6, dy: 5.8 } },
  },
};

export interface Play {
  id: string;
  name: string;
  formation: string;
  routes: Partial<Record<SkillSlot, RouteId>>;
  /** Progression hint shown on the play card, in order. */
  reads: SkillSlot[];
  tip: string;
}

export const PLAYBOOK: readonly Play[] = [
  {
    id: "four-verts", name: "FOUR VERTS", formation: "spread",
    routes: { X: "go", H: "seam", Y: "seam", Z: "go" }, reads: ["H", "Y", "X", "Z"],
    tip: "Stretch the deep zones. Seams split two-high safeties; hit the go ball against press man.",
  },
  {
    id: "mesh", name: "MESH", formation: "spread",
    routes: { X: "corner", H: "shallow", Y: "drag", Z: "sit" }, reads: ["H", "Y", "Z", "X"],
    tip: "Two crossers rub off each other. Great against man: hit the crosser who comes free.",
  },
  {
    id: "smash", name: "SMASH", formation: "spread",
    routes: { X: "hitch", H: "corner", Y: "corner", Z: "hitch" }, reads: ["H", "X", "Y", "Z"],
    tip: "High-low the corner. If the flat defender sinks, take the hitch; if he squats, throw the corner.",
  },
  {
    id: "slant-flat", name: "SLANT FLAT", formation: "spread",
    routes: { X: "slant", H: "flat", Y: "flat", Z: "slant" }, reads: ["X", "H", "Z", "Y"],
    tip: "Quick game. Get it out fast against the blitz; slants beat soft zone and off coverage.",
  },
  {
    id: "flood", name: "FLOOD", formation: "trips",
    routes: { Z: "go", H: "sail", Y: "arrow", X: "dig" }, reads: ["H", "Y", "X", "Z"],
    tip: "Three levels to one side. Beats Cover 3: the flat defender can't cover both sail and arrow.",
  },
  {
    id: "drive", name: "DRIVE", formation: "trips",
    routes: { Y: "shallow", H: "dig", Z: "go", X: "post" }, reads: ["Y", "H", "X", "Z"],
    tip: "Shallow under, dig over the linebacker. Read the hook defender.",
  },
  {
    id: "curl-flat", name: "CURL FLAT", formation: "ace",
    routes: { X: "curl", H: "flat", Z: "curl", RB: "checkdown" }, reads: ["X", "H", "Z", "RB"],
    tip: "Classic Cover 2 beater. Curl sits behind the flat corner; the back is your outlet.",
  },
  {
    id: "post-wheel", name: "POST WHEEL", formation: "ace",
    routes: { X: "post", H: "wheel", Z: "comeback", RB: "block" }, reads: ["H", "X", "Z", "RB"],
    tip: "Shot play. The back stays in to protect; the wheel runs away from man coverage.",
  },
  {
    id: "stick", name: "BUNCH STICK", formation: "bunch",
    routes: { Y: "stick", H: "corner", Z: "flat", X: "slant" }, reads: ["Y", "Z", "H", "X"],
    tip: "Bunch releases cause traffic for man defenders. Stick sits in the hole between zones.",
  },
];

export function getPlay(id: string): Play {
  return PLAYBOOK.find((p) => p.id === id) ?? PLAYBOOK[0];
}
