import { defineConfig } from 'vite';

export default defineConfig({
  // host: true binds to 0.0.0.0 so real phones on the same LAN can open the URL.
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    host: true,
    port: 4173,
  },
});
