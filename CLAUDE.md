# Interverse Engine — Claude Code guide

TypeScript framework for 2D mobile games (party / cozy / RPG / arcade).
Master spec: `interverse-engine-spec.md`. Claude Code is this engine's
editor — you scaffold games, generate scenes, draw code-vector art, and
iterate visually.

## The one rule that outranks everything

**Always keep the game runnable.** Every change must leave `pnpm typecheck`,
`pnpm lint`, and `pnpm build` green and the affected game playable. Verify
with the headless playtests before calling work done.

## Repo map

```
packages/engine       @interverse/engine — core (scenes, entities, art, world, dialogue, audio, save, input)
packages/ui-kit       @interverse/ui — UIButton, drawPanel, DialogueBox
packages/net-client   @interverse/net — host/join room-code sessions
relay/                WebSocket relay server (deployed once on Render; serves ALL games)
games/hello           Blob Tap (arcade demo)      — dev port 5173
games/room            Cozy Room (RPG/cozy demo)   — dev port 5174
games/taps            Tap Party (party demo)      — dev port 5175
games/_template       template consumed by /new-game — dev port 5180
tools/mcp-server      the `interverse` MCP server (screenshot, bots, docs, dev server)
docs/                 engine topic docs (also served by MCP get_engine_docs)
.claude/commands      /new-game /new-scene /new-minigame /new-art /playtest
.claude/skills        vector-art-style, party-game-design, cozy-rpg-patterns
site/index.html       GitHub Pages hub page listing the demos
scripts/              headless playtests + playtest launcher
```

## Commands you will actually use

| Command                                        | Purpose                                                         |
| ---------------------------------------------- | --------------------------------------------------------------- |
| `pnpm dev` / `dev:room` / `dev:taps`           | run a game's dev server (binds 0.0.0.0 for phones on LAN)       |
| `pnpm relay`                                   | run the relay locally on :8787 (games on localhost auto-use it) |
| `pnpm typecheck` / `lint` / `format` / `build` | quality gates — all must stay green                             |
| `pnpm verify` / `verify:room` / `verify:net`   | headless playtests (Blob Tap, Cozy Room, 3-phone multiplayer)   |
| `node scripts/playtest.mjs <game>`             | dev server + LAN URL + QR code for real phones                  |

MCP tools (server `interverse`): `list_games`, `list_scenes`, `get_engine_docs`,
`run_dev`/`stop_dev`, `screenshot` (LOOK at your work), `create_room`/
`join_room_bot`/`disconnect_bots` (fake multiplayer players), `validate_dialogue`.

## Engine cheat sheet

Docs per topic live in `docs/` (scenes, entities, art, tilemap, dialogue,
net, audio-save-input) — read them before working in an area. Essentials:

- `createGame({ width: 720, height: 1280, background, scene })` — portrait
  design space 720x1280, letterboxed to any screen; fixed 60Hz update.
- Scenes: subclass `Scene`, override `onEnter/onExit/onUpdate(dt)`;
  `scene.add(entity, layer?)`; switch via `game.scenes.replace(next)`.
- Entities: `Entity` + behaviors `Velocity/Timer/Tween/Wobble` (+ custom).
- Art: `blobCharacter`, `drawBlob`, palettes (`partyPop`, `cozyAutumn`),
  juice (`popIn`, `squash`). Never hardcode one-off colors — use palettes.
- UI: `UIButton` (≥84 design-unit height), `DialogueBox`, `drawPanel`.
- World: `tileMapFromRows` + painters, `moveWithCollision`, `Camera`.
- Net: `host()/join()` from `@interverse/net`; host-authoritative patterns
  in `games/taps`. One relay serves every game.
- Multi-scene games pass data through scene constructors, not globals.

## Conventions

- TypeScript strict everywhere; `pnpm` workspaces; ESLint flat + Prettier.
- Games live in `games/<name>` as `@interverse/<name>`, each with its own
  vite port (next free: 5176+). Template port 5180 is reserved.
- Every game exposes a `window.__<name>` debug hook (see existing games)
  so headless playtests can drive it; add debug query params (`?round=`,
  `?host=1`, `?join=CODE`) rather than clicking through UIs in tests.
- Commit style: what + why, spec section references (e.g. "spec 4.6").
- Branch flow: work on `fabian-branch`, fast-forward `main` to deploy —
  pushing `main` publishes the hub + demos to GitHub Pages.

## Hard constraints (spec §8)

1. Runnable at all times — each phase ends with something playable on a phone.
2. The game pays for the engine — build features only when a game needs them.
3. Browser joiners are sacred — never break install-free joining.
4. No API keys in shipped games — AI is dev-time only.
5. Performance: 60fps on mid-range phones; <3MB initial load for joiners.
6. Kid-safe defaults — filtered nicknames, no chat by default.

## Current status

Phases 0–4 complete: engine core, tilemap/dialogue/UI kit, multiplayer
(relay live at wss://interverse-engine.onrender.com), Claude tooling.
Next: Phase 5 — build the first real 4–8 player party game on top.
