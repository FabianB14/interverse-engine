/**
 * 🏃 Blob Rush 3D — the same game, drawn for real.
 *
 * Every rule here comes from @interverse/core and is the SAME code the 2D
 * game runs: the track generator with its fairness guarantees, the lane
 * rider, the jump/slide bands, the corner map, the speed ramp. This file
 * only decides what those rules look like — which is the entire thesis of
 * the core/engine split, demonstrated.
 *
 * The rendering trick is the same as 2D, one dimension up: the player never
 * moves. Everything stores an absolute z from the start of the run, and each
 * frame maps (lateral, z-ahead) path coordinates into world space through
 * cornerSpace — the identical function the 2D projection uses. A corner is
 * the world rotating around you, which through a real perspective camera is
 * indistinguishable from you turning, and the junction geometry cannot
 * produce a bowtie because there is no hand-drawn road to get wrong.
 */

import {
  Color,
  Fog,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  PlaneGeometry,
  Quaternion,
  Scene,
  Vector3,
} from 'three';
import {
  DRAW_DISTANCE, HIT_DEPTH, LANE_WIDTH, LaneRider, RunnerMoves, TrackBuilder,
  audio, bendAt, collides, cornerClear, laneX, playerBand, speedAt, yawFor,
  RUN_HEIGHT, cornerSpace,
} from '@interverse/core';
import type { ClearSpan, CornerFrame, Hazard, Pickup } from '@interverse/core';
import {
  autoQuality, createGame3, lightRig, loadModel, paintFacets, rollingBlob3, scatter,
  seededRand, skyDome,
} from '@interverse/three';
import { BoxGeometry } from 'three';
import { MATS, coinView3, hatView3, hazardView3, treeView3 } from './art3.js';
import { BLOB_COLOR, MINT, ROSE, ZONES3, zone3 } from './theme.js';
import { bankRun, loadProfile } from './save.js';

// Identical pacing constants to the 2D game — the rhythm IS the game.
const UNITS_PER_METRE = 12;
const TURN_SECS = 11;
const TURN_WINDOW = 1500;
const BEND_MAX = 260;
const BEND_SECS = 3.4;
const BEND_EASE = 2.4;
const CHASE_PER_HIT = 0.2;
const CHASE_RECOVER = 0.075;
const STUMBLE_SECS = 0.5;
const BLOB_RADIUS = 46;

// Camera: low and close, like the 2D projection's framing.
const CAM_HEIGHT = 300;
const CAM_BACK = 420;
const FOG_FAR = 3600;

// ------------------------------------------------------------------- boot
const game = createGame3({ background: 0x8fa08c, fov: 52, update: (dt) => update(dt) });
const { scene, camera, renderer } = game;
// Aimed slightly DOWN the road: the blob has to sit fully in frame with
// room under it for its shadow — you cannot dodge with the thing you are
// steering half off the bottom of the screen.
camera.position.set(0, CAM_HEIGHT, CAM_BACK);
camera.lookAt(new Vector3(0, -70, -1200));

const quality = autoQuality(game);
const rig = lightRig(scene, {
  intensity: 1.2,
  from: { x: 0.55, y: 1, z: 0.4 },
  shadowArea: 700,
  shadowMap: 1024,
});
rig.hemi.intensity = 0.6;
audio.installUnlock();

// ------------------------------------------------------------------ world
let sky: Mesh | null = null;

// Water everywhere; the causeway crosses it. The swamp IS the water.
const water = new Mesh(new PlaneGeometry(24000, 24000), MATS.water);
water.rotation.x = -Math.PI / 2;
water.position.y = -26;
scene.add(water);

/**
 * The causeway, as two instanced plank sets (light rows, dark rows) whose
 * matrices are rewritten every frame from path space. ~34 slabs cover the
 * draw distance in 2 draw calls, and because every slab goes through
 * cornerSpace, the road turns its corner by itself.
 */
