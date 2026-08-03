/**
 * 🏡 Blobhaven's bodies — the island yard, the house you can walk into,
 * the furniture catalogue, and the blob avatars that wear the cosmetics.
 *
 * Everything is code-drawn primitives in the cozy-autumn family: warm
 * terracotta, cream, moss and honey. Albedo sits a step darker than the
 * screen target because ACES lifts it (the rule every 3D game here
 * relearned once and now just follows).
 */

import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import { jitterVertices, loadModel, lowPolyMaterial, lowPolyTree, paintFacets, seededRand } from '@interverse/three';
import { MODEL_DECOR } from './store.js';
import type { HouseTheme } from './store.js';

const mat = (): MeshStandardMaterial => lowPolyMaterial();

/** How many model-decor loads have finished — a verify gate reads this. */
export const modelStats = { loaded: 0 };

const paint = (geom: Parameters<typeof paintFacets>[0], c: number): ReturnType<typeof paintFacets> =>
  paintFacets(geom, (_x, _y, _z, set) => set(new Color(c)));

function shadowed(g: Group): Group {
  g.traverse((o) => {
    const m = o as Mesh;
    if (m.isMesh) m.castShadow = true;
  });
  return g;
}

// ------------------------------------------------------------ the world

/** Yard floor: a big soft island disc. Flat on purpose — this is a hub
 *  people wander while chatting, not a platformer. */
export function islandView(radius: number): Group {
  const g = new Group();
  const rand = seededRand(11);
  // No jitter here: a cylinder's cap and wall don't share vertices, so
  // displacement tears white seams between them. Facet paint alone gives
  // the low-poly read.
  const topGeom = new CylinderGeometry(radius, radius * 0.94, 60, 28, 2);
  const gA = 0x5d8a50;
  const gB = 0x6d9a58;
  const top = new Mesh(
    paintFacets(topGeom, (_x, y, _z, set) => set(new Color(y > 10 ? (rand() < 0.5 ? gA : gB) : 0x6b5230))),
    mat(),
  );
  top.position.y = -30;
  top.receiveShadow = true;
  g.add(top);
  return g;
}

/** The path from spawn to the front door — worn honey-colored stones. */
export function pathView(fromZ: number, toZ: number): Group {
  const g = new Group();
  const rand = seededRand(23);
  const n = Math.ceil(Math.abs(toZ - fromZ) / 130);
  for (let i = 0; i <= n; i++) {
    const z = fromZ + ((toZ - fromZ) * i) / n;
    const stoneGeom = new CylinderGeometry(46 + rand() * 16, 52 + rand() * 16, 10, 6);
    const stone = new Mesh(paint(stoneGeom, rand() < 0.5 ? 0x9a8a68 : 0x8a7a5c), mat());
    stone.position.set((rand() - 0.5) * 40, 4, z);
    stone.rotation.y = rand() * Math.PI;
    stone.receiveShadow = true;
    g.add(stone);
  }
  return g;
}

export interface HouseSpec {
  /** Centre of the house footprint in yard space. */
  x: number;
  z: number;
  w: number;
  d: number;
  /** Door strip: centred on x, this wide, on the +z face. */
  doorW: number;
  /** 1 = cottage, 2 = manor with a loft up the stairs. */
  stories: number;
}

/** The house from outside — walls, roof, door and windows all wear the
 *  owner's THEME, and a second story stacks a real floor of windows. */
export function houseExterior(spec: HouseSpec, theme: HouseTheme): Group {
  const g = new Group();
  const wallH = spec.stories > 1 ? 520 : 300;
  const walls = new Mesh(paint(new BoxGeometry(spec.w, wallH, spec.d), theme.wall), mat());
  walls.position.set(spec.x, wallH / 2, spec.z);
  g.add(walls);
  // A trim band between stories, so "two floors" reads at a distance.
  if (spec.stories > 1) {
    const band = new Mesh(paint(new BoxGeometry(spec.w + 16, 18, spec.d + 16), theme.roof), mat());
    band.position.set(spec.x, 300, spec.z);
    g.add(band);
  }
  const roofGeom = new ConeGeometry(Math.max(spec.w, spec.d) * 0.78, spec.stories > 1 ? 240 : 200, 4);
  const roof = new Mesh(paint(roofGeom, theme.roof), mat());
  roof.position.set(spec.x, wallH + (spec.stories > 1 ? 118 : 98), spec.z);
  roof.rotation.y = Math.PI / 4;
  g.add(roof);
  // Door on the +z face — slightly proud of the wall so it reads at a
  // distance. This is the SAME rectangle the walk-in trigger uses; the
  // picture and the rule are one object.
  const door = new Mesh(paint(new BoxGeometry(spec.doorW, 190, 14), theme.door), mat());
  door.position.set(spec.x, 95, spec.z + spec.d / 2 + 5);
  g.add(door);
  const knob = new Mesh(paint(new SphereGeometry(8, 6, 5), 0xe8c860), mat());
  knob.position.set(spec.x + spec.doorW / 2 - 24, 95, spec.z + spec.d / 2 + 14);
  g.add(knob);
  // Windows, glowing from the life inside — one row per story.
  for (let story = 0; story < spec.stories; story++) {
    for (const side of [-1, 1]) {
      const win = new Mesh(paint(new BoxGeometry(70, 70, 10), 0xffe9a8), winGlowMat());
      win.position.set(spec.x + side * spec.w * 0.3, 170 + story * 240, spec.z + spec.d / 2 + 4);
      g.add(win);
    }
  }
  return shadowed(g);
}

