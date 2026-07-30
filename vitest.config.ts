import { defineConfig } from 'vitest/config';

// Unit tests for the pure logic layers (tilemaps, dialogue, saves, economy,
// behaviors, studio project model). The headless playtests in scripts/ stay
// the integration layer — these are the fast `pnpm test` gate.
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
  },
});
