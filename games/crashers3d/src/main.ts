/**
 * 🥊 Blob Crashers 3D — the brawler, in a real canyon.
 *
 * The combat is the SAME code the 2D brawler ships, from @interverse/core:
 * Combo (the three-hit chain and its window), Telegraph (you could not
 * have known is not a difficulty setting), Invulnerable (a crowd is a
 * fight, not a stunlock), knockback with drag, HitStop, and WaveRunner
 * (gates close, gates open). This file decides what a swing LOOKS like.
 *
 * Three engine features make their debut here and this game is their
 * proof:
 *   - Actor3: golems are imported animated models (golem.glb — 'idle' and
 *     'swing' clips), the player is a procedural fallback body; both wear
 *     sfx and vfx SLOTS, and combat only ever calls emit().
 *   - Splines: every golem ENTERS along a curved path from offstage —
 *     placed points, smooth arrival, distance-parameterized so speed is
 *     speed.
 *   - The quality ladder and sky/fog, as everywhere in 3D.
 */

import {
  BoxGeometry,
  Color,
  Fog,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
import {
  Combo, Invulnerable, Spline, Telegraph, WaveRunner, audio,
  decayKnock, hitStopFor, knockbackFrom, spawnSpots,
} from '@interverse/core';
import type { Knock, WaveSpec } from '@interverse/core';
import {
  Actor3, autoQuality, createGame3, jitterVertices, lightRig, lowPolyMaterial,
  paintFacets, scatter, seededRand, skyDome,
} from '@interverse/three';

// ------------------------------------------------------------ the canyon
const ARENA_END = 3200;
const DEPTH_MIN = -230; // walkable band, world z
const DEPTH_MAX = 170;
const PLAYER_SPEED = 340;
const MOB_SPEED = 150;
const PLAYER_HEARTS = 5;
const MOB_HP = 3;
const GOLEM_HEIGHT = 210;

const SKY = 0x8c96a8;
const SKY_HIGH = 0x39415a;
const SAND = 0xb8a888;
const WALL = 0x8a7a64;
const BLOB = 0xe86a8a;

const WAVES: WaveSpec[] = [
  { atX: 900, enemies: [{ kind: 'golem' }, { kind: 'golem' }] as never[] },
  { atX: 1800, enemies: [{ kind: 'golem' }, { kind: 'golem' }, { kind: 'golem' }] as never[] },
  {
    atX: 2700,
    enemies: [{ kind: 'golem' }, { kind: 'golem' }, { kind: 'golem' }, { kind: 'golem' }] as never[],
  },
];

// ------------------------------------------------------------------- boot
const game = createGame3({ background: SKY, fov: 50, update: (dt) => update(dt) });
const { scene, camera, renderer } = game;
const quality = autoQuality(game);
const rig = lightRig(scene, {
  sky: 0xd8e0e8,
  ground: 0x6a6252,
  intensity: 1.3,
  from: { x: 0.35, y: 1, z: 0.55 },
  shadowArea: 620,
});
rig.hemi.intensity = 0.55;
audio.installUnlock();
scene.fog = new Fog(SKY, 700, 4200);
scene.add(skyDome({ horizon: SKY, zenith: SKY_HIGH, radius: 9000 }));

// Sand floor.
const floorGeom = new PlaneGeometry(ARENA_END + 2400, 1400, 60, 18);
floorGeom.rotateX(-Math.PI / 2);
jitterVertices(floorGeom, 6, 3);
{
  const rand = seededRand(21);
  const a = new Color(SAND);
  const b = new Color(0xa89878);
  scene.add(
    new Mesh(
      paintFacets(floorGeom, (_x, _y, _z, set) => set(rand() < 0.4 ? b : a)),
      lowPolyMaterial(),
    ),
  );
}
scene.children[scene.children.length - 1]!.position.x = ARENA_END / 2;
(scene.children[scene.children.length - 1] as Mesh).receiveShadow = true;

// Canyon walls: instanced boulders down both sides.
{
  const rockGeom = new SphereGeometry(150, 7, 5);
  jitterVertices(rockGeom, 34, 9);
  const rand = seededRand(31);
  const wall = new Color(WALL);
  const wallDark = new Color(0x6a5c4a);
  const rock = new Mesh(
    paintFacets(rockGeom, (_x, y, _z, set) => set(y > 40 ? wall : wallDark)),
    lowPolyMaterial(),
  );
  for (const side of [-1, 1]) {
    const inst = scatter(rock, 26, (i) => ({
      x: (i / 26) * (ARENA_END + 1800) - 600,
      z: side * (480 + rand() * 220),
      scale: 0.7 + rand() * 1.1,
      rotY: rand() * Math.PI * 2,
    }));
    // scatter places at y=0; boulders sit half-buried.
    inst.position.y = -40;
    scene.add(inst);
  }
}

// ------------------------------------------------------------------- vfx
/** A tiny spark pool: emit() throws a handful of glowing shards from a
 *  point. This is what lives behind every actor's vfx slot here. */
class Sparks {
  private pool: { m: Mesh; vel: Vector3; life: number }[] = [];
  private readonly mat = new MeshStandardMaterial({
    color: 0xffd166,
    emissive: 0xffd166,
    emissiveIntensity: 1.6,
  });

  burst(at: Vector3, count = 10, color?: number): void {
    for (let i = 0; i < count; i++) {
      const m = new Mesh(new BoxGeometry(9, 9, 9), this.mat);
      if (color !== undefined) {
        // One-off colored bursts share the pool but not the material.
        m.material = this.mat.clone();
        (m.material as MeshStandardMaterial).color.set(color);
        (m.material as MeshStandardMaterial).emissive.set(color);
      }
      m.position.copy(at);
      m.position.y += 60;
      scene.add(m);
      this.pool.push({
        m,
        vel: new Vector3((Math.random() - 0.5) * 420, 180 + Math.random() * 280, (Math.random() - 0.5) * 420),
        life: 0.55,
      });
    }
  }

  update(dt: number): void {
    for (let i = this.pool.length - 1; i >= 0; i--) {
      const s = this.pool[i]!;
      s.life -= dt;
      s.vel.y -= 900 * dt;
      s.m.position.addScaledVector(s.vel, dt);
      s.m.scale.setScalar(Math.max(0.01, s.life * 1.8));
      if (s.life <= 0) {
        scene.remove(s.m);
        this.pool.splice(i, 1);
      }
    }
  }
}
const sparks = new Sparks();

// ---------------------------------------------------------------- player
function blobBody(): Group {
  const g = new Group();
  const geom = new SphereGeometry(52, 12, 9);
  jitterVertices(geom, 2.4, 4);
  const c = new Color(BLOB);
  const light = new Color(0xf2a0b8);
  const rand = seededRand(8);
  const body = new Mesh(
    paintFacets(geom, (_x, _y, _z, set) => set(rand() < 0.1 ? light : c)),
    lowPolyMaterial(),
  );
  body.position.y = 52;
  body.castShadow = true;
  g.add(body);
  for (const side of [-1, 1]) {
    const eye = new Mesh(new SphereGeometry(7, 6, 5), new MeshStandardMaterial({ color: 0x22222e }));
    eye.position.set(side * 18, 66, 44);
    g.add(eye);
  }
  return g;
}

const player = new Actor3({
  fallback: blobBody,
  sfx: {
    swing: () => audio.blip(1.2),
    hit: () => audio.pop(0.9),
    hurt: () => audio.buzz(),
    down: () => audio.chime(),
  },
  vfx: {
    hit: (at) => sparks.burst(at, 10),
    hurt: (at) => sparks.burst(at, 8, 0xff6f91),
  },
});
scene.add(player.view);

// ------------------------------------------------------------------ mobs
interface Mob {
  actor: Actor3;
  x: number;
  z: number;
  hp: number;
  knock: Knock;
  telegraph: Telegraph;
  /** Entrance path — while set, the mob is arriving and cannot act. */
  path: { spline: Spline; travelled: number } | null;
  swingLanded: boolean;
}
let mobs: Mob[] = [];

function golemSfx(): Record<string, () => void> {
  return {
    swing: () => audio.blip(0.5),
    hit: () => audio.pop(0.6),
    down: () => audio.buzz(),
  };
}

function spawnMob(x: number, z: number, fromX: number): Mob {
  const actor = new Actor3({
    model: 'models/golem.glb',
    height: GOLEM_HEIGHT,
    autoPlay: 'idle',
    sfx: golemSfx(),
    vfx: {
      hit: (at) => sparks.burst(at, 8),
      down: (at) => sparks.burst(at, 22, 0x9aa4b0),
    },
  });
  scene.add(actor.view);
  // The entrance: a curved run from offstage to the spot. Two placed
  // points would be a straight march; the middle one bows the path out,
  // which is all a spline needs to read as "coming around" not "sliding".
  const side = z > (DEPTH_MIN + DEPTH_MAX) / 2 ? 1 : -1;
  const spline = new Spline([
    { x: fromX, y: 0, z: side * 760 },
    { x: (fromX + x) / 2, y: 0, z: side * 420 },
    { x, y: 0, z },
  ]);
  return {
    actor,
    x: fromX,
    z: side * 760,
    hp: MOB_HP,
    knock: { vx: 0, vy: 0, vz: 0 },
    telegraph: new Telegraph(),
    path: { spline, travelled: 0 },
    swingLanded: false,
  };
}

// ------------------------------------------------------------------ state
const combo = new Combo();
const iframes = new Invulnerable();
let waves = new WaveRunner(WAVES, ARENA_END);
let px = 200;
let pz = 0;
let hearts = PLAYER_HEARTS;
let over = true;
let won = false;
let hitStop = 0;
let safe = false;
let lastSpawnedWave = -1;

// ------------------------------------------------------------------- hud
const el = (id: string): HTMLElement => document.getElementById(id)!;
const hudHearts = el('hearts');
const hudWave = el('wave');
const hudBanner = el('banner');
const overlay = el('overlay');
const statsLine = el('stats-line');
let bannerTimer = 0;

function banner(text: string, secs = 1.3): void {
  hudBanner.textContent = text;
  hudBanner.style.opacity = '1';
  window.clearTimeout(bannerTimer);
  bannerTimer = window.setTimeout(() => (hudBanner.style.opacity = '0'), secs * 1000);
}

function refreshHud(): void {
  hudHearts.textContent = '❤'.repeat(hearts) + '🖤'.repeat(Math.max(0, PLAYER_HEARTS - hearts));
  const p = waves.progress;
  hudWave.textContent = p.state === 'done' ? 'GO → the far gate' : `wave ${p.index + 1} / ${WAVES.length}${p.state === 'fighting' ? ` · ${p.alive} left` : ''}`;
}

// ------------------------------------------------------------------ flow
function startRun(): void {
  for (const m of mobs) scene.remove(m.actor.view);
  mobs = [];
  waves = new WaveRunner(WAVES, ARENA_END);
  combo.reset();
  px = 200;
  pz = 0;
  hearts = PLAYER_HEARTS;
  over = false;
  won = false;
  hitStop = 0;
  lastSpawnedWave = -1;
  overlay.classList.add('hidden');
  banner('CRASH!', 0.9);
  refreshHud();
}

function endRun(win: boolean): void {
  if (over) return;
  over = true;
  won = win;
  statsLine.textContent = win
    ? `🏆 Canyon cleared — every wave broken. Run it again?`
    : `The golems got you at wave ${waves.progress.index + 1}. Again?`;
  overlay.classList.remove('hidden');
}

// ----------------------------------------------------------------- input
const held = { x: 0, z: 0 };
{
  const keys = new Map<string, [number, number]>([
    ['ArrowLeft', [-1, 0]], ['a', [-1, 0]],
    ['ArrowRight', [1, 0]], ['d', [1, 0]],
    ['ArrowUp', [0, -1]], ['w', [0, -1]],
    ['ArrowDown', [0, 1]], ['s', [0, 1]],
  ]);
  const down = new Set<string>();
  const apply = (): void => {
    held.x = 0;
    held.z = 0;
    for (const k of down) {
      const v = keys.get(k);
      if (v) {
        held.x += v[0];
        held.z += v[1];
      }
    }
  };
  window.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'j') {
      attack();
      return;
    }
    if (keys.has(e.key)) {
      down.add(e.key);
      apply();
    }
  });
  window.addEventListener('keyup', (e) => {
    down.delete(e.key);
    apply();
  });

  // Touch: drag anywhere = a velocity stick; short tap = attack.
  let start: { x: number; y: number; t: number } | null = null;
  window.addEventListener('pointerdown', (e) => {
    start = { x: e.clientX, y: e.clientY, t: performance.now() };
  });
  window.addEventListener('pointermove', (e) => {
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.hypot(dx, dy) < 18) return;
    const len = Math.hypot(dx, dy);
    held.x = dx / len;
    held.z = dy / len;
  });
  window.addEventListener('pointerup', () => {
    if (start && performance.now() - start.t < 220) attack();
    start = null;
    held.x = 0;
    held.z = 0;
  });
}
el('play').addEventListener('click', () => startRun());

