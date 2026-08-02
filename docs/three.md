# 3D — @interverse/three

The engine's second renderer. A sibling of the Pixi engine, not a
replacement: every shipped 2D game keeps running untouched, and the game
logic in `@interverse/core` (track generation, combat, collision bands,
dialogue, saves, netcode) runs identically under either. Blob Rush and
Blob Rush 3D are the proof — same rules, same save, different pictures.

```ts
import { createGame3, lightRig, skyDome, autoQuality } from '@interverse/three';

const game = createGame3({ background: 0x8fa08c, fov: 52, update: (dt) => tick(dt) });
lightRig(game.scene, { intensity: 1.2 });
game.scene.add(skyDome({ horizon: 0x8fa08c, zenith: 0x3d4a4a }));
const quality = autoQuality(game); // call quality.update() each tick
```

## The boot contract

`createGame3` mirrors `createGame`: a fixed 60Hz update with interpolated
render, DPR-aware resizing, `destroy()` that destroys. The renderer comes
configured, not configurable — ACES filmic tone mapping, soft shadow maps,
sRGB output. Those three are the difference between "hobby WebGL" and a
game, and they are package decisions.

Post-processing? Set `game.draw = () => composer.render()` and the loop
stays the loop; only the last draw changes hands. Keep the composer's
pixel ratio synced to the renderer's or the quality ladder's resolution
steps get quietly undone one pass later.

## Quality answers to the frame clock

`autoQuality(game)` runs a four-step ladder — resolution 100/80/65/50%,
shadows off only at the floor — driven by MEASURED frame time from
`game.stats`, never by device name. It is paced by the wall clock, because
under load game time runs slower than real time, which is exactly when
quality most needs to act. Drops are fast, climbs are slow and sticky:
oscillating between tiers is worse than sitting one tier low.

## The house style, one dimension up

Vertex-colored low poly, zero textures. Same reasons as 2D's code-vector
rule: size (a whole 3D game ships ~130KB gzipped), phone GPUs (fill-rate
bound, no texture fetches), and coherence.

- `lowPolyMaterial()` — one shared material per CATEGORY of thing, so a
  zone restyle is a few `material.color` writes (color multiplies the
  vertex paint).
- `paintVertices(geom, fn)` — per-vertex color: gradients, height bands.
- `paintFacets(geom, fn)` — per-FACE color on non-indexed geometry:
  stripes, spots, anything crisp. Vertex colors interpolate across
  triangles, so a pattern painted at vertex granularity smears; facet
  paint is the fundamental low-poly move. Returns a new geometry.
- `jitterVertices`, `seededRand` — craft, deterministically. Art you can
  regenerate is art you can diff.
- `lowPolyGround`, `lowPolyTree`, `scatter` (InstancedMesh — hundreds of
  props, single-digit draw calls), `rollingBlob3` (the wheel/rider split:
  cosmetics ride, never spin).

Two rules found by screenshot, worth keeping:

- **Author albedo darker than the target screen color.** The pipeline
  lights and tone-maps everything UP; 2D palette colors painted straight
  in wash out to white.
- **Never height-paint a body that rolls.** A light belly ends up on top,
  in the sun, looking like a bug. Rolling bodies get spots.

## Imported models

```ts
import { loadModel } from '@interverse/three';

const totem = await loadModel('models/totem.glb', { height: 260 });
scene.add(totem);
```

glTF (`.glb`) only — the one format worth supporting. Files live in the
game's own `public/models/`, ship with the game, and are counted by the
payload budget gate like everything else (`pnpm budget`; spec §8.5's 3MB
is enforced at build time). A low-poly vertex-colored model runs
kilobytes: rush3d's totem is 8KB.

`loadModel` normalizes what every import needs and nobody remembers:
shadows on, feet re-origined to y=0, scaled so its bounding height equals
`height`, cached by URL and cloned per call — load once, place many.
Clones share materials: tint one and you tint them all, which is the same
lever the zone restyle uses. Draco-compressed files work by passing
`dracoPath` (copy three's decoder into your `public/`).

Keep models OPTIONAL: load them `.then`, ship the game so a failed fetch
costs a decoration, never a level. And keep provenance clear — anything
committed to the repo needs a licence you can name.

Studio's asset importer remains 2D (PNG spritesheets); it now points 3D
files here instead of refusing them outright.

## What is still 2D on purpose

The UI kit. HUD, buttons, dialogue are flat by nature — rush3d does its
HUD in DOM, which is free layout, free crispness, zero draw calls. A 3D
UI kit is a solution looking for a problem.

## Actors with slots

```ts
import { Actor3 } from '@interverse/three';

const golem = new Actor3({
  model: 'models/golem.glb',   // the MODEL slot ('@assetId' works in Studio)
  height: 210,
  autoPlay: 'idle',            // the ANIMATION slot: clips from the file
  fallback: () => myStandIn(), // shown until (or instead of) the model
  sfx: { hit: () => audio.pop() },          // the SFX slot
  vfx: { hit: (at) => sparks.burst(at) },   // the VFX slot
});
golem.play('swing');   // cross-fades; same-name calls are free
golem.emit('hit');     // fires BOTH slots, at the actor's feet
```

Every actor gets the same four sockets, and gameplay code only ever calls
`emit()` — what a hit looks and sounds like belongs to the slots, which is
what lets an actor re-skin without touching the code that fights it. Emit
counts are queryable (`emitted('hit')`) so playtests can assert the noise
actually happened. Blob Crashers 3D is the reference use.

In Studio, every actor's inspector carries these slots (model, idle/move
clips for characters, and per-moment sound/vfx pickers), and the view
dropdown's **3D** mode plays the level through them.

## Splines

```ts
import { Spline } from '@interverse/core';

const path = new Spline([a, mid, b]);          // passes through every point
mob.pos = path.atDistance(speed * t);          // moves in world units
```

Centripetal Catmull-Rom: no overshoot between tight points, and
`atDistance` is arc-length parameterized because a mob walking a path must
cover ground at its speed — segment-time motion visibly lurches between
control points. Lives in core (renderer-free): 2D patrols and 3D entrance
paths use the same curve.
