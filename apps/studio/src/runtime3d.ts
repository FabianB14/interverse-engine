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

import {
  BoxGeometry, Color, Fog, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Plane,
  PlaneGeometry, Raycaster, SphereGeometry, TorusGeometry, Vector2, Vector3,
} from 'three';
import {
  Actor3, autoQuality, createGame3, jitterVertices, lightRig, lowPolyMaterial,
  paintFacets, seededRand, skyDome, wireRing,
} from '@interverse/three';
import type { Game3 } from '@interverse/three';
import { audio } from '@interverse/core';
import { STEP_LIMIT, groundHeightAt } from './model.js';
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
  debug: () => { actors: number; models: number; playerX: number; playerZ: number; playerY: number };
}

export interface Mount3dOptions {
  /** 'play' walks the level; 'edit' is the 3D EDITOR — click selects (wired
   *  to the inspector), dragging an actor moves it on the ground plane, and
   *  every inspector edit lands live because positions, scale and color are
   *  re-read from the defs each frame. */
  mode?: 'edit' | 'play';
  /** Edit mode: called when a click selects an actor (or empty ground). */
  onSelect?: (id: string | null) => void;
  /** Edit mode: called after a drag ends, so the editor can save. */
  onMoved?: () => void;
  /** Edit mode: who is selected right now — the transform gizmos follow
   *  this actor. A getter, because selection lives in the editor and the
   *  inspector can change it while the 3D view is open. */
  selected?: () => string | null;
}

