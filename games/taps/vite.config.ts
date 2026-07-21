import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  // Relative base so the build works from a subpath (GitHub Pages /taps/).
  base: command === 'build' ? './' : '/',
  server: {
    host: true,
    port: 5175,
  },
  preview: {
    host: true,
    port: 4175,
  },
}));
