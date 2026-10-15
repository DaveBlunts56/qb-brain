import { FIELD_WIDTH } from "../field";
import type { DefSlot } from "./types";

export type CoverageId = "cover0" | "cover1" | "cover2" | "cover3" | "cover4";

export type ZoneId =
  | "deepHalfL" | "deepHalfR"
  | "deepThirdL" | "deepThirdM" | "deepThirdR"
  | "deepQtrL" | "deepQtrML" | "deepQtrMR" | "deepQtrR"
  | "flatL" | "flatR" | "curlFlatL" | "curlFlatR" | "hook";

/** A zone landmark: where the defender drops and how much width he is responsible for. */
export interface ZoneSpec {
  id: ZoneId;
  kind: "deep" | "under";
  /** Landmark across the field (absolute y). */
  y: number;
  /** Landmark depth past the line of scrimmage. */
  depth: number;
  /** Half the zone's width (yards). */
  halfWidth: number;
}

export type DefAssignment =
  | { kind: "rush" }
  | { kind: "man" } // target receiver resolved at the snap from the formation
  | { kind: "zone"; zone: ZoneId };

export interface DefenseCall {
  id: CoverageId;
  name: string;
  /** What the safeties show before the snap. */
  shell: "zero" | "one-high" | "two-high";
  assignments: Record<DefSlot, DefAssignment>;
  description: string;
}

const RUSH: DefAssignment = { kind: "rush" };
const MAN: DefAssignment = { kind: "man" };
const Z = (zone: ZoneId): DefAssignment => ({ kind: "zone", zone });

export const DEFENSE_CALLS: Record<CoverageId, DefenseCall> = {
  cover0: {
    id: "cover0", name: "COVER 0 BLITZ", shell: "zero",
    assignments: { DL1: RUSH, DL2: RUSH, LB: RUSH, CB1: MAN, CB2: MAN, SS: MAN, FS: MAN },
    description: "Man everywhere, no deep help, linebacker blitzes.",
  },
  cover1: {
    id: "cover1", name: "COVER 1", shell: "one-high",
    assignments: { DL1: RUSH, DL2: RUSH, LB: MAN, CB1: MAN, CB2: MAN, SS: MAN, FS: Z("deepThirdM") },
    description: "Man-free: man underneath, free safety in the deep middle.",
  },
  cover2: {
    id: "cover2", name: "COVER 2", shell: "two-high",
    assignments: { DL1: RUSH, DL2: RUSH, LB: Z("hook"), CB1: Z("flatL"), CB2: Z("flatR"), SS: Z("deepHalfR"), FS: Z("deepHalfL") },
    description: "Two deep halves, corners squat in the flats.",
  },
  cover3: {
    id: "cover3", name: "COVER 3", shell: "one-high",
    assignments: { DL1: RUSH, DL2: RUSH, LB: Z("curlFlatL"), CB1: Z("deepThirdL"), CB2: Z("deepThirdR"), SS: Z("curlFlatR"), FS: Z("deepThirdM") },
    description: "Three deep thirds, two underneath curl-to-flat defenders.",
  },
  cover4: {
    id: "cover4", name: "COVER 4", shell: "two-high",
    assignments: { DL1: RUSH, DL2: RUSH, LB: Z("hook"), CB1: Z("deepQtrL"), CB2: Z("deepQtrR"), SS: Z("deepQtrMR"), FS: Z("deepQtrML") },
    description: "Quarters: four deep, one underneath. Takes away the deep ball.",
  },
};

export const COVERAGE_IDS: readonly CoverageId[] = ["cover0", "cover1", "cover2", "cover3", "cover4"];

/** Builds the absolute landmark for a zone. ballY shades the hook/middle zones toward the ball. */
export function zoneSpec(id: ZoneId, ballY: number): ZoneSpec {
  const W = FIELD_WIDTH;
  switch (id) {
    case "deepHalfL": return { id, kind: "deep", y: W * 0.27, depth: 16, halfWidth: W * 0.27 };
    case "deepHalfR": return { id, kind: "deep", y: W * 0.73, depth: 16, halfWidth: W * 0.27 };
    case "deepThirdL": return { id, kind: "deep", y: W / 6 + 1, depth: 15, halfWidth: W / 6 + 1 };
    case "deepThirdM": return { id, kind: "deep", y: (ballY + W / 2) / 2, depth: 16, halfWidth: W / 6 + 1 };
    case "deepThirdR": return { id, kind: "deep", y: W - W / 6 - 1, depth: 15, halfWidth: W / 6 + 1 };
    case "deepQtrL": return { id, kind: "deep", y: W / 8 + 1, depth: 13, halfWidth: W / 8 + 1 };
    case "deepQtrML": return { id, kind: "deep", y: (W * 3) / 8, depth: 14, halfWidth: W / 8 + 1 };
    case "deepQtrMR": return { id, kind: "deep", y: (W * 5) / 8, depth: 14, halfWidth: W / 8 + 1 };
    case "deepQtrR": return { id, kind: "deep", y: W - W / 8 - 1, depth: 13, halfWidth: W / 8 + 1 };
    case "flatL": return { id, kind: "under", y: 7, depth: 4, halfWidth: 7 };
    case "flatR": return { id, kind: "under", y: W - 7, depth: 4, halfWidth: 7 };
    case "curlFlatL": return { id, kind: "under", y: Math.min(ballY - 8, 15), depth: 7, halfWidth: 10 };
    case "curlFlatR": return { id, kind: "under", y: Math.max(ballY + 8, W - 15), depth: 7, halfWidth: 10 };
    case "hook": return { id, kind: "under", y: ballY, depth: 8, halfWidth: 8 };
  }
}
