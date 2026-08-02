/**
 * 🧪 The 3D spike.
 *
 * One question, answered with a number: can three.js hold a playable frame
 * rate with the whole "decent graphics" stack on — ACES tone mapping, a
 * shadow-casting key light, bloom — drawing the house style (vertex-colored
 * low poly, zero textures)?
 *
 * The scene is deliberately a stand-in for Blob Rush's world: a swamp with
 * hundreds of instanced trees, a boardwalk road, glowing wisps for the bloom
 * to bite on, and the rolling blob — wheel spinning, hat level — running
 * through it. If THIS holds frame rate, a real game will, because a real
 * game draws less than a stress scene.
 *
 * Not a game: no input, no score, no scenes. Anything beyond the question is
 * scope the spike does not get to have.
 */

import {
  Color,
  ConeGeometry,
  Fog,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  Vector2,
  Vector3,
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import {
  autoQuality,
  createGame3,
  lightRig,
  lowPolyGround,
  lowPolyMaterial,
  lowPolyTree,
  paintFacets,
  paintVertices,
  rollingBlob3,
  scatter,
  seededRand,
  skyDome,
} from '@interverse/three';

// The Misty Bog palette, translated. Same rule as 2D: colors come from a
// palette block, never scattered one-off through the code.
const SKY = 0x9fb8ad;
const FOG_FAR = 1400;
const GROUND = 0x3f5c42;
const GROUND_SPECKLE = 0x4c6b4a;
const GROUND_HOLLOW = 0x2c4034;
const WATER = 0x1d3a3c;
const BOARDS = 0x7a5f3d;
const BOARDS_DARK = 0x5d4930;
const TRUNK = 0x5d4930;
const CANOPY = 0x4e7a46;
const CANOPY_DARK = 0x35502f;
// Albedo authored DARKER than the screen target. A lit, tone-mapped
// pipeline brightens everything: paint the 2D palette's colors straight in
// and the sun washes them to white — the blue then only survives on the
// shaded side, which is exactly what the first screenshot showed. Author
// mid-tones and let the light do the lifting.
const BLOB = 0x3d9bdd;
const WISP = 0x8affc1;
const HAT = 0x2fbf8a;
const HAT_BAND = 0xe6a93f;

const RUN_SPEED = 90; // world units / sec
const ROAD_HALF = 42;
const TILE = 2400;

// Feature toggles, so the measurement can attribute cost: ?bloom=0 and
// ?shadows=0 turn the two expensive stages off one at a time. Attribution
// is what makes a slow number actionable instead of just bad news.
const params = new URLSearchParams(location.search);
const BLOOM_ON = params.get('bloom') !== '0';
const SHADOWS_ON = params.get('shadows') !== '0';

const game = createGame3({
  background: SKY,
  fov: 55,
  update: (dt) => update(dt),
});
const { scene, camera, renderer } = game;
renderer.shadowMap.enabled = SHADOWS_ON;

// Fog is the 3D fogAlpha: distant things dissolve into the sky color
// instead of popping at a draw distance. The sky dome's horizon matches the
// fog color, which is what makes the world read as hazy rather than as a
// world with a wall around it.
scene.fog = new Fog(SKY, 300, FOG_FAR);
scene.add(skyDome({ horizon: SKY, zenith: 0x647f8c }));

// Quality answers to the frame clock: resolution steps down under load,
// shadows only at the floor. ?tier=N pins one for testing.
const quality = autoQuality(game);
const pinnedTier = params.get('tier');
if (pinnedTier !== null) quality.pin(Number(pinnedTier));

// ------------------------------------------------------------------ light
// Intensities tuned DOWN from the first attempt: sun 2.0 + hemi 0.9
// through ACES blew every light color out to white — the 3D version of the
// white-ball blob bug, found the same way (by looking, not by asserting).
const rig = lightRig(scene, {
  sky: 0xcfe6d8,
  ground: GROUND_HOLLOW,
  sun: 0xfff2d8,
  intensity: 1.25,
  from: { x: 0.5, y: 1, z: 0.4 },
  shadowArea: 240,
});
rig.hemi.intensity = 0.55;

// ------------------------------------------------------------------ world
// Two ground tiles leapfrogging each other down -z make an endless swamp
// out of finite geometry — the 3D version of culling behind the camera.
const tiles: Mesh[] = [0, 1].map((i) => {
  const g = lowPolyGround({
    width: TILE,
    depth: TILE,
    segments: 44,
    base: GROUND,
    speckle: GROUND_SPECKLE,
    hollow: GROUND_HOLLOW,
    relief: 20,
    seed: 7 + i,
  });
  // Press the ground flat under the road corridor. The terrain's relief is
  // taller than the road's surface, so without this the near ground swallows
  // the boardwalk and the road reads as scattered mud patches — the
  // intersection outline of two surfaces was doing the drawing.
  const pos = g.geometry.getAttribute('position');
  for (let v = 0; v < pos.count; v++) {
    if (Math.abs(pos.getX(v)) < ROAD_HALF * 1.6) pos.setY(v, -3);
  }
  pos.needsUpdate = true;
  g.geometry.computeVertexNormals();
  g.position.z = -i * TILE;
  scene.add(g);
  return g;
});

// Water: a huge still plane just under the ground's hollows, so dips read
// as pools without a single extra vertex of terrain.
const water = new Mesh(
  new PlaneGeometry(TILE * 2, TILE * 2),
  new MeshStandardMaterial({ color: WATER, roughness: 0.25, metalness: 0 }),
);
water.rotation.x = -Math.PI / 2;
water.position.y = -6;
scene.add(water);

// The boardwalk: plank-colored slabs down the middle, vertex-painted in two
// browns so the planks read without a texture. The row height must MATCH the
// vertex spacing — vertex colors cannot resolve a pattern finer than the
// vertices, and the first cut painted 26-unit planks onto 53-unit cells,
// which averaged out to a featureless mud strip.
// The paint period must be the geometry's ACTUAL row height, not the
// nominal plank size. 4800 units divided into whole rows gives 25.946, and
// painting that at a period of 26 walks the color boundary through the
// middle of a quad for long stretches — each quad splits diagonally into
// two colors and the road renders as a checkerboard moiré. Painting in the
// geometry's own units means a boundary can never land inside a row.
const PLANK = 26;
const rows = Math.round((TILE * 2) / PLANK);
const rowH = (TILE * 2) / rows;
const roadGeom = new PlaneGeometry(ROAD_HALF * 2, TILE * 2, 2, rows);
roadGeom.rotateX(-Math.PI / 2);
const cA = new Color(BOARDS);
const cB = new Color(BOARDS_DARK);
// Facet paint, not vertex paint: each plank owns its triangles and wears a
// solid color. Painted per vertex this exact stripe came out as one smeared
// brown gradient, because vertex colors interpolate across every cell.
const road = new Mesh(
  paintFacets(roadGeom, (_x, _y, z, set) => {
    set(Math.floor((z + TILE) / rowH) % 2 === 0 ? cA : cB);
  }),
  lowPolyMaterial(),
);
road.position.y = 2;
road.receiveShadow = true;
scene.add(road);

// Trees: one geometry per tree part, scattered as instances. Three hundred
// trees for three draw calls — draw calls, not triangles, are what actually
// kill mid-range phones.
const rand = seededRand(99);
const treeSource = lowPolyTree({
  trunk: TRUNK,
  canopy: CANOPY,
  canopyDark: CANOPY_DARK,
  height: 90,
  seed: 3,
});
const forest = new Group();
for (const part of treeSource.children as Mesh[]) {
  const placed = scatter(part, 300, (i) => {
    const r = seededRand(i * 7 + 1);
    const side = i % 2 === 0 ? -1 : 1;
    // Clear of the road, thickening away from it.
    const x = side * (ROAD_HALF + 30 + r() * 900);
    const z = -(i / 300) * TILE * 2 + r() * 40;
    return { x, z, scale: 0.7 + r() * 0.8, rotY: r() * Math.PI * 2 };
  });
  // Instances place the whole tree; parts keep their within-tree offset.
  placed.position.copy(part.position);
  placed.rotation.copy(part.rotation);
  forest.add(placed);
}
scene.add(forest);

// Wisps: small emissive spheres drifting over the water — the thing the
// bloom pass exists for. Emissive intensity above the bloom threshold is
// what reads as light rather than as a bright object.
const wispMat = new MeshStandardMaterial({
  color: WISP,
  emissive: WISP,
  emissiveIntensity: 2.4,
});
const wisps: Mesh[] = [];
for (let i = 0; i < 24; i++) {
  const w = new Mesh(new SphereGeometry(3.4, 8, 6), wispMat);
  const side = i % 2 === 0 ? -1 : 1;
  w.position.set(side * (ROAD_HALF + 40 + rand() * 300), 16 + rand() * 30, -rand() * TILE * 2);
  wisps.push(w);
  scene.add(w);
}

// ------------------------------------------------------------------- blob
const blob = rollingBlob3({ radius: 11, color: BLOB, seed: 4 });
blob.view.position.set(0, 13, 0);
// The hat rides the RIDER, never the wheel — the contract from art/roller.ts,
// ported. A party cone with a band, vertex-colored like everything else.
{
  const cone = new ConeGeometry(6.5, 12, 8);
  const cHat = new Color(HAT);
  const cBand = new Color(HAT_BAND);
  paintVertices(cone, (_x, y, _z, set) => set(y < -3 ? cBand : cHat));
  const hat = new Mesh(cone, lowPolyMaterial());
  hat.position.y = 14;
  hat.rotation.z = 0.12;
  hat.castShadow = true;
  blob.rider.add(hat);
}
scene.add(blob.view);

// ----------------------------------------------------------------- camera
// Chase framing, matched to Blob Rush: low, close, looking slightly down.
camera.position.set(0, 42, 88);
camera.lookAt(new Vector3(0, 10, -60));

// ------------------------------------------------------------------ bloom
// Threshold just under the wisps' emissive level: the wisps glow, the swamp
// does not. A bloom that catches the whole frame is a smeared frame.
if (BLOOM_ON) {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new Vector2(1024, 1024), 0.55, 0.6, 0.85));
  composer.addPass(new OutputPass());
  const fitComposer = (): void => {
    const size = renderer.getSize(new Vector2());
    // Track the renderer's CURRENT pixel ratio — the quality ladder changes
    // it at runtime, and a composer left on the boot-time ratio would quietly
    // undo the whole point of stepping resolution down.
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(size.x, size.y);
  };
  fitComposer();
  window.addEventListener('resize', fitComposer);
  // The composer owns the frame now; the loop stays the loop.
  game.draw = () => composer.render();
}

