# Audio (§4.8), save (§4.9), input (§4.4)

## Audio

Procedural WebAudio SFX with mobile unlock handled internally (installed by
`createGame`); Howler.js lands when real audio files exist.

```ts
import { audio } from '@interverse/engine';
audio.pop(1.2); // tap-hit; pitch 0.5..2 (higher = squeakier)
audio.blip(); // UI confirm
audio.chime(); // little victory arpeggio
audio.buzz(); // round over / error
audio.volume = 0.6;
```

Sound only works after the first user gesture — fine in practice because
title screens require a tap.

## Save

```ts
import { createSave } from '@interverse/engine';
const store = createSave('my-game', 1 /* version */, migrateFn?);
store.set('bestScore', 120);
const best = store.get('bestScore', 0);   // typed by the fallback
```

JSON-serializable values only. Versioned with a migration hook; falls back
to in-memory storage in private browsing. Capacitor Preferences backing
arrives with the native shell.

## Input

```ts
import { makeTappable, VirtualJoystick } from '@interverse/engine';

makeTappable(entity, (e) => onTap(e), { hitRadius: r * 1.6 }); // oversize for thumbs
// Multi-touch safe: simultaneous taps on different objects all land.

const joy = scene.add(new VirtualJoystick({ radius: 100 }), uiLayer);
joy.position.set(170, H - 190);
// each update: joy.value -> {x, y} direction, magnitude 0..1
```

Touch targets: min 44pt on screen ≈ 84+ design units for buttons
(`UIButton` defaults handle this). Swipe/pinch/long-press gestures land
when a game needs them.