function winGlowMat(): MeshStandardMaterial {
  const m = lowPolyMaterial();
  m.emissive = new Color(0xffd894);
  m.emissiveIntensity = 0.7;
  return m;
}

/** The house from inside: its own little box of warm light, wearing the
 *  owner's theme. Bounds are half-extents; the door mat marks the exit on
 *  the +z wall. A 2-story house gets STAIRS in the back-left corner —
 *  the same rectangle the go-upstairs trigger reads. */
export function houseInterior(
  halfW: number,
  halfD: number,
  doorW: number,
  theme: HouseTheme,
  opts: { stairs?: boolean } = {},
): Group {
  const g = new Group();
  const floor = new Mesh(paint(new BoxGeometry(halfW * 2, 16, halfD * 2), theme.floor), mat());
  floor.position.y = -8;
  floor.receiveShadow = true;
  g.add(floor);
  const wallH = 340;
  const mkWall = (w: number, d: number, x: number, z: number): void => {
    const wall = new Mesh(paint(new BoxGeometry(w, wallH, d), theme.inWall), mat());
    wall.position.set(x, wallH / 2, z);
    wall.receiveShadow = true;
    g.add(wall);
  };
  mkWall(halfW * 2 + 40, 20, 0, -halfD - 10); // back
  mkWall(20, halfD * 2, -halfW - 10, 0); // left
  mkWall(20, halfD * 2, halfW + 10, 0); // right
  // Front wall in two pieces, leaving the doorway open.
  const seg = halfW - doorW / 2;
  mkWall(seg, 20, -(doorW / 2 + seg / 2), halfD + 10);
  mkWall(seg, 20, doorW / 2 + seg / 2, halfD + 10);
  // Window on the back wall, glowing dusk.
  const win = new Mesh(paint(new BoxGeometry(120, 90, 12), 0xa8d8ff), winGlowMat());
  win.position.set(0, 190, -halfD - 2);
  g.add(win);
  // Door mat: the exit's picture.
  const matRug = new Mesh(paint(new CylinderGeometry(70, 70, 6, 8), theme.roof), mat());
  matRug.position.set(0, 3, halfD - 60);
  g.add(matRug);
  if (opts.stairs) {
    // Steps rising along the left wall toward the back corner.
    for (let i = 0; i < 6; i++) {
      const step = new Mesh(paint(new BoxGeometry(150, 24, 60), theme.door), mat());
      step.position.set(-halfW + 90, 12 + i * 24, -halfD + 260 - i * 55);
      step.castShadow = true;
      g.add(step);
    }
    const rail = new Mesh(paint(new BoxGeometry(14, 170, 340), theme.roof), mat());
    rail.position.set(-halfW + 170, 100, -halfD + 130);
    g.add(rail);
  }
  return g;
}

/** The loft — the manor's upstairs. Smaller than the ground floor, warm
 *  rail around the stairwell, its own round window. */
export function loftInterior(halfW: number, halfD: number, theme: HouseTheme): Group {
  const g = new Group();
  const floor = new Mesh(paint(new BoxGeometry(halfW * 2, 16, halfD * 2), theme.floor), mat());
  floor.position.y = -8;
  floor.receiveShadow = true;
  g.add(floor);
  const wallH = 300;
  const mkWall = (w: number, d: number, x: number, z: number): void => {
    const wall = new Mesh(paint(new BoxGeometry(w, wallH, d), theme.inWall), mat());
    wall.position.set(x, wallH / 2, z);
    wall.receiveShadow = true;
    g.add(wall);
  };
  mkWall(halfW * 2 + 40, 20, 0, -halfD - 10);
  mkWall(halfW * 2 + 40, 20, 0, halfD + 10);
  mkWall(20, halfD * 2, -halfW - 10, 0);
  mkWall(20, halfD * 2, halfW + 10, 0);
  // The stairwell opening's rail — the way back down lives inside it.
  const rail1 = new Mesh(paint(new BoxGeometry(14, 90, 360), theme.door), mat());
  rail1.position.set(-halfW + 180, 45, -halfD + 200);
  g.add(rail1);
  const rail2 = new Mesh(paint(new BoxGeometry(180, 90, 14), theme.door), mat());
  rail2.position.set(-halfW + 100, 45, -halfD + 380);
  g.add(rail2);
  // A round window for the loft — moonlight.
  const win = new Mesh(paint(new CylinderGeometry(60, 60, 12, 12), 0xa8d8ff), winGlowMat());
  win.rotation.x = Math.PI / 2;
  win.position.set(0, 190, -halfD - 2);
  g.add(win);
  return g;
}

