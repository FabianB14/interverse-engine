/**
 * 🎨 The world's bodies, generated from the collision model.
 *
 * The rule that fixed the 2D game, carried over whole: the picture and the
 * rule are the same object. Every hazard here is built FROM its entry in
 * HAZARD_SHAPES — the log's top is the band's `high`, the vines' bottom
 * hem is the band's `low` — so the line you duck under is the line the
 * collision tests, because they are the same number.
 *
 * Everything is painted in NEUTRAL near-greys and tinted per zone through
 * material.color, which multiplies vertex colors. That is how a corner
 * restyles the whole world for the cost of a few color writes instead of
 * a repaint.
 */

import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import { HAZARD_SHAPES, LANE_WIDTH } from '@interverse/core';
import type { HazardKind } from '@interverse/core';
import { jitterVertices, lowPolyMaterial, paintFacets, seededRand } from '@interverse/three';
import { GOLD } from './theme.js';

/** Hazard body width — inside the lane, for the same reason as 2D: art
 *  wider than its lane makes one blocked lane read as a wall. */
export const HAZARD_UNIT = LANE_WIDTH * 0.7;

/** Shared tintable materials — one per category so a zone change is a few
 *  color writes. Vertex paint is neutral; these carry the hue. */
export const MATS = {
  road: lowPolyMaterial(),
  tree: lowPolyMaterial(),
  /** Wood hazards — logs, pit lips. Tinted with the road. */
  hazard: lowPolyMaterial(),
  /** Foliage hazards — the vines. Tinted with the trees, because a curtain
   *  of vines the same brown as the boards reads as a fence, not a plant. */
  leaf: lowPolyMaterial(),
  water: new MeshStandardMaterial({ color: 0x1d3a3c, roughness: 0.3, metalness: 0 }),
};

const grey = (v: number): Color => new Color(v, v, v);

/** A fallen log: a cylinder whose TOP is exactly the band's high. */
function logView(): Group {
  const shape = HAZARD_SHAPES.block;
  const radius = shape.high / 2;
  const g = new Group();
  const geom = new CylinderGeometry(radius, radius, HAZARD_UNIT, 9, 2);
  jitterVertices(geom, radius * 0.08, 5);
  const rand = seededRand(11);
  const painted = paintFacets(geom, (_x, _y, _z, set) => {
    set(grey(0.55 + rand() * 0.2));
  });
  const log = new Mesh(painted, MATS.hazard);
  log.rotation.z = Math.PI / 2; // lie across the lane
  log.position.y = radius; // top lands on shape.high
  log.castShadow = true;
  g.add(log);
  return g;
}

/** Hanging vines: strands from the canopy bar down to EXACTLY band.low —
 *  the hem IS the duck-under line. */
function vinesView(kind: 'barrier' | 'low'): Group {
  const shape = HAZARD_SHAPES[kind];
  const g = new Group();
  const rand = seededRand(kind === 'barrier' ? 23 : 29);
  const top = Math.min(shape.high, 320);
  // The branch you cannot jump over — chunky, so "over is wrong" reads.
  const barGeom = new CylinderGeometry(14, 17, HAZARD_UNIT * 1.1, 7);
  jitterVertices(barGeom, 4, 31);
  const barPainted = paintFacets(barGeom, (_x, _y, _z, set) => set(grey(0.38 + rand() * 0.1)));
  const bar = new Mesh(barPainted, MATS.hazard);
  bar.rotation.z = Math.PI / 2;
  bar.position.y = top;
  bar.castShadow = true;
  g.add(bar);
  // Strands: thin, uneven, sagging — a PLANT, not a fence. Every strand
  // still ends on the same hem, because the hem is the collision line and
  // the picture and the rule are the same object.
  const strands = 5;
  for (let i = 0; i < strands; i++) {
    const x = (i / (strands - 1) - 0.5) * HAZARD_UNIT * (0.86 + rand() * 0.1);
    const len = top - shape.low;
    const sGeom = new CylinderGeometry(2.2, 4.2, len, 4);
    const sPainted = paintFacets(sGeom, (_x2, _y2, _z2, set) => set(grey(0.48 + rand() * 0.2)));
    const s = new Mesh(sPainted, MATS.leaf);
    s.position.set(x, shape.low + len / 2, (rand() - 0.5) * 20);
    s.rotation.z = (rand() - 0.5) * 0.1;
    s.rotation.x = (rand() - 0.5) * 0.08;
    g.add(s);
    // A leaf tuft partway down each strand, so the silhouette is organic.
    const tuftGeom = new SphereGeometry(9 + rand() * 6, 5, 4);
    const tuft = new Mesh(
      paintFacets(tuftGeom, (_x3, _y3, _z3, set) => set(grey(0.55 + rand() * 0.15))),
      MATS.leaf,
    );
    tuft.position.set(x + (rand() - 0.5) * 10, shape.low + len * (0.3 + rand() * 0.5), 0);
    g.add(tuft);
  }
  return g;
}