export function mount3d(
  project: ProjectDef,
  scene: SceneDef,
  host: HTMLElement,
  opts: Mount3dOptions = {},
): Mounted3d {
  const mode = opts.mode ?? 'play';
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
  /** What each shape's body was last built from — see syncActors. */
  const shapeSigs = new Map<string, string>();
  // A ref cell rather than a let: closures below read it long after the
  // loop that assigns it, and flow narrowing across that boundary has
  // opinions; a property read has none.
  const playerRef: { cur: { def: EntityDef; actor: Actor3 } | null } = { cur: null };
  const touched = new Set<string>();

  function spawnActor(def: EntityDef): { def: EntityDef; actor: Actor3 } {
    const url = modelUrl(project, def.model3d);
    const standIn = (): Group => {
      const g = new Group();
      if (def.kind === 'shape') {
        // The primitive IS its numbers: a plane is flat, a ramp is a box
        // tipped so its top runs from ground to sizeH along Z.
        const h = def.shapeType === 'plane' ? 6 : Math.max(10, def.sizeH);
        const geom = new BoxGeometry(def.sizeX, h, def.sizeZ);
        const c = new Color(def.color);
        const mesh = new Mesh(
          paintFacets(geom, (_x, _y, _z, set) => set(c)),
          lowPolyMaterial(),
        );
        if (def.shapeType === 'ramp') {
          mesh.rotation.x = -Math.atan2(def.sizeH, def.sizeZ);
          mesh.position.y = h / 2;
        } else {
          mesh.position.y = h / 2;
        }
        mesh.castShadow = def.shapeType !== 'plane';
        mesh.receiveShadow = true;
        g.add(mesh);
        return g;
      }
      if (def.kind === 'camera') {
        // Editor-only body; play mode hides it and films from it instead.
        const cBody = new Mesh(
          paintFacets(new BoxGeometry(60, 40, 40), (_x, _y, _z, set) => set(new Color(0x2a2740))),
          lowPolyMaterial(),
        );
        cBody.position.y = 40;
        const lens = new Mesh(
          paintFacets(new BoxGeometry(24, 24, 20), (_x, _y, _z, set) => set(new Color(def.color))),
          lowPolyMaterial(),
        );
        lens.position.set(0, 40, 28);
        g.add(cBody, lens);
        return g;
      }
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
    if (def.kind === 'shape') {
      shapeSigs.set(def.id, `${def.shapeType}|${def.sizeX}|${def.sizeZ}|${def.sizeH}|${def.color}`);
    }
    const entry = { def, actor };
    actors.push(entry);
    if (def.kind === 'blob' && !playerRef.cur) playerRef.cur = entry;
    return entry;
  }
  for (const def of scene.entities) spawnActor(def);

  /**
   * Live add/remove: the palette drops actors into scene.entities while the
   * 3D editor is open, and an actor that only appears after Undo shuffles
   * the array is a bug someone actually hit. Diff by id every frame — N is
   * a scene's worth, the map is cheap, and the world stays truthful.
   */
  function syncActors(): void {
    const want = new Map(scene.entities.map((e) => [e.id, e]));
    for (let i = actors.length - 1; i >= 0; i--) {
      const a = actors[i]!;
      if (!want.has(a.def.id)) {
        game.scene.remove(a.actor.view);
        if (playerRef.cur === a) playerRef.cur = null;
        actors.splice(i, 1);
      }
      want.delete(a.def.id);
    }
    for (const def of want.values()) spawnActor(def);
    // Shapes bake their dimensions into geometry, so a size edit (gizmo or
    // inspector) rebuilds the body — cheap at editor scale, and the only
    // way the box you see stays the box the walk code climbs.
    for (let i = actors.length - 1; i >= 0; i--) {
      const a = actors[i]!;
      if (a.def.kind !== 'shape') continue;
      const sig = `${a.def.shapeType}|${a.def.sizeX}|${a.def.sizeZ}|${a.def.sizeH}|${a.def.color}`;
      if (shapeSigs.get(a.def.id) !== sig) {
        game.scene.remove(a.actor.view);
        actors.splice(i, 1);
        spawnActor(a.def);
      }
    }
  }

  // 🩻 Collision view (H): a ring per actor, scaled LIVE from def.radius —
  // edit the radius in the inspector and the ring follows, which is the
  // "modify them" half of seeing collisions.
  let showHitboxes = false;
  const rings = actors.map((a) => {
    const ring = wireRing(1, a.def.kind === 'blob' ? 0x8affc1 : 0xff6f91);
    ring.visible = false;
    game.scene.add(ring);
    return { a, ring };
  });

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
    if (e.key === 'h') showHitboxes = !showHitboxes;
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

  // Per-actor tint: the actor's COLOR belongs to the actor, so it must
  // reach the model. Clones share materials by design, so the first tint
  // clones them; near-white stock albedo is what lets the color land true.
  const applyTint = (entry: { def: EntityDef; actor: Actor3 }, applied: Map<string, number>): void => {
    if (applied.get(entry.def.id) === entry.def.color) return;
    applied.set(entry.def.id, entry.def.color);
    entry.actor.view.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      if (!mesh.userData.ownMat) {
        mesh.material = (mesh.material as MeshStandardMaterial).clone();
        mesh.userData.ownMat = true;
      }
      (mesh.material as MeshStandardMaterial).color.set(entry.def.color);
    });
  };
  const tinted = new Map<string, number>();

  // The edit block below installs this: per-frame editor work (WASD camera
  // flight, gizmo placement) that needs dt and runs only in edit mode.
  let editTick: ((dt: number) => void) | null = null;

  function update(dt: number): void {
    quality.update();
    // Defs are LIVE references into the project: re-reading them each frame
    // is what makes the inspector's edits appear as you type them.
    if (mode === 'edit') syncActors();
    editTick?.(dt);
    for (const a of actors) {
      if (mode === 'edit' || a !== playerRef.cur) {
        a.actor.view.position.x = a.def.x - W / 2;
        a.actor.view.position.z = a.def.y - H / 2;
        // Plan rotation is 2D CCW; three's Y-rotation is CW seen from
        // above, so the sign flips — the same convention shapeHeightAt
        // inverts, which is what keeps a ramp's slope where its art is.
        a.actor.view.rotation.y = -a.def.rotation;
      }
      // Shapes size through sizeX/sizeZ (rebuilt on change below), not the
      // uniform scale — scaling a box's GROUP would also scale its height.
      if (a.def.kind !== 'shape') a.actor.view.scale.setScalar(a.def.scale);
      applyTint(a, tinted);
    }
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
    for (const { a, ring } of rings) {
      ring.visible = showHitboxes;
      if (showHitboxes) {
        ring.position.set(a.actor.view.position.x, 3, a.actor.view.position.z);
        const rr = Math.max(14, a.def.radius) * a.def.scale;
        ring.scale.setScalar(rr);
      }
    }
    const player = playerRef.cur;
    // A placed camera wins: play films from it, aimed at the player (or
    // scene centre without one). Its body only shows in the editor.
    const camActor = actors.find((a) => a.def.kind === 'camera');
    if (camActor) camActor.actor.view.visible = mode === 'edit';
    if (mode === 'edit' || !player) return;
    if (camActor) {
      const cd = camActor.def;
      const target = player.actor.view.position;
      game.camera.position.set(
        cd.x - W / 2 + Math.sin(playYaw) * cd.camDist * 0.001,
        cd.camHeight,
        cd.y - H / 2,
      );
      game.camera.lookAt(new Vector3(target.x, 40 + target.y, target.z));
      // fall through: movement still runs below; the follow-cam block is
      // skipped because the placed camera owns the shot.
    }
    const pv = player.actor.view;
    // Walkable shapes: the ground under your feet is groundHeightAt, and a
    // rise steeper than STEP_LIMIT is a wall. Axes resolve separately so a
    // blocked diagonal slides along the face instead of sticking.
    const planH = (wx: number, wz: number): number => groundHeightAt(scene, wx + W / 2, wz + H / 2);
    const nx = Math.max(-W / 2, Math.min(W / 2, pv.position.x + held.x * PLAYER_SPEED * dt));
    const nz = Math.max(-H / 2, Math.min(H / 2, pv.position.z + held.z * PLAYER_SPEED * dt));
    const hHere = planH(pv.position.x, pv.position.z);
    if (planH(nx, nz) - hHere <= STEP_LIMIT) {
      pv.position.x = nx;
      pv.position.z = nz;
    } else {
      if (planH(nx, pv.position.z) - hHere <= STEP_LIMIT) pv.position.x = nx;
      else if (planH(pv.position.x, nz) - hHere <= STEP_LIMIT) pv.position.z = nz;
    }
    // Feet ease onto the ground — ramps read as slopes, steps as steps.
    const under = planH(pv.position.x, pv.position.z);
    pv.position.y += (under - pv.position.y) * Math.min(1, dt * 14);
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
    // The follow cam, orbitable: drag swings playYaw, wheel scales playDist.
    if (!camActor) {
      game.camera.position.set(
        pv.position.x + Math.sin(playYaw) * 640 * playDist,
        520 * playDist + pv.position.y,
        pv.position.z + Math.cos(playYaw) * 640 * playDist,
      );
      game.camera.lookAt(new Vector3(pv.position.x, 30 + pv.position.y, pv.position.z));
    }
  }

  // Play-mode orbit: drag to swing the follow camera around the player,
  // wheel to zoom — the rotate-the-angle ask, in game.
  let playYaw = 0;
  let playDist = 1;
  if (mode === 'play') {
    let last: { x: number; y: number } | null = null;
    const dom = game.renderer.domElement;
    dom.addEventListener('pointerdown', (e) => (last = { x: e.clientX, y: e.clientY }));
    dom.addEventListener('pointermove', (e) => {
      if (!last) return;
      playYaw -= (e.clientX - last.x) * 0.006;
      last = { x: e.clientX, y: e.clientY };
    });
    dom.addEventListener('pointerup', () => (last = null));
    dom.addEventListener('wheel', (e) => {
      playDist = Math.max(0.5, Math.min(2.2, playDist + e.deltaY * 0.001));
    }, { passive: true });
  }

  // ------------------------------------------------- edit interactions
  if (mode === 'edit') {
    const ray = new Raycaster();
    const pointer = new Vector2();
    const groundPlane = new Plane(new Vector3(0, 1, 0), 0);
    let dragging: { def: EntityDef } | null = null;
    let orbiting: { x: number; y: number } | null = null;
    let camDist = Math.max(W, H) * 1.1 + 500;
    let yaw = 0;
    let pitch = 0.82; // radians above the horizon — the familiar 3/4 view
    const camAt = new Vector3(0, 0, 0);
    const placeCam = (): void => {
      game.camera.position.set(
        camAt.x + camDist * Math.cos(pitch) * Math.sin(yaw),
        camDist * Math.sin(pitch),
        camAt.z + camDist * Math.cos(pitch) * Math.cos(yaw),
      );
      game.camera.lookAt(new Vector3(camAt.x, 0, camAt.z));
    };
    placeCam();

    // 🔄 Transform gizmos: a ring to ROTATE, a corner cube to SCALE. They
    // shadow whichever actor the editor says is selected, and dragging them
    // writes rotation / scale (or a shape's footprint) back into the def —
    // the same def the inspector shows, so both views agree by construction.
    const selDef = (): EntityDef | null => {
      const id = opts.selected?.() ?? null;
      return id ? (scene.entities.find((en) => en.id === id) ?? null) : null;
    };
    const gizmo = new Group();
    const rotRing = new Mesh(
      new TorusGeometry(1, 0.05, 8, 48),
      new MeshBasicMaterial({ color: 0x6ec5ff, transparent: true, opacity: 0.9, depthTest: false }),
    );
    rotRing.rotation.x = Math.PI / 2;
    rotRing.renderOrder = 998;
    const scaleHandle = new Mesh(
      new BoxGeometry(0.16, 0.16, 0.16),
      new MeshBasicMaterial({ color: 0xffd166, depthTest: false }),
    );
    scaleHandle.position.set(1, 0, 0);
    scaleHandle.renderOrder = 999;
    gizmo.add(rotRing, scaleHandle);
    gizmo.visible = false;
    game.scene.add(gizmo);
    let gizmoDrag:
      | { kind: 'rotate'; def: EntityDef; grabOffset: number }
      | { kind: 'scale'; def: EntityDef; startDist: number; scale: number; sizeX: number; sizeZ: number }
      | null = null;
    const cast = (e: PointerEvent): void => {
      const r = game.renderer.domElement.getBoundingClientRect();
      pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(pointer, game.camera);
    };
    const groundAt = (e: PointerEvent): Vector3 | null => {
      cast(e);
      const at = new Vector3();
      return ray.ray.intersectPlane(groundPlane, at) ? at : null;
    };
    const onDown = (e: PointerEvent): void => {
      cast(e);
      // The gizmo outranks the world: a click that lands on it must never
      // fall through and re-select whatever actor sits underneath.
      const gDef = selDef();
      if (gizmo.visible && gDef) {
        const gHit = ray.intersectObject(gizmo, true);
        if (gHit.length) {
          const at = groundAt(e);
          const dx = (at?.x ?? 0) - (gDef.x - W / 2);
          const dz = (at?.z ?? 0) - (gDef.y - H / 2);
          if (gHit[0]!.object === scaleHandle) {
            gizmoDrag = {
              kind: 'scale', def: gDef, startDist: Math.max(1, Math.hypot(dx, dz)),
              scale: gDef.scale, sizeX: gDef.sizeX, sizeZ: gDef.sizeZ,
            };
          } else {
            gizmoDrag = { kind: 'rotate', def: gDef, grabOffset: Math.atan2(dz, dx) - gDef.rotation };
          }
          return;
        }
      }
      // Nearest actor whose mesh the ray hits.
      let best: { d: number; a: (typeof actors)[number] } | null = null;
      for (const a of actors) {
        const hit = ray.intersectObject(a.actor.view, true);
        if (hit.length && (!best || hit[0]!.distance < best.d)) best = { d: hit[0]!.distance, a };
      }
      if (best) {
        dragging = { def: best.a.def };
        opts.onSelect?.(best.a.def.id);
      } else {
        // Empty ground: this drag ORBITS, Unity-style. Click-without-drag
        // still lands as a deselect on pointerup.
        orbiting = { x: e.clientX, y: e.clientY };
      }
    };
    const onMove = (e: PointerEvent): void => {
      if (gizmoDrag) {
        const at = groundAt(e);
        if (!at) return;
        const d = gizmoDrag.def;
        const dx = at.x - (d.x - W / 2);
        const dz = at.z - (d.y - H / 2);
        if (gizmoDrag.kind === 'rotate') {
          d.rotation = Math.atan2(dz, dx) - gizmoDrag.grabOffset;
        } else {
          const factor = Math.hypot(dx, dz) / gizmoDrag.startDist;
          if (d.kind === 'shape') {
            // Scaling a shape grows its FOOTPRINT — the numbers the walk
            // code reads — never a group scale the collision cannot see.
            d.sizeX = Math.max(20, Math.round(gizmoDrag.sizeX * factor));
            d.sizeZ = Math.max(20, Math.round(gizmoDrag.sizeZ * factor));
          } else {
            d.scale = Math.max(0.2, Math.min(6, Math.round(gizmoDrag.scale * factor * 100) / 100));
          }
        }
        return;
      }
      if (orbiting) {
        yaw -= (e.clientX - orbiting.x) * 0.008;
        pitch = Math.max(0.25, Math.min(1.35, pitch + (e.clientY - orbiting.y) * 0.006));
        orbiting = { x: e.clientX, y: e.clientY };
        placeCam();
        return;
      }
      if (!dragging) return;
      cast(e);
      const at = new Vector3();
      if (ray.ray.intersectPlane(groundPlane, at)) {
        dragging.def.x = Math.round(at.x + W / 2);
        dragging.def.y = Math.round(at.z + H / 2);
      }
    };
    const onUp = (e: PointerEvent): void => {
      if (gizmoDrag || dragging) opts.onMoved?.();
      else if (orbiting && Math.hypot(e.clientX - orbiting.x, e.clientY - orbiting.y) < 4) {
        opts.onSelect?.(null);
      }
      gizmoDrag = null;
      dragging = null;
      orbiting = null;
    };
    const onWheel = (e: WheelEvent): void => {
      camDist = Math.max(500, Math.min(6000, camDist + e.deltaY * 1.6));
      placeCam();
    };
    const dom = game.renderer.domElement;
    dom.addEventListener('pointerdown', onDown);
    dom.addEventListener('pointermove', onMove);
    dom.addEventListener('pointerup', onUp);
    dom.addEventListener('wheel', onWheel, { passive: true });

    editTick = (dt) => {
      // WASD flies the camera over the board — yaw-relative, like every
      // scene editor: W is "into the screen" wherever you have orbited to.
      if (held.x !== 0 || held.z !== 0) {
        const spd = Math.max(500, camDist * 0.55);
        const fwd = -held.z; // W pushes forward
        camAt.x += (fwd * -Math.sin(yaw) + held.x * Math.cos(yaw)) * spd * dt;
        camAt.z += (fwd * -Math.cos(yaw) - held.x * Math.sin(yaw)) * spd * dt;
        placeCam();
      }
      // The gizmo shadows the selection, sized to clear the actor's body.
      const def = selDef();
      if (!def) {
        gizmo.visible = false;
        return;
      }
      gizmo.visible = true;
      const r =
        def.kind === 'shape'
          ? Math.hypot(def.sizeX, def.sizeZ) / 2 + 30
          : Math.max(14, def.radius) * def.scale + 40;
      gizmo.position.set(def.x - W / 2, 6, def.y - H / 2);
      gizmo.scale.setScalar(r);
      gizmo.rotation.y = -def.rotation;
    };
  }

  // A gentle overhead start if there is no player to follow.
  if (mode !== 'edit' && !playerRef.cur) {
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
        playerY: Math.round(p ? p.actor.view.position.y : 0),
      };
    },
  };
}
