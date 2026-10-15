import { defineConfig, type Plugin } from "vite";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

/**
 * Base path the game is served from.
 * - Local dev / preview: "./" (relative, works anywhere).
 * - GitHub Pages: the deploy workflow sets PG_BASE, e.g. "/qb-brain/pocket-gridiron/".
 */
const base = process.env.PG_BASE || "./";

/**
 * Emits sw.js next to index.html. It precaches every file in the build, so the game
 * works offline after the first visit and installed copies update when a new build ships.
 */
function serviceWorker(): Plugin {
  return {
    name: "pg-service-worker",
    apply: "build",
    generateBundle(_opts, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith(".map"));
      const hash = createHash("sha256").update(files.sort().join("|")).digest("hex").slice(0, 10);
      const precache = ["./", ...files.map((f) => "./" + f), "./manifest.webmanifest",
        "./icons/icon-180.png", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-maskable-512.png"];
      const source = readFileSync(new URL("./src/platform/sw-template.js", import.meta.url), "utf8")
        .replace("__VERSION__", `pocket-gridiron-${pkg.version}-${hash}`)
        .replace("__PRECACHE__", JSON.stringify(precache));
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

export default defineConfig({
  base,
  define: {
    __PG_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    target: "es2020",
    outDir: "dist",
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks: { phaser: ["phaser"] },
      },
    },
  },
  plugins: [serviceWorker()],
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
} as Parameters<typeof defineConfig>[0]);
