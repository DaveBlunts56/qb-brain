import { describe, expect, it } from "vitest";
import { CHARS, GLYPH_H, GLYPH_TABLE, GLYPH_W, glyph, pixelTextWidth } from "../src/game/art/pixelFont";

describe("pixel font", () => {
  it("every glyph is exactly 5x7", () => {
    for (const [ch, g] of Object.entries(GLYPH_TABLE)) {
      const rows = g.split("/");
      expect(rows, `glyph ${ch}`).toHaveLength(GLYPH_H);
      for (const r of rows) {
        expect(r, `glyph ${ch}`).toHaveLength(GLYPH_W);
        expect(/^[.#]+$/.test(r), `glyph ${ch}`).toBe(true);
      }
    }
  });

  it("covers letters, digits and the HUD symbols", () => {
    for (const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.:-&!?{|}~$") expect(CHARS).toContain(ch);
    expect(glyph("A").flat().some(Boolean)).toBe(true);
    expect(glyph("@").flat().some(Boolean)).toBe(false);
  });

  it("measures text width", () => {
    expect(pixelTextWidth("AB", 1)).toBe(11);
    expect(pixelTextWidth("AB", 2)).toBe(22);
  });
});