/** Trees for the big island: a ring at the rim plus a loose scatter
 *  inland, thinned near the house and the spawn path so the middle stays
 *  a meadow you can actually decorate. */
export function yardTrees(radius: number, avoid: { x: number; z: number; r: number }[]): Group {
  const g = new Group();
  const rand = seededRand(31);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + rand() * 0.3;
    const r = radius * (0.86 + rand() * 0.08);
    const tree = lowPolyTree({ height: 200 + rand() * 140, seed: i * 13 + 5 });
    tree.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    g.add(tree);
  }
  for (let i = 0; i < 22; i++) {
    const a = rand() * Math.PI * 2;
    const r = radius * (0.3 + rand() * 0.52);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (avoid.some((k) => Math.hypot(x - k.x, z - k.z) < k.r)) continue;
    const tree = lowPolyTree({ height: 170 + rand() * 160, seed: i * 29 + 7 });
    tree.position.set(x, 0, z);
    g.add(tree);
  }
  return shadowed(g);
}

/** A pond: still water in a stone lip, for the far meadow. */
export function pondView(x: number, z: number, r: number): Group {
  const g = new Group();
  const lip = new Mesh(paint(new CylinderGeometry(r + 26, r + 40, 26, 18), 0x9a8a68), mat());
  lip.position.set(x, 13, z);
  g.add(lip);
  const water = new Mesh(paint(new CylinderGeometry(r, r, 10, 18), 0x5a9ac8), waterMat());
  water.position.set(x, 22, z);
  g.add(water);
  const pad = new Mesh(paint(new CylinderGeometry(26, 26, 4, 8), 0x5d8a50), mat());
  pad.position.set(x + r * 0.4, 28, z - r * 0.3);
  g.add(pad);
  return g;
}

/** Mossy boulder clusters — landmarks so the big meadow has bones. */
export function rockCluster(x: number, z: number, seed: number): Group {
  const g = new Group();
  const rand = seededRand(seed);
  for (let i = 0; i < 3 + Math.floor(rand() * 3); i++) {
    const r = 40 + rand() * 70;
    const geom = new SphereGeometry(r, 6, 5);
    jitterVertices(geom, r * 0.18, seed + i);
    const rock = new Mesh(
      paintFacets(geom, (_x, y, _z, set) => set(new Color(y > r * 0.3 ? 0x6d8a5e : 0x8a8a84))),
      mat(),
    );
    rock.scale.y = 0.6 + rand() * 0.25;
    rock.position.set(x + (rand() - 0.5) * 180, 0, z + (rand() - 0.5) * 180);
    rock.castShadow = true;
    g.add(rock);
  }
  return g;
}

// ------------------------------------------------------- the furniture

export interface CatalogueItem {
  id: string;
  label: string;
  emoji: string;
  rooms: readonly ('yard' | 'house' | 'loft')[];
  build: (seed: number) => Group;
}

const buildPlant = (seed: number): Group => {
  const g = new Group();
  const rand = seededRand(seed);
  const pot = new Mesh(paint(new CylinderGeometry(30, 22, 40, 7), 0xa8543a), mat());
  pot.position.y = 20;
  g.add(pot);
  for (let i = 0; i < 3; i++) {
    const leafGeom = new ConeGeometry(14 + rand() * 6, 60 + rand() * 30, 5);
    const leaf = new Mesh(paint(leafGeom, i % 2 ? 0x5d8a50 : 0x4e7a46), mat());
    leaf.position.set((rand() - 0.5) * 22, 60 + rand() * 14, (rand() - 0.5) * 22);
    leaf.rotation.z = (rand() - 0.5) * 0.5;
    g.add(leaf);
  }
  return shadowed(g);
};

const buildFlower = (seed: number): Group => {
  const g = new Group();
  const rand = seededRand(seed);
  for (let i = 0; i < 4; i++) {
    const stem = new Mesh(paint(new CylinderGeometry(2.5, 3.5, 40 + rand() * 20, 4), 0x4e7a46), mat());
    const x = (rand() - 0.5) * 60;
    const z = (rand() - 0.5) * 60;
    stem.position.set(x, 24, z);
    g.add(stem);
    const bloom = new Mesh(
      paint(new SphereGeometry(9 + rand() * 4, 6, 5), [0xe07a5f, 0xf2cc8f, 0xc77dff, 0xff6f91][i % 4]!),
      mat(),
    );
    bloom.position.set(x, 50 + rand() * 18, z);
    g.add(bloom);
  }
  return shadowed(g);
};

