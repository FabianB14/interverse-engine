import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : '/',
  server: {
    host: true,
    port: 5183,
  },
  preview: {
    host: true,
    port: 4183,
  },
}));
