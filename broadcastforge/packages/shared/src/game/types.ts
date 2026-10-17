export const TEAM_SIDES = ['home', 'away'] as const;
export type TeamSide = (typeof TEAM_SIDES)[number];

export function otherSide(side: TeamSide): TeamSide {
  return side === 'home' ? 'away' : 'home';
}

/** Editable identity of a team (everything except live numbers). */
export interface TeamInfo {
  name: string;
  mascot: string;
  abbreviation: string;
  record: string;
  primaryColor: string;
  secondaryColor: string;
  textColor: string;
  logoAssetId: string | null;
}

export interface TeamState extends TeamInfo {
  score: number;
  timeouts: number;
}

/**
 * A countdown clock anchored to the server's monotonic clock.
 *
 * While running, the true remaining time is
 *   remainingMs - (nowMono - anchorMono)
 * where nowMono is measured on the *server's* monotonic clock. Clients
 * estimate the server's monotonic time via ping/pong offset estimation.
 * anchorWall (epoch ms) is only used to recover after a server restart,
 * because monotonic time does not survive a process restart.
 */
export interface ClockState {
  running: boolean;
  remainingMs: number;
  anchorMono: number;
  anchorWall: number;
}

export type ClockId = 'game' | 'play';

export type Down = 1 | 2 | 3 | 4;

/** Ball spot: yardLine 1..50 on `side`'s half; side null means the 50. */
export interface BallSpot {
  side: TeamSide | null;
  yardLine: number;
}

/** PRE, Q1..Q4, HALF, OT1..OT9, FINAL */
export type PeriodId = string;

export type FootballFormatId = 'nfhs' | 'college' | 'pro' | 'youth' | 'custom';

export interface GameConfig {
  formatId: FootballFormatId;
  quarterLengthMs: number;
  /** null = untimed overtime (e.g. NFHS/college "Kansas plan" overtime). */
  overtimeLengthMs: number | null;
  playClockSeconds: number;
  playClockShortSeconds: number;
  timeoutsPerHalf: number;
  overtimeTimeouts: number;
  resetTimeoutsAtHalf: boolean;
  showTenthsUnderMinute: boolean;
  maxOvertimes: number;
}

export interface GameState {
  home: TeamState;
  away: TeamState;
  period: PeriodId;
  gameClock: ClockState;
  playClock: ClockState;
  playClockVisible: boolean;
  down: Down | null;
  /** Yards to gain. 0 renders as "INCHES". null hides the distance. */
  distance: number | null;
  goalToGo: boolean;
  ballOn: BallSpot | null;
  possession: TeamSide | null;
  flag: boolean;
  situationVisible: boolean;
  overlayVisible: boolean;
  labels: Record<string, string>;
  config: GameConfig;
}

export const LIMITS = {
  maxScore: 999,
  maxTimeouts: 9,
  maxDistance: 99,
  maxClockMs: (99 * 60 + 59) * 1000 + 900,
  maxPlayClockMs: 99_000,
  maxLabelLength: 80,
  maxTeamNameLength: 40,
  maxAbbrLength: 6,
} as const;
