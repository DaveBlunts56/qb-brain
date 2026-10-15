import Phaser from "phaser";
import type { Team } from "../../core/data/types";
import { FIELD_LENGTH, FIELD_WIDTH, HASH_BOTTOM, HASH_TOP } from "../../core/field";
import { Rng } from "../../core/math/rng";
import { MARGIN_X, MARGIN_Y, PPY, WORLD_H, WORLD_W } from "../config";
import { drawPixelText, pixelTextWidth } from "./pixelFont";

const hex = (c: number) => "#" + c.toString(16).padStart(6, "0");

/** Bakes the whole stadium (field, end zones, sidelines, crowd) into one texture per matchup. */
export function makeFieldTexture(scene: Phaser.Scene, home: Team, away: Team): string {
  const key = `field-${home.id}-${away.id}`;
  if (scene.textures.exists(key)) return key;
  const canvas = document.createElement("canvas");
  canvas.width = WORLD_W;
  canvas.height = WORLD_H;
  const ctx = canvas.getContext("2d")!;
  const rng = new Rng(1234);
  const X = (yd: number) => Math.round((yd + MARGIN_X) * PPY);
  const Y = (yd: number) => Math.round((yd + MARGIN_Y) * PPY);
  const rect = (x: number, y: number, w: number, h: number, c: string) => {
    ctx.fillStyle = c;
    ctx.fillRect(x, y, w, h);
  };

  // Stands and crowd.
  rect(0, 0, WORLD_W, WORLD_H, "#22262d");
  const crowd = ["#d9d4c7", "#c94f4f", "#3d6fb6", "#e0b84a", "#4f8f5a", "#8c5aa8", "#e8e8e8", "#2b2b2b", hex(home.colors.primary), hex(home.colors.primary), hex(away.colors.primary)];
  const drawStand = (y0: number, y1: number) => {
    for (let y = y0; y < y1; y += 4) {
      rect(0, y + 3, WORLD_W, 1, "#1a1d22");
      for (let x = (y / 4) % 2 === 0 ? 0 : 2; x < WORLD_W; x += 4) {
        if (rng.chance(0.86)) {
          rect(x, y, 2, 2, rng.pick(crowd));
          rect(x, y + 2, 2, 1, "#14161a");
        }
      }
    }
  };
  drawStand(0, Y(-4.5));
  drawStand(Y(FIELD_WIDTH + 4.5), WORLD_H);
  // Padded walls with a sponsor-free pixel banner.
  const wall = (y: number) => {
    rect(0, y, WORLD_W, 6, "#173a2a");
    rect(0, y, WORLD_W, 1, "#2f6b4a");
    rect(0, y + 5, WORLD_W, 1, "#0d2016");
    for (let x = 30; x < WORLD_W; x += 260) drawPixelText(ctx, "POCKET GRIDIRON", x, y - 0, 1, "#cfe8d6");
  };
  wall(Y(-4.5) - 6);
  wall(Y(FIELD_WIDTH + 4.5));

  // Sideline / team areas.
  rect(0, Y(-4.5), WORLD_W, Y(FIELD_WIDTH + 4.5) - Y(-4.5), "#2f7234");
  for (let i = 0; i < 1400; i++) rect(Math.floor(rng.range(0, WORLD_W)), Math.floor(rng.range(Y(-4.5), Y(FIELD_WIDTH + 4.5))), 1, 1, "#2a6830");

  // Field of play: 5-yard stripes with grass texture.
  for (let yd = 0; yd < FIELD_LENGTH; yd += 5) {
    const inEnd = yd < 10 || yd >= 110;
    if (inEnd) continue;
    const c = (yd / 5) % 2 === 0 ? "#3f9445" : "#398a3f";
    rect(X(yd), Y(0), 5 * PPY, Y(FIELD_WIDTH) - Y(0), c);
  }
  for (let i = 0; i < 5200; i++) {
    const x = Math.floor(rng.range(X(10), X(110)));
    const y = Math.floor(rng.range(Y(0), Y(FIELD_WIDTH)));
    rect(x, y, 1, 1, rng.chance(0.5) ? "#358039" : "#46a04c");
  }

  // End zones in team colors, names reading toward the field.
  const endZone = (x0: number, team: Team, rot: number) => {
    rect(X(x0), Y(0), 10 * PPY, Y(FIELD_WIDTH) - Y(0), hex(team.colors.primary));
    for (let i = 0; i < 900; i++) {
      rect(Math.floor(rng.range(X(x0), X(x0 + 10))), Math.floor(rng.range(Y(0), Y(FIELD_WIDTH))), 1, 1, "rgba(0,0,0,0.12)");
    }
    const text = team.name.toUpperCase();
    const scale = 5;
    const w = pixelTextWidth(text, scale);
    ctx.save();
    ctx.translate(X(x0 + 5), Y(FIELD_WIDTH / 2));
    ctx.rotate(rot);
    drawPixelText(ctx, text, -Math.round(w / 2), -Math.round((7 * scale) / 2), scale, hex(team.colors.secondary), "rgba(0,0,0,0.45)");
    ctx.restore();
  };
  endZone(0, home, -Math.PI / 2);
  endZone(110, away, Math.PI / 2);

  // Lines.
  const white = "#f3f3ec";
  rect(X(0) - 2, Y(0) - 2, X(FIELD_LENGTH) - X(0) + 4, 2, white); // sidelines
  rect(X(0) - 2, Y(FIELD_WIDTH), X(FIELD_LENGTH) - X(0) + 4, 2, white);
  rect(X(0) - 2, Y(0), 2, Y(FIELD_WIDTH) - Y(0), white); // end lines
  rect(X(FIELD_LENGTH), Y(0), 2, Y(FIELD_WIDTH) - Y(0), white);
  for (let yd = 10; yd <= 110; yd += 5) {
    const goal = yd === 10 || yd === 110;
    rect(X(yd) - (goal ? 1 : 0), Y(0), goal ? 2 : 1, Y(FIELD_WIDTH) - Y(0), white);
  }
  // One-yard ticks along the sidelines and at the hashes.
  for (let yd = 11; yd < 110; yd++) {
    if (yd % 5 === 0) continue;
    for (const hy of [0.4, HASH_TOP, HASH_BOTTOM, FIELD_WIDTH - 0.8]) rect(X(yd), Y(hy) - 1, 1, 3, white);
  }
  // Pylons.
  for (const px of [0, 10, 110, 120]) for (const py of [0, FIELD_WIDTH]) rect(X(px) - 1, Y(py) - 1, 3, 3, "#ff8c1a");

  // Yard numbers every 10 with direction arrows.
  for (let yd = 20; yd <= 100; yd += 10) {
    const n = yd <= 60 ? yd - 10 : 110 - yd;
    const label = String(n);
    const s = 2;
    const w = pixelTextWidth(label, s);
    const x = X(yd) - Math.round(w / 2);
    // Bottom (upright).
    drawPixelText(ctx, label, x, Y(FIELD_WIDTH - 9) - 7 * s, s, white);
    // Top (upside down, as painted on a real field).
    ctx.save();
    ctx.translate(X(yd), Y(9) + 7 * s);
    ctx.rotate(Math.PI);
    drawPixelText(ctx, label, -Math.round(w / 2), 0, s, white);
    ctx.restore();
    if (n !== 50) {
      const dir = yd < 60 ? -1 : 1;
      for (const ay of [FIELD_WIDTH - 9 - 1, 9 + 1]) {
        const ax = X(yd) + dir * (Math.round(w / 2) + 4);
        const cy = Y(ay) - (ay > 20 ? 7 : -7);
        for (let i = 0; i < 3; i++) rect(ax + dir * i, cy - (2 - i), 1, (2 - i) * 2 + 1, white);
      }
    }
  }

  // Midfield logo: an original diamond badge with "PG".
  const cx = X(60);
  const cy = Y(FIELD_WIDTH / 2);
  for (let r = 0; r <= 22; r++) {
    for (let dx = -r; dx <= r; dx++) {
      const yy = 22 - r;
      if (Math.abs(dx) === r || r === 22) {
        rect(cx + dx, cy - yy, 1, 1, white);
        rect(cx + dx, cy + yy, 1, 1, white);
      }
    }
  }
  for (let r = 0; r < 21; r++) {
    rect(cx - r, cy - (21 - r), r * 2 + 1, 1, hex(home.colors.primary));
    rect(cx - r, cy + (21 - r), r * 2 + 1, 1, hex(home.colors.primary));
  }
  rect(cx - 21, cy, 43, 1, hex(home.colors.primary));
  drawPixelText(ctx, "PG", cx - pixelTextWidth("PG", 2) / 2, cy - 7, 2, hex(home.colors.secondary), "rgba(0,0,0,0.4)");

  scene.textures.addCanvas(key, canvas);
  return key;
}
