---
description: Add a scene to a game and wire it into the flow
argument-hint: <game> <SceneName>
---

Add a scene named "$2" to `games/$1`.

1. Read docs/scenes.md and one existing scene of that game for its idioms
   (debug hook, layers, palette).
2. Create `games/$1/src/scenes/$2.ts`: subclass `Scene` from
   `@interverse/engine`, implement `onEnter` (+ `onExit`/`onUpdate` as needed),
   design space 720x1280, palette-driven visuals, `popIn`/`Wobble` juice.
3. Wire a navigation path to it from an existing scene
   (`this.game.scenes.replace(new $2(...))`) — a scene nothing reaches is dead
   code. Pass data via constructor params, not globals.
4. `pnpm typecheck && pnpm lint` must stay green; use the MCP `screenshot`
   tool (with `run_dev`) to look at the scene and iterate until it looks right.
