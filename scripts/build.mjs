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

const { version } = JSON.parse(rd("package.json"));
// Cloud sync settings (Supabase project URL + public anon key). Empty = accounts switched off; the app stays local-only.
// The anon key is meant to be public: row-level security in supabase/schema.sql is what protects the data.
let cloud = { url: "", anonKey: "" };
try { cloud = Object.assign(cloud, JSON.parse(rd("cloud.config.json"))); } catch (_) {}
if (process.env.QB_CLOUD_URL) cloud = { url: process.env.QB_CLOUD_URL, anonKey: process.env.QB_CLOUD_KEY || "" };

// 1) JavaScript: ES modules in src/js -> one IIFE
const js = esbuild.buildSync({
  entryPoints: [path.join(root, "src/js/main.js")], bundle: true, format: "iife", target: "es2019",
  minify: !dev, legalComments: "none", write: false, logLevel: "warning",
  define: { __QB_CLOUD__: JSON.stringify(cloud.url && cloud.anonKey ? { url: cloud.url, anonKey: cloud.anonKey } : null) }
}).outputFiles[0].text;

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
  const body = rd("src/html/body.html").replace("__VERSION__", version);
  const script = "<script>\n" + (pwa ? "window.QB_PWA=true;\n" : "") + js.replace(/<\/script/gi, "<\\/script") + "\n</script>\n" + (pwa ? SW_REGISTER + "\n" : "");
  return head + "</head>\n" + body + script + "</body>\n</html>\n";
}
fs.writeFileSync(path.join(root, "index.html"), page(true));
fs.mkdirSync(path.join(root, "dist"), { recursive: true });
fs.writeFileSync(path.join(root, "dist/qb_brain.html"), page(false));
fs.writeFileSync(path.join(root, "sw.js"), rd("src/sw.js").replace("__VERSION__", version));
const kb = f => (fs.statSync(path.join(root, f)).size / 1024).toFixed(0) + " KB";
console.log(`QB Brain v${version} built${dev ? " (dev)" : ""}${cloud.url && cloud.anonKey ? " [cloud: " + new URL(cloud.url).host + "]" : " [cloud off]"}: index.html ${kb("index.html")}, dist/qb_brain.html ${kb("dist/qb_brain.html")}, sw.js`);
