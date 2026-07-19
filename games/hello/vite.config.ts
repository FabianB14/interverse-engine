import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  // Relative base so the production build works when served from a subpath
  // (e.g. GitHub Pages at /interverse-engine/) as well as from a domain root.
  base: command === 'build' ? './' : '/',
  // host: true binds to 0.0.0.0 so real phones on the same LAN can open the URL.
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    host: true,
    port: 4173,
  },
}));
