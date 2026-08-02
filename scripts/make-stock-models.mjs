// Authors Studio's stock 3D models — the "already there" catalogue the
// Model dropdown offers before anyone uploads anything: a blob, a boss
// golem, and the prop basics. Same rules as every model in this repo:
// authored as a script, vertex-colored boxes, clips where a thing is alive.
//
//   node scripts/make-stock-models.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { makeBuilder, writeGlb } from './lib/glb.mjs';

mkdirSync('apps/studio/public/models', { recursive: true });
const qx = (a) => [Math.sin(a / 2), 0, 0, Math.cos(a / 2)];
const qz = (a) => [0, 0, Math.sin(a / 2), Math.cos(a / 2)];
const out = (name, nodes, clips) => {
  const glb = writeGlb(nodes, clips);
  writeFileSync(`apps/studio/public/models/${name}.glb`, glb);
  console.log(`${name}.glb: ${glb.length} bytes`);
};

// 🔵 The blob: a friendly stack with eyes; idle bob, walk waddle.
{
  const body = makeBuilder(5);
  body.box(0, 0.45, 0, 0.9, 0.9, 0.85, [0.24, 0.61, 0.86]);
  body.box(0, 0.95, 0.1, 0.55, 0.25, 0.5, [0.24, 0.61, 0.86]);
  body.box(-0.18, 0.62, 0.44, 0.12, 0.16, 0.06, [0.13, 0.13, 0.18]);
  body.box(0.18, 0.62, 0.44, 0.12, 0.16, 0.06, [0.13, 0.13, 0.18]);
  out('blob', [{ name: 'body', geometry: body }], [
    {
      name: 'idle',
      channels: [
        { node: 'body', path: 'translation', times: [0, 0.8, 1.6], values: [0, 0, 0, 0, 0.06, 0, 0, 0, 0] },
      ],
    },
    {
      name: 'walk',
      channels: [
        { node: 'body', path: 'rotation', times: [0, 0.2, 0.4, 0.6], values: [...qz(0.12), ...qz(-0.12), ...qz(0.12), ...qz(0.12)] },
        { node: 'body', path: 'translation', times: [0, 0.2, 0.4], values: [0, 0, 0, 0, 0.1, 0, 0, 0, 0] },
      ],
    },
  ]);
}

// 👹 The boss golem: broader and ember-eyed; idle breathe, swing slam.
{
  const body = makeBuilder(23);
  body.box(0, 0.3, 0, 0.8, 0.6, 0.55, [0.35, 0.3, 0.32]);
  body.box(0, 1.0, 0, 1.15, 0.85, 0.7, [0.45, 0.38, 0.4], 0.08);
  body.box(0, 1.6, 0.06, 0.55, 0.45, 0.45, [0.45, 0.38, 0.4]);
  body.box(-0.13, 1.62, 0.3, 0.12, 0.1, 0.06, [1, 0.45, 0.15]);
  body.box(0.13, 1.62, 0.3, 0.12, 0.1, 0.06, [1, 0.45, 0.15]);
  const arm = (sign) => {
    const b = makeBuilder(sign > 0 ? 29 : 31);
    b.box(sign * 0.14, -0.35, 0, 0.34, 0.65, 0.38, [0.4, 0.34, 0.36], 0.1);
    b.box(sign * 0.18, -0.8, 0.02, 0.5, 0.45, 0.5, [0.3, 0.26, 0.28], 0.16);
    return b;
  };
  const swing = {
    times: [0, 0.3, 0.45, 0.6, 1.0],
    values: [...qx(0), ...qx(-2.0), ...qx(-2.0), ...qx(0.8), ...qx(0)],
  };
  out('boss', [
    { name: 'body', geometry: body },
    { name: 'armL', geometry: arm(-1), translation: [-0.68, 1.15, 0] },
    { name: 'armR', geometry: arm(1), translation: [0.68, 1.15, 0] },
  ], [
    {
      name: 'idle',
      channels: [
        { node: 'body', path: 'translation', times: [0, 1.0, 2.0], values: [0, 0, 0, 0, 0.05, 0, 0, 0, 0] },
      ],
    },
    {
      name: 'swing',
      channels: [
        { node: 'armL', path: 'rotation', ...swing },
        { node: 'armR', path: 'rotation', ...swing },
      ],
    },
  ]);
}

// 📦 The crate. It is a crate.
{
  const b = makeBuilder(7);
  b.box(0, 0.5, 0, 1, 1, 1, [0.55, 0.42, 0.26]);
  b.box(0, 0.5, 0, 1.04, 0.16, 1.04, [0.4, 0.3, 0.18]);
  out('crate', [{ name: 'body', geometry: b }], []);
}

// 🌿 The plant: pot, stem, leaves; idle sway.
{
  const b = makeBuilder(11);
  b.box(0, 0.15, 0, 0.5, 0.3, 0.5, [0.5, 0.32, 0.24]);
  b.box(0, 0.55, 0, 0.1, 0.5, 0.1, [0.25, 0.45, 0.22]);
  b.box(-0.2, 0.85, 0, 0.4, 0.18, 0.3, [0.3, 0.55, 0.28], 0.3);
  b.box(0.2, 0.95, 0, 0.4, 0.18, 0.3, [0.3, 0.55, 0.28], -0.3);
  out('plant', [{ name: 'body', geometry: b }], [
    {
      name: 'idle',
      channels: [
        { node: 'body', path: 'rotation', times: [0, 1.1, 2.2], values: [...qz(0.05), ...qz(-0.05), ...qz(0.05)] },
      ],
    },
  ]);
}

// 🏮 The lantern: post, cage, glow; idle sway.
{
  const b = makeBuilder(13);
  b.box(0, 0.6, 0, 0.12, 1.2, 0.12, [0.3, 0.28, 0.26]);
  b.box(0, 1.3, 0, 0.4, 0.45, 0.4, [0.35, 0.32, 0.3]);
  b.box(0, 1.3, 0, 0.26, 0.3, 0.26, [1, 0.8, 0.35]);
  out('lantern', [{ name: 'body', geometry: b }], [
    {
      name: 'idle',
      channels: [
        { node: 'body', path: 'rotation', times: [0, 1.4, 2.8], values: [...qz(0.04), ...qz(-0.04), ...qz(0.04)] },
      ],
    },
  ]);
}
