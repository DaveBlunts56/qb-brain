import Phaser from "phaser";
import { CELL_H, CELL_W, CHARS, drawPixelText, PER_ROW } from "./pixelFont";

export const FONT_KEY = "pg-font";

/** Builds the font texture and registers it as a Phaser bitmap font. */
export function registerPixelFont(scene: Phaser.Scene): void {
  if (scene.cache.bitmapFont.exists(FONT_KEY)) return;
  const rowsCount = Math.ceil(CHARS.length / PER_ROW);
  const canvas = document.createElement("canvas");
  canvas.width = PER_ROW * CELL_W;
  canvas.height = rowsCount * CELL_H;
  const ctx = canvas.getContext("2d")!;
  [...CHARS].forEach((ch, i) => {
    const x = (i % PER_ROW) * CELL_W;
    const y = Math.floor(i / PER_ROW) * CELL_H;
    if (ch !== " ") drawPixelText(ctx, ch, x, y, 1, "#ffffff", "rgba(8,12,10,0.9)");
  });
  scene.textures.addCanvas(FONT_KEY, canvas);
  const data = Phaser.GameObjects.RetroFont.Parse(scene, {
    image: FONT_KEY,
    width: CELL_W,
    height: CELL_H,
    chars: CHARS,
    charsPerRow: PER_ROW,
    "spacing.x": 0,
    "spacing.y": 0,
    "offset.x": 0,
    "offset.y": 0,
    lineSpacing: 3,
  });
  scene.cache.bitmapFont.add(FONT_KEY, data);
}
