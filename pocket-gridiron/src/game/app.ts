import type { SettingsStore } from "../platform/settings";
import type { ViewportInfo } from "../platform/viewport";
import type { Sfx } from "./audio/sfx";

/**
 * Process-wide services shared by all scenes. Set up once in main.ts before Phaser starts.
 */
export interface App {
  store: SettingsStore;
  sfx: Sfx;
  viewport: ViewportInfo;
  /** True while the device is portrait (rotate prompt showing). */
  portrait: boolean;
  /** Set when the page is hidden; the game scene pauses itself. */
  backgrounded: boolean;
  version: string;
}

let current: App | null = null;

export function setApp(a: App): void {
  current = a;
}

export function app(): App {
  if (!current) throw new Error("App not initialized");
  return current;
}
