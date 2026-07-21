# Scenes (§4.2)

A game is a stack of `Scene` subclasses driven by `game.scenes` (a
`SceneManager`).

```ts
import { Scene } from '@interverse/engine';

class MyScene extends Scene {
  protected override onEnter(): void {} // build the world; this.game is set
  protected override onExit(): void {} // cleanup (stage children auto-destroyed)
  protected override onUpdate(dt: number): void {} // fixed-step logic, dt in seconds
}
```

- `this.stage` — the scene's root container (design-space, 720x1280 portrait).
- `this.add(entity, parent?)` — register an Entity for per-step updates and
  attach it to `parent` (default `stage`). `this.remove(entity)` destroys it.
- `this.game` — the running `Game`: `designWidth/Height`, `app`, `scenes`.

Switching scenes:

```ts
this.game.scenes.replace(new NextScene()); // 0.3s fade by default
this.game.scenes.replace(new NextScene(), { fade: 0 }); // instant
this.game.scenes.push(overlay);
this.game.scenes.pop();
```

Scene changes requested mid-fade are queued (latest wins), so async flows
(e.g. a network join resolving) are safe. Input is swallowed during fades.
Pass data to scenes through constructors, not globals.
