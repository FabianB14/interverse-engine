/**
 * 🧊 The 3D play preview — Studio's first walk into the third dimension.
 *
 * When a level's view is set to 3D, Play mounts THIS instead of the Pixi
 * runtime: the same project data (positions, colors, kinds, and the new
 * model/anim/sfx/vfx slots) rendered by @interverse/three. The mapping is
 * the one the data already implies — the editor canvas is a top-down
 * plan, so x stays x and canvas-y becomes world-z, and every entity
 * stands on a ground plane where its marker sat.
 *
 * Deliberately a PREVIEW, and honest about it: you walk the level with
 * the player actor, imported models load into their slots with their
 * animations, sfx/vfx slots fire on spawn and contact — but scripts,
 * combat and events still run only in the 2D runtimes. Those arrive when
 * the 3D runtime grows up; a preview that pretends otherwise would be a
 * bug factory wearing a feature's clothes.
 */

import { BoxGeometry, Color, Fog, Group, Mesh, MeshStandardMaterial, PlaneGeometry, SphereGeometry, Vector3 } from 'three';
import {
  Actor3, autoQuality, createGame3, jitterVertices, lightRig, lowPolyMaterial,
  paintFacets, seededRand, skyDome,
} from '@interverse/three';
import type { Game3 } from '@interverse/three';
import { audio } from '@interverse/core';
import type { EntityDef, ProjectDef, SceneDef } from './model.js';

const PLAYER_SPEED = 320;

/** Resolve a model3d slot: '@assetId' means an uploaded asset (a data
 *  URL in the project file), anything else is a URL as written. */
function modelUrl(p: ProjectDef, slot: string): string | null {
  if (!slot) return null;
  if (slot.startsWith('@')) return p.assets?.[slot.slice(1)] ?? null;
  return slot;
}

function slotSfx(def: EntityDef): Record<string, () => void> {
  const out: Record<string, () => void> = {};
  for (const s of def.sfxSlot) {
    const sound = s.sound;
    if (sound) out[s.on] = () => audio[sound === 'pop' ? 'pop' : sound === 'chime' ? 'chime' : sound === 'buzz' ? 'buzz' : 'blip']();
  }
  return out;
}

/** Preset-agnostic 3D burst: every vfx preset becomes a shower of glowing
 *  shards in the preset's signature color. The 2D runtime draws the real
 *  particle art; the preview's job is that the SLOT visibly fires. */
const PRESET_COLORS: Record<string, number> = {
  confetti: 0xffd166, poof: 0xd8dde8, sparkle: 0x8affc1, ember: 0xff9a4a,
  heal: 0x7dffb8, hit: 0xff6f91, magic: 0xb08aff, trail: 0x8fd0ff,
};

export interface Mounted3d {
  dispose: () => void;
  /** For tests: how many actors mounted, how many have models loaded. */
  debug: () => { actors: number; models: number; playerX: number; playerZ: number };
}

