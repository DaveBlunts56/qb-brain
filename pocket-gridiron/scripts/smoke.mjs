// Browser smoke test: runs the production build in Chromium emulating an iPhone in landscape,
// taps through the menus, plays snaps with two-finger multitouch, and saves screenshots.
// Usage: npm run build && npm run smoke   (needs Playwright + Chromium; not part of CI)
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  ({ chromium } = require(process.env.PLAYWRIGHT_PATH || "/opt/node22/lib/node_modules/playwright"));
}

const OUT = process.env.SMOKE_OUT || new URL("../smoke-out/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const PORT = 4179;
const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { stdio: "pipe", cwd: new URL("..", import.meta.url).pathname });
await new Promise((res) => {
  server.stdout.on("data", (d) => String(d).includes(String(PORT)) && res());
  setTimeout(res, 4000);
});

const errors = [];
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
const context = await browser.newContext({
  viewport: { width: 844, height: 390 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
});
const page = await context.newPage();
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const cdp = await context.newCDPSession(page);

const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });
const sleep = (ms) => page.waitForTimeout(ms);

/** Finds a pixel-font label in the active scenes and returns its center in CSS px. */
async function find(label) {
  return page.evaluate((label) => {
    const { game, app } = window.__PG__;
    const dpr = app.viewport.dpr;
    for (const scene of game.scene.getScenes(true)) {
      const stack = [...scene.children.list];
      while (stack.length) {
        const o = stack.pop();
        if (o.list) stack.push(...o.list);
        if (o.type === "BitmapText" && o.text === label && o.visible) {
          const b = o.getBounds();
          return { x: (b.x + b.width / 2) / dpr, y: (b.y + b.height / 2) / dpr };
        }
      }
    }
    return null;
  }, label);
}

async function tap(label) {
  const p = await find(label);
  if (!p) throw new Error(`label not found: ${label}`);
  await page.touchscreen.tap(p.x, p.y);
  await sleep(250);
}

const flow = () => page.evaluate(() => window.__PG_SESSION__?.match.flow.kind ?? "none");
const match = (fn) => page.evaluate(fn);

/** Raw multitouch through CDP: list of {id, x, y}. */
async function touches(type, points) {
  await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map((p) => ({ x: p.x, y: p.y, id: p.id, radiusX: 4, radiusY: 4, force: 1 })) });
}