// ---------------------------------------------------------------- combat
function attack(): void {
  if (over) return;
  const step = combo.swing();
  if (!step) return;
  player.emit('swing');
  // Squash-and-stretch on the swing — the fallback body has no clips, so
  // the juice is transform-side. If the player ever gets a modeled body
  // with a 'swing' clip, play() replaces this for free.
  player.view.scale.set(1.14, 0.86, 1.14);
  const facing = player.view.rotation.y;
  const dir = Math.abs(facing) < Math.PI / 2 ? 1 : -1;
  let connected = false;
  for (const m of mobs) {
    if (m.path) continue; // still arriving — offstage is out of reach
    const dx = m.x - px;
    const dz = m.z - pz;
    if (Math.abs(dz) > 95) continue;
    if (dx * dir < -30 || Math.abs(dx) > step.reach + 60) continue;
    connected = true;
    m.hp -= step.damage;
    m.knock = knockbackFrom(dir, step.launch ? 520 : 300, step.launch);
    m.actor.emit('hit');
    if (m.hp <= 0) {
      m.actor.emit('down');
      hitStop = Math.max(hitStop, hitStopFor(step.damage * 2));
      waves.defeated();
    } else {
      hitStop = Math.max(hitStop, hitStopFor(step.damage));
    }
  }
  if (connected) player.emit('hit');
}

