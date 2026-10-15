import Phaser from "phaser";
import { CELL_W } from "../art/pixelFont";
import { COLORS } from "../config";
import { drawMarker } from "./playDiagram";
import type { UI } from "./kit";

export const CONTROLS_LINES: { head: string; body: string }[] = [
  { head: "LEFT THUMB", body: "Joystick moves your QB: drop back, slide in the pocket, scramble. After a catch it steers the runner." },
  { head: "RIGHT THUMB", body: "One button per receiver. Shapes match the icons on the field. Tap = BULLET. Hold = TOUCH. Hold longer = LOB. Release to throw." },
  { head: "AIM", body: "While holding a receiver button, drag your thumb to lead the ball: drag right = deeper, left = shorter, up/down = toward a sideline." },
  { head: "RUN", body: "With the ball: JUKE makes tacklers miss, DIVE grabs a last yard. You can't throw once you cross the line." },
  { head: "READ", body: "Before the snap look at the safeties. Two deep = Cover 2 or 4. One deep = Cover 1 or 3. None = blitz, throw it quick!" },
  { head: "CLOCK", body: "After a tackle in bounds the clock keeps running until you snap. Hurry, or call a TIMEOUT." },
  { head: "KEYBOARD", body: "WASD/arrows move, 1-4 throw (hold for touch/lob), Space snaps/continues, J juke, K dive, P pause." },
];

/** Builds the controls help into a container: a mini diagram plus the rules above. */
export function buildControlsHelp(ui: UI, x: number, y: number, w: number, h: number): Phaser.GameObjects.Container {
  const c = ui.scene.add.container(0, 0);
  const g = ui.scene.add.graphics();
  c.add(g);
  ui.panel(g, x, y, w, h);
  const pad = 10 * ui.u;
  c.add(ui.text(x + pad, y + pad, "HOW TO PLAY", "lg", COLORS.gold));
  // Mini picture of the two thumbs.
  const diagW = Math.min(w * 0.3, 170 * ui.u);
  const dx = x + w - pad - diagW;
  const dy = y + pad;
  const dh = diagW * 0.55;
  ui.panel(g, dx, dy, diagW, dh, 0x2f7234, 0x1f4f28, 1);
  g.fillStyle(0xffffff, 0.25);
  g.fillCircle(dx + dh * 0.45, dy + dh * 0.6, dh * 0.3);
  g.fillStyle(0xffffff, 0.6);
  g.fillCircle(dx + dh * 0.45 + dh * 0.1, dy + dh * 0.6 - dh * 0.08, dh * 0.12);
  for (let i = 0; i < 4; i++) drawMarker(g, i, dx + diagW - dh * 0.2, dy + dh * (0.18 + i * 0.22), dh * 0.08);
  c.add(ui.text(dx + dh * 0.45, dy + dh + 3 * ui.u, "MOVE", "xs", COLORS.dim, 0.5, 0));
  c.add(ui.text(dx + diagW - dh * 0.2, dy + dh + 3 * ui.u, "THROW", "xs", COLORS.dim, 1, 0));

  let ty = y + pad + ui.scaleFor("lg") * 9 + 6 * ui.u;
  const textW = w - pad * 3 - diagW;
  const headW = Math.max(...CONTROLS_LINES.map((l) => l.head.length)) * CELL_W * ui.scaleFor("sm") + 10 * ui.u;
  for (const line of CONTROLS_LINES) {
    const avail = ty < dy + dh + 18 * ui.u ? textW : w - pad * 2;
    const head = ui.text(x + pad, ty, line.head, "sm", COLORS.gold);
    c.add(head);
    const body = ui.text(x + pad + headW, ty, ui.wrap(line.body, avail - headW, "sm"), "sm", COLORS.ink);
    c.add(body);
    ty += Math.max(head.height, body.height) + 6 * ui.u;
  }
  return c;
}
