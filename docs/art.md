# Code-drawn vector art (§4.5)

No sprite assets required — art is drawn with PixiJS Graphics helpers.

```ts
import {
  drawBlob,
  blobCharacter,
  palettes,
  partyPop,
  cozyAutumn,
  darken,
  lighten,
  pickColor,
  popIn,
  squash,
} from '@interverse/engine';

// Organic blob shape into a Graphics (deterministic by seed):
drawBlob(g, {
  radius: 60,
  seed: 7,
  wobble: 0.16,
  color: 0xff6f91,
  stroke: 0xffffff,
  strokeWidth: 5,
});

// A whole character (body + face + soft shadow):
const char = blobCharacter({ radius: 40, color: partyPop.colors[0] ?? 0xff6f91, seed: 3 });
entity.addChild(char.view); // position/scale this
new Wobble({ target: char.body }); // squash/wobble the body, not the shadow
```

**Palettes** keep games cohesive: `partyPop` (vibrant purple/pink) and
`cozyAutumn` (warm browns/greens). Each has `bg, ink, inkSoft, accent,
colors[]`. Pick entity colors with `pickColor(palette.colors)`; derive
shades with `darken(color, 0.2)` / `lighten(color, 0.2)`.

**Juice** (procedural animation): `popIn(entity)` for springy spawns,
`squash(entity, { amount, duration, onDone })` for impacts, `Wobble` for
idle breathing. Cozy games live and die on juice — use it everywhere.

Sprites/spritesheets remain fully supported via plain Pixi when real art
exists.
