import { getTeam } from "../core/data/teams";
import { Match } from "../core/match";
import type { Vec2 } from "../core/math/vec";
import type { PassType } from "../core/sim/types";
import type { Settings } from "../platform/settings";

/** A receiver button being held: becomes a throw on release. */
export interface AimState {
  receiverId: string;
  marker: number;
  /** performance.now() when pressed. */
  startedAt: number;
  /** Lead offset in yards (from dragging). */
  lead: Vec2;
}

/** Hold time thresholds (seconds) for touch and lob. */
export const HOLD_TOUCH = 0.2;
export const HOLD_LOB = 0.55;

export function passTypeForHold(seconds: number): PassType {
  return seconds < HOLD_TOUCH ? "bullet" : seconds < HOLD_LOB ? "touch" : "lob";
}

/** One game in progress: the match plus the live input shared by the field and HUD scenes. */
export class Session {
  readonly match: Match;
  /** Joystick vector in field space (+x downfield, +y toward the bottom sideline), length 0..1. */
  move: Vec2 = { x: 0, y: 0 };
  aim: AimState | null = null;
  paused = false;
  /** Game result saved to the records (once). */
  recorded = false;
  /** Snaps taken this game (for first-play hints). */
  snaps = 0;
  /** Short message for the big center banner. */
  banner: { text: string; color: number; at: number } | null = null;

  constructor(settings: Settings, seed = Math.floor(Math.random() * 2 ** 31)) {
    this.match = new Match({
      home: getTeam(settings.userTeam),
      away: getTeam(settings.cpuTeam === settings.userTeam ? (settings.userTeam === "rattlers" ? "gulls" : "rattlers") : settings.cpuTeam),
      quarterMinutes: settings.quarterMinutes,
      difficulty: settings.difficulty,
      seed,
    });
  }

  showBanner(text: string, color: number): void {
    this.banner = { text, color, at: performance.now() };
  }
}