const PLANK = 130;
const SLABS = Math.ceil(DRAW_DISTANCE / PLANK) + 3;
const ROAD_HALF = LANE_WIDTH * 1.55;
const slabGeom = new BoxGeometry(ROAD_HALF * 2, 22, PLANK * 0.94);
const slabPainted = (shade: number): typeof slabGeom => {
  const rand = seededRand(3 + shade);
  return paintFacets(slabGeom.clone(), (_x, _y, _z, set) =>
    set(new Color().setScalar(shade + rand() * 0.06)),
  ) as typeof slabGeom;
};
const slabsA = new InstancedMesh(slabPainted(0.52), MATS.road, Math.ceil(SLABS / 2));
const slabsB = new InstancedMesh(slabPainted(0.42), MATS.road, Math.ceil(SLABS / 2));
slabsA.receiveShadow = slabsB.receiveShadow = true;
scene.add(slabsA, slabsB);

// Trees: fixed absolute-z posts either side, wrapped forward as the run
// passes them. Instanced per tree part.
const TREE_EVERY = 420;
const TREE_N = Math.ceil((DRAW_DISTANCE + 800) / TREE_EVERY) * 2;
interface TreePost {
  side: number;
  off: number;
  z: number;
  scale: number;
}
const posts: TreePost[] = [];
{
  const r = seededRand(41);
  for (let i = 0; i < TREE_N; i++) {
    posts.push({
      side: i % 2 === 0 ? -1 : 1,
      off: ROAD_HALF + 160 + r() * 700,
      z: i * (TREE_EVERY / 2),
      scale: 0.75 + r() * 0.7,
    });
  }
}
const treeSource = treeView3(9);
const treeParts: { inst: InstancedMesh; base: Vector3; baseRot: number }[] = [];
for (const part of treeSource.children as Mesh[]) {
  const inst = scatter(part, TREE_N, () => ({ x: 0, z: 0 }));
  treeParts.push({ inst, base: part.position.clone(), baseRot: part.rotation.z });
  scene.add(inst);
}

// --------------------------------------------------------------- entities
interface LiveHazard {
  data: Hazard;
  view: Group;
}
interface LiveCoin {
  data: Pickup;
  view: Mesh;
  taken: boolean;
}

const blob = rollingBlob3({ radius: BLOB_RADIUS, color: BLOB_COLOR, seed: 4 });
scene.add(blob.view);
let hatOn: Group | null = null;
function wearHat(id: string): void {
  if (hatOn) {
    blob.rider.remove(hatOn);
    hatOn = null;
  }
  const h = hatView3(id);
  if (h) {
    h.position.y = BLOB_RADIUS * 0.72;
    blob.rider.add(h);
    hatOn = h;
  }
}

// The corner junction pad — visible whenever the corner is in draw range,
// so the right angle ahead is a THING you can see, not a symbol.
const junction = new Mesh(
  paintFacets(new BoxGeometry(ROAD_HALF * 2.4, 22, ROAD_HALF * 2.4), (_x, _y, _z, set) =>
    set(new Color().setScalar(0.5)),
  ),
  MATS.road,
);
junction.receiveShadow = true;
scene.add(junction);

/**
 * The corner waymarkers — a pair of carved totems flanking every junction,
 * and the proof of the model-import pipeline: totem.glb is a real glTF
 * binary shipped in public/models/, fetched and parsed at runtime, scaled
 * and grounded by loadModel. One load, two clones; failure to load is a
 * missing decoration, never a broken game.
 */
let totems: Group[] = [];
let modelLoaded = false;
void Promise.all([
  loadModel('models/totem.glb', { height: 260 }),
  loadModel('models/totem.glb', { height: 260 }),
])
  .then((pair) => {
    totems = pair;
    for (const t of totems) scene.add(t);
    modelLoaded = true;
  })
  .catch(() => {
    // The game runs undecorated. A model is never load-bearing.
  });

// ------------------------------------------------------------------ state
const rider = new LaneRider(1);
const moves = new RunnerMoves();
const builder = new TrackBuilder({ density: 0.68 });

