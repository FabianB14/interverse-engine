/**
 * 🔻 Vertex-colored low poly — the house style, in 3D.
 *
 * No textures, anywhere. The 2D games ship zero image files because color is
 * data ("never hardcode one-off colors — use palettes"), and this carries the
 * same rule into 3D: a mesh is geometry plus a color PER VERTEX, lit
 * properly. That buys three things at once:
 *
 *   - Size. A vertex-colored character is tens of kilobytes; textures are
 *     what blow the <3MB joiner budget, and there are none.
 *   - Performance. Mid-range phone GPUs are fill-rate bound and hate big
 *     texture fetches; flat-shaded untextured triangles are the cheapest
 *     thing they draw.
 *   - Coherence. Every asset drawn from the same palettes looks like it
 *     belongs to the same world — the Monument Valley / Alto's Odyssey
 *     space, which is a real look and not a fallback.
 *
 * Everything here is deterministic from a seed, same as blobCharacter: art
 * you can regenerate is art you can diff.
 */

import {
  BufferAttribute,
  type BufferGeometry,
  Color,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  Vector3,
} from 'three';

/** Deterministic random — art you can regenerate is art you can diff. */
export function seededRand(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * One material for a whole scene.
 *
 * vertexColors on, flatShading on. Sharing a single material across every
 * low-poly mesh is what keeps the draw-call count down — meshes that share
 * a material can share a shader program, and the color variety all lives in
 * the vertex data instead.
 */
export function lowPolyMaterial(): MeshStandardMaterial {
  return new MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.9,
    metalness: 0,
  });
}

/** Paint every vertex by position. The painter runs on world-ish local
 *  coordinates before any jitter, so bands stay bands. */
export function paintVertices(
  geom: BufferGeometry,
  paint: (x: number, y: number, z: number, set: (c: Color) => void) => void,
): void {
  const pos = geom.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    paint(pos.getX(i), pos.getY(i), pos.getZ(i), (out) => c.copy(out));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geom.setAttribute('color', new BufferAttribute(colors, 3));
}

/**
 * Solid color per FACE, not per vertex.
 *
 * Vertex colors interpolate across every triangle, so painting a pattern at
 * vertex granularity produces gradients — plank stripes come out as smeared
 * brown, spots as pale smudges. Crisp low-poly facets need each triangle to
 * own its three vertices and wear one color, which means non-indexed
 * geometry: this converts (a copy — reassign your reference) and paints by
 * triangle centroid.
 */
export function paintFacets(
  geom: BufferGeometry,
  paint: (cx: number, cy: number, cz: number, set: (c: Color) => void) => void,
): BufferGeometry {
  const flat = geom.index ? geom.toNonIndexed() : geom;
  const pos = flat.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const c = new Color();
  for (let t = 0; t < pos.count; t += 3) {
    const cx = (pos.getX(t) + pos.getX(t + 1) + pos.getX(t + 2)) / 3;
    const cy = (pos.getY(t) + pos.getY(t + 1) + pos.getY(t + 2)) / 3;
    const cz = (pos.getZ(t) + pos.getZ(t + 1) + pos.getZ(t + 2)) / 3;
    paint(cx, cy, cz, (out) => c.copy(out));
    for (let v = 0; v < 3; v++) {
      colors[(t + v) * 3] = c.r;
      colors[(t + v) * 3 + 1] = c.g;
      colors[(t + v) * 3 + 2] = c.b;
    }
  }
  flat.setAttribute('color', new BufferAttribute(colors, 3));
  return flat;
}

/** Nudge vertices by up to `amount`, seeded. Low poly reads as CRAFTED
 *  rather than cheap exactly when the grid stops being visible. */
export function jitterVertices(geom: BufferGeometry, amount: number, seed = 1): void {
  const rand = seededRand(seed);
  const pos = geom.getAttribute('position') as BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(
      i,
      pos.getX(i) + (rand() - 0.5) * amount,
      pos.getY(i) + (rand() - 0.5) * amount,
      pos.getZ(i) + (rand() - 0.5) * amount,
    );
  }
  pos.needsUpdate = true;
  geom.computeVertexNormals();
}

export interface GroundOptions {
  width?: number;
  depth?: number;
  /** Cells per side — keep low; the look IS the low resolution. */
  segments?: number;
  /** Two colors to speckle between, and a third for hollows. */
  base?: number;
  speckle?: number;
  hollow?: number;
  /** Vertical relief. */
  relief?: number;
  seed?: number;
}

/** A speckled, gently creased ground slab. Flat-shaded relief does most of
 *  the work: every crease is a lighting change with zero texels. */
export function lowPolyGround(opts: GroundOptions = {}): Mesh {
  const {
    width = 2400,
    depth = 2400,
    segments = 48,
    base = 0x4e7a46,
    speckle = 0x5d8a50,
    hollow = 0x37503a,
    relief = 16,
    seed = 7,
  } = opts;
  const geom = new PlaneGeometry(width, depth, segments, segments);
  geom.rotateX(-Math.PI / 2);
  jitterVertices(geom, relief, seed);
  const rand = seededRand(seed * 31);
  const cBase = new Color(base);
  const cSpeck = new Color(speckle);
  const cHollow = new Color(hollow);
  paintVertices(geom, (_x, y, _z, set) => {
    // Hollows darken; the rest speckles between two near greens. Color from
    // HEIGHT, so the shape and the shading agree about where the dips are.
    if (y < -relief * 0.2) set(cHollow);
    else set(rand() < 0.35 ? cSpeck : cBase);
  });
  const mesh = new Mesh(geom, lowPolyMaterial());
  mesh.receiveShadow = true;
  return mesh;
}

