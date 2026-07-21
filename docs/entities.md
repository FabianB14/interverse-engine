# Entities & behaviors (§4.3)

`Entity` = PixiJS `Container` + composable behaviors — deliberately not a
full ECS.

```ts
import { Entity, Velocity, Timer, Tween, Wobble, easings } from '@interverse/engine';

const e = new Entity();
e.addChild(someGraphicsOrCharacter);
e.addBehavior(new Velocity(120, -40)); // units/sec
e.addBehavior(new Timer(2, () => scene.remove(e))); // fire once after 2s
e.addBehavior(new Timer(0.5, spawn, true)); // repeating
e.addBehavior(new Tween(e.scale, { x: 2, y: 2 }, 0.4, { ease: easings.outBack }));
e.addBehavior(new Wobble({ amount: 0.05, speed: 2 })); // idle squash/stretch
scene.add(e);
```

- Behaviors implement `{ done?: boolean; update(dt, entity) }` — set
  `done = true` to self-remove. Write custom ones freely.
- `Tween` interpolates any numeric properties on any object (positions,
  `scale`, `alpha`) from current values; `delay` and `onDone` supported.
  Chain tweens in `onDone` for sequences.
- Easings: `linear, inQuad, outQuad, outCubic, outBack`.
- Entities added via `scene.add()` update only while their scene is active.
