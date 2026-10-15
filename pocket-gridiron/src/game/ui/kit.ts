import Phaser from "phaser";
import { app } from "../app";
import { FONT_KEY } from "../art/font";
import { CELL_W } from "../art/pixelFont";
import { COLORS } from "../config";

/**
 * Pixel UI kit. Every scene lays out in CSS pixels (u) converted to device pixels, so controls
 * have the same physical size on every phone. Text uses the pixel font at integer scales.
 */
export type TextSize = "xs" | "sm" | "md" | "lg" | "xl";
const TEXT_CSS: Record<TextSize, number> = { xs: 1.1, sm: 1.4, md: 1.8, lg: 2.8, xl: 5 };

export class UI {
  readonly scene: Phaser.Scene;
  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /** Device pixels per CSS pixel. */
  get u(): number {
    return app().viewport.dpr;
  }

  get w(): number {
    return this.scene.scale.width;
  }

  get h(): number {
    return this.scene.scale.height;
  }

  /** Safe-area insets in device pixels (plus a small margin). */
  get safe() {
    const s = app().viewport.safe;
    const u = this.u;
    const m = 6 * u;
    return { top: s.top * u + m, right: s.right * u + m, bottom: s.bottom * u + m, left: s.left * u + m };
  }

  scaleFor(size: TextSize): number {
    // Shrink a step on very small screens.
    const small = app().viewport.cssHeight < 340 ? 0.85 : 1;
    return Math.max(1, Math.round(TEXT_CSS[size] * this.u * small));
  }

  text(x: number, y: number, s: string, size: TextSize = "md", color: number = COLORS.ink, originX = 0, originY = 0): Phaser.GameObjects.BitmapText {
    const t = this.scene.add.bitmapText(x, y, FONT_KEY, s.toUpperCase()).setScale(this.scaleFor(size)).setOrigin(originX, originY);
    t.setTint(color);
    return t;
  }

  /** Character columns that fit in a width at a text size (the font is monospaced). */
  charsFor(width: number, size: TextSize): number {
    return Math.max(4, Math.floor(width / (CELL_W * this.scaleFor(size))));
  }

  wrap(s: string, width: number, size: TextSize): string {
    const max = this.charsFor(width, size);
    const out: string[] = [];
    for (const para of s.toUpperCase().split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/)) {
        if (!word) continue;
        if ((line + " " + word).trim().length > max) {
          if (line) out.push(line);
          line = word.length > max ? word.slice(0, max) : word;
        } else {
          line = (line + " " + word).trim();
        }
      }
      out.push(line);
    }
    return out.join("\n");
  }

  /** Pixel panel: dark fill, bright edge, notched corners. */
  panel(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, fill: number = COLORS.panel, edge: number = COLORS.panelEdge, alpha = 0.96): void {
    const b = Math.max(2, Math.round(this.u * 1.5));
    g.fillStyle(edge, alpha);
    g.fillRect(x + b, y, w - 2 * b, h);
    g.fillRect(x, y + b, w, h - 2 * b);
    g.fillStyle(fill, alpha);
    g.fillRect(x + b * 2, y + b, w - 4 * b, h - 2 * b);
    g.fillRect(x + b, y + b * 2, w - 2 * b, h - 4 * b);
  }

  button(x: number, y: number, w: number, h: number, label: string, onClick: () => void, opts: ButtonOpts = {}): PixelButton {
    return new PixelButton(this, x, y, w, h, label, onClick, opts);
  }
}

export interface ButtonOpts {
  size?: TextSize;
  fill?: number;
  edge?: number;
  color?: number;
  sub?: string;
  depth?: number;
  /** Fire on press instead of release (gameplay buttons). */
  onDown?: boolean;
}

/** A tappable pixel button (single touch, fires on release inside unless onDown). */
export class PixelButton {
  readonly container: Phaser.GameObjects.Container;
  private g: Phaser.GameObjects.Graphics;
  private label: Phaser.GameObjects.BitmapText;
  private subText: Phaser.GameObjects.BitmapText | null = null;
  private zone: Phaser.GameObjects.Zone;
  private pressed = false;
  private enabledFlag = true;
  constructor(private ui: UI, public x: number, public y: number, public w: number, public h: number, text: string, private onClick: () => void, private opts: ButtonOpts) {
    const sc = ui.scene;
    this.container = sc.add.container(x, y);
    this.g = sc.add.graphics();
    this.label = ui.text(w / 2, opts.sub ? h * 0.36 : h / 2, text, opts.size ?? "md", opts.color ?? COLORS.ink, 0.5, 0.5);
    this.container.add([this.g, this.label]);
    if (opts.sub) {
      this.subText = ui.text(w / 2, h * 0.74, opts.sub, "xs", COLORS.dim, 0.5, 0.5);
      this.container.add(this.subText);
    }
    this.zone = sc.add.zone(w / 2, h / 2, w, h).setInteractive();
    this.container.add(this.zone);
    if (opts.depth !== undefined) this.container.setDepth(opts.depth);
    this.draw();
    this.zone.on("pointerdown", () => {
      if (!this.enabledFlag) return;
      this.pressed = true;
      this.draw();
      app().sfx.unlock();
      if (opts.onDown) {
        app().sfx.play("click");
        this.onClick();
      }
    });
    this.zone.on("pointerout", () => {
      this.pressed = false;
      this.draw();
    });
    this.zone.on("pointerup", () => {
      const was = this.pressed;
      this.pressed = false;
      this.draw();
      if (was && this.enabledFlag && !opts.onDown) {
        app().sfx.play("click");
        this.onClick();
      }
    });
  }

  private draw(): void {
    const g = this.g;
    g.clear();
    const fill = !this.enabledFlag ? 0x1c2a22 : this.pressed ? (this.opts.edge ?? COLORS.panelEdge) : (this.opts.fill ?? COLORS.panelLight);
    this.ui.panel(g, 0, 0, this.w, this.h, fill, this.enabledFlag ? (this.opts.edge ?? COLORS.panelEdge) : 0x2a3a30, 1);
    this.label.setAlpha(this.enabledFlag ? 1 : 0.4);
  }

  setText(t: string): this {
    this.label.setText(t.toUpperCase());
    return this;
  }

  setSub(t: string): this {
    this.subText?.setText(t.toUpperCase());
    return this;
  }

  setEnabled(on: boolean): this {
    this.enabledFlag = on;
    this.draw();
    return this;
  }

  setVisible(v: boolean): this {
    this.container.setVisible(v);
    if (v) this.zone.setInteractive();
    else this.zone.disableInteractive();
    return this;
  }

  setStyle(fill: number, edge: number): this {
    this.opts.fill = fill;
    this.opts.edge = edge;
    this.draw();
    return this;
  }

  destroy(): void {
    this.container.destroy();
  }
}
