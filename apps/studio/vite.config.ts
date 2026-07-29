import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  // Relative base so the production build works when served from a subpath
  // (e.g. GitHub Pages at /interverse-engine/studio/) or from a Tauri shell.
  base: command === 'build' ? './' : '/',
  server: {
    host: true,
    port: 5179,
  },
  preview: {
    host: true,
    port: 4179,
  },
}));
