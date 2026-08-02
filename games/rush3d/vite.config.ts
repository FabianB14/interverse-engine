import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : '/',
  server: {
    host: true,
    port: 5184,
  },
  preview: {
    host: true,
    port: 4184,
  },
}));