const buildLamp = (): Group => {
  const g = new Group();
  const post = new Mesh(paint(new CylinderGeometry(6, 8, 150, 6), 0x4a4038), mat());
  post.position.y = 75;
  g.add(post);
  const shade = new Mesh(paint(new BoxGeometry(40, 40, 40), 0xffe9a8), winGlowMat());
  shade.position.y = 165;
  g.add(shade);
  const cap = new Mesh(paint(new ConeGeometry(34, 30, 4), 0x4a4038), mat());
  cap.position.y = 198;
  cap.rotation.y = Math.PI / 4;
  g.add(cap);
  return shadowed(g);
};

const buildBench = (): Group => {
  const g = new Group();
  const seat = new Mesh(paint(new BoxGeometry(150, 14, 50), 0x8a6a48), mat());
  seat.position.y = 50;
  g.add(seat);
  const back = new Mesh(paint(new BoxGeometry(150, 60, 12), 0x8a6a48), mat());
  back.position.set(0, 90, -22);
  g.add(back);
  for (const sx of [-60, 60]) {
    const leg = new Mesh(paint(new BoxGeometry(14, 50, 44), 0x6a4a32), mat());
    leg.position.set(sx, 25, 0);
    g.add(leg);
  }
  return shadowed(g);
};

const buildTable = (): Group => {
  const g = new Group();
  const top = new Mesh(paint(new CylinderGeometry(70, 70, 12, 8), 0x8a6a48), mat());
  top.position.y = 74;
  g.add(top);
  const leg = new Mesh(paint(new CylinderGeometry(10, 14, 70, 6), 0x6a4a32), mat());
  leg.position.y = 35;
  g.add(leg);
  const mug = new Mesh(paint(new CylinderGeometry(10, 9, 16, 7), 0xe07a5f), mat());
  mug.position.set(20, 88, 8);
  g.add(mug);
  return shadowed(g);
};

const buildChair = (): Group => {
  const g = new Group();
  const seat = new Mesh(paint(new BoxGeometry(52, 12, 52), 0x9a7a58), mat());
  seat.position.y = 44;
  g.add(seat);
  const back = new Mesh(paint(new BoxGeometry(52, 60, 10), 0x9a7a58), mat());
  back.position.set(0, 80, -21);
  g.add(back);
  for (const [sx, sz] of [[-20, -20], [20, -20], [-20, 20], [20, 20]] as const) {
    const leg = new Mesh(paint(new CylinderGeometry(5, 5, 44, 5), 0x6a4a32), mat());
    leg.position.set(sx, 22, sz);
    g.add(leg);
  }
  return shadowed(g);
};

const buildRug = (): Group => {
  const g = new Group();
  const outer = new Mesh(paint(new CylinderGeometry(110, 110, 5, 10), 0xa8543a), mat());
  outer.position.y = 2.5;
  outer.receiveShadow = true;
  g.add(outer);
  const inner = new Mesh(paint(new CylinderGeometry(70, 70, 6, 10), 0xe0b878), mat());
  inner.position.y = 3;
  g.add(inner);
  return g;
};

const buildShelf = (): Group => {
  const g = new Group();
  const rand = seededRand(47);
  const frame = new Mesh(paint(new BoxGeometry(120, 200, 40), 0x6a4a32), mat());
  frame.position.y = 100;
  g.add(frame);
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 5; i++) {
      const book = new Mesh(
        paint(new BoxGeometry(14, 34 + rand() * 8, 26), [0xe07a5f, 0x81b29a, 0xf2cc8f, 0x6fc3ff][Math.floor(rand() * 4)]!),
        mat(),
      );
      book.position.set(-44 + i * 20 + rand() * 4, 48 + row * 58, 2);
      g.add(book);
    }
  }
  return shadowed(g);
};

const buildFountain = (): Group => {
  const g = new Group();
  const basin = new Mesh(paint(new CylinderGeometry(90, 100, 40, 10), 0x9a8a68), mat());
  basin.position.y = 20;
  g.add(basin);
  const water = new Mesh(paint(new CylinderGeometry(78, 78, 8, 10), 0x6fc3ff), waterMat());
  water.position.y = 42;
  g.add(water);
  const spire = new Mesh(paint(new CylinderGeometry(12, 18, 80, 7), 0x9a8a68), mat());
  spire.position.y = 80;
  g.add(spire);
  const drop = new Mesh(paint(new SphereGeometry(16, 6, 5), 0x8fd0ff), waterMat());
  drop.position.y = 128;
  drop.name = 'bob'; // the main loop bobs anything named bob
  g.add(drop);
  return shadowed(g);
};

function waterMat(): MeshStandardMaterial {
  const m = lowPolyMaterial();
  m.emissive = new Color(0x2a4a6a);
  m.emissiveIntensity = 0.4;
  return m;
}

