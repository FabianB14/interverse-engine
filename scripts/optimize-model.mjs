/**
 * Shrink an uploaded .glb for phones — the pipeline that took the Tiny
 * Planet Friends from ~25MB to ~0.4MB each:
 *   - drop normal/metallic-roughness/occlusion/emissive maps (the house
 *     low-poly look only needs albedo)
 *   - resize + webp the albedo (384px, q72)
 *   - weld + simplify to ~3% of the source triangles
 *   - quantize attributes (KHR_mesh_quantization — three.js reads it
 *     natively, no decoder needed)
 *
 *   node scripts/optimize-model.mjs input.glb games/haven/public/models/name.glb
 */
import { NodeIO } from '@gltf-transform/core';
import { prune, quantize, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const [src, dst] = process.argv.slice(2);
if (!src || !dst) {
  console.error('usage: node scripts/optimize-model.mjs <in.glb> <out.glb>');
  process.exit(1);
}
const io = new NodeIO();
const doc = await io.read(src);
for (const mat of doc.getRoot().listMaterials()) {
  mat.setNormalTexture(null);
  mat.setMetallicRoughnessTexture(null);
  mat.setOcclusionTexture(null);
  mat.setEmissiveTexture(null);
  mat.setMetallicFactor(0);
  mat.setRoughnessFactor(0.9);
}
await doc.transform(
  prune(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [384, 384], quality: 72 }),
  weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio: 0.03, error: 0.05 }),
  quantize(),
  prune(),
);
await io.write(dst, doc);
const { statSync } = await import('node:fs');
console.log(`${dst}: ${(statSync(dst).size / 1e6).toFixed(2)} MB`);
