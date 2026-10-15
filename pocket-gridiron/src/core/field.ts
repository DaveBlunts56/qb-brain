/**
 * Field geometry, in yards.
 *
 * Absolute coordinates: x runs along the field from the back of the left end zone (0) to the back
 * of the right end zone (120). The user's offense always drives toward +x. y runs across the field
 * from the top sideline (0) to the bottom sideline (53.33).
 *
 * "Yard line" (0..100) is the offense's distance from its own goal line, so own 25 = 25 and
 * opponent 25 = 75. Absolute x = yard line + 10.
 */
export const FIELD_LENGTH = 120;
export const END_ZONE = 10;
export const FIELD_WIDTH = 160 / 3; // 53.33 yards
export const OWN_GOAL_X = END_ZONE; // 10
export const OPP_GOAL_X = FIELD_LENGTH - END_ZONE; // 110
/** NFL hash marks: 70'9" from each sideline. */
export const HASH_TOP = 70.75 / 3;
export const HASH_BOTTOM = FIELD_WIDTH - 70.75 / 3;
export const CENTER_Y = FIELD_WIDTH / 2;

export const yardLineToX = (yardLine: number): number => yardLine + END_ZONE;
export const xToYardLine = (x: number): number => x - END_ZONE;

export function isInBounds(x: number, y: number): boolean {
  return y >= 0 && y <= FIELD_WIDTH && x >= 0 && x <= FIELD_LENGTH;
}

/** "OWN 25", "50", "OPP 35" from the offense's point of view. */
export function describeYardLine(yardLine: number): string {
  const yl = Math.round(yardLine);
  if (yl === 50) return "50";
  if (yl < 50) return `OWN ${Math.max(1, yl)}`;
  return `OPP ${Math.max(1, 100 - yl)}`;
}

/** Ball is spotted between the hashes: the next snap starts on the nearest hash if the play ended outside them. */
export function spotBetweenHashes(y: number): number {
  return Math.min(HASH_BOTTOM, Math.max(HASH_TOP, y));
}