const buildMailbox = (): Group => {
  const g = new Group();
  const post = new Mesh(paint(new CylinderGeometry(5, 6, 90, 5), 0x6a4a32), mat());
  post.position.y = 45;
  g.add(post);
  const box = new Mesh(paint(new BoxGeometry(50, 34, 30), 0xe07a5f), mat());
  box.position.y = 102;
  g.add(box);
  const flag = new Mesh(paint(new BoxGeometry(6, 20, 4), 0xf2cc8f), mat());
  flag.position.set(28, 116, 0);
  g.add(flag);
  return shadowed(g);
};

const buildMushroom = (seed: number): Group => {
  const g = new Group();
  const rand = seededRand(seed);
  for (let i = 0; i < 3; i++) {
    const h = 24 + rand() * 26;
    const stem = new Mesh(paint(new CylinderGeometry(7, 9, h, 6), 0xe8dcc0), mat());
    const x = (rand() - 0.5) * 50;
    const z = (rand() - 0.5) * 50;
    stem.position.set(x, h / 2, z);
    g.add(stem);
    const cap = new Mesh(paint(new SphereGeometry(14 + rand() * 8, 7, 5), 0xe07a5f), mat());
    cap.scale.y = 0.62;
    cap.position.set(x, h + 4, z);
    g.add(cap);
  }
  return shadowed(g);
};

const buildBed = (): Group => {
  const g = new Group();
  const frame = new Mesh(paint(new BoxGeometry(120, 40, 190), 0x6a4a32), mat());
  frame.position.y = 20;
  g.add(frame);
  const mattress = new Mesh(paint(new BoxGeometry(110, 20, 180), 0xe8dcc0), mat());
  mattress.position.y = 50;
  g.add(mattress);
  const blanket = new Mesh(paint(new BoxGeometry(110, 12, 110), 0x81b29a), mat());
  blanket.position.set(0, 62, 30);
  g.add(blanket);
  const pillow = new Mesh(paint(new BoxGeometry(80, 16, 40), 0xf6efe0), mat());
  pillow.position.set(0, 64, -60);
  g.add(pillow);
  const head = new Mesh(paint(new BoxGeometry(120, 70, 14), 0x6a4a32), mat());
  head.position.set(0, 70, -96);
  g.add(head);
  return shadowed(g);
};

// Premium pieces — bought once in the store, then placed like anything.

const buildCampfire = (): Group => {
  const g = new Group();
  const rand = seededRand(53);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const log = new Mesh(paint(new CylinderGeometry(9, 11, 90, 6), 0x6a4a32), mat());
    log.position.set(Math.cos(a) * 30, 14, Math.sin(a) * 30);
    log.rotation.z = Math.PI / 2.3;
    log.rotation.y = a;
    g.add(log);
  }
  const flameMat = lowPolyMaterial();
  flameMat.emissive = new Color(0xff8a3a);
  flameMat.emissiveIntensity = 1.4;
  for (let i = 0; i < 3; i++) {
    const flame = new Mesh(paint(new ConeGeometry(16 - i * 4, 46 + i * 18, 5), 0xffb35a), flameMat);
    flame.position.set((rand() - 0.5) * 14, 34 + i * 8, (rand() - 0.5) * 14);
    flame.name = 'bob';
    g.add(flame);
  }
  return shadowed(g);
};

const buildSwing = (): Group => {
  const g = new Group();
  for (const sx of [-70, 70]) {
    const post = new Mesh(paint(new CylinderGeometry(7, 9, 200, 6), 0x6a4a32), mat());
    post.position.set(sx, 100, 0);
    post.rotation.z = sx > 0 ? -0.12 : 0.12;
    g.add(post);
  }
  const bar = new Mesh(paint(new CylinderGeometry(6, 6, 170, 6), 0x6a4a32), mat());
  bar.rotation.z = Math.PI / 2;
  bar.position.y = 196;
  g.add(bar);
  for (const sx of [-26, 26]) {
    const rope = new Mesh(paint(new CylinderGeometry(2, 2, 130, 4), 0xe8dcc0), mat());
    rope.position.set(sx, 128, 0);
    g.add(rope);
  }
  const seat = new Mesh(paint(new BoxGeometry(70, 8, 30), 0xa8543a), mat());
  seat.position.y = 62;
  g.add(seat);
  return shadowed(g);
};

