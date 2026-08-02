// Authors games/crashers3d/public/models/golem.glb — an animated mossy
// stone golem, the proof model for Actor3's animation slot.
//
// Three nodes (body, armL, armR) so the clips can move parts separately,
// and two clips with the names gameplay actually asks for:
//   'idle'  — a slow breathing bob
//   'swing' — both arms heave up and slam down (the telegraphed attack)
//
//   node scripts/make-golem-model.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { makeBuilder, writeGlb } from './lib/glb.mjs';

const STONE = [0.45, 0.48, 0.44];
const STONE_DARK = [0.32, 0.35, 0.32];
const MOSS = [0.3, 0.5, 0.28];
const EMBER = [0.95, 0.55, 0.2];

// Body node: torso stack, head, eyes, legs.
const body = makeBuilder(13);
body.box(0, 0.25, 0, 0.55, 0.5, 0.45, STONE_DARK); // hips
body.box(0, 0.85, 0, 0.85, 0.7, 0.6, STONE, 0.08); // chest
body.box(0, 1.05, 0.05, 0.8, 0.2, 0.55, MOSS, 0.12); // moss shoulders
body.box(0, 1.45, 0.05, 0.45, 0.4, 0.4, STONE, 0.05); // head
body.box(-0.11, 1.47, 0.26, 0.1, 0.08, 0.06, EMBER); // eye
body.box(0.11, 1.47, 0.26, 0.1, 0.08, 0.06, EMBER); // eye
body.box(-0.2, -0.15, 0, 0.26, 0.34, 0.3, STONE_DARK); // leg
body.box(0.2, -0.15, 0, 0.26, 0.34, 0.3, STONE_DARK); // leg

// Arm nodes: boulder fists on stumpy arms, origin at the shoulder so the
// swing clip rotates them like arms and not like satellites.
function arm(sign) {
  const b = makeBuilder(sign > 0 ? 17 : 19);
  b.box(sign * 0.12, -0.3, 0, 0.3, 0.55, 0.34, STONE, 0.1);
  b.box(sign * 0.16, -0.68, 0.02, 0.42, 0.4, 0.44, STONE_DARK, 0.15); // fist
  b.box(sign * 0.16, -0.52, 0.06, 0.4, 0.12, 0.4, MOSS, 0.1); // moss wrist
  return b;
}
const armL = arm(-1);
const armR = arm(1);

// ---------------------------------------------------------------- clips
// Quaternions about X for the swing: q = [sin(a/2), 0, 0, cos(a/2)].
const qx = (a) => [Math.sin(a / 2), 0, 0, Math.cos(a / 2)];

const idle = {
  name: 'idle',
  channels: [
    {
      node: 'body',
      path: 'translation',
      times: [0, 0.9, 1.8],
      values: [0, 0, 0, 0, 0.05, 0, 0, 0, 0],
    },
    {
      node: 'armL',
      path: 'rotation',
      times: [0, 0.9, 1.8],
      values: [...qx(0.06), ...qx(-0.06), ...qx(0.06)],
    },
    {
      node: 'armR',
      path: 'rotation',
      times: [0, 0.9, 1.8],
      values: [...qx(-0.06), ...qx(0.06), ...qx(-0.06)],
    },
  ],
};

// The swing: wind up high (the readable telegraph), hold, slam.
const swingArm = {
  times: [0, 0.28, 0.42, 0.55, 0.9],
  values: [...qx(0), ...qx(-1.9), ...qx(-1.9), ...qx(0.7), ...qx(0)],
};
const swing = {
  name: 'swing',
  channels: [
    { node: 'armL', path: 'rotation', ...swingArm },
    { node: 'armR', path: 'rotation', ...swingArm },
    {
      node: 'body',
      path: 'translation',
      times: [0, 0.42, 0.6, 0.9],
      values: [0, 0, 0, 0, 0.08, 0, 0, -0.05, 0, 0, 0, 0],
    },
  ],
};

const glb = writeGlb(
  [
    { name: 'body', geometry: body },
    { name: 'armL', geometry: armL, translation: [-0.5, 1.0, 0] },
    { name: 'armR', geometry: armR, translation: [0.5, 1.0, 0] },
  ],
  [idle, swing],
);

mkdirSync('games/crashers3d/public/models', { recursive: true });
writeFileSync('games/crashers3d/public/models/golem.glb', glb);
console.log(`golem.glb: ${glb.length} bytes, clips: idle, swing`);
