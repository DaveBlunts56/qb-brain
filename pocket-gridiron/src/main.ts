import Phaser from "phaser";
import { app, setApp } from "./game/app";
import { Sfx } from "./game/audio/sfx";
import { BootScene } from "./game/scenes/BootScene";
import { GameScene } from "./game/scenes/GameScene";
import { HudScene } from "./game/scenes/HudScene";
import { TitleScene } from "./game/scenes/TitleScene";
import { watchLifecycle } from "./platform/lifecycle";
import { registerServiceWorker } from "./platform/pwa";
import { SettingsStore } from "./platform/settings";
import { openStore } from "./platform/storage";
import { lockTouchGestures, onViewportChange, readViewport } from "./platform/viewport";

/** Shows uncaught errors on screen: on a phone there is no console to look at. */
function showFatal(err: unknown): void {
  const el = document.getElementById("fatal");
  if (!el) return;
  const msg = err instanceof Error ? `${err.message}\n\n${err.stack ?? ""}` : String(err);
  el.textContent = `Pocket Gridiron hit an error.\nPlease screenshot this and report it.\n\n${msg}`;
  el.style.display = "block";
}

window.addEventListener("error", (e) => showFatal(e.error ?? e.message));
window.addEventListener("unhandledrejection", (e) => showFatal(e.reason));

async function start(): Promise<void> {
  lockTouchGestures();
  const store = new SettingsStore(await openStore());
  await store.load();
  const sfx = new Sfx();
  sfx.setEnabled(store.settings.sound);
  sfx.setVolume(store.settings.volume);
  store.onChange((s) => {
    sfx.setEnabled(s.sound);
    sfx.setVolume(s.volume);
  });
  const vp = readViewport();
  setApp({ store, sfx, viewport: vp, portrait: vp.portrait, backgrounded: false, version: __PG_VERSION__ });

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: "game",
    backgroundColor: "#0b1a12",
    pixelArt: true,
    roundPixels: true,
    antialias: false,
    scale: {
      mode: Phaser.Scale.NONE,
      width: vp.cssWidth * vp.dpr,
      height: vp.cssHeight * vp.dpr,
      zoom: 1 / vp.dpr,
    },
    input: { activePointers: 4, touch: { capture: true } },
    audio: { noAudio: true },
    scene: [BootScene, TitleScene, GameScene, HudScene],
  });

  onViewportChange((v) => {
    const a = app();
    a.viewport = v;
    a.portrait = v.portrait;
    game.scale.resize(v.cssWidth * v.dpr, v.cssHeight * v.dpr);
    game.scale.setZoom(1 / v.dpr);
    game.events.emit("pg-layout");
  });

  watchLifecycle(
    () => {
      app().backgrounded = true;
      sfx.suspend();
      game.events.emit("pg-hidden");
    },
    () => {
      app().backgrounded = false;
      sfx.resume();
    },
  );

  // iOS only allows audio after a touch.
  const unlock = () => sfx.unlock();
  window.addEventListener("touchend", unlock, { passive: true });
  window.addEventListener("pointerup", unlock, { passive: true });

  document.getElementById("boot")?.remove();
  registerServiceWorker();
  // Read-only handle for automated browser tests and debugging.
  (window as unknown as { __PG__: unknown }).__PG__ = { game, app: app() };
}

start().catch(showFatal);
