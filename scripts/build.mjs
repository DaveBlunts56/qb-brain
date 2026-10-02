// Builds QB Brain from src/ into:
//   index.html + sw.js   — the installable web app served by GitHub Pages (repo root)
//   dist/qb_brain.html   — a single self-contained file (no service worker), for sharing/previews
// Usage: node scripts/build.mjs [--dev]   (--dev skips minification)
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const rd = p => fs.readFileSync(path.join(root, p), "utf8");
const dev = process.argv.includes("--dev");

let esbuild;
try { esbuild = require("esbuild"); }
catch (_) { throw new Error("esbuild is missing — run `npm install` first."); }

const pkg = JSON.parse(rd("package.json"));
const { version } = pkg;
// Feature switches (package.json → "features"). `--with=accounts` builds a test copy with a feature forced on.
const features = Object.assign({ accounts: false }, pkg.features || {});
const forced = (process.argv.find(a => a.startsWith("--with=")) || "").slice(7).split(",").filter(Boolean);
forced.forEach(f => { features[f] = true; });
// `--channel=stable` builds a test copy as the public release would behave (Pro needs a real subscription)
const chArg = (process.argv.find(a => a.startsWith("--channel=")) || "").slice(10);
const channelName = chArg || pkg.channel || "stable";
const variant = (forced.length ? "." + forced.join("+") : "") + (chArg ? "." + chArg : "");
const channel = channelName !== "stable" ? " " + channelName.toUpperCase() : "";
// Cloud sync settings (Supabase project URL + public anon key). Empty = accounts switched off; the app stays local-only.
// The anon key is meant to be public: row-level security in supabase/schema.sql is what protects the data.
let cloud = { url: "", anonKey: "", checkout: false };   // checkout: true once supabase/functions are deployed (see docs/PRO_SETUP.md)
try { cloud = Object.assign(cloud, JSON.parse(rd("cloud.config.json"))); } catch (_) {}
if (process.env.QB_CLOUD_URL) cloud = { url: process.env.QB_CLOUD_URL, anonKey: process.env.QB_CLOUD_KEY || "" };

// 1) JavaScript: ES modules in src/js -> one IIFE.
// A switched-off feature's modules are swapped for an empty init(), so none of their code ships.
const FEATURE_MODULES = { accounts: ["cloud.js", "account.js", "merge.js"] };
const offModules = Object.keys(FEATURE_MODULES).filter(f => !features[f]).flatMap(f => FEATURE_MODULES[f]);
const featureStub = { name: "feature-off", setup(b) {
  b.onResolve({ filter: /^\.\/[a-z]+\.js$/ }, a => offModules.includes(a.path.slice(2)) ? { path: a.path, namespace: "feature-off" } : null);
  b.onLoad({ filter: /.*/, namespace: "feature-off" }, () => ({ contents: "export function init(){}", loader: "js" }));
} };
const js = (await esbuild.build({
  plugins: [featureStub],
  entryPoints: [path.join(root, "src/js/main.js")], bundle: true, format: "iife", target: "es2019",
  minify: !dev, legalComments: "none", write: false, logLevel: "warning",
  define: { __QB_FEATURES__: JSON.stringify(features), __QB_CHANNEL__: JSON.stringify(channelName), __QB_CLOUD__: JSON.stringify(cloud.url && cloud.anonKey ? { url: cloud.url, anonKey: cloud.anonKey, checkout: !!cloud.checkout } : null) }
})).outputFiles[0].text;

// 2) CSS: self-hosted fonts (inlined, so they work offline and in the single-file build) + styles
const font = (family, file, weight) =>
  `@font-face{font-family:'${family}';src:url(data:font/woff;base64,${fs.readFileSync(path.join(root, "src/fonts", file)).toString("base64")}) format('woff');font-weight:${weight};font-style:normal;font-display:swap;}`;
let css = font("Jersey 10", "jersey10.woff", "400") + "\n" + font("Pixelify Sans", "pixelifysans.woff", "400 700") + "\n" + rd("src/styles/main.css");
if (!dev) css = esbuild.transformSync(css, { loader: "css", minify: true }).code;

// 3) HTML
const PWA_HEAD = `<title>QB Brain</title>
<meta name="description" content="Flag football QB read trainer: coverage recognition, key defender reads, progressions and full drives.">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icons/icon-180.png">
<link rel="icon" type="image/png" href="icons/favicon-64.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="QB Brain">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#0d1117">
<meta name="format-detection" content="telephone=no">`;
const SW_REGISTER = `<script>
if("serviceWorker" in navigator && (location.protocol==="https:"||location.hostname==="localhost")){
  window.addEventListener("load",function(){ navigator.serviceWorker.register("sw.js").catch(function(){}); });
}
</script>`;
function page(pwa) {
  let head = rd("src/html/head.html");
  if (pwa) head = head.replace(/<title>[^<]*<\/title>/, PWA_HEAD);
  head = head.replace("<!--HEAD_EXTRA-->", "<style>\n" + css + "\n</style>");
  let body = rd("src/html/body.html").replace("__VERSION__", version).replace("__CHANNEL__", channel);
  // drop the markup of switched-off features
  Object.keys(features).forEach(f => { if(!features[f]) body = body.replace(new RegExp("<!--feature:" + f + "-->[\\s\\S]*?<!--/feature:" + f + "-->\\n?", "g"), ""); });
  body = body.replace(/<!--\/?feature:[a-z]+-->\n?/g, "");
  const script = "<script>\n" + (pwa ? "window.QB_PWA=true;\n" : "") + js.replace(/<\/script/gi, "<\\/script") + "\n</script>\n" + (pwa ? SW_REGISTER + "\n" : "");
  return head + "</head>\n" + body + script + "</body>\n</html>\n";
}
fs.mkdirSync(path.join(root, "dist"), { recursive: true });
fs.writeFileSync(path.join(root, "dist/qb_brain" + variant + ".html"), page(false));
if (!variant) {
  fs.writeFileSync(path.join(root, "index.html"), page(true));
  fs.writeFileSync(path.join(root, "sw.js"), rd("src/sw.js").replace("__VERSION__", version));
}
const kb = f => (fs.statSync(path.join(root, f)).size / 1024).toFixed(0) + " KB";
const on = Object.keys(features).filter(f => features[f]);
console.log(`QB Brain v${version}${channel}${variant} built${dev ? " (dev)" : ""} — features on: ${on.length ? on.join(", ") : "none"}${features.accounts ? (cloud.url && cloud.anonKey ? " [cloud: " + new URL(cloud.url).host + "]" : " [cloud not configured]") : ""} → dist/qb_brain${variant}.html ${kb("dist/qb_brain" + variant + ".html")}${variant ? "" : ", index.html, sw.js"}`);
