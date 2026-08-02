// A tiny glTF-binary writer — the repo's model "format toolchain".
//
// Models in this repo are authored as SCRIPTS (diffable, regenerable), and
// this is the shared part: facet-colored box geometry in, .glb with
// optional animation clips out. No dependencies; the binary layout is
// simple enough that owning it outright beats importing a converter.
import { Buffer } from 'node:buffer';

export function makeBuilder(seed = 7) {
  let s = seed >>> 0 || 1;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const positions = [];
  const colors = [];
  const indices = [];

  /** A facet-colored box. `node` chooses which animated node it lives in
   *  (geometry is grouped per node so clips can move parts separately). */
  function box(cx, cy, cz, w, h, d, rgb, twist = 0) {
    const corners = [];
    for (const sy of [-0.5, 0.5]) {
      for (const sz of [-0.5, 0.5]) {
        for (const sx of [-0.5, 0.5]) {
          const a = twist * sy;
          const x = sx * w * Math.cos(a) - sz * d * Math.sin(a);
          const z = sx * w * Math.sin(a) + sz * d * Math.cos(a);
          corners.push([
            cx + x + (rand() - 0.5) * 0.02,
            cy + sy * h,
            cz + z + (rand() - 0.5) * 0.02,
          ]);
        }
      }
    }
    const quads = [
      [0, 1, 3, 2], [4, 6, 7, 5], [0, 2, 6, 4],
      [1, 5, 7, 3], [2, 3, 7, 6], [0, 4, 5, 1],
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
          indices.push(positions.length / 3 - 1);
        }
      }
    }
  }

  /** A faceted UV sphere — for anything ALIVE. Boxes read as furniture. */
  function sphere(cx, cy, cz, r, rgb, { squash = 1, rings = 7, segs = 10 } = {}) {
    const vert = (ri, si) => {
      const phi = (ri / rings) * Math.PI;
      const theta = (si / segs) * Math.PI * 2;
      return [
        cx + r * Math.sin(phi) * Math.cos(theta),
        cy + r * Math.cos(phi) * squash,
        cz + r * Math.sin(phi) * Math.sin(theta),
      ];
    };
    for (let ri = 0; ri < rings; ri++) {
      for (let si = 0; si < segs; si++) {
        const quad = [vert(ri, si), vert(ri + 1, si), vert(ri + 1, si + 1), vert(ri, si + 1)];
        const shade = 0.88 + rand() * 0.24;
        for (const tri of [[0, 1, 2], [0, 2, 3]]) {
          for (const idx of tri) {
            positions.push(...quad[idx]);
            colors.push(
              Math.min(1, rgb[0] * shade),
              Math.min(1, rgb[1] * shade),
              Math.min(1, rgb[2] * shade),
            );
            indices.push(positions.length / 3 - 1);
          }
        }
      }
    }
  }

  return { rand, box, sphere, positions, colors, indices };
}

const pad4 = (b, fill = 0) =>
  b.length % 4 === 0 ? b : Buffer.concat([b, Buffer.alloc(4 - (b.length % 4), fill)]);

function toBuffer(arr, Ctor) {
  const typed = new Ctor(arr);
  return Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
}

/**
 * Assemble a .glb.
 *
 * `nodes`: [{ name, geometry: {positions, colors, indices}, translation? }]
 * `clips`: [{ name, channels: [{ node: nodeName, path: 'translation'|'rotation'|'scale',
 *             times: number[], values: number[] }] }]
 */
export function writeGlb(nodes, clips = []) {
  const buffers = [];
  const bufferViews = [];
  const accessors = [];
  let offset = 0;

  const pushView = (buf, componentType, count, type, extras = {}) => {
    const padded = pad4(buf);
    buffers.push(padded);
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: buf.length });
    offset += padded.length;
    accessors.push({ bufferView: bufferViews.length - 1, componentType, count, type, ...extras });
    return accessors.length - 1;
  };

  const meshes = [];
  const gltfNodes = [];
  for (const n of nodes) {
    const { positions, colors, indices } = n.geometry;
    const mins = [Infinity, Infinity, Infinity];
    const maxs = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i += 3) {
      for (let a = 0; a < 3; a++) {
        mins[a] = Math.min(mins[a], positions[i + a]);
        maxs[a] = Math.max(maxs[a], positions[i + a]);
      }
    }
    const posAcc = pushView(toBuffer(positions, Float32Array), 5126, positions.length / 3, 'VEC3', {
      min: mins,
      max: maxs,
    });
    const colAcc = pushView(toBuffer(colors, Float32Array), 5126, colors.length / 3, 'VEC3');
    const idxAcc = pushView(toBuffer(indices, Uint16Array), 5123, indices.length, 'SCALAR');
    meshes.push({
      primitives: [{ attributes: { POSITION: posAcc, COLOR_0: colAcc }, indices: idxAcc, material: 0 }],
    });
    gltfNodes.push({
      name: n.name,
      mesh: meshes.length - 1,
      ...(n.translation ? { translation: n.translation } : {}),
    });
  }

  const animations = clips.map((clip) => {
    const samplers = [];
    const channels = [];
    for (const ch of clip.channels) {
      const nodeIndex = nodes.findIndex((n) => n.name === ch.node);
      if (nodeIndex < 0) throw new Error(`clip ${clip.name}: unknown node ${ch.node}`);
      const timeAcc = pushView(toBuffer(ch.times, Float32Array), 5126, ch.times.length, 'SCALAR', {
        min: [Math.min(...ch.times)],
        max: [Math.max(...ch.times)],
      });
      const size = ch.path === 'rotation' ? 4 : 3;
      const valAcc = pushView(
        toBuffer(ch.values, Float32Array),
        5126,
        ch.values.length / size,
        ch.path === 'rotation' ? 'VEC4' : 'VEC3',
      );
      samplers.push({ input: timeAcc, output: valAcc, interpolation: 'LINEAR' });
      channels.push({
        sampler: samplers.length - 1,
        target: { node: nodeIndex, path: ch.path },
      });
    }
    return { name: clip.name, samplers, channels };
  });

  const bin = Buffer.concat(buffers);
  const gltf = {
    asset: { version: '2.0', generator: 'interverse glb writer' },
    scene: 0,
    scenes: [{ nodes: gltfNodes.map((_, i) => i) }],
    nodes: gltfNodes,
    meshes,
    materials: [
      {
        name: 'facets',
        pbrMetallicRoughness: {
          baseColorFactor: [1, 1, 1, 1],
          metallicFactor: 0,
          roughnessFactor: 0.9,
        },
      },
    ],
    ...(animations.length ? { animations } : {}),
    buffers: [{ byteLength: bin.length }],
    bufferViews,
    accessors,
  };

  const jsonBuf = pad4(Buffer.from(JSON.stringify(gltf)), 0x20);
  const header = Buffer.alloc(12);
  header.write('glTF', 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8);
  const jsonChunk = Buffer.alloc(8);
  jsonChunk.writeUInt32LE(jsonBuf.length, 0);
  jsonChunk.writeUInt32LE(0x4e4f534a, 4);
  const binChunk = Buffer.alloc(8);
  binChunk.writeUInt32LE(bin.length, 0);
  binChunk.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonChunk, jsonBuf, binChunk, bin]);
}
