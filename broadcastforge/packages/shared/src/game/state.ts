import { createClock } from './clock.js';
import { defaultGameConfig } from './config.js';
import { periodLengthMs } from './period.js';
import type { GameConfig, GameState, TeamInfo, TeamState } from './types.js';

export const DEFAULT_HOME: TeamInfo = {
  name: 'Home',
  mascot: '',
  abbreviation: 'HOME',
  record: '',
  primaryColor: '#1f4ea8',
  secondaryColor: '#0b1f44',
  textColor: '#ffffff',
  logoAssetId: null,
};

export const DEFAULT_AWAY: TeamInfo = {
  name: 'Away',
  mascot: '',
  abbreviation: 'AWAY',
  record: '',
  primaryColor: '#b3261e',
  secondaryColor: '#4a0d0a',
  textColor: '#ffffff',
  logoAssetId: null,
};

export function teamFromInfo(info: TeamInfo, timeouts: number): TeamState {
  return { ...info, score: 0, timeouts };
}

export function teamInfoOf(team: TeamState): TeamInfo {
  const { score: _score, timeouts: _timeouts, ...info } = team;
  return info;
}

export interface InitialStateOptions {
  home?: TeamInfo;
  away?: TeamInfo;
  config?: GameConfig;
  nowMono?: number;
  nowWall?: number;
  overlayVisible?: boolean;
}

export function createInitialGameState(opts: InitialStateOptions = {}): GameState {
  const config = opts.config ?? defaultGameConfig('nfhs');
  const nowMono = opts.nowMono ?? 0;
  const nowWall = opts.nowWall ?? 0;
  return {
    home: teamFromInfo(opts.home ?? DEFAULT_HOME, config.timeoutsPerHalf),
    away: teamFromInfo(opts.away ?? DEFAULT_AWAY, config.timeoutsPerHalf),
    period: 'PRE',
    gameClock: createClock(periodLengthMs('PRE', config), nowMono, nowWall),
    playClock: createClock(config.playClockSeconds * 1000, nowMono, nowWall),
    playClockVisible: true,
    down: null,
    distance: null,
    goalToGo: false,
    ballOn: null,
    possession: null,
    flag: false,
    situationVisible: true,
    overlayVisible: opts.overlayVisible ?? true,
    labels: {},
    config,
  };
}

/** A believable mid-game state used for editor previews and thumbnails. */
export function createSampleGameState(home?: TeamInfo, away?: TeamInfo): GameState {
  const state = createInitialGameState({ home, away });
  state.home.score = 21;
  state.away.score = 17;
  state.home.timeouts = 2;
  state.away.timeouts = 3;
  state.period = 'Q3';
  state.gameClock = createClock(7 * 60_000 + 42_000);
  state.playClock = createClock(25_000);
  state.down = 3;
  state.distance = 6;
  state.ballOn = { side: 'away', yardLine: 34 };
  state.possession = 'home';
  return state;
}