const buildTelescope = (): Group => {
  const g = new Group();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = new Mesh(paint(new CylinderGeometry(4, 5, 110, 5), 0x4a4038), mat());
    leg.position.set(Math.cos(a) * 30, 52, Math.sin(a) * 30);
    leg.rotation.x = Math.sin(a) * 0.3;
    leg.rotation.z = Math.cos(a) * 0.3;
    g.add(leg);
  }
  const tube = new Mesh(paint(new CylinderGeometry(16, 22, 130, 8), 0x3a628a), mat());
  tube.position.set(0, 130, 0);
  tube.rotation.x = -0.7;
  g.add(tube);
  const eye = new Mesh(paint(new CylinderGeometry(8, 8, 18, 6), 0xe6b33f), mat());
  eye.position.set(0, 100, 42);
  eye.rotation.x = -0.7;
  g.add(eye);
  return shadowed(g);
};

const buildPiano = (): Group => {
  const g = new Group();
  const body = new Mesh(paint(new BoxGeometry(170, 100, 70), 0x22222e), mat());
  body.position.set(0, 90, -10);
  g.add(body);
  const keybed = new Mesh(paint(new BoxGeometry(170, 12, 40), 0x2a2a36), mat());
  keybed.position.set(0, 66, 30);
  g.add(keybed);
  const keys = new Mesh(paint(new BoxGeometry(160, 8, 34), 0xf2ede0), mat());
  keys.position.set(0, 70, 32);
  g.add(keys);
  const rand = seededRand(61);
  for (let i = 0; i < 7; i++) {
    if (rand() < 0.4) continue;
    const black = new Mesh(paint(new BoxGeometry(9, 6, 18), 0x14141c), mat());
    black.position.set(-66 + i * 22, 76, 26);
    g.add(black);
  }
  for (const sx of [-72, 72]) {
    const leg = new Mesh(paint(new BoxGeometry(14, 60, 14), 0x22222e), mat());
    leg.position.set(sx, 30, 20);
    g.add(leg);
  }
  return shadowed(g);
};

const buildAquarium = (): Group => {
  const g = new Group();
  const stand = new Mesh(paint(new BoxGeometry(150, 60, 60), 0x6a4a32), mat());
  stand.position.y = 30;
  g.add(stand);
  const tankMat = lowPolyMaterial();
  tankMat.emissive = new Color(0x2a6a8a);
  tankMat.emissiveIntensity = 0.8;
  const tank = new Mesh(paint(new BoxGeometry(140, 80, 50), 0x5ab0d8), tankMat);
  tank.position.y = 100;
  g.add(tank);
  const rand = seededRand(67);
  for (let i = 0; i < 3; i++) {
    const fish = new Mesh(
      paint(new SphereGeometry(9, 5, 4), [0xff9a4a, 0xffd166, 0xff6f91][i]!),
      mat(),
    );
    fish.scale.x = 1.6;
    fish.position.set((rand() - 0.5) * 100, 90 + rand() * 30, (rand() - 0.5) * 20);
    fish.name = 'bob';
    g.add(fish);
  }
  return shadowed(g);
};

/** A .glb furnishing: the group mounts instantly (so placement feels
 *  immediate) and the model pops in when the load lands. loadModel caches
 *  by URL, so ten gnomes cost one fetch. */
const buildModelItem = (url: string, height: number): Group => {
  const g = new Group();
  void loadModel(url, { height })
    .then((m) => {
      g.add(m);
      modelStats.loaded++;
    })
    .catch(() => {
      // A missing file still needs a body — the classic crate.
      const ph = new Mesh(paint(new BoxGeometry(height * 0.6, height * 0.6, height * 0.6), 0xc98a4b), mat());
      ph.position.y = height * 0.3;
      ph.castShadow = true;
      g.add(ph);
    });
  return g;
};

export const CATALOGUE: readonly CatalogueItem[] = [
  { id: 'plant', label: 'Plant', emoji: '🪴', rooms: ['yard', 'house', 'loft'], build: buildPlant },
  { id: 'flower', label: 'Flowers', emoji: '🌼', rooms: ['yard'], build: buildFlower },
  { id: 'lamp', label: 'Lamp', emoji: '🏮', rooms: ['yard', 'house', 'loft'], build: () => buildLamp() },
  { id: 'bench', label: 'Bench', emoji: '🪑', rooms: ['yard'], build: () => buildBench() },
  { id: 'fountain', label: 'Fountain', emoji: '⛲', rooms: ['yard'], build: () => buildFountain() },
  { id: 'mailbox', label: 'Mailbox', emoji: '📮', rooms: ['yard'], build: () => buildMailbox() },
  { id: 'mushroom', label: 'Shrooms', emoji: '🍄', rooms: ['yard'], build: buildMushroom },
  { id: 'table', label: 'Table', emoji: '🍽', rooms: ['house', 'loft'], build: () => buildTable() },
  { id: 'chair', label: 'Chair', emoji: '🪑', rooms: ['house', 'loft'], build: () => buildChair() },
  { id: 'rug', label: 'Rug', emoji: '🟠', rooms: ['house', 'loft'], build: () => buildRug() },
  { id: 'shelf', label: 'Books', emoji: '📚', rooms: ['house', 'loft'], build: () => buildShelf() },
  { id: 'bed', label: 'Bed', emoji: '🛏', rooms: ['house', 'loft'], build: () => buildBed() },
  // Store pieces (owned before they can be placed):
  { id: 'campfire', label: 'Campfire', emoji: '🔥', rooms: ['yard'], build: () => buildCampfire() },
  { id: 'swing', label: 'Swing', emoji: '🎠', rooms: ['yard'], build: () => buildSwing() },
  { id: 'telescope', label: 'Scope', emoji: '🔭', rooms: ['yard', 'loft'], build: () => buildTelescope() },
  { id: 'piano', label: 'Piano', emoji: '🎹', rooms: ['house', 'loft'], build: () => buildPiano() },
  { id: 'aquarium', label: 'Fish', emoji: '🐠', rooms: ['house', 'loft'], build: () => buildAquarium() },
  ...MODEL_DECOR.map((m) => ({
    id: m.id,
    label: m.id === 'gnome' ? 'Gnome' : m.id === 'bear' ? 'Teddy' : m.id,
    emoji: m.id === 'gnome' ? '🍄' : '🧸',
    rooms: ['yard', 'house', 'loft'] as const,
    build: () => buildModelItem(m.url, m.height),
  })),
];