try {
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__PG__ && window.__PG__.game.scene.isActive("title"), null, { timeout: 15000 });
  await sleep(600);
  await shot("01-title");
  check("title scene boots", true);
  check("no fatal error panel", await page.evaluate(() => getComputedStyle(document.getElementById("fatal")).display === "none"));

  await tap("CONTROLS");
  await sleep(300);
  await shot("01b-controls");
  check("controls screen opens", !!(await find("HOW TO PLAY")));
  await tap("BACK");
  await tap("SETTINGS");
  await sleep(300);
  await shot("01c-settings");
  const camBefore = await page.evaluate(() => window.__PG__.app.store.settings.camera);
  await tap(camBefore.toUpperCase());
  const camAfter = await page.evaluate(() => window.__PG__.app.store.settings.camera);
  check("settings toggle changes and saves", camBefore !== camAfter, `${camBefore} → ${camAfter}`);
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => window.__PG__ && window.__PG__.game.scene.isActive("title"), null, { timeout: 15000 });
  const persisted = await page.evaluate(() => window.__PG__.app.store.settings.camera);
  check("settings persist across reload", persisted === camAfter, `${persisted}`);
  // Restore the default camera for the rest of the run.
  await page.evaluate(() => window.__PG__.app.store.update({ camera: "normal" }));
  // Simulate an iPhone notch / home bar in landscape: layout must move inside the safe area.
  await page.evaluate(() => {
    document.getElementById("safe-probe").style.padding = "0px 47px 21px 47px";
    window.dispatchEvent(new Event("resize"));
  });
  await sleep(600);
  await shot("01d-title-safe-area");
  const playPos = await find("PLAY");
  check("menu respects right safe inset", playPos && playPos.x < 844 - 47, JSON.stringify(playPos));

  await tap("PLAY");
  await sleep(300);
  await shot("02-setup");
  check("game setup opens", !!(await find("KICKOFF")));
  await tap("KICKOFF");
  await page.waitForFunction(() => window.__PG_SESSION__?.match.flow.kind === "kickoff", null, { timeout: 8000 });
  await sleep(700);
  await shot("03-kickoff-card");
  check("kickoff card shown", (await flow()) === "kickoff");

  await page.touchscreen.tap(422, 300);
  await sleep(500);
  check("tap continues to play call", (await flow()) === "playCall");
  await shot("04-play-call");

  await tap("SLANT FLAT");
  await sleep(600);
  check("selecting a play lines up (pre-snap)", (await flow()) === "preSnap");
  await shot("05-presnap-routes");

  // Snap, then two thumbs at once: joystick (left) + receiver button (right).
  await tap("SNAP");
  await sleep(150);
  check("snap starts the play", (await flow()) === "live");
  const before = await match(() => ({ ...window.__PG_SESSION__.match.sim.qb.pos }));
  await touches("touchStart", [{ id: 1, x: 120, y: 300 }]);
  await touches("touchMove", [{ id: 1, x: 120, y: 250 }]);
  await sleep(450);
  const btn = await page.evaluate(() => {
    const hud = window.__PG__.game.scene.getScene("hud");
    const b = hud.recvButtons.find((r) => r.receiverId && r.label.visible);
    const dpr = window.__PG__.app.viewport.dpr;
    return b ? { x: b.cx / dpr, y: b.cy / dpr, id: b.receiverId } : null;
  });
  check("receiver buttons visible after snap", !!btn);
  const moving = await match(() => window.__PG_SESSION__.move);
  check("joystick drives QB input while held", Math.hypot(moving.x, moving.y) > 0.5, JSON.stringify(moving));
  // Second finger presses the receiver button while the first keeps the stick.
  await touches("touchStart", [{ id: 1, x: 120, y: 250 }, { id: 2, x: btn.x, y: btn.y }]);
  await sleep(300); // hold → touch pass
  const aiming = await match(() => !!window.__PG_SESSION__.aim);
  check("second finger starts aiming while stick is held", aiming);
  await shot("06-aiming-multitouch");
  await touches("touchMove", [{ id: 1, x: 120, y: 250 }, { id: 2, x: btn.x + 20, y: btn.y }]);
  // Lift only the throwing finger (CDP touchEnd with a point list releases just those points,
  // like iOS's per-finger touchend).
  await touches("touchEnd", [{ id: 2, x: btn.x + 20, y: btn.y }]);
  await sleep(60);
  const thrown = await match(() => { const sim = window.__PG_SESSION__.match.sim; return sim.passThrown || !!sim.pendingThrow; });
  check("releasing the button throws while the stick stays held", thrown);
  const stillHeld = await match(() => window.__PG__.game.scene.getScene("hud").stick.active);
  check("joystick finger unaffected by the other finger lifting", stillHeld);
  const after = await match(() => ({ ...window.__PG_SESSION__.match.sim.qb.pos }));
  check("QB moved with the joystick before the throw", Math.hypot(after.x - before.x, after.y - before.y) > 0.5, `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
  await sleep(250);
  await shot("07-ball-in-air");
  await touches("touchEnd", []);
  await page.waitForFunction(() => window.__PG_SESSION__.match.flow.kind !== "live", null, { timeout: 15000 });
  await sleep(400);
  await shot("08-result-card");
  const f = await flow();
  check("play ends in a result card", f === "result", f);
  const outcome = await match(() => window.__PG_SESSION__.match.lastOutcome);
  console.log("      outcome:", outcome?.text);

  // Pause / resume.
  await page.touchscreen.tap(422, 300);
  await sleep(400);
  const pauseAt = await find("II");
  await page.touchscreen.tap(pauseAt.x, pauseAt.y);
  await sleep(300);
  check("pause opens", await match(() => window.__PG_SESSION__.paused));
  await shot("09-paused");
  await tap("RESUME");
  check("resume closes pause", !(await match(() => window.__PG_SESSION__.paused)));

  // Backgrounding Safari pauses the game.
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await sleep(200);
  check("hiding the page pauses", await match(() => window.__PG_SESSION__.paused));
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await tap("RESUME");

  // Play more snaps through the UI: pick a play, snap, quick tap-throw to the first receiver.
  for (let i = 0; i < 6; i++) {
    for (let k = 0; k < 10 && !["playCall"].includes(await flow()); k++) {
      const fl = await flow();
      if (fl === "final") break;
      if (fl === "pat") await tap("KICK PAT");
      else await page.touchscreen.tap(422, 300);
      await sleep(350);
    }
    if ((await flow()) !== "playCall") break;
    await tap(["MESH", "SMASH", "FOUR VERTS", "CURL FLAT", "DRIVE", "BUNCH STICK"][i]);
    await tap("SNAP");
    await sleep(1300);
    const b2 = await page.evaluate(() => {
      const hud = window.__PG__.game.scene.getScene("hud");
      const b = hud.recvButtons.find((r) => r.receiverId && r.label.visible);
      const dpr = window.__PG__.app.viewport.dpr;
      return b ? { x: b.cx / dpr, y: b.cy / dpr } : null;
    });
    if (b2) await page.touchscreen.tap(b2.x, b2.y);
    await page.waitForFunction(() => window.__PG_SESSION__.match.flow.kind !== "live", null, { timeout: 20000 });
    const o = await match(() => window.__PG_SESSION__.match.lastOutcome?.text);
    console.log(`      snap ${i + 2}:`, o);
  }
  await shot("10-after-snaps");
  const sb = await match(() => ({ ...window.__PG_SESSION__.match.state, score: window.__PG_SESSION__.match.state.score }));
  check("game state advanced", sb.quarter >= 1 && sb.clock < 180, `Q${sb.quarter} ${sb.clock.toFixed(0)}s, ${sb.score.home}-${sb.score.away}`);

  // Jump to the end of the game: Q4 with 2 seconds left, then one snap.
  for (let k = 0; k < 10 && (await flow()) !== "playCall"; k++) {
    const fl = await flow();
    if (fl === "pat") await tap("KICK PAT");
    else await page.touchscreen.tap(422, 300);
    await sleep(350);
  }
  await page.evaluate(() => {
    const m = window.__PG_SESSION__.match;
    m.state.quarter = 4;
    m.state.clock = 2;
    m.state.clockRunning = false;
  });
  await tap("FOUR VERTS");
  await shot("10b-presnap-wide-camera");
  await tap("SNAP");
  await page.waitForFunction(() => window.__PG_SESSION__.match.flow.kind !== "live", null, { timeout: 30000 });
  for (let k = 0; k < 10 && (await flow()) !== "final"; k++) {
    const fl = await flow();
    if (fl === "pat") await tap("KICK PAT");
    else await page.touchscreen.tap(422, 300);
    await sleep(400);
  }
  check("game reaches the final whistle", (await flow()) === "final");
  await sleep(300);
  await shot("10c-final");
  await tap("PLAY AGAIN");
  await page.waitForFunction(() => window.__PG_SESSION__?.match.flow.kind === "kickoff", null, { timeout: 8000 });
  check("play again starts a new game", (await match(() => window.__PG_SESSION__.match.state.quarter)) === 1);
  check("game result recorded", (await page.evaluate(() => window.__PG__.app.store.records.played)) === 1);

  // Rotate to portrait: prompt shows and play freezes.
  await page.setViewportSize({ width: 390, height: 844 });
  await sleep(800);
  await shot("11-portrait-prompt");
  check("rotate prompt visible in portrait", await page.evaluate(() => getComputedStyle(document.getElementById("rotate")).display !== "none"));
  await page.setViewportSize({ width: 844, height: 390 });
  await sleep(800);
  check("landscape again hides prompt", await page.evaluate(() => getComputedStyle(document.getElementById("rotate")).display === "none"));
  await shot("12-landscape-again");

  const sw = await page.evaluate(async () => {
    for (let i = 0; i < 25; i++) {
      const regs = await navigator.serviceWorker.getRegistrations();
      if (regs.some((r) => r.active)) return regs.map((r) => r.scope).join(",");
      await new Promise((r) => setTimeout(r, 200));
    }
    return "";
  });
  check("service worker registered (offline + install)", sw.length > 0, sw);

  // Settings persist (IndexedDB).
  const kind = await page.evaluate(() => window.__PG__.app.store.storageKind);
  check("settings storage available", kind === "indexeddb", kind);
} catch (e) {
  check("smoke run", false, String(e?.stack || e));
  await shot("zz-failure").catch(() => {});
} finally {
  check("no page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
  await browser.close();
  server.kill();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed. Screenshots in ${OUT}`);
  process.exit(failed ? 1 : 0);
}
