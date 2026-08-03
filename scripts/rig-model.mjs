/**
 * 🦴 Chop-and-rig: give a STATIC low-poly character real walk/idle clips.
 *
 * Models that arrive without skeletons cannot move their limbs — so this
 * carves the mesh itself: triangles are assigned to body / legL / legR /
 * armL / armR / tail by where they sit, each part becomes its own node
 * pivoted at its joint, and walk + idle animations (leg scissor, arm
 * counter-swing, tail sway, body bob) are baked into the file. three.js
 * plays them like any authored clips. Cuts are hidden by low amplitudes —
 * this is cartoon rigging, not surgery.
 *
 * Tuned for quadruped-ish bipeds authored FACING +X (the LP dino). The
 * output is rotated to face +Z, our engine's forward.
 *
 *   node scripts/rig-model.mjs in.glb out.glb
 */
import { Document, NodeIO } from '@gltf-transform/core';
import { dequantize, prune } from '@gltf-transform/functions';

const [src, dst] = process.argv.slice(2);
if (!src || !dst) {
  console.error('usage: node scripts/rig-model.mjs <in.glb> <out.glb>');
  process.exit(1);
}

const io = new NodeIO();
const srcDoc = await io.read(src);
await srcDoc.transform(dequantize());

const srcPrim = srcDoc.getRoot().listMeshes()[0].listPrimitives()[0];
const pos = srcPrim.getAttribute('POSITION').getArray();
const nrm = srcPrim.getAttribute('NORMAL')?.getArray();
const uv = srcPrim.getAttribute('TEXCOORD_0')?.getArray();
const idx = srcPrim.getIndices().getArray();
const srcMat = srcPrim.getMaterial();

// ---- the model's frame: forward +X, up +Y, sides ±Z ------------------
let min = [1e9, 1e9, 1e9];
let max = [-1e9, -1e9, -1e9];
for (let i = 0; i < pos.length; i += 3) {
  for (let a = 0; a < 3; a++) {
    min[a] = Math.min(min[a], pos[i + a]);
    max[a] = Math.max(max[a], pos[i + a]);
  }
}
const h = max[1] - min[1];
const hipY = min[1] + h * 0.34;
const armLoY = min[1] + h * 0.42;
const armHiY = min[1] + h * 0.75;
const halfZ = Math.max(Math.abs(min[2]), Math.abs(max[2]));
const armZ = halfZ * 0.55;
const tailX = min[0] + (max[0] - min[0]) * 0.22; // rear fifth = tail

/** Which part does a triangle belong to? Centroid decides. */
function regionOf(cx, cy, cz) {
  if (cy < hipY && cx > tailX) return cz >= 0 ? 'legL' : 'legR';
  if (cx < tailX && cy < armHiY) return 'tail';
  if (cy > armLoY && cy < armHiY && Math.abs(cz) > armZ && cx > 0) {
    return cz >= 0 ? 'armL' : 'armR';
  }
  return 'body';
}

const groups = { body: [], legL: [], legR: [], armL: [], armR: [], tail: [] };
for (let t = 0; t < idx.length; t += 3) {
  const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
  const cx = (pos[a * 3] + pos[b * 3] + pos[c * 3]) / 3;
  const cy = (pos[a * 3 + 1] + pos[b * 3 + 1] + pos[c * 3 + 1]) / 3;
  const cz = (pos[a * 3 + 2] + pos[b * 3 + 2] + pos[c * 3 + 2]) / 3;
  groups[regionOf(cx, cy, cz)].push(a, b, c);
}

// Joint pivots: legs at the hip line, arms at their inner-top edge, the
// tail where it meets the rump.
function pivotOf(name, tris) {
  if (name === 'body') return [0, 0, 0];
  let sx = 0;
  let sz = 0;
  let n = 0;
  for (const vi of tris) {
    sx += pos[vi * 3];
    sz += pos[vi * 3 + 2];
    n++;
  }
  const mx = sx / n;
  const mz = sz / n;
  if (name.startsWith('leg')) return [mx, hipY, mz];
  if (name.startsWith('arm')) return [mx, armHiY, mz * 0.8];
  return [tailX, min[1] + h * 0.42, 0]; // tail root
}