export function mount3d(project: ProjectDef, scene: SceneDef, host: HTMLElement): Mounted3d {
  const game: Game3 = createGame3({
    background: 0x8fa8b8,
    fov: 50,
    mount: host,
    update: (dt) => update(dt),
  });
  const quality = autoQuality(game);
  const rig = lightRig(game.scene, { intensity: 1.2, shadowArea: 700 });
  rig.hemi.intensity = 0.6;
  game.scene.fog = new Fog(0x8fa8b8, 900, 4600);
  game.scene.add(skyDome({ horizon: 0x8fa8b8, zenith: 0x44586a }));

  const W = scene.worldW;
  const H = scene.worldH;

  // The ground: the level's rectangle, terrain-green, faceted.
  const groundGeom = new PlaneGeometry(W + 400, H + 400, 40, 24);
  groundGeom.rotateX(-Math.PI / 2);
  jitterVertices(groundGeom, 5, 3);
  const rand = seededRand(scene.id.length + W);
  const gA = new Color(0x74a06a);
  const gB = new Color(0x86b078);
  const ground = new Mesh(
    paintFacets(groundGeom, (_x, _y, _z, set) => set(rand() < 0.4 ? gB : gA)),
    lowPolyMaterial(),
  );
  ground.receiveShadow = true;
  game.scene.add(ground);

  // Entities: the plan's (x, y) becomes (x - W/2, y - H/2) on the plane.
  const sparksPool: { m: Mesh; vel: Vector3; life: number }[] = [];
  const sparkBurst = (at: Vector3, color: number): void => {
    for (let i = 0; i < 10; i++) {
      const m = new Mesh(
        new BoxGeometry(8, 8, 8),
        new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.5 }),
      );
      m.position.copy(at);
      m.position.y += 50;
      game.scene.add(m);
      sparksPool.push({
        m,
        vel: new Vector3((Math.random() - 0.5) * 380, 200 + Math.random() * 240, (Math.random() - 0.5) * 380),
        life: 0.5,
      });
    }
  };

  const actors: { def: EntityDef; actor: Actor3 }[] = [];
  // A ref cell rather than a let: closures below read it long after the
  // loop that assigns it, and flow narrowing across that boundary has
  // opinions; a property read has none.
  const playerRef: { cur: { def: EntityDef; actor: Actor3 } | null } = { cur: null };
  const touched = new Set<string>();

  for (const def of scene.entities) {
    const url = modelUrl(project, def.model3d);
    const standIn = (): Group => {
      const g = new Group();
      const r = Math.max(14, def.radius) * def.scale;
      const geom = new SphereGeometry(r, 10, 7);
      jitterVertices(geom, r * 0.05, def.seed);
      const c = new Color(def.color);
      const body = new Mesh(
        paintFacets(geom, (_x, _y, _z, set) => set(c)),
        lowPolyMaterial(),
      );
      body.position.y = r;
      body.castShadow = true;
      g.add(body);
      return g;
    };
    const actor = new Actor3({
      ...(url ? { model: url, height: Math.max(60, def.radius * 3 * def.scale) } : {}),
      fallback: standIn,
      ...(def.animIdle ? { autoPlay: def.animIdle } : {}),
      sfx: slotSfx(def),
      vfx: Object.fromEntries(
        def.vfxSlot.map((v) => [v.on, (at: Vector3) => sparkBurst(at, PRESET_COLORS[v.preset] ?? 0xffd166)]),
      ),
    });
    actor.view.position.set(def.x - W / 2, 0, def.y - H / 2);
    game.scene.add(actor.view);
    actor.emit('spawn');
    const entry = { def, actor };
    actors.push(entry);
    if (def.kind === 'blob' && !playerRef.cur) playerRef.cur = entry;
  }

  // Walk the level: arrows/WASD, same keys as the 2D runtime.
  const held = { x: 0, z: 0 };
  const keys = new Map<string, [number, number]>([
    ['ArrowLeft', [-1, 0]], ['a', [-1, 0]],
    ['ArrowRight', [1, 0]], ['d', [1, 0]],
    ['ArrowUp', [0, -1]], ['w', [0, -1]],
    ['ArrowDown', [0, 1]], ['s', [0, 1]],
  ]);
  const down = new Set<string>();
  const applyKeys = (): void => {
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
  const onKeyDown = (e: KeyboardEvent): void => {
    if (keys.has(e.key)) {
      down.add(e.key);
      applyKeys();
    }
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    down.delete(e.key);
    applyKeys();
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  function update(dt: number): void {
    quality.update();
    for (let i = sparksPool.length - 1; i >= 0; i--) {
      const sp = sparksPool[i]!;
      sp.life -= dt;
      sp.vel.y -= 900 * dt;
      sp.m.position.addScaledVector(sp.vel, dt);
      sp.m.scale.setScalar(Math.max(0.01, sp.life * 2));
      if (sp.life <= 0) {
        game.scene.remove(sp.m);
        sparksPool.splice(i, 1);
      }
    }
    for (const a of actors) a.actor.update(dt);
    const player = playerRef.cur;
    if (!player) return;
    const pv = player.actor.view;
    pv.position.x += held.x * PLAYER_SPEED * dt;
    pv.position.z += held.z * PLAYER_SPEED * dt;
    pv.position.x = Math.max(-W / 2, Math.min(W / 2, pv.position.x));
    pv.position.z = Math.max(-H / 2, Math.min(H / 2, pv.position.z));
    const moving = held.x !== 0 || held.z !== 0;
    if (moving) pv.rotation.y = Math.atan2(held.x, held.z);
    // The animation slot answers movement: move clip while walking, idle
    // when standing — the exact contract a character model signs up for.
    if (player.def.animMove || player.def.animIdle) {
      player.actor.play(moving ? player.def.animMove || player.def.animIdle : player.def.animIdle);
    }
    // Contact fires the tap/hit slots of whatever the player walks into.
    for (const a of actors) {
      if (a === player || touched.has(a.def.id)) continue;
      const d = a.actor.view.position.distanceTo(pv.position);
      if (d < Math.max(40, a.def.radius * a.def.scale) + 50) {
        touched.add(a.def.id);
        a.actor.emit('tap');
      }
    }
    game.camera.position.set(pv.position.x, 520, pv.position.z + 640);
    game.camera.lookAt(new Vector3(pv.position.x, 30, pv.position.z - 120));
  }

  // A gentle overhead start if there is no player to follow.
  if (!playerRef.cur) {
    game.camera.position.set(0, 900, H / 2 + 700);
    game.camera.lookAt(new Vector3(0, 0, 0));
  }

  return {
    dispose: () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      game.destroy();
    },
    debug: () => {
      const p = playerRef.cur;
      return {
        actors: actors.length,
        models: actors.filter((a) => a.actor.modelLoaded).length,
        playerX: Math.round(p ? p.actor.view.position.x : 0),
        playerZ: Math.round(p ? p.actor.view.position.z : 0),
      };
    },
  };
}
