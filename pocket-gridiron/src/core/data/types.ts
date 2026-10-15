/** Shared data types for players, teams and ratings. No runtime code here. */

export type Position = "QB" | "OL" | "WR" | "TE" | "RB" | "DL" | "LB" | "CB" | "S";

/** Offensive personnel slots. A formation puts four of the five skill slots on the field. */
export type OffSlot = "QB" | "OL1" | "OL2" | "X" | "H" | "Y" | "Z" | "RB";
export type SkillSlot = "X" | "H" | "Y" | "Z" | "RB";
export type DefSlot = "DL1" | "DL2" | "LB" | "CB1" | "CB2" | "SS" | "FS";

export const SKILL_SLOTS: readonly SkillSlot[] = ["X", "H", "Y", "Z", "RB"];
export const DEF_SLOTS: readonly DefSlot[] = ["DL1", "DL2", "LB", "CB1", "CB2", "SS", "FS"];

/** All ratings are 0..99. Every one of them feeds a physical or probabilistic model in the sim. */
export interface Ratings {
  speed: number;
  acceleration: number;
  agility: number;
  strength: number;
  awareness: number;
  catching: number;
  routeRunning: number;
  throwPower: number;
  throwAccuracy: number;
  passBlock: number;
  passRush: number;
  manCoverage: number;
  zoneCoverage: number;
  tackling: number;
  elusiveness: number;
}

export interface PlayerProfile {
  id: string;
  name: string;
  number: number;
  position: Position;
  ratings: Ratings;
}

export interface KickerProfile {
  name: string;
  number: number;
  power: number;
  accuracy: number;
}

export interface TeamColors {
  /** Jersey / helmet main color (0xRRGGBB). */
  primary: number;
  /** Trim, numbers. */
  secondary: number;
  /** Pants / helmet stripe. */
  accent: number;
  /** Helmet shell. */
  helmet: number;
}

export interface Team {
  id: string;
  city: string;
  name: string;
  abbr: string;
  colors: TeamColors;
  /** Overall unit strength used for the roster generator and the CPU drive model (0..99). */
  offenseRating: number;
  defenseRating: number;
  offense: Record<OffSlot, PlayerProfile>;
  defense: Record<DefSlot, PlayerProfile>;
  kicker: KickerProfile;
  punter: KickerProfile;
}