let hazards: LiveHazard[] = [];
let coins: LiveCoin[] = [];
let distance = 0;
let purse = 0;
let speed = 0;
let chase = 0;
let stumble = 0;
let zoneN = 0;
let turnZ = 0;
let turnDir = 1;
let turned = false;
let corner: CornerFrame | null = null;
let bend = 0;
let bendTarget = 0;
let bendNext = 0;
let over = true; // starts on the menu
let safe = false;

// -------------------------------------------------------------------- hud
const el = (id: string): HTMLElement => document.getElementById(id)!;
const hudMetres = el('metres');
const hudCoins = el('coins');
const hudZone = el('zone');
const hudChase = el('chasefill');
const hudBanner = el('banner');
const overlay = el('overlay');
const statsLine = el('stats-line');
let bannerTimer = 0;

function banner(text: string, secs = 1.2): void {
  hudBanner.textContent = text;
  hudBanner.style.opacity = '1';
  window.clearTimeout(bannerTimer);
  bannerTimer = window.setTimeout(() => {
    hudBanner.style.opacity = '0';
  }, secs * 1000);
}

function refreshHud(): void {
  hudMetres.textContent = `${Math.floor(distance / UNITS_PER_METRE)} m`;
  hudCoins.textContent = `🪙 ${purse}`;
  hudZone.innerHTML = `${zoneN + 1} · ${zone3(zoneN).name}<br><span style="opacity:.65;font-size:13px">of ${ZONES3.length}</span>`;
  const t = Math.min(1, chase);
  hudChase.style.width = `${t * 100}%`;
  hudChase.style.background = `#${(t > 0.66 ? ROSE : t > 0.33 ? 0xffd166 : MINT).toString(16).padStart(6, '0')}`;
}

// ------------------------------------------------------------------ zones
function restyle(): void {
  const z = zone3(zoneN);
  scene.fog = new Fog(z.sky, 400, FOG_FAR);
  scene.background = new Color(z.sky);
  if (sky) {
    scene.remove(sky);
    sky.geometry.dispose();
  }
  sky = skyDome({ horizon: z.sky, zenith: z.skyHigh, radius: 8000 });
  scene.add(sky);
  MATS.road.color.set(z.road);
  MATS.tree.color.set(z.prop);
  MATS.hazard.color.set(z.road);
  MATS.leaf.color.set(z.prop);
  MATS.water.color.set(z.water);
  rig.hemi.color.set(z.sky);
  rig.hemi.groundColor.set(z.water);
}

// ------------------------------------------------------------- path space
/**
 * Path (lateral, depth-ahead) → world (x, z). The one map everything goes
 * through, so everything turns the corner together. Bend rides along
 * exactly as in 2D: applied to the lateral before the corner map.
 */
const frameFor = (): CornerFrame | null => corner;

function pathXZ(lateral: number, depth: number): { x: number; z: number } {
  const lat = lateral + bendAt(Math.max(0, depth), bend);
  const cs = cornerSpace(lat, depth, frameFor());
  return { x: cs.x, z: -cs.z };
}

const tmpMat = new Matrix4();
const tmpQuat = new Quaternion();
const tmpScale = new Vector3();
const tmpPos = new Vector3();
const UP = new Vector3(0, 1, 0);

/** Yaw of the path itself at `depth` — derived from the same map, so a
 *  slab's facing can never disagree with its position. */
function pathYaw(lateral: number, depth: number): number {
  const a = pathXZ(lateral, depth);
  const b = pathXZ(lateral, depth + 20);
  return Math.atan2(-(b.x - a.x), -(b.z - a.z));
}

