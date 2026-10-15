import Phaser from "phaser";
import type { TeamColors } from "../../core/data/types";

/**
 * Original player sprites, authored as tiny ASCII templates and painted with team colors at boot.
 * A dark outline is generated automatically so players read clearly on grass.
 *
 * Palette keys: H helmet · h helmet stripe · M facemask · S skin · s skin shade · J jersey ·
 * j jersey shade · N number/trim · P pants · W socks · K cleats · . transparent
 */
export const FRAME_W = 16;
export const FRAME_H = 18;

type Template = string[];

const FRONT_STAND: Template = [
  "....HHHH....",
  "...HHhHHH...",
  "..HHHhHHHH..",
  "..HMMMMMMH..",
  "..HSMSSMSH..",
  "...HMMMMH...",
  ".JJJJJJJJJJ.",
  "JJJJJNNJJJJJ",
  "SJjJJNNJJjJS",
  "SJjJJJJJJjJS",
  ".s.JJJJJJ.s.",
  "...PPPPPP...",
  "...PP..PP...",
  "...WW..WW...",
  "...KK..KK...",
];
const FRONT_RUN_A: Template = [
  ...FRONT_STAND.slice(0, 7),
  "JJJJJNNJJJJS",
  "SJjJJNNJJjJs",
  "sJjJJJJJJjJ.",
  "...JJJJJJ...",
  "...PPPPPP...",
  "...PP..PP...",
  "...WW..KK...",
  "...KK.......",
];
const FRONT_RUN_B: Template = [
  ...FRONT_STAND.slice(0, 7),
  "SJJJJNNJJJJJ",
  "sJjJJNNJJjJS",
  ".JjJJJJJJjJs",
  "...JJJJJJ...",
  "...PPPPPP...",
  "...PP..PP...",
  "...KK..WW...",
  ".......KK...",
];
const BACK_STAND: Template = [
  "....HHHH....",
  "...HHhHHH...",
  "..HHHhHHHH..",
  "..HHHhHHHH..",
  "..HHHHHHHH..",
  "...HHHHHH...",
  ".JJJJJJJJJJ.",
  "JJJJNNNNJJJJ",
  "SJjJNNNNJjJS",
  "SJjJJJJJJjJS",
  ".s.JJJJJJ.s.",
  "...PPPPPP...",
  "...PP..PP...",
  "...WW..WW...",
  "...KK..KK...",
];
const BACK_RUN_A: Template = [...BACK_STAND.slice(0, 11), "...PPPPPP...", "...PP..PP...", "...WW..KK...", "...KK......."];
const BACK_RUN_B: Template = [...BACK_STAND.slice(0, 11), "...PPPPPP...", "...PP..PP...", "...KK..WW...", ".......KK..."];
const SIDE_STAND: Template = [
  "....HHHH....",
  "...HHHHHH...",
  "..hhhhHHHM..",
  "...HHHHSMM..",
  "....HHHSM...",
  "....JJJJJ...",
  "...JJJJJJJ..",
  "...JJNJJJS..",
  "...JjNJJJS..",
  "....JJJJJ...",
  "....PPPPP...",
  "....PP.PP...",
  "....WW.WW...",
  "...KK..KK...",
];
const SIDE_RUN_A: Template = [
  ...SIDE_STAND.slice(0, 6),
  "...JJJJJJJS.",
  "..SJJNJJJJs.",
  "..sJjNJJJ...",
  "....JJJJJ...",
  "....PPPPP...",
  "...PP...PP..",
  "..WW.....WW.",
  ".KK.......KK",
];
const SIDE_RUN_B: Template = [
  ...SIDE_STAND.slice(0, 10),
  "....PPPP....",
  ".....PPP....",
  ".....WW.....",
  "....KKK.....",
];
/** Arm cocked back to throw (side view). */
const SIDE_THROW: Template = [
  ".S..HHHH....",
  ".sJHHHHHH...",
  "..JhhhHHHM..",
  "..JJHHHSMM..",
  "...JHHHSM...",
  "....JJJJJ...",
  "...JJJJJJJ..",
  "...JJNJJJ...",
  "...JjNJJJ...",
  "....JJJJJ...",
  "....PPPPP...",
  "...PP...PP..",
  "...WW...WW..",
  "..KK...KK...",
];
/** On the ground after a tackle. */
const DOWN: Template = [
  "................",
  "................",
  "................",
  "................",
  "................",
  "................",
  "..HHHH..........",
  ".HHhHHJJJJJPPPWK",
  ".HMMHHJJNNJPPPWK",
  "..SSHSJJJJJPPPWK",
  "......ss........",
  "................",
];

export const FRAMES = {
  front: [FRONT_STAND, FRONT_RUN_A, FRONT_STAND, FRONT_RUN_B],
  back: [BACK_STAND, BACK_RUN_A, BACK_STAND, BACK_RUN_B],
  side: [SIDE_STAND, SIDE_RUN_A, SIDE_RUN_B, SIDE_RUN_A],
};
/** Frame indices in the generated sheet. */
export const FRAME_INDEX = { front: 0, back: 4, side: 8, throw: 12, down: 13 } as const;
const SHEET_ORDER: Template[] = [...FRAMES.front, ...FRAMES.back, ...FRAMES.side, SIDE_THROW, DOWN];

