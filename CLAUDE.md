# Interverse Engine — Claude Code guide

TypeScript framework for 2D mobile games (party / cozy / RPG / arcade).
Master spec: `interverse-engine-spec.md`. Claude Code is this engine's
editor — you scaffold games, generate scenes, draw code-vector art, and
iterate visually.

## The one rule that outranks everything

**Always keep the game runnable.** Every change must leave `pnpm typecheck`,
`pnpm lint`, `pnpm test`, and `pnpm build` green and the affected game
playable. Verify with the headless playtests before calling work done.

## Repo map

```
packages/core         @interverse/core — renderer-free game logic (runner, brawler, dialogue, save, net authority, palettes); shared by BOTH renderers
packages/engine       @interverse/engine — 2D renderer (Pixi): scenes, entities, art, world, input; re-exports all of core
packages/three        @interverse/three — 3D renderer (three.js): createGame3, light rig, low-poly kit, loadModel (.glb), auto quality; see docs/three.md
packages/ui-kit       @interverse/ui — UIButton, drawPanel, DialogueBox
packages/net-client   @interverse/net — host/join room-code sessions
relay/                WebSocket relay server (deployed once on Render; serves ALL games)
games/hello           Blob Tap (arcade demo)      — dev port 5173
games/room            Cozy Room (RPG/cozy demo)   — dev port 5174
games/taps            Tap Party (party demo)      — dev port 5175
games/blobvale        Blobvale (RPG demo)         — dev port 5176
games/farm            Bloomstead (cozy farming)   — dev port 5177
games/hushfall        Hushfall (hide & seek)      — dev port 5178
games/crashers        Blob Crashers (15-stage brawler)  — dev port 5181
games/rush            Blob Rush (2D endless runner)     — dev port 5182
games/spike3d         3D renderer stress scene (not on the hub) — dev port 5183
games/rush3d          Blob Rush 3D (shares rush's save) — dev port 5184
games/crashers3d      Blob Crashers 3D (animated model golems) — dev port 5185
games/_template       template consumed by /new-game — dev port 5180
apps/studio           Interverse Studio (visual game maker) — dev port 5179;
                      projects are JSON (model.ts) run by runtime.ts; Tauri
                      shell in src-tauri (Windows via manual CI workflow).
                      See docs/studio.md.
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
| `pnpm test`                                    | unit tests (vitest) — engine logic + studio model; keep green   |
| `pnpm verify` / `verify:room` / `verify:net`   | headless playtests (Blob Tap, Cozy Room, 3-phone multiplayer)   |
| `pnpm verify:crashers`                         | headless playtest for the 15-stage brawler                      |
| `pnpm dev:studio` / `verify:studio`            | Interverse Studio (game-maker app) + its headless playtest      |
| `pnpm ai`                                      | local AI bridge: Studio's AI Chat via Claude Code login (no key) |
| `node scripts/playtest.mjs <game>`             | dev server + LAN URL + QR code for real phones                  |

MCP tools (server `interverse`): `list_games`, `list_scenes`, `get_engine_docs`,
`run_dev`/`stop_dev`, `screenshot` (LOOK at your work), `create_room`/
`join_room_bot`/`disconnect_bots` (fake multiplayer players), `validate_dialogue`,
and the Studio dev cycle: `studio_open`/`studio_project`/`studio_add_entity`/
`studio_update_entity`/`studio_set_script`/`studio_load_template`/`studio_play`/
`studio_screenshot` (drive a running `pnpm dev:studio`).

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
  vite port (next free: 5186+). Template port 5180 is reserved.
- Every game exposes a `window.__<name>` debug hook (see existing games)
  so headless playtests can drive it; add debug query params (`?round=`,
  `?host=1`, `?join=CODE`) rather than clicking through UIs in tests.
- Orientation: if a game uses `createGame({ adaptive: true })` (it relays
  out for landscape), its `public/manifest.webmanifest` MUST set
  `"orientation": "any"` — otherwise an installed PWA is locked to portrait
  and the phone won't rotate. Only keep `"portrait"` for non-adaptive
  (letterboxed portrait-only) games. Match blobvale/farm, not the template.
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
