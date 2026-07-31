import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  // Relative base so the build works from a Pages subpath.
  base: command === 'build' ? './' : '/',
  server: {
    host: true,
    port: 5182,
  },
  preview: {
    host: true,
    port: 4182,
  },
}));