function hurtPlayer(): void {
  if (safe || over || iframes.active) return;
  hearts -= 1;
  iframes.hit();
  player.emit('hurt');
  if (hearts <= 0) {
    player.emit('down');
    endRun(false);
  }
}

// ------------------------------------------------------------------ tick
function update(dt: number): void {
  quality.update();
  sparks.update(dt);
  if (over) return;

  // Hit stop freezes the WORLD, not the UI — time is the juice here.
  if (hitStop > 0) {
    hitStop = Math.max(0, hitStop - dt);
    return;
  }

  combo.tick(dt);
  iframes.tick(dt);
  player.update(dt);

  // Move, clamped to the walkable band and the wave gate.
  if (!combo.busy) {
    px += held.x * PLAYER_SPEED * dt;
    pz += held.z * PLAYER_SPEED * dt;
  }
  px = Math.max(60, Math.min(waves.limitX, px));
  pz = Math.max(DEPTH_MIN, Math.min(DEPTH_MAX, pz));
  if (held.x !== 0) player.view.rotation.y = held.x > 0 ? 0 : Math.PI;

  // Ease the swing squash back out.
  player.view.scale.lerp(new Vector3(1, 1, 1), Math.min(1, dt * 10));
  player.view.position.set(px, 0, pz);
  // The i-frame flicker: the classic "I am briefly untouchable" sign.
  player.view.visible = !iframes.active || Math.floor(performance.now() / 60) % 2 === 0;

  // Waves: walking into a gate spawns its fight.
  const spawned = waves.update(px);
  if (spawned && waves.progress.index !== lastSpawnedWave) {
    lastSpawnedWave = waves.progress.index;
    banner(`WAVE ${waves.progress.index + 1}`, 1.1);
    const spots = spawnSpots(spawned.enemies.length, px + 420, DEPTH_MIN, DEPTH_MAX, seededRand(waves.progress.index * 7 + 3));
    for (const s of spots) mobs.push(spawnMob(s.x, s.y, px + 1400));
  }

  // Mobs.
  for (const m of mobs) {
    m.actor.update(dt);
    if (m.path) {
      // Entering along the spline, at walk speed, in world units.
      m.path.travelled += MOB_SPEED * 1.7 * dt;
      const p = m.path.spline.atDistance(m.path.travelled);
      m.x = p.x;
      m.z = p.z;
      if (m.path.travelled >= m.path.spline.length) m.path = null;
    } else if (m.hp > 0) {
      m.knock = decayKnock(m.knock, dt);
      m.x += m.knock.vx * dt;
      const dx = px - m.x;
      const dz = pz - m.z;
      const dist = Math.hypot(dx, dz);
      if (m.telegraph.running) {
        // Wound up: the slam lands where it lands, dodged or not.
        if (m.telegraph.tick(dt) && !m.swingLanded) {
          m.swingLanded = true;
          if (Math.hypot(px - m.x, pz - m.z) < 190) hurtPlayer();
        }
      } else if (dist < 170) {
        m.telegraph.start(0.55);
        m.swingLanded = false;
        m.actor.play('swing');
        m.actor.emit('swing');
      } else {
        m.actor.play('idle');
        if (dist > 150) {
          m.x += (dx / dist) * MOB_SPEED * dt;
          m.z += (dz / dist) * MOB_SPEED * dt;
        }
      }
    }
    m.actor.view.position.set(m.x, 0, m.z);
    m.actor.view.rotation.y = px >= m.x ? Math.PI / 2 : -Math.PI / 2;
    // Downed golems sink away.
    if (m.hp <= 0) {
      m.actor.view.position.y -= 260 * dt;
      m.actor.view.rotation.z += dt * 2;
    }
  }
  mobs = mobs.filter((m) => {
    if (m.hp <= 0 && m.actor.view.position.y < -300) {
      scene.remove(m.actor.view);
      return false;
    }
    return true;
  });

  // Camera: a 3/4 chase along the canyon.
  camera.position.set(px - 60, 470, 760);
  camera.lookAt(new Vector3(px + 160, 60, pz * 0.4));

  if (waves.finished && px >= ARENA_END - 80) endRun(true);
  refreshHud();
}

