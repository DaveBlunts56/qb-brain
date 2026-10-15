import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, sanitizeSettings, SettingsStore } from "../src/platform/settings";
import { memoryStore, openStore } from "../src/platform/storage";

describe("settings", () => {
  it("falls back to defaults for missing or malformed data", () => {
    expect(sanitizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings("nonsense")).toEqual(DEFAULT_SETTINGS);
    const s = sanitizeSettings({ sound: "yes", volume: 7, quarterMinutes: 4, difficulty: "legend", camera: "far", leftHanded: true });
    expect(s.sound).toBe(DEFAULT_SETTINGS.sound);
    expect(s.volume).toBe(DEFAULT_SETTINGS.volume);
    expect(s.quarterMinutes).toBe(DEFAULT_SETTINGS.quarterMinutes);
    expect(s.difficulty).toBe(DEFAULT_SETTINGS.difficulty);
    expect(s.camera).toBe("far");
    expect(s.leftHanded).toBe(true);
  });

  it("saves, notifies and reloads", async () => {
    const kv = memoryStore();
    const a = new SettingsStore(kv);
    await a.load();
    let seen = 0;
    a.onChange(() => seen++);
    a.update({ difficulty: "allpro", sound: false });
    expect(seen).toBe(1);
    a.recordGame(21, 14);
    a.recordGame(7, 10);
    await new Promise((r) => setTimeout(r, 0));
    const b = new SettingsStore(kv);
    await b.load();
    expect(b.settings.difficulty).toBe("allpro");
    expect(b.settings.sound).toBe(false);
    expect(b.records).toMatchObject({ played: 2, wins: 1, losses: 1, ties: 0, bestMargin: 7 });
  });

  it("works without IndexedDB or localStorage (falls back to memory)", async () => {
    const kv = await openStore();
    expect(["memory", "localstorage"]).toContain(kv.kind);
    await kv.set("x", { a: 1 });
    expect(await kv.get("x")).toEqual({ a: 1 });
  });
});