// ---- rebuild as a multi-node document --------------------------------
const doc = new Document();
const buffer = doc.createBuffer();
const outMat = doc.createMaterial(srcMat.getName() || 'mat')
  .setBaseColorFactor(srcMat.getBaseColorFactor())
  .setMetallicFactor(srcMat.getMetallicFactor())
  .setRoughnessFactor(srcMat.getRoughnessFactor())
  .setDoubleSided(srcMat.getDoubleSided());
const srcTex = srcMat.getBaseColorTexture();
if (srcTex) {
  const tex = doc.createTexture().setImage(srcTex.getImage()).setMimeType(srcTex.getMimeType());
  outMat.setBaseColorTexture(tex);
}

const scene = doc.createScene();
// The root faces the ENGINE's forward: authored +X snout turns to +Z.
const root = doc.createNode('root').setRotation([0, Math.sin(-Math.PI / 4), 0, Math.cos(-Math.PI / 4)]);
scene.addChild(root);

const nodes = {};
for (const [name, tris] of Object.entries(groups)) {
  if (tris.length === 0) continue;
  const pivot = pivotOf(name, tris);
  // Remap shared vertices into a compact local set, shifted to the pivot.
  const remap = new Map();
  const P = [];
  const N = [];
  const U = [];
  const I = [];
  for (const vi of tris) {
    let m = remap.get(vi);
    if (m === undefined) {
      m = remap.size;
      remap.set(vi, m);
      P.push(pos[vi * 3] - pivot[0], pos[vi * 3 + 1] - pivot[1], pos[vi * 3 + 2] - pivot[2]);
      if (nrm) N.push(nrm[vi * 3], nrm[vi * 3 + 1], nrm[vi * 3 + 2]);
      if (uv) U.push(uv[vi * 2], uv[vi * 2 + 1]);
    }
    I.push(m);
  }
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setArray(new Float32Array(P)).setType('VEC3').setBuffer(buffer))
    .setIndices(doc.createAccessor().setArray(new Uint32Array(I)).setType('SCALAR').setBuffer(buffer))
    .setMaterial(outMat);
  if (nrm) prim.setAttribute('NORMAL', doc.createAccessor().setArray(new Float32Array(N)).setType('VEC3').setBuffer(buffer));
  if (uv) prim.setAttribute('TEXCOORD_0', doc.createAccessor().setArray(new Float32Array(U)).setType('VEC2').setBuffer(buffer));
  const node = doc.createNode(name)
    .setMesh(doc.createMesh(name).addPrimitive(prim))
    .setTranslation(pivot);
  root.addChild(node);
  nodes[name] = node;
  console.log(`${name}: ${tris.length / 3} tris, pivot [${pivot.map((v) => v.toFixed(2)).join(', ')}]`);
}

// ---- the clips -------------------------------------------------------
// Axis picking is everything here. Legs hang DOWN (−Y), so swinging about
// the side axis Z moves feet forward/back — visible. But the T-pose arms
// point ALONG ±Z: rotating them about Z only rolls them on their own long
// axis, which moves nothing on screen. Arms get a baked droop about X
// (goodbye T-pose) plus a forward/back sweep about Y.
const qz = (a) => [0, 0, Math.sin(a / 2), Math.cos(a / 2)]; // leg swing (about side axis Z)
const qy = (a) => [0, Math.sin(a / 2), 0, Math.cos(a / 2)]; // tail wag / arm sweep
const qx = (a) => [Math.sin(a / 2), 0, 0, Math.cos(a / 2)]; // arm droop/flap
const qmul = (q, r) => [
  q[3] * r[0] + q[0] * r[3] + q[1] * r[2] - q[2] * r[1],
  q[3] * r[1] - q[0] * r[2] + q[1] * r[3] + q[2] * r[0],
  q[3] * r[2] + q[0] * r[1] - q[1] * r[0] + q[2] * r[3],
  q[3] * r[3] - q[0] * r[0] - q[1] * r[1] - q[2] * r[2],
];
const DROOP = 0.7; // rest pose: arms angled down, not a scarecrow
/** side: +1 = armL (+Z), -1 = armR (−Z). sweep>0 pushes the paw forward. */
const armPose = (side, sweep, flap = 0) => qmul(qx(side * (DROOP + flap)), qy(sweep));

