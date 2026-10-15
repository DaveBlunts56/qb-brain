import type { CoverageId } from "../data/defense";
import type { Rng } from "../math/rng";
import { isGoalToGo, yardsToGo, type GameState } from "./gameState";

/**
 * CPU defensive coordinator: picks a coverage for the situation. Tendencies, not scripts — it is a
 * weighted random choice, so the user has to read the shell every snap.
 */
export function chooseCoverage(s: GameState, rng: Rng, recent: CoverageId[] = []): CoverageId {
  const togo = yardsToGo(s);
  const w: Record<CoverageId, number> = { cover0: 0.4, cover1: 2, cover2: 2, cover3: 2.5, cover4: 1.2 };
  if (s.down >= 3 && togo >= 8) { w.cover4 += 2; w.cover2 += 1; w.cover0 -= 0.3; }
  if (togo <= 3) { w.cover1 += 1.5; w.cover0 += 0.8; w.cover4 -= 0.6; }
  if (isGoalToGo(s) || s.yardLine >= 85) { w.cover0 += 0.8; w.cover1 += 1.5; w.cover4 -= 0.8; }
  if (s.yardLine <= 20) { w.cover3 += 0.6; w.cover1 += 0.4; }
  // Late in a half and protecting a lead: keep everything in front.
  if ((s.quarter === 2 || s.quarter === 4) && s.clock < 45) { w.cover4 += 2; w.cover2 += 1; w.cover0 = 0; }
  // Don't sit in the same coverage over and over.
  for (const c of recent.slice(-2)) w[c] *= 0.6;
  return rng.weighted(w);
}
