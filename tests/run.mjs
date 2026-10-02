// Runs the QB Brain test suite.  node tests/run.mjs [unit|e2e]   (no argument = both)
//   unit: the game engine headless in Node (drills, drives, custom plays, key reads, drills, adaptive, profile)
//   e2e:  real Chromium on an iPhone-sized screen (touch throws, joystick, editor, tutorial, Film Room, offline install)
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const which = process.argv[2];
const list = dir => fs.readdirSync(path.join(root, "tests", dir)).filter(f => f.endsWith(".cjs") && !f.startsWith("_")).map(f => path.join("tests", dir, f));

function run(file, env) {
  return new Promise(res => {
    const t0 = Date.now(); let out = "";
    const p = spawn(process.execPath, [file], { cwd: root, env: { ...process.env, ...env } });
    p.stdout.on("data", d => out += d); p.stderr.on("data", d => out += d);
    const timer = setTimeout(() => { out += "\nTIMEOUT"; p.kill("SIGKILL"); }, 5 * 60 * 1000);
    p.on("close", code => { clearTimeout(timer); res({ file, ok: code === 0, secs: ((Date.now() - t0) / 1000).toFixed(1), out }); });
  });
}
function serve(port) {   // tiny static server for the offline/install test (service workers need http://localhost)
  const types = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png" };
  return new Promise(res => {
    const srv = http.createServer((req, rsp) => {
      let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
      const f = path.join(root, p); if (!f.startsWith(root) || !fs.existsSync(f)) { rsp.writeHead(404); return rsp.end(); }
      rsp.writeHead(200, { "Content-Type": types[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(rsp);
    }).listen(port, () => res(srv));
  });
}

const files = [];
if (which !== "e2e") files.push(...list("unit"));
let srv = null, mockCloud = null;
if (which !== "unit") {
  for (const args of [["scripts/build.mjs"], ["scripts/build.mjs", "--with=accounts"]]) {   // the app + a copy with accounts on
    const b = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit" });
    if (b.status !== 0) process.exit(1);
  }
  srv = await serve(8765);
  const { start } = createRequire(import.meta.url)(path.join(root, "tests/mock-cloud.cjs"));
  mockCloud = await start(8790);
  files.push(...list("e2e"));
}
const results = [];
for (const f of files) {           // one at a time: the e2e tests are timing-sensitive
  const r = await run(f, { QB_SITE: "http://localhost:8765/" });
  results.push(r); console.log((r.ok ? "  pass " : "  FAIL ") + r.file.padEnd(36) + r.secs + "s");
  if (!r.ok) console.log(r.out.split("\n").slice(-25).map(l => "      " + l).join("\n"));
}
if (srv) srv.close();
if (mockCloud) mockCloud.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