// ------------------------------------------------------------------- loop
let travelled = 0;

function update(dt: number): void {
  quality.update();
  travelled += RUN_SPEED * dt;
  blob.roll(RUN_SPEED * dt);
  // The world scrolls past the blob, same trick as the 2D runner: the
  // player never moves, so float error never accumulates in the thing the
  // camera is glued to.
  const z = travelled % TILE;
  for (const [i, tile] of tiles.entries()) {
    tile.position.z = z - i * TILE;
    if (tile.position.z > TILE * 0.75) tile.position.z -= TILE * 2;
  }
  forest.position.z = travelled % (TILE * 2);
  // The planks scroll underfoot — by whole plank pairs, so the pattern
  // arrives seamlessly. Without this the road is the one still thing in a
  // moving world, and the eye reads the whole scene as slower for it.
  road.position.z = travelled % (rowH * 2);
  for (const [i, w] of wisps.entries()) {
    w.position.y = 16 + Math.sin(travelled * 0.02 + i * 1.7) * 8;
    w.position.z += RUN_SPEED * dt;
    if (w.position.z > 100) w.position.z -= TILE * 2;
  }
  // A lane wiggle so the shadow rig's follow logic actually gets exercised.
  blob.view.position.x = Math.sin(travelled * 0.004) * 28;
  rig.follow(blob.view.position);
  camera.position.x = blob.view.position.x * 0.6;
}

// ------------------------------------------------- headless test hooks
declare global {
  interface Window {
    __spike3d?: {
      ready: () => boolean;
      stats: () => {
        fps: number;
        frameMs: number;
        drawCalls: number;
        triangles: number;
        spin: number;
        hatLevel: number;
        tier: number;
        pixelRatio: number;
      };
    };
  }
}

window.__spike3d = {
  ready: () => game.stats.fps > 0,
  stats: () => ({
    fps: Math.round(game.stats.fps * 10) / 10,
    frameMs: Math.round(game.stats.frameMs * 100) / 100,
    drawCalls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    spin: Math.round(blob.spin * 100) / 100,
    // The rider's pitch: must stay 0 while the wheel spins underneath it.
    hatLevel: Math.round(blob.rider.rotation.x * 1000) / 1000,
    tier: quality.tier,
    pixelRatio: Math.round(renderer.getPixelRatio() * 100) / 100,
  }),
};