function placeInstance(
  inst: InstancedMesh,
  i: number,
  lateral: number,
  depth: number,
  y: number,
  scale: number,
  align: boolean,
  // A multi-part source (a tree's trunk + canopies) bakes each part's
  // within-group offset here — instancing flattens the group, and dropping
  // the offsets collapses every part to the origin: canopies become mounds
  // at water level with half-sunk posts, which is exactly what the first
  // screenshot showed.
  off?: Vector3,
): void {
  const p = pathXZ(lateral, depth);
  tmpQuat.setFromAxisAngle(UP, align ? pathYaw(lateral, depth) : 0);
  tmpPos.set(
    p.x + (off?.x ?? 0) * scale,
    y + (off?.y ?? 0) * scale,
    p.z + (off?.z ?? 0) * scale,
  );
  tmpMat.compose(tmpPos, tmpQuat, tmpScale.set(scale, scale, scale));
  inst.setMatrixAt(i, tmpMat);
}

// ------------------------------------------------------------------- run
function startRun(): void {
  for (const h of hazards) scene.remove(h.view);
  for (const c of coins) scene.remove(c.view);
  hazards = [];
  coins = [];
  builder.reset();
  rider.lane = 1;
  rider.x = laneX(1);
  moves.reset();
  distance = 0;
  purse = 0;
  chase = 0;
  stumble = 0;
  zoneN = 0;
  speed = speedAt(0);
  turnZ = speed * TURN_SECS;
  turnDir = Math.random() < 0.5 ? -1 : 1;
  turned = false;
  corner = null;
  bend = (Math.random() < 0.5 ? -1 : 1) * BEND_MAX * 0.5;
  bendTarget = -bend * 0.7;
  bendNext = speed * BEND_SECS;
  over = false;
  wearHat(loadProfile().wearing);
  restyle();
  overlay.classList.add('hidden');
  refreshHud();
}

function endRun(cause: 'hit' | 'pit' | 'corner'): void {
  if (over) return;
  over = true;
  audio.buzz();
  const metres = Math.floor(distance / UNITS_PER_METRE);
  const { profile, newBest } = bankRun(metres, purse);
  const why =
    cause === 'pit' ? 'the swamp got you' : cause === 'corner' ? 'missed the turn' : 'caught';
  statsLine.textContent =
    `${metres} m · 🪙 ${purse} banked · ${why}` +
    (newBest ? ' · ✨ NEW BEST' : ` · best ${profile.best} m`);
  overlay.classList.remove('hidden');
}

// ------------------------------------------------------------------ track
function cornerSpan(): ClearSpan {
  const cornerZ = distance + turnZ;
  return cornerClear(cornerZ, speedAt(cornerZ));
}

function fillTrack(): void {
  builder.clear = [cornerSpan()];
  const out = builder.build(distance, DRAW_DISTANCE, speed);
  for (const data of out.hazards) {
    const view = hazardView3(data.kind);
    scene.add(view);
    hazards.push({ data, view });
  }
  for (const data of out.pickups) {
    const view = coinView3();
    scene.add(view);
    coins.push({ data, view, taken: false });
  }
}

function cull(): void {
  hazards = hazards.filter((h) => {
    if (h.data.z - distance > -220) return true;
    scene.remove(h.view);
    return false;
  });
  coins = coins.filter((c) => {
    if (c.data.z - distance > -220) return true;
    scene.remove(c.view);
    return false;
  });
}

// ----------------------------------------------------------------- corner
function tickTurn(moved: number): void {
  turnZ -= moved;
  if (turnZ > DRAW_DISTANCE) {
    corner = null;
    return;
  }
  corner = { ahead: turnZ, dir: turnDir, yaw: turned ? yawFor(turnZ, turnDir) : 0 };
  if (turned) {
    if (turnZ <= 0) passCorner();
    return;
  }
  if (turnZ < -HIT_DEPTH) endRun('corner');
}

function takeCorner(): void {
  turned = true;
  purse += 25;
  audio.chime();
  banner('TURN!', 0.8);
}

function passCorner(): void {
  corner = null;
  turned = false;
  zoneN++;
  bend = turnDir * BEND_MAX * 1.1;
  bendTarget = turnDir * BEND_MAX * 0.35;
  bendNext = distance + speed * BEND_SECS;
  turnZ = speed * TURN_SECS;
  turnDir = Math.random() < 0.5 ? -1 : 1;
  banner(`${zoneN + 1}. ${zone3(zoneN).name.toUpperCase()}`, 1.8);
  restyle();
}

