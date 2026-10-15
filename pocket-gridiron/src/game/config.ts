import { FIELD_LENGTH, FIELD_WIDTH } from "../core/field";

/** World pixels per yard. Field art and sprites are authored at this scale. */
export const PPY = 8;
/** Yards of stadium drawn beyond the end lines / sidelines. */
export const MARGIN_X = 6;
export const MARGIN_Y = 10;
export const WORLD_W = (FIELD_LENGTH + MARGIN_X * 2) * PPY;
export const WORLD_H = Math.ceil((FIELD_WIDTH + MARGIN_Y * 2) * PPY);

export const toWorldX = (x: number): number => (x + MARGIN_X) * PPY;
export const toWorldY = (y: number): number => (y + MARGIN_Y) * PPY;

/** Visible field height (world px) at each camera setting (normal ≈ 36 yards: a full formation). */
export const CAMERA_SPAN: Record<"near" | "normal" | "far", number> = { near: 240, normal: 290, far: 350 };

export const COLORS = {
  bg: 0x0b1a12,
  panel: 0x10241a,
  panelLight: 0x1a3a2a,
  panelEdge: 0x2f6b4a,
  ink: 0xf4f1de,
  dim: 0x8fbf9f,
  gold: 0xffd166,
  good: 0x7bd88f,
  bad: 0xff6b6b,
  los: 0x4aa3ff,
  firstDown: 0xffd23f,
  black: 0x0a0e0c,
};
