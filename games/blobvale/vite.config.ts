import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  // Relative base so the build works from a Pages subpath.
  base: command === 'build' ? './' : '/',
  server: {
    host: true,
    port: 5176, // /new-game assigns each game its own port (5176+)
  },
  preview: {
    host: true,
    port: 4176,
  },
}));