export function buildItem(item: string, seed: number): Group | null {
  const entry = CATALOGUE.find((c) => c.id === item);
  return entry ? entry.build(seed) : null;
}

// --------------------------------------------------------- the avatars

export function hatView(id: string): Group | null {
  if (id === 'none') return null;
  const g = new Group();
  if (id === 'sprout') {
    const stem = new Mesh(paint(new CylinderGeometry(3, 3, 22, 5), 0x4e7a46), mat());
    stem.position.y = 10;
    g.add(stem);
    for (const side of [-1, 1]) {
      const leaf = new Mesh(paint(new SphereGeometry(11, 6, 5), 0x5d8a50), mat());
      leaf.scale.set(1.3, 0.5, 0.7);
      leaf.position.set(side * 10, 22, 0);
      leaf.rotation.z = side * 0.5;
      g.add(leaf);
    }
  } else if (id === 'cap') {
    const dome = new Mesh(
      paint(new SphereGeometry(26, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0x4d7ea8),
      mat(),
    );
    g.add(dome);
    const brim = new Mesh(paint(new BoxGeometry(30, 6, 26), 0x3a628a), mat());
    brim.position.set(0, 2, -26);
    g.add(brim);
  } else if (id === 'sun') {
    const brim = new Mesh(paint(new CylinderGeometry(42, 46, 8, 12), 0xf2cc8f), mat());
    brim.position.y = 2;
    g.add(brim);
    const domeTop = new Mesh(paint(new CylinderGeometry(20, 24, 22, 10), 0xe8bc78), mat());
    domeTop.position.y = 15;
    g.add(domeTop);
    const band = new Mesh(paint(new CylinderGeometry(24.5, 24.5, 7, 10), 0xe07a5f), mat());
    band.position.y = 7;
    g.add(band);
  } else if (id === 'crown') {
    const band = new Mesh(paint(new CylinderGeometry(22, 22, 14, 8, 1, true), 0xe6b33f), mat());
    band.position.y = 7;
    g.add(band);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const spike = new Mesh(paint(new CylinderGeometry(1.5, 5, 14, 4), 0xe6b33f), mat());
      spike.position.set(Math.cos(a) * 20, 19, Math.sin(a) * 20);
      g.add(spike);
    }
  } else if (id === 'halo') {
    const m = lowPolyMaterial();
    m.emissive = new Color(0xfff2b0);
    m.emissiveIntensity = 1.2;
    const ring = new Mesh(paint(new TorusGeometry(22, 4, 6, 14), 0xfff2b0), m);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 22;
    g.add(ring);
  } else if (id === 'flower') {
    const stem = new Mesh(paint(new CylinderGeometry(2.5, 2.5, 16, 4), 0x4e7a46), mat());
    stem.position.y = 8;
    g.add(stem);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const petal = new Mesh(paint(new SphereGeometry(8, 5, 4), 0xffc75f), mat());
      petal.scale.set(1.3, 0.5, 0.9);
      petal.position.set(Math.cos(a) * 11, 18, Math.sin(a) * 11);
      petal.rotation.y = -a;
      g.add(petal);
    }
    const heart = new Mesh(paint(new SphereGeometry(7, 6, 5), 0xe07a5f), mat());
    heart.position.y = 19;
    g.add(heart);
  } else if (id === 'party') {
    const cone = new Mesh(paint(new ConeGeometry(20, 46, 8), 0x2fbf8a), mat());
    cone.position.y = 22;
    g.add(cone);
    const pom = new Mesh(paint(new SphereGeometry(7, 6, 5), 0xff6f91), mat());
    pom.position.y = 48;
    g.add(pom);
  } else if (id === 'wizard') {
    const brim = new Mesh(paint(new CylinderGeometry(34, 38, 6, 10), 0x4a3a7a), mat());
    brim.position.y = 2;
    g.add(brim);
    const cone = new Mesh(paint(new ConeGeometry(22, 60, 8), 0x5a4a92), mat());
    cone.position.y = 32;
    cone.rotation.z = 0.14;
    g.add(cone);
    const star = new Mesh(paint(new SphereGeometry(6, 5, 4), 0xffd166), mat());
    star.position.set(12, 30, 14);
    g.add(star);
  } else if (id === 'viking') {
    const dome = new Mesh(
      paint(new SphereGeometry(26, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0x8a8a94),
      mat(),
    );
    g.add(dome);
    const band = new Mesh(paint(new CylinderGeometry(26.5, 26.5, 8, 10), 0x6a5a42), mat());
    band.position.y = 2;
    g.add(band);
    for (const side of [-1, 1]) {
      const horn = new Mesh(paint(new CylinderGeometry(2.5, 9, 30, 6), 0xe8e2cc), mat());
      horn.position.set(side * 26, 16, 0);
      horn.rotation.z = side * -0.55;
      g.add(horn);
    }
  } else if (id === 'tophat') {
    const brim = new Mesh(paint(new CylinderGeometry(32, 32, 5, 12), 0x2a2a34), mat());
    brim.position.y = 2;
    g.add(brim);
    const stack = new Mesh(paint(new CylinderGeometry(20, 22, 38, 10), 0x1c1c26), mat());
    stack.position.y = 22;
    g.add(stack);
    const band = new Mesh(paint(new CylinderGeometry(22.5, 22.5, 7, 10), 0xe6a93f), mat());
    band.position.y = 7;
    g.add(band);
  } else if (id === 'prop') {
    const beanie = new Mesh(
      paint(new SphereGeometry(24, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0xe86a8a),
      mat(),
    );
    g.add(beanie);
    const stem = new Mesh(paint(new CylinderGeometry(2.5, 2.5, 10, 5), 0x2a2a34), mat());
    stem.position.y = 26;
    g.add(stem);
    const rotor = new Group();
    for (const a of [0, Math.PI / 2]) {
      const blade = new Mesh(paint(new BoxGeometry(50, 3, 8), 0x8affc1), mat());
      blade.rotation.y = a;
      rotor.add(blade);
    }
    rotor.position.y = 33;
    rotor.name = 'spin';
    g.add(rotor);
  }
  return shadowed(g);
}

export interface Avatar {
  view: Group;
  setColor: (c: number) => void;
  setHat: (id: string) => void;
  /** Bob + squash while moving; settle while idle. */
  tick: (t: number, moving: boolean) => void;
}

/** A haven blob: soft body, friendly face, hat anchor on top. */
export function blobAvatar(color: number, hat: string): Avatar {
  const view = new Group();
  const R = 44;
  const bodyGeom = new SphereGeometry(R, 12, 9);
  jitterVertices(bodyGeom, 2.2, 3);
  const bodyMat = lowPolyMaterial();
  const body = new Mesh(
    paintFacets(bodyGeom, (_x, _y, _z, set) => set(new Color(0.92, 0.92, 0.92))),
    bodyMat,
  );
  bodyMat.color.set(color);
  body.position.y = R;
  body.castShadow = true;
  view.add(body);
  const eyeMat = new MeshStandardMaterial({ color: 0x2b2b3a, roughness: 0.4 });
  for (const side of [-1, 1]) {
    const eye = new Mesh(new SphereGeometry(5.5, 6, 5), eyeMat);
    eye.position.set(side * 15, R + 10, R * 0.82);
    view.add(eye);
  }
  const hatAnchor = new Group();
  hatAnchor.position.y = R * 1.86;
  view.add(hatAnchor);
  let hatNow: Group | null = null;
  const setHat = (id: string): void => {
    if (hatNow) hatAnchor.remove(hatNow);
    hatNow = hatView(id);
    if (hatNow) hatAnchor.add(hatNow);
  };
  setHat(hat);
  return {
    view,
    setColor: (c) => bodyMat.color.set(c),
    setHat,
    tick: (t, moving) => {
      const bounce = moving ? Math.abs(Math.sin(t * 9)) * 10 : Math.sin(t * 2) * 2;
      body.position.y = R + bounce;
      hatAnchor.position.y = R * 1.86 + bounce;
      const squash = moving ? 1 - Math.abs(Math.sin(t * 9)) * 0.06 : 1;
      body.scale.set(1 + (1 - squash) * 0.7, squash, 1 + (1 - squash) * 0.7);
      const rotor = hatAnchor.getObjectByName('spin');
      if (rotor) rotor.rotation.y = t * (moving ? 14 : 5);
    },
  };
}
