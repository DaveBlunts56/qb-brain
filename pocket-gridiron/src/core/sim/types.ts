import type { CoverageId, ZoneSpec } from "../data/defense";
import type { RouteDef } from "../data/routes";
import type { DefSlot, OffSlot, PlayerProfile, Ratings } from "../data/types";
import type { Vec2, Vec3 } from "../math/vec";

/** Play phases (the play state machine). */
export type PlayPhase = "preSnap" | "live" | "passInAir" | "deadBall" | "result";

export type PassType = "bullet" | "touch" | "lob";
export type TeamSide = "offense" | "defense";

/** What a player is doing right now. Drives both AI and animation. */
export type PlayerMode =
  | "idle" // pre-snap stance / after the whistle
  | "qb" // quarterback holding the ball (user-controlled)
  | "throwing" // wind-up
  | "passBlock"
  | "route"
  | "settled" // route finished, sitting in a hole
  | "trackBall" // adjusting to a thrown ball
  | "carrier" // running with the ball
  | "rush"
  | "man"
  | "zone"
  | "attackBall" // defender breaking on a thrown ball
  | "pursuit"
  | "convoy" // offense blocking for a ball carrier
  | "engaged"; // locked in a block

export interface RouteState {
  def: RouteDef;
  /** Absolute waypoints computed at the snap. */
  points: Vec2[];
  index: number;
  /** Direction to keep running after the last waypoint ("continue" routes). */
  exitDir: Vec2;
  /** -1 for receivers on the top side (y below ball), +1 for bottom side. */
  outsideSign: number;
  /** Pass-protect assignment (RB "block" route): stays home until this time, then leaks out. */
  protectUntil?: number;
}

export interface SimPlayer {
  id: string;
  side: TeamSide;
  slot: OffSlot | DefSlot;
  profile: PlayerProfile;
  r: Ratings;
  pos: Vec2;
  vel: Vec2;
  /** Unit vector the player is looking along. */
  facing: Vec2;
  maxSpeed: number;
  accel: number;
  mass: number;
  eligible: boolean;
  mode: PlayerMode;
  /** Receiver marker index 0..3 (button / icon), -1 for none. */
  marker: number;
  route?: RouteState;
  manTargetId?: string;
  /** Depth cushion (yards) on the man at the snap. */
  manCushion?: number;
  zone?: ZoneSpec;
  /** Seconds until this player reacts to the thrown ball (counts down after release). */
  reactTimer: number;
  reacted: boolean;
  engagedWith: string | null;
  /** Can't act (missed tackle, shed block, getting up). */
  stun: number;
  tackleCooldown: number;
  down: boolean;
  /** Juke / dive state for ball carriers. */
  jukeTimer: number;
  jukeCooldown: number;
  jukeDir: Vec2;
  diveTimer: number;
  /** Slowed (jammed at the line, stumbling out of a broken tackle). */
  slowTimer: number;
  /** Recent velocities, newest first, sampled each tick (used for reaction delay in coverage). */
  velHistory: Vec2[];
  /** Where the player wants to go this tick (debug/animation). */
  goal: Vec2;
}

export interface ThrowInfo {
  throwerId: string;
  targetId: string;
  type: PassType;
  from: Vec2;
  /** Intended spot (after aim lead, before error). */
  aimPoint: Vec2;
  /** Where the ball will be at catch height (after error). */
  catchPoint: Vec2;
  /** Sim time when the ball reaches catch height. */
  catchTime: number;
  /** Where the descending ball first comes within reach (defenders undercut here). */
  highPoint: Vec2;
  highTime: number;
  releaseTime: number;
  airYards: number;
}

export interface BallState {
  state: "held" | "air" | "dead";
  carrierId: string | null;
  pos: Vec3;
  vel: Vec3;
  throwInfo: ThrowInfo | null;
  deflected: boolean;
  /** Players who already tried to catch the ball since the last touch. */
  attempted: string[];
  /** Ball was caught/carried by this side last. */
  possession: TeamSide;
}

export interface ControlInput {
  /** Joystick vector, magnitude 0..1, in field space (+x downfield, +y toward bottom sideline). */
  move: Vec2;
  commands: Command[];
}

export type Command =
  | { kind: "throw"; targetId: string; passType: PassType; aim: Vec2 }
  | { kind: "juke" }
  | { kind: "dive" };

export type SimEvent =
  | { kind: "snap" }
  | { kind: "windup"; passType: PassType }
  | { kind: "throw"; passType: PassType; targetId: string }
  | { kind: "catch"; playerId: string; contested: boolean; diving: boolean }
  | { kind: "drop"; playerId: string }
  | { kind: "deflect"; playerId: string }
  | { kind: "interception"; playerId: string }
  | { kind: "incomplete"; reason: "ground" | "outOfBounds" }
  | { kind: "tackle"; tacklerId: string; carrierId: string; sack: boolean }
  | { kind: "missedTackle"; tacklerId: string; carrierId: string }
  | { kind: "juke"; playerId: string }
  | { kind: "shed"; playerId: string }
  | { kind: "outOfBounds"; playerId: string }
  | { kind: "touchdown"; side: TeamSide }
  | { kind: "safety" }
  | { kind: "touchback" }
  | { kind: "whistle" };

export type OutcomeKind =
  | "tackle" // ball carrier down in the field of play
  | "outOfBounds"
  | "incomplete"
  | "sack"
  | "touchdown" // offense scores
  | "interception" // returned and downed / out of bounds
  | "pickSix" // interception returned for a touchdown
  | "interceptionTouchback"
  | "safety";

export interface PlayOutcome {
  kind: OutcomeKind;
  /** Absolute x where the ball is dead (forward progress). */
  spotX: number;
  /** Absolute y where the ball is dead (used to pick the hash for the next snap). */
  spotY: number;
  /** Yards gained from the line of scrimmage (offense perspective). */
  yards: number;
  /** Live-ball seconds that ran off. */
  elapsed: number;
  /** Clock stops after this play (incomplete, out of bounds, score, change of possession). */
  clockStops: boolean;
  passAttempt: boolean;
  completion: boolean;
  receiverId: string | null;
  airYards: number;
  yardsAfterCatch: number;
  qbScramble: boolean;
  /** Human-readable summary, e.g. "Complete to #84 Holloway for 12". */
  text: string;
}

export interface SimConfig {
  /** Offense drives toward +x; line of scrimmage absolute x. */
  losX: number;
  ballY: number;
  firstDownX: number;
  coverage: CoverageId;
  /** Two-point try: one play, no returns. */
  isTry: boolean;
  seed: number;
  /** Difficulty: shifts defensive reaction times (+ = slower defenders). */
  reactionBias: number;
}
