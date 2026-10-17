// End-to-end test: production server + real Chromium.
// Run `npm run build` first (the script builds automatically if dist/ is missing).
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverBundle = path.join(root, 'packages/server/dist/server.mjs');
if (!fs.existsSync(serverBundle) || !fs.existsSync(path.join(root, 'packages/web/dist/overlay.html'))) {
  console.log('Building…');
  const r = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

const port = await freePort();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-e2e-'));
const base = `http://localhost:${port}`;
const server = spawn(process.execPath, [serverBundle], { cwd: root, env: { ...process.env, PORT: String(port), BF_DATA_DIR: dataDir, LOG_LEVEL: 'warn' }, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));

const results = [];
async function step(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log(`  ✓ ${name} (${Date.now() - t0} ms)`);
  } catch (err) {
    results.push({ name, ok: false, err });
    console.log(`  ✗ ${name}\n    ${err.message.split('\n').join('\n    ')}`);
  }
}

const waitFor = async (fn, ms = 5000, label = 'condition') => {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Timed out waiting for ${label} (last value: ${JSON.stringify(last)})`);
};

let browser;
try {
  await waitFor(async () => (await fetch(`${base}/api/system/info`).catch(() => null))?.ok, 15000, 'server start');
  const id = (await (await fetch(`${base}/api/projects`)).json())[0].id;
  browser = await chromium.launch();
  const pageErrors = [];
  const overlay = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  overlay.on('pageerror', (e) => pageErrors.push(`overlay: ${e.message}`));
  const control = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  control.on('pageerror', (e) => pageErrors.push(`control: ${e.message}`));
  const texts = () => overlay.evaluate(() => [...document.querySelectorAll('.bf-tt')].filter((e) => e.offsetParent !== null).map((e) => e.textContent));
  const scores = async () => (await texts()).filter((t) => /^\d+$/.test(t)).map(Number);

  console.log(`BroadcastForge e2e on ${base}`);

  await step('overlay renders the example scorebug with a transparent background', async () => {
    await overlay.goto(`${base}/overlay/${id}?status=0`);
    await waitFor(async () => (await texts()).includes('IRW'), 8000, 'scorebug text');
    const bg = await overlay.evaluate(() => getComputedStyle(document.body).backgroundColor);
    assert.equal(bg, 'rgba(0, 0, 0, 0)');
    assert.deepEqual((await scores()).slice(0, 2), [10, 14]);
  });

  await step('control room +6 updates the overlay in real time', async () => {
    await control.goto(`${base}/projects/${id}/live`);
    await control.waitForSelector('text=HAS POSSESSION');
    const t0 = Date.now();
    await control.locator('section[aria-label="home team"] button', { hasText: '+6' }).click();
    await waitFor(async () => (await scores())[1] === 20, 3000, 'home score 20');
    console.log(`    overlay updated ${Date.now() - t0} ms after the click`);
  });

  await step('touchdown graphic plays without changing the score', async () => {
    await control.locator('section[aria-label="Graphics"] button', { hasText: 'TOUCHDOWN' }).nth(1).click();
    await waitFor(async () => (await texts()).includes('TOUCHDOWN'), 3000, 'TOUCHDOWN text');
    const snap = await (await fetch(`${base}/api/projects/${id}/match`)).json();
    assert.equal(snap.state.home.score, 20);
    await waitFor(async () => !(await texts()).includes('TOUCHDOWN'), 8000, 'takeover to finish');
  });

  await step('game clock runs from the server and survives an overlay refresh', async () => {
    await control.getByRole('button', { name: /START/ }).click();
    const clock = async () => (await texts()).find((t) => /^\d+:\d\d$/.test(t));
    const a = await waitFor(clock, 3000, 'clock');
    await overlay.waitForTimeout(2200);
    const b = await clock();
    assert.notEqual(a, b, 'clock should tick');
    await overlay.reload();
    await waitFor(async () => (await scores())[1] === 20, 6000, 'state after reload');
    const c = await waitFor(clock, 3000, 'clock after reload');
    const toSec = (s) => Number(s.split(':')[0]) * 60 + Number(s.split(':')[1]);
    assert.ok(Math.abs(toSec(c) - toSec(b)) <= 3, `clock jumped after reload: ${b} → ${c}`);
    await control.getByRole('button', { name: /STOP/ }).click();
  });

  await step('a retried command is applied once (dedupe)', async () => {
    const body = JSON.stringify({ commandId: 'e2e-dedupe-1', command: { type: 'score.add', team: 'away', delta: 3 } });
    const send = () => fetch(`${base}/api/projects/${id}/command`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }).then((r) => r.json());
    const first = await send();
    const second = await send();
    assert.equal(second.duplicate, true);
    assert.equal(second.seq, first.seq);
    await waitFor(async () => (await scores())[0] === 13, 3000, 'away score 13');
  });

  await step('undo reverts the last scoring action', async () => {
    await control.getByRole('button', { name: /Undo:/ }).click();
    await waitFor(async () => (await scores())[0] === 10, 3000, 'away score back to 10');
  });

  await step('publishing a design change updates the live overlay without a refresh', async () => {
    const project = await (await fetch(`${base}/api/projects/${id}`)).json();
    const scene = project.draft;
    const label = scene.elements.find((e) => e.role === 'awayAbbr');
    label.text.color = '#ff00ff';
    const saved = await fetch(`${base}/api/projects/${id}/scene`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scene, rev: project.draftRev }) });
    assert.equal(saved.status, 200);
    const before = await overlay.evaluate(() => [...document.querySelectorAll('.bf-text')].map((e) => e.style.color).includes('rgb(255, 0, 255)'));
    assert.equal(before, false, 'draft edits must not reach the overlay before publishing');
    await fetch(`${base}/api/projects/${id}/publish`, { method: 'POST' });
    await waitFor(() => overlay.evaluate(() => [...document.querySelectorAll('.bf-text')].map((e) => e.style.color).includes('rgb(255, 0, 255)')), 3000, 'published colour');
  });

  await step('emergency clear removes all graphics from air', async () => {
    const btn = control.getByRole('button', { name: /HOLD TO CLEAR/ });
    const box = await btn.boundingBox();
    await control.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await control.mouse.down();
    await control.waitForTimeout(900);
    await control.mouse.up();
    await waitFor(() => overlay.evaluate(() => getComputedStyle(document.querySelector('.bf-stage')).visibility === 'hidden'), 3000, 'stage hidden');
    await control.getByRole('button', { name: /SHOW BUG/ }).click();
    await waitFor(() => overlay.evaluate(() => getComputedStyle(document.querySelector('.bf-stage')).visibility === 'visible'), 3000, 'stage visible again');
  });

  await step('studio, animation editor, OBS and settings pages load', async () => {
    for (const p of [`/projects/${id}/studio`, `/projects/${id}/animate`, '/obs', '/settings', '/']) {
      const page = await browser.newPage();
      page.on('pageerror', (e) => pageErrors.push(`${p}: ${e.message}`));
      await page.goto(base + p);
      await page.waitForTimeout(1200);
      await page.close();
    }
  });

  await step('no uncaught page errors', async () => {
    assert.deepEqual(pageErrors, []);
  });
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  fs.rmSync(dataDir, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} e2e checks passed`);
if (failed.length) {
  console.log('\nServer log:\n' + serverLog.slice(-3000));
  process.exit(1);
}