export interface TreeOptions {
  trunk?: number;
  canopy?: number;
  canopyDark?: number;
  height?: number;
  seed?: number;
}

/** One low-poly swamp tree: a leaning trunk and two jittered canopy blobs. */
export function lowPolyTree(opts: TreeOptions = {}): Group {
  const {
    trunk = 0x6b5230,
    canopy = 0x4e7a46,
    canopyDark = 0x375a33,
    height = 90,
    seed = 1,
  } = opts;
  const rand = seededRand(seed);
  const g = new Group();

  const trunkGeom = new CylinderGeometry(height * 0.06, height * 0.11, height, 5, 2);
  jitterVertices(trunkGeom, height * 0.03, seed * 7);
  const cTrunk = new Color(trunk);
  paintVertices(trunkGeom, (_x, _y, _z, set) => set(cTrunk));
  const trunkMesh = new Mesh(trunkGeom, lowPolyMaterial());
  trunkMesh.position.y = height / 2;
  trunkMesh.rotation.z = (rand() - 0.5) * 0.16;
  trunkMesh.castShadow = true;
  g.add(trunkMesh);

  const cCanopy = new Color(canopy);
  const cDark = new Color(canopyDark);
  for (let i = 0; i < 2; i++) {
    const r = height * (0.34 - i * 0.08);
    const blob = new IcosahedronGeometry(r, 0);
    jitterVertices(blob, r * 0.22, seed * 13 + i);
    // Undersides darker: a one-triangle approximation of self-shadowing.
    paintVertices(blob, (_x, y, _z, set) => set(y < 0 ? cDark : cCanopy));
    const m = new Mesh(blob, lowPolyMaterial());
    m.position.set(
      (rand() - 0.5) * height * 0.3,
      height * (0.95 + i * 0.28),
      (rand() - 0.5) * height * 0.3,
    );
    m.castShadow = true;
    g.add(m);
  }
  return g;
}

/**
 * Many copies of one thing, one draw call.
 *
 * The swamp needs hundreds of trees, and a hundred Meshes is a hundred draw
 * calls — the thing that actually kills mid-range phones. InstancedMesh
 * draws them all at once; the price is that they share geometry, which the
 * per-instance rotation/scale wobble hides well enough at tree-line
 * distance.
 */
export function scatter(
  source: Mesh,
  count: number,
  place: (i: number) => { x: number; z: number; scale?: number; rotY?: number },
): InstancedMesh {
  const inst = new InstancedMesh(source.geometry, source.material, count);
  const mat = new Matrix4();
  const scale = new Vector3();
  for (let i = 0; i < count; i++) {
    const p = place(i);
    const s = p.scale ?? 1;
    mat.makeRotationY(p.rotY ?? 0);
    mat.scale(scale.set(s, s, s));
    mat.setPosition(p.x, 0, p.z);
    inst.setMatrixAt(i, mat);
  }
  inst.castShadow = true;
  inst.instanceMatrix.needsUpdate = true;
  return inst;
}

export interface Blob3Options {
  radius?: number;
  color?: number;
  /** Spot color — a lighter tint of the body, never white: spots roll with
   *  the body, and a white patch under the sun reads as a highlight bug. */
  spots?: number;
  seed?: number;
}

/**
 * The blob, in 3D — and the same split as art/roller.ts: `wheel` spins with
 * the ground, `rider` never does. Cosmetics go on the rider; that is the
 * whole contract, ported.
 */
export interface RollingBlob3 {
  view: Group;
  wheel: Group;
  rider: Group;
  /** Roll forward by `dist` world units (rolling without slipping). */
  roll(dist: number): void;
  readonly spin: number;
}

export function rollingBlob3(opts: Blob3Options = {}): RollingBlob3 {
  const { radius = 10, color = 0x3d9bdd, spots = 0x63b7e8, seed = 4 } = opts;
  const view = new Group();
  const wheel = new Group();
  const rider = new Group();
  view.add(wheel, rider);

  // No belly band: this body ROLLS, so anything painted by height spins
  // round with it — the first cut had a light belly that ended up on top,
  // in the sun, looking like a rendering bug. Spots are fine because spots
  // are supposed to roll (the 2D drawBlob's spots do).
  let geom: BufferGeometry = new SphereGeometry(radius, 12, 9);
  jitterVertices(geom, radius * 0.045, seed);
  const cBody = new Color(color);
  const cSpot = new Color(spots);
  const spotRand = seededRand(seed * 17);
  geom = paintFacets(geom, (_x, _y, _z, set) => {
    set(spotRand() < 0.1 ? cSpot : cBody);
  });
  const body = new Mesh(geom, lowPolyMaterial());
  body.castShadow = true;
  wheel.add(body);

  let spin = 0;
  return {
    view,
    wheel,
    rider,
    roll(dist: number) {
      spin += dist / radius;
      // Rolling toward -z: a positive distance pitches the wheel forward.
      wheel.rotation.x = -spin;
    },
    get spin() {
      return spin;
    },
  };
}
