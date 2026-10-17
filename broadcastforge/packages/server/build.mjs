// Bundles the server (and the TypeScript @bf/shared workspace package) into
// dist/server.mjs. npm dependencies stay external and load from node_modules.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)));
const external = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})].filter((d) => !d.startsWith('@bf/'));

await build({
  entryPoints: [fileURLToPath(new URL('./src/index.ts', import.meta.url))],
  outfile: fileURLToPath(new URL('./dist/server.mjs', import.meta.url)),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  external: [...external, 'node:*'],
  logLevel: 'info',
});