// ------------------------------------------------------------------ input
function input(dir: 'left' | 'right' | 'up' | 'down'): void {
  if (over) return;
  if (dir === 'up') {
    moves.jump();
    audio.blip(1.3);
    return;
  }
  if (dir === 'down') {
    moves.slide();
    audio.blip(0.7);
    return;
  }
  const window3 = Math.max(TURN_WINDOW, speed * 1.6);
  if (!turned && turnZ < window3) {
    if ((dir === 'left' ? -1 : 1) === turnDir) takeCorner();
    else endRun('corner');
    return;
  }
  if (rider.step(dir === 'left' ? -1 : 1)) audio.blip(1.1);
}

// Swipes on the whole page; arrows/WASD for desktops and tests.
{
  let sx = 0;
  let sy = 0;
  let live = false;
  let fired = false;
  const THRESHOLD = 26;
  window.addEventListener('pointerdown', (e) => {
    sx = e.clientX;
    sy = e.clientY;
    live = true;
    fired = false;
  });
  window.addEventListener('pointermove', (e) => {
    if (!live || fired) return;
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    if (Math.abs(dx) < THRESHOLD && Math.abs(dy) < THRESHOLD) return;
    fired = true;
    if (Math.abs(dx) > Math.abs(dy)) input(dx > 0 ? 'right' : 'left');
    else input(dy > 0 ? 'down' : 'up');
  });
  window.addEventListener('pointerup', () => {
    // A tap is a jump — the panic poke should do the most useful thing.
    if (live && !fired && !over) input('up');
    live = false;
  });
  const keys: Record<string, 'left' | 'right' | 'up' | 'down'> = {
    ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
    a: 'left', d: 'right', w: 'up', s: 'down',
  };
  window.addEventListener('keydown', (e) => {
    const d = keys[e.key];
    if (d) input(d);
  });
}
el('play').addEventListener('click', () => startRun());

// ------------------------------------------------------------------- tick
function tickBend(dt: number): void {
  if (distance >= bendNext) {
    bendNext = distance + speed * BEND_SECS * (0.6 + Math.random() * 0.8);
    const away = bend > 0 ? -1 : 1;
    const sign = Math.random() < 0.72 ? away : -away;
    bendTarget = sign * BEND_MAX * (0.35 + Math.random() * 0.65);
  }
  bend += (bendTarget - bend) * Math.min(1, BEND_EASE * dt);
}

function checkHits(): void {
  for (const c of coins) {
    const near = c.data.z - distance;
    if (c.taken || Math.abs(near) > HIT_DEPTH) continue;
    if (Math.round(rider.lane) !== c.data.lane) continue;
    c.taken = true;
    c.view.visible = false;
    purse += 1;
    audio.pop(1.4);
  }
  if (stumble > 0) return;
  for (const h of hazards) {
    const near = h.data.z - distance;
    if (Math.abs(near) > HIT_DEPTH) continue;
    const me = playerBand(moves.height, moves.crouch);
    if (!collides(rider.lane, { ...h.data, z: near }, me)) continue;
    if (h.data.kind === 'pit' && !safe) {
      endRun('pit');
      return;
    }
    stumble = STUMBLE_SECS;
    if (!safe) chase = Math.min(1, chase + CHASE_PER_HIT);
    audio.buzz();
    banner(chase > 0.66 ? 'LAST CHANCE!' : 'OOF!', 1);
    return;
  }
}

