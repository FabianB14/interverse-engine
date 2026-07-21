import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  // Relative base so the build works from a subpath (GitHub Pages /room/).
  base: command === 'build' ? './' : '/',
  server: {
    host: true,
    port: 5174,
  },
  preview: {
    host: true,
    port: 4174,
  },
}));