export const SKIN_TONES = [
  { S: "#f1c7a0", s: "#d29d74" },
  { S: "#b9794d", s: "#8e5634" },
  { S: "#6e432a", s: "#4d2c1b" },
];

const hex = (c: number) => "#" + c.toString(16).padStart(6, "0");

function shade(c: number, f: number): string {
  const r = Math.round(((c >> 16) & 255) * f);
  const g = Math.round(((c >> 8) & 255) * f);
  const b = Math.round((c & 255) * f);
  return `rgb(${Math.min(255, r)},${Math.min(255, g)},${Math.min(255, b)})`;
}

function paletteFor(colors: TeamColors, skin: { S: string; s: string }): Record<string, string> {
  return {
    H: hex(colors.helmet), h: hex(colors.accent), M: "#9aa3a8",
    S: skin.S, s: skin.s,
    J: hex(colors.primary), j: shade(colors.primary, 0.72), N: hex(colors.secondary),
    P: hex(colors.secondary === 0xffffff || colors.secondary === 0xf4f1de ? colors.secondary : colors.accent),
    W: "#f2f2f2", K: "#1b1b1b",
  };
}

/** Paints one template into the frame at (ox, oy), with an automatic outline. */
function paint(ctx: CanvasRenderingContext2D, t: Template, ox: number, oy: number, pal: Record<string, string>): void {
  const w = Math.max(...t.map((r) => r.length));
  const x0 = ox + Math.floor((FRAME_W - w) / 2);
  const y0 = oy + (FRAME_H - 1 - t.length);
  const solid = (x: number, y: number) => y >= 0 && y < t.length && x >= 0 && x < (t[y]?.length ?? 0) && t[y][x] !== ".";
  ctx.fillStyle = "rgba(10,14,12,0.85)";
  for (let y = -1; y <= t.length; y++) {
    for (let x = -1; x <= w; x++) {
      if (solid(x, y)) continue;
      if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) ctx.fillRect(x0 + x, y0 + y, 1, 1);
    }
  }
  t.forEach((row, y) => {
    [...row].forEach((k, x) => {
      if (k === ".") return;
      ctx.fillStyle = pal[k] ?? "#ff00ff";
      ctx.fillRect(x0 + x, y0 + y, 1, 1);
    });
  });
}

export function teamSheetKey(teamId: string, skin: number): string {
  return `players-${teamId}-${skin}`;
}

/** Generates a spritesheet (14 frames of 16×18) for a team and skin tone. */
export function makeTeamSheet(scene: Phaser.Scene, teamId: string, colors: TeamColors, skin: number): string {
  const key = teamSheetKey(teamId, skin);
  if (scene.textures.exists(key)) return key;
  const canvas = document.createElement("canvas");
  canvas.width = FRAME_W * SHEET_ORDER.length;
  canvas.height = FRAME_H;
  const ctx = canvas.getContext("2d")!;
  const pal = paletteFor(colors, SKIN_TONES[skin % SKIN_TONES.length]);
  SHEET_ORDER.forEach((t, i) => paint(ctx, t, i * FRAME_W, 0, pal));
  const tex = scene.textures.addCanvas(key, canvas)!;
  SHEET_ORDER.forEach((_, i) => tex.add(i, 0, i * FRAME_W, 0, FRAME_W, FRAME_H));
  return key;
}

/** Small textures: ball, shadow, receiver markers, selection ring, dust. */
export const MARKER_COLORS = [0xffd166, 0xff6b81, 0x5ec8ff, 0xc792ff];
export const MARKER_GLYPHS = ["{", "|", "}", "~"];

export function makeMiscTextures(scene: Phaser.Scene): void {
  const make = (key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) => {
    if (scene.textures.exists(key)) return;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    draw(c.getContext("2d")!);
    scene.textures.addCanvas(key, c);
  };
  make("ball", 7, 5, (ctx) => {
    const rows = [".OOOOO.", "OBBBBBO", "OBWWWBO", "OBBBBBO", ".OOOOO."];
    const pal: Record<string, string> = { O: "#2a160a", B: "#8a4b22", W: "#f2e8d8" };
    rows.forEach((r, y) => [...r].forEach((k, x) => { if (k !== ".") { ctx.fillStyle = pal[k]; ctx.fillRect(x, y, 1, 1); } }));
  });
  make("shadow", 10, 4, (ctx) => {
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(2, 0, 6, 4);
    ctx.fillRect(0, 1, 10, 2);
  });
  make("ring", 16, 7, (ctx) => {
    const rows = ["....########....", "..##........##..", ".#............#.", "#..............#", ".#............#.", "..##........##..", "....########...."];
    ctx.fillStyle = "#ffffff";
    rows.forEach((r, y) => [...r].forEach((k, x) => { if (k === "#") ctx.fillRect(x, y, 1, 1); }));
  });
  make("dust", 3, 3, (ctx) => {
    ctx.fillStyle = "#d9cfa8";
    ctx.fillRect(1, 0, 1, 3);
    ctx.fillRect(0, 1, 3, 1);
  });
  make("pixel", 1, 1, (ctx) => {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 1, 1);
  });
}