/** A pit: a dark mouth in the boards with a raised lip you can read. */
function pitView(): Group {
  const g = new Group();
  const mouthGeom = new BoxGeometry(HAZARD_UNIT, 4, LANE_WIDTH * 0.9);
  const mouth = new Mesh(
    paintFacets(mouthGeom, (_x, _y, _z, set) => set(grey(0.05))),
    MATS.hazard,
  );
  mouth.position.y = 4;
  g.add(mouth);
  const lipGeom = new TorusGeometry(HAZARD_UNIT * 0.52, 5, 6, 12);
  const lip = new Mesh(
    paintFacets(lipGeom, (_x, _y, _z, set) => set(grey(0.35))),
    MATS.hazard,
  );
  lip.rotation.x = Math.PI / 2;
  lip.position.y = 6;
  g.add(lip);
  return g;
}

export function hazardView3(kind: HazardKind): Group {
  if (kind === 'block') return logView();
  if (kind === 'pit') return pitView();
  return vinesView(kind);
}

/** A coin: a fat golden disc. Unshared material — coins are always gold. */
const COIN_MAT = new MeshStandardMaterial({
  color: GOLD,
  emissive: GOLD,
  emissiveIntensity: 0.35,
  roughness: 0.4,
});

export function coinView3(): Mesh {
  // Half the blob's radius. A coin near the camera looms in perspective,
  // and one sized against the lane (as in 2D) fills a third of the screen.
  const geom = new CylinderGeometry(22, 22, 8, 10);
  const coin = new Mesh(geom, COIN_MAT);
  coin.rotation.x = Math.PI / 2;
  return coin;
}

/** A swamp tree for the roadside — neutral paint, zone tint does the rest. */
export function treeView3(seed: number): Group {
  const g = new Group();
  const rand = seededRand(seed);
  const h = 420 + rand() * 220;
  const trunkGeom = new CylinderGeometry(h * 0.05, h * 0.1, h, 5, 2);
  jitterVertices(trunkGeom, h * 0.02, seed * 3);
  const trunk = new Mesh(
    paintFacets(trunkGeom, (_x, _y, _z, set) => set(grey(0.34 + rand() * 0.08))),
    MATS.tree,
  );
  trunk.position.y = h / 2;
  trunk.rotation.z = (rand() - 0.5) * 0.14;
  trunk.castShadow = true;
  g.add(trunk);
  for (let i = 0; i < 2; i++) {
    const r = h * (0.3 - i * 0.07);
    const blobGeom = new IcosahedronGeometry(r, 0);
    jitterVertices(blobGeom, r * 0.24, seed * 7 + i);
    const blob = new Mesh(
      paintFacets(blobGeom, (_x, y, _z, set) => set(grey(y < 0 ? 0.42 : 0.6))),
      MATS.tree,
    );
    blob.position.set((rand() - 0.5) * h * 0.24, h * (0.9 + i * 0.26), (rand() - 0.5) * h * 0.24);
    blob.castShadow = true;
    g.add(blob);
  }
  return g;
}

/** Hats — worn on the RIDER, never the wheel, exactly as in 2D. A small
 *  catalogue; any hat bought in the 2D shop that has no 3D body yet falls
 *  back to the party cone rather than to nothing. */
export function hatView3(id: string): Group | null {
  const g = new Group();
  const mat = lowPolyMaterial();
  const paint = (geom: Parameters<typeof paintFacets>[0], c: Color) =>
    paintFacets(geom, (_x, _y, _z, set) => set(c));
  if (id === 'none') return null;
  if (id === 'cap') {
    const dome = new Mesh(paint(new SphereGeometry(30, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), new Color(0x2f8fbf)), mat);
    const brim = new Mesh(paint(new BoxGeometry(34, 6, 30), new Color(0x24709a)), brimMat());
    brim.position.set(0, 2, -30);
    g.add(dome, brim);
  } else if (id === 'horns') {
    for (const side of [-1, 1]) {
      const horn = new Mesh(paint(new CylinderGeometry(3, 11, 34, 6), new Color(0xe8e2cc)), mat);
      horn.position.set(side * 24, 12, 0);
      horn.rotation.z = side * -0.5;
      g.add(horn);
    }
  } else if (id === 'crown') {
    const band = new Mesh(paint(new CylinderGeometry(26, 26, 16, 8, 1, true), new Color(0xe6b33f)), mat);
    band.position.y = 8;
    g.add(band);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const spike = new Mesh(paint(new CylinderGeometry(1.5, 6, 16, 4), new Color(0xe6b33f)), mat);
      spike.position.set(Math.cos(a) * 24, 22, Math.sin(a) * 24);
      g.add(spike);
    }
  } else if (id === 'halo') {
    const ring = new Mesh(paint(new TorusGeometry(26, 4.5, 6, 14), new Color(0xfff2b0)), haloMat());
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 26;
    g.add(ring);
  } else {
    // party / top / prop / anything future: the celebratory default.
    const cone = new Mesh(paint(new CylinderGeometry(1, 24, 52, 8), new Color(0x2fbf8a)), mat);
    cone.position.y = 26;
    const pom = new Mesh(paint(new SphereGeometry(7, 6, 5), new Color(0xff6f91)), mat);
    pom.position.y = 54;
    g.add(cone, pom);
  }
  g.traverse((o) => {
    (o as Mesh).castShadow = true;
  });
  return g;
}

function brimMat(): MeshStandardMaterial {
  return lowPolyMaterial();
}

function haloMat(): MeshStandardMaterial {
  const m = lowPolyMaterial();
  m.emissive = new Color(0xfff2b0);
  m.emissiveIntensity = 1.2;
  return m;
}
