import type { BallSpot, Down, GameState, TeamSide } from './types.js';

export function ordinal(n: number): string {
  const s = ['TH', 'ST', 'ND', 'RD'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

export function downText(down: Down | null): string {
  return down ? ordinal(down) : '';
}

export function distanceText(distance: number | null, goalToGo: boolean): string {
  if (goalToGo) return 'GOAL';
  if (distance === null) return '';
  if (distance === 0) return 'INCHES';
  return String(distance);
}

export function downAndDistanceText(state: Pick<GameState, 'down' | 'distance' | 'goalToGo'>): string {
  if (!state.down) return '';
  const dist = distanceText(state.distance, state.goalToGo);
  return dist ? `${ordinal(state.down)} & ${dist}` : ordinal(state.down);
}

export function ballOnText(state: Pick<GameState, 'ballOn' | 'home' | 'away'>): string {
  const spot = state.ballOn;
  if (!spot) return '';
  if (spot.side === null || spot.yardLine >= 50) return '50';
  const team = state[spot.side];
  return `${team.abbreviation || spot.side.toUpperCase()} ${spot.yardLine}`;
}

/** Yards from the ball to the goal line the offense is attacking, or null if unknown. */
export function yardsToGoal(spot: BallSpot | null, offense: TeamSide | null): number | null {
  if (!spot || !offense) return null;
  if (spot.side === null || spot.yardLine >= 50) return 50;
  // On the opponent's half: yards to goal is the yard line itself.
  return spot.side === offense ? 100 - spot.yardLine : spot.yardLine;
}
