import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const dir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: dir,
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    // "/assets/:id" is the uploaded-asset route, so built files live under /static.
    assetsDir: 'static',
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: {
        index: path.join(dir, 'index.html'),
        overlay: path.join(dir, 'overlay.html'),
      },
    },
  },
});