function draw(): void {
  // Slabs: anchored to the plank grid so the boards physically scroll.
  const first = Math.floor((distance - PLANK * 2) / PLANK);
  let ai = 0;
  let bi = 0;
  for (let s = 0; s < SLABS; s++) {
    const slabZ = (first + s) * PLANK;
    const depth = slabZ - distance;
    const dark = (first + s) % 2 !== 0;
    const inst = dark ? slabsB : slabsA;
    const idx = dark ? bi++ : ai++;
    placeInstance(inst, idx, 0, depth + PLANK / 2, -11, 1, true);
  }
  for (let i = ai; i < slabsA.count; i++) placeInstance(slabsA, i, 0, -4000, -400, 0.001, false);
  for (let i = bi; i < slabsB.count; i++) placeInstance(slabsB, i, 0, -4000, -400, 0.001, false);
  slabsA.instanceMatrix.needsUpdate = true;
  slabsB.instanceMatrix.needsUpdate = true;

  // Junction pad at the corner, while one is in range — flanked by the
  // imported totems, which stand just wide of the road on either side so
  // the corner reads as a PLACE from as far away as it can be seen.
  if (corner && turnZ > -ROAD_HALF) {
    junction.visible = true;
    const p = pathXZ(0, turnZ);
    junction.position.set(p.x, -10, p.z);
    const jyaw = pathYaw(0, Math.max(0, turnZ - 30));
    junction.rotation.y = jyaw;
    for (const [i, t] of totems.entries()) {
      const side = i === 0 ? -1 : 1;
      const tp = pathXZ(side * (ROAD_HALF + 90), turnZ);
      t.visible = true;
      t.position.set(tp.x, 0, tp.z);
      t.rotation.y = jyaw;
    }
  } else {
    junction.visible = false;
    for (const t of totems) t.visible = false;
  }

  // Trees: wrap forward over the draw distance, place through the path map
  // so the forest turns the corner with the road.
  const span = TREE_EVERY * (TREE_N / 2);
  for (const [t, post] of posts.entries()) {
    const rel = ((post.z - distance) % span + span) % span;
    for (const part of treeParts) {
      // Rooted in the water, not hovering at road level — a tree whose
      // trunk vanishes into the surface reads as growing out of the swamp.
      placeInstance(part.inst, t, post.side * post.off, rel, -26, post.scale, false, part.base);
    }
  }
  for (const part of treeParts) part.inst.instanceMatrix.needsUpdate = true;

  // Hazards and coins.
  for (const h of hazards) {
    const depth = h.data.z - distance;
    const p = pathXZ(laneX(h.data.lane), depth);
    h.view.visible = depth > -220 && depth < DRAW_DISTANCE;
    h.view.position.set(p.x, 0, p.z);
    h.view.rotation.y = pathYaw(laneX(h.data.lane), depth);
  }
  for (const c of coins) {
    if (c.taken) continue;
    const depth = c.data.z - distance;
    const p = pathXZ(laneX(c.data.lane), depth);
    c.view.visible = depth > -220 && depth < DRAW_DISTANCE;
    c.view.position.set(p.x, 100, p.z);
    c.view.rotation.z = distance * 0.008 + c.data.z * 0.01;
  }

  // The blob: real position through the same map, squash from the same
  // band the collision reads — what you see is what you can hit.
  const me = playerBand(moves.height, moves.crouch);
  const squash = (me.high - me.low) / RUN_HEIGHT;
  const bp = pathXZ(rider.x, 0);
  blob.view.position.set(bp.x, moves.height + BLOB_RADIUS * squash, bp.z);
  blob.view.scale.set(1 + moves.crouch * 0.3, squash, 1 + moves.crouch * 0.3);
  blob.rider.rotation.z = ((rider.targetX - rider.x) / LANE_WIDTH) * 0.35;

  camera.position.x = bp.x * 0.55;
  rig.follow(blob.view.position);
}

function update(dt: number): void {
  quality.update();
  if (over) return;
  speed = speedAt(distance);
  const stumbling = stumble > 0;
  if (stumbling) stumble = Math.max(0, stumble - dt);
  const moved = speed * (stumbling ? 0.45 : 1) * dt;
  distance += moved;
  blob.roll(moved / 1.0);

  rider.update(dt);
  moves.update(dt);
  tickBend(dt);
  chase = Math.max(0, chase - CHASE_RECOVER * dt);

  cull();
  fillTrack();
  tickTurn(moved);
  checkHits();
  draw();
  refreshHud();
  if (chase >= 1) endRun('hit');
}

