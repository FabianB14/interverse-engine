/**
 * Assemble the deployable website into dist-site/: the landing page plus
 * every built game and the Studio. Used by BOTH deploy targets so they can
 * never drift: the GitHub Pages workflow and Vercel (see vercel.json).
 * Run `pnpm build` first (or `pnpm build:site`, which does both).
 */
import { cpSync, mkdirSync, rmSync } from 'node:fs';

const out = 'dist-site';
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

cpSync('site/index.html', `${out}/index.html`);

const apps = [
  ['games/hello/dist', 'blob-tap'],
  ['games/room/dist', 'room'],
  ['games/taps/dist', 'taps'],
  ['games/blobvale/dist', 'blobvale'],
  ['games/farm/dist', 'farm'],
  ['games/hushfall/dist', 'hushfall'],
  ['games/crashers/dist', 'crashers'],
  ['games/rush/dist', 'rush'],
  ['games/rush3d/dist', 'rush3d'],
  ['games/crashers3d/dist', 'crashers3d'],
  ['games/haven/dist', 'haven'],
  ['apps/studio/dist', 'studio'],
];
for (const [src, dest] of apps) {
  cpSync(src, `${out}/${dest}`, { recursive: true });
  console.log(`[site] ${src} -> ${out}/${dest}`);
}
console.log('[site] done');
