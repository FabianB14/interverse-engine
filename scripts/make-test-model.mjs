// Authors games/rush3d/public/models/totem.glb — a vertex-colored low-poly
// waymarker totem, built as raw glTF binary with no dependencies.
//
// This exists for two reasons. First, the model-import pipeline needs a real
// .glb committed to the repo to prove itself end-to-end (fetch → parse →
// normalize → draw), and a generated one keeps the repo's no-binary-blobs
// spirit: the model's SOURCE is this script, diffable and regenerable, and
// the .glb is a build product we happen to check in. Second, it documents by
// example exactly what a hand-made model should be: vertex colors, no
// textures, a few hundred triangles.
//
//   node scripts/make-test-model.mjs
import { Buffer } from 'node:buffer';
import { mkdirSync, writeFileSync } from 'node:fs';

// ---------------------------------------------------------------- geometry
// A stack of jittered box segments, each a solid color — a carved totem.
const positions = [];
const colors = [];
const indices = [];

let seed = 7;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

function box(cx, cy, cz, w, h, d, rgb, twist = 0) {
  const base = positions.length / 3;
  const corners = [];
  for (const sy of [-0.5, 0.5]) {
    for (const sz of [-0.5, 0.5]) {
      for (const sx of [-0.5, 0.5]) {
        // A little twist per level, so the silhouette reads carved.
        const a = twist * sy;
        const x = sx * w * Math.cos(a) - sz * d * Math.sin(a);
        const z = sx * w * Math.sin(a) + sz * d * Math.cos(a);
        corners.push([cx + x + (rand() - 0.5) * 0.02, cy + sy * h, cz + z + (rand() - 0.5) * 0.02]);
      }
    }
  }
  // 12 triangles, each with its OWN vertices so facet colors stay flat.
  const quads = [
    [0, 1, 3, 2], // bottom
    [4, 6, 7, 5], // top
    [0, 2, 6, 4], // left
    [1, 5, 7, 3], // right
    [2, 3, 7, 6], // front
    [0, 4, 5, 1], // back
  ];
  for (const [a, b, c, d2] of quads) {
    const shade = 0.85 + rand() * 0.3;
    for (const tri of [[a, b, c], [a, c, d2]]) {
      for (const idx of tri) {
        const p = corners[idx];
        positions.push(p[0], p[1], p[2]);
        colors.push(
          Math.min(1, rgb[0] * shade),
          Math.min(1, rgb[1] * shade),
          Math.min(1, rgb[2] * shade),
        );
        indices.push(base + (positions.length / 3 - 1) - base);
      }
    }
  }
}

// The totem: weathered wood segments, a moss band, two amber "eyes".
const WOOD = [0.42, 0.33, 0.2];
const WOOD_DARK = [0.3, 0.23, 0.14];
const MOSS = [0.3, 0.45, 0.26];
const AMBER = [0.95, 0.7, 0.25];

let y = 0;
const levels = [
  { w: 0.62, h: 0.5, c: WOOD_DARK, twist: 0.0 },
  { w: 0.5, h: 0.42, c: WOOD, twist: 0.18 },
  { w: 0.56, h: 0.2, c: MOSS, twist: 0.3 },
  { w: 0.44, h: 0.46, c: WOOD, twist: 0.42 },
  { w: 0.52, h: 0.34, c: WOOD_DARK, twist: 0.55 },
];
for (const lvl of levels) {
  box(0, y + lvl.h / 2, 0, lvl.w, lvl.h, lvl.w, lvl.c, lvl.twist);
  y += lvl.h;
}
// The eyes, proud of the face on the top segment.
box(-0.13, y - 0.2, 0.27, 0.1, 0.1, 0.08, AMBER, 0.55);
box(0.13, y - 0.2, 0.27, 0.1, 0.1, 0.08, AMBER, 0.55);
// A small roof cap.
box(0, y + 0.07, 0, 0.6, 0.14, 0.6, WOOD_DARK, 0.6);

// ------------------------------------------------------------------- glb
function toBuffer(arr, Ctor) {
  const typed = new Ctor(arr);
  return Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
}
const posBuf = toBuffer(positions, Float32Array);
const colBuf = toBuffer(colors, Float32Array);
const idxBuf = toBuffer(indices, Uint16Array);

const pad4 = (b, fill = 0) =>
  b.length % 4 === 0 ? b : Buffer.concat([b, Buffer.alloc(4 - (b.length % 4), fill)]);
const bin = Buffer.concat([pad4(posBuf), pad4(colBuf), pad4(idxBuf)]);

const mins = [Infinity, Infinity, Infinity];
const maxs = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < positions.length; i += 3) {
  for (let a = 0; a < 3; a++) {
    mins[a] = Math.min(mins[a], positions[i + a]);
    maxs[a] = Math.max(maxs[a], positions[i + a]);
  }
}

const gltf = {
  asset: { version: '2.0', generator: 'interverse make-test-model' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0, name: 'totem' }],
  meshes: [
    {
      primitives: [
        { attributes: { POSITION: 0, COLOR_0: 1 }, indices: 2, material: 0 },
      ],
    },
  ],
  materials: [
    {
      name: 'totem-facets',
      pbrMetallicRoughness: {
        baseColorFactor: [1, 1, 1, 1],
        metallicFactor: 0,
        roughnessFactor: 0.9,
      },
    },
  ],
  buffers: [{ byteLength: bin.length }],
  bufferViews: [
    { buffer: 0, byteOffset: 0, byteLength: posBuf.length },
    { buffer: 0, byteOffset: pad4(posBuf).length, byteLength: colBuf.length },
    { buffer: 0, byteOffset: pad4(posBuf).length + pad4(colBuf).length, byteLength: idxBuf.length },
  ],
  accessors: [
    { bufferView: 0, componentType: 5126, count: positions.length / 3, type: 'VEC3', min: mins, max: maxs },
    { bufferView: 1, componentType: 5126, count: colors.length / 3, type: 'VEC3' },
    { bufferView: 2, componentType: 5123, count: indices.length, type: 'SCALAR' },
  ],
};

const jsonBuf = pad4(Buffer.from(JSON.stringify(gltf)), 0x20);
const header = Buffer.alloc(12);
header.write('glTF', 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8);
const jsonChunk = Buffer.alloc(8);
jsonChunk.writeUInt32LE(jsonBuf.length, 0);
jsonChunk.writeUInt32LE(0x4e4f534a, 4); // 'JSON'
const binChunk = Buffer.alloc(8);
binChunk.writeUInt32LE(bin.length, 0);
binChunk.writeUInt32LE(0x004e4942, 4); // 'BIN'

const glb = Buffer.concat([header, jsonChunk, jsonBuf, binChunk, bin]);
mkdirSync('games/rush3d/public/models', { recursive: true });
writeFileSync('games/rush3d/public/models/totem.glb', glb);
console.log(
  `totem.glb: ${glb.length} bytes, ${indices.length / 3} triangles, ${positions.length / 3} vertices`,
);