// Boot into the menu state with the world visible behind it.
restyle();
draw();
{
  const p = loadProfile();
  statsLine.textContent = p.best > 0 ? `best ${p.best} m · 🪙 ${p.coins}` : 'first run';
}

// ------------------------------------------------- headless test hooks
declare global {
  interface Window {
    __rush3d?: {
      ready: () => boolean;
      screen: () => 'menu' | 'run';
      play: () => void;
      run: () => {
        metres: number; coins: number; lane: number; airborne: boolean; sliding: boolean;
        hazards: number; chase: number; turnZ: number; zone: string; speed: number;
        over: boolean; spin: number; bend: number; yaw: number; turning: boolean;
      } | null;
      swipe: (d: 'left' | 'right' | 'up' | 'down') => void;
      corner: () => number;
      safe: (on: boolean) => void;
      track: () => { count: number; inSpan: number; cornerSecs: number };
      stats: () => {
        fps: number; frameMs: number; drawCalls: number; triangles: number; tier: number;
        modelLoaded: boolean;
      };
      hat: () => { children: number; wheel: number; riderPitch: number };
      profile: () => { best: number; coins: number; runs: number };
    };
  }
}

window.__rush3d = {
  ready: () => game.stats.fps > 0,
  screen: () => (over ? 'menu' : 'run'),
  play: () => startRun(),
  run: () =>
    over && distance === 0
      ? null
      : {
          metres: Math.floor(distance / UNITS_PER_METRE),
          coins: purse,
          lane: rider.lane,
          airborne: moves.airborne,
          sliding: moves.sliding,
          hazards: hazards.length,
          chase: Math.round(chase * 100) / 100,
          turnZ: Math.round(turnZ),
          zone: zone3(zoneN).name,
          speed: Math.round(speed),
          over,
          spin: Math.round(blob.spin * 100) / 100,
          bend: Math.round(bend),
          yaw: Math.round((corner?.yaw ?? 0) * 1000) / 1000,
          turning: turned,
        },
  swipe: (d) => input(d),
  corner: () => {
    const window3 = Math.max(TURN_WINDOW, speed * 1.6);
    turnZ = Math.min(turnZ, window3 - 200);
    // Same rule as 2D: dragging the corner back must not manufacture the
    // obstacle-on-corner state the generator can never produce.
    const span = cornerSpan();
    hazards = hazards.filter((h) => {
      const inside = h.data.z >= span.from && h.data.z <= span.to;
      if (inside) scene.remove(h.view);
      return !inside;
    });
    return turnDir;
  },
  safe: (on) => {
    safe = on;
    if (on) chase = 0;
  },
  track: () => {
    const span = cornerSpan();
    const cornerZ = distance + turnZ;
    let inSpan = 0;
    let gap = Infinity;
    for (const h of hazards) {
      if (h.data.z >= span.from && h.data.z <= span.to) inSpan++;
      gap = Math.min(gap, Math.abs(h.data.z - cornerZ));
    }
    return {
      count: hazards.length,
      inSpan,
      cornerSecs: Number.isFinite(gap) ? Math.round((gap / speed) * 100) / 100 : -1,
    };
  },
  stats: () => ({
    fps: Math.round(game.stats.fps * 10) / 10,
    frameMs: Math.round(game.stats.frameMs * 100) / 100,
    drawCalls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    tier: quality.tier,
    modelLoaded,
  }),
  hat: () => ({
    children: hatOn?.children.length ?? 0,
    wheel: Math.round(blob.wheel.rotation.x * 100) / 100,
    riderPitch: Math.round(blob.rider.rotation.x * 1000) / 1000,
  }),
  profile: () => {
    const p = loadProfile();
    return { best: p.best, coins: p.coins, runs: p.runs };
  },
};

// Silence the unused-import warning for Scene (types only in this file).
export type { Scene };