function addClip(name, channels) {
  const anim = doc.createAnimation(name);
  for (const { node, path, times, values, size } of channels) {
    if (!node) continue;
    const sampler = doc.createAnimationSampler()
      .setInput(doc.createAccessor().setArray(new Float32Array(times)).setType('SCALAR').setBuffer(buffer))
      .setOutput(doc.createAccessor().setArray(new Float32Array(values)).setType(size === 4 ? 'VEC4' : 'VEC3').setBuffer(buffer))
      .setInterpolation('LINEAR');
    anim.addSampler(sampler);
    anim.addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(sampler));
  }
}

const W = 0.55; // one stride
const swing = 0.8;
const armSw = 0.7;
const bodyBase = nodes.body.getTranslation();
addClip('walk', [
  { node: nodes.legL, path: 'rotation', size: 4, times: [0, W / 2, W], values: [...qz(swing), ...qz(-swing), ...qz(swing)] },
  { node: nodes.legR, path: 'rotation', size: 4, times: [0, W / 2, W], values: [...qz(-swing), ...qz(swing), ...qz(-swing)] },
  { node: nodes.armL, path: 'rotation', size: 4, times: [0, W / 2, W], values: [...armPose(1, -armSw), ...armPose(1, armSw), ...armPose(1, -armSw)] },
  { node: nodes.armR, path: 'rotation', size: 4, times: [0, W / 2, W], values: [...armPose(-1, armSw), ...armPose(-1, -armSw), ...armPose(-1, armSw)] },
  { node: nodes.tail, path: 'rotation', size: 4, times: [0, W / 2, W], values: [...qy(0.3), ...qy(-0.3), ...qy(0.3)] },
  {
    node: nodes.body, path: 'translation', size: 3,
    times: [0, W / 4, W / 2, (3 * W) / 4, W],
    values: [
      ...bodyBase,
      bodyBase[0], bodyBase[1] + h * 0.03, bodyBase[2],
      ...bodyBase,
      bodyBase[0], bodyBase[1] + h * 0.03, bodyBase[2],
      ...bodyBase,
    ],
  },
]);
// Idle is NOT frozen: a visible weight-shift foot to foot, arms swaying,
// tail wagging — standing still should still read as a living creature.
const ID = 1.8;
addClip('idle', [
  { node: nodes.tail, path: 'rotation', size: 4, times: [0, ID / 2, ID], values: [...qy(0.22), ...qy(-0.22), ...qy(0.22)] },
  { node: nodes.legL, path: 'rotation', size: 4, times: [0, ID / 2, ID], values: [...qz(0.12), ...qz(-0.12), ...qz(0.12)] },
  { node: nodes.legR, path: 'rotation', size: 4, times: [0, ID / 2, ID], values: [...qz(-0.12), ...qz(0.12), ...qz(-0.12)] },
  { node: nodes.armL, path: 'rotation', size: 4, times: [0, ID / 2, ID], values: [...armPose(1, 0.18, 0.1), ...armPose(1, -0.12, -0.06), ...armPose(1, 0.18, 0.1)] },
  { node: nodes.armR, path: 'rotation', size: 4, times: [0, ID / 2, ID], values: [...armPose(-1, -0.12, -0.06), ...armPose(-1, 0.18, 0.1), ...armPose(-1, -0.12, -0.06)] },
  {
    node: nodes.body, path: 'translation', size: 3,
    times: [0, ID / 2, ID],
    values: [...bodyBase, bodyBase[0], bodyBase[1] + h * 0.02, bodyBase[2], ...bodyBase],
  },
]);

await doc.transform(prune());
await io.write(dst, doc);
const { statSync } = await import('node:fs');
console.log(`${dst}: ${(statSync(dst).size / 1e6).toFixed(2)} MB, clips: walk, idle`);