refreshHud();

// ------------------------------------------------- headless test hooks
declare global {
  interface Window {
    __crashers3d?: {
      ready: () => boolean;
      screen: () => 'menu' | 'run';
      play: () => void;
      state: () => {
        x: number; z: number; hearts: number; over: boolean; won: boolean;
        wave: { state: string; index: number; alive: number; limitX: number };
        mobs: number; entering: number; comboStep: number;
      };
      move: (x: number, z: number) => void;
      attack: () => void;
      warp: (x: number) => void;
      safe: (on: boolean) => void;
      mob: (i: number) => {
        x: number; z: number; hp: number; playing: string; clipTime: number;
        modelLoaded: boolean; clips: string[]; swings: number; hits: number;
      } | null;
      emitted: (event: string) => number;
      stats: () => { fps: number; drawCalls: number; triangles: number; tier: number };
    };
  }
}

window.__crashers3d = {
  ready: () => game.stats.fps > 0,
  screen: () => (over ? 'menu' : 'run'),
  play: () => startRun(),
  state: () => ({
    x: Math.round(px),
    z: Math.round(pz),
    hearts,
    over,
    won,
    wave: { ...waves.progress },
    mobs: mobs.filter((m) => m.hp > 0).length,
    entering: mobs.filter((m) => m.path !== null).length,
    comboStep: combo.step,
  }),
  move: (x, z) => {
    held.x = x;
    held.z = z;
  },
  attack: () => attack(),
  warp: (x) => {
    px = Math.min(x, waves.limitX);
  },
  safe: (on) => {
    safe = on;
  },
  mob: (i) => {
    // Index the LIVING only — a downed golem is scenery on its way out,
    // and a test driver aiming at one would be fighting a corpse.
    const alive = mobs.filter((x) => x.hp > 0);
    const m = alive[i];
    if (!m) return null;
    return {
      x: Math.round(m.x),
      z: Math.round(m.z),
      hp: m.hp,
      playing: m.actor.playing,
      clipTime: Math.round(m.actor.clipTime * 100) / 100,
      modelLoaded: m.actor.modelLoaded,
      clips: m.actor.clips,
      swings: m.actor.emitted('swing'),
      hits: m.actor.emitted('hit'),
    };
  },
  emitted: (event) => player.emitted(event),
  stats: () => ({
    fps: Math.round(game.stats.fps * 10) / 10,
    drawCalls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    tier: quality.tier,
  }),
};
