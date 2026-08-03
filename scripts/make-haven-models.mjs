// Authors Blobhaven's sample MODEL decor — the two statues that prove the
// .glb store pipeline end to end. Any model dropped into
// games/haven/public/models/ and listed in the game's MODEL_DECOR registry
// ships the same way: loadModel scales it to its stated height, feet land
// at y=0, and the store sells it like any other furnishing.
//
//   node scripts/make-haven-models.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { makeBuilder, writeGlb } from './lib/glb.mjs';

mkdirSync('games/haven/public/models', { recursive: true });
const out = (name, nodes, clips) => {
  const glb = writeGlb(nodes, clips);
  writeFileSync(`games/haven/public/models/${name}.glb`, glb);
  console.log(`${name}.glb: ${glb.length} bytes`);
};

// 🍄 Garden gnome: boots, coat, beard, and the hat that makes the gnome.
{
  const b = makeBuilder(17);
  // boots + coat
  b.box(-0.12, 0.06, 0, 0.16, 0.12, 0.22, [0.25, 0.2, 0.16]);
  b.box(0.12, 0.06, 0, 0.16, 0.12, 0.22, [0.25, 0.2, 0.16]);
  b.sphere(0, 0.42, 0, 0.3, [0.32, 0.5, 0.68], { squash: 1.15 });
  // belt + buckle
  b.box(0, 0.4, 0, 0.62, 0.08, 0.62, [0.22, 0.17, 0.12]);
  b.box(0, 0.4, 0.3, 0.12, 0.1, 0.04, [0.9, 0.78, 0.35]);
  // head + nose + beard
  b.sphere(0, 0.78, 0, 0.19, [0.92, 0.78, 0.66], { rings: 6, segs: 8 });
  b.sphere(0, 0.74, 0.18, 0.06, [0.88, 0.6, 0.5], { rings: 4, segs: 6 });
  b.sphere(0, 0.62, 0.14, 0.15, [0.94, 0.94, 0.94], { squash: 0.75, rings: 5, segs: 7 });
  // the hat: a tapering stack of red boxes, slightly twisted
  b.box(0, 0.95, 0, 0.34, 0.14, 0.34, [0.78, 0.22, 0.2], 0.1);
  b.box(0, 1.07, 0, 0.24, 0.12, 0.24, [0.74, 0.2, 0.18], 0.25);
  b.box(0, 1.17, 0, 0.14, 0.1, 0.14, [0.7, 0.18, 0.17], 0.4);
  b.box(0.03, 1.25, 0.02, 0.07, 0.08, 0.07, [0.66, 0.17, 0.16], 0.5);
  out('gnome', [{ name: 'body', geometry: b }], []);
}

// 🧸 Teddy bear: sitting, arms open — the housewarming gift classic.
{
  const b = makeBuilder(29);
  const fur = [0.55, 0.4, 0.28];
  const pale = [0.78, 0.64, 0.48];
  // seated body + legs stretched forward
  b.sphere(0, 0.34, 0, 0.32, fur, { squash: 1.05 });
  b.sphere(0, 0.38, 0.16, 0.16, pale, { squash: 1.2, rings: 5, segs: 7 });
  b.sphere(-0.22, 0.12, 0.22, 0.12, fur, { rings: 5, segs: 6 });
  b.sphere(0.22, 0.12, 0.22, 0.12, fur, { rings: 5, segs: 6 });
  // arms
  b.sphere(-0.32, 0.42, 0.05, 0.11, fur, { rings: 5, segs: 6 });
  b.sphere(0.32, 0.42, 0.05, 0.11, fur, { rings: 5, segs: 6 });
  // head + muzzle + ears
  b.sphere(0, 0.74, 0.02, 0.22, fur, { rings: 6, segs: 8 });
  b.sphere(0, 0.68, 0.2, 0.1, pale, { squash: 0.8, rings: 4, segs: 6 });
  b.sphere(0, 0.7, 0.27, 0.035, [0.15, 0.1, 0.08], { rings: 3, segs: 5 });
  b.sphere(-0.15, 0.92, 0, 0.08, fur, { squash: 0.7, rings: 4, segs: 6 });
  b.sphere(0.15, 0.92, 0, 0.08, fur, { squash: 0.7, rings: 4, segs: 6 });
  // eyes
  b.sphere(-0.08, 0.78, 0.19, 0.03, [0.12, 0.09, 0.08], { rings: 3, segs: 5 });
  b.sphere(0.08, 0.78, 0.19, 0.03, [0.12, 0.09, 0.08], { rings: 3, segs: 5 });
  out('bear', [{ name: 'body', geometry: b }], []);
}
