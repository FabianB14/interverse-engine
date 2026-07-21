# Interverse Engine

An AI-native 2D game framework for mobile party games, cozy games, and 2D RPGs.
See [`interverse-engine-spec.md`](./interverse-engine-spec.md) for the master spec.

> **Status: Phase 3 — Multiplayer.**
> Phase 1: engine core (**Blob Tap**). Phase 2: tilemap + dialogue + UI kit
> (**Cozy Room**). Phase 3 adds the room-code relay server and
> `@interverse/net` client — demoed by **Tap Party**: host a room, others
> join with a 4-letter code, everyone sees everyone's taps live.
>
> **Play them:** https://fabianb14.github.io/interverse-engine/ (hub with
> all demos, auto-deployed from `main`). Tap Party needs the relay deployed
> (see Multiplayer below).

## Layout

```
packages/
  engine/      @interverse/engine — core framework
    src/app/       createGame(): PixiJS boot, letterbox resize, fixed-timestep loop
    src/scene/     Scene + SceneManager (replace/push/pop, fade transition)
    src/entity/    Entity + behaviors (Velocity, Timer, Tween, Wobble)
    src/input/     makeTappable(), VirtualJoystick
    src/world/     tilemaps (data/collision/painters) + Camera
    src/dialogue/  DialogueRunner — JSON nodes, choices, flags
    src/art/       drawBlob, blobCharacter, palettes, juice (popIn/squash)
    src/audio/     procedural SFX with mobile audio unlock
    src/save/      versioned localStorage wrapper
  ui-kit/      @interverse/ui — Button, Panel, DialogueBox
  net-client/  @interverse/net — host/join sessions over the relay
relay/         room-code relay server (Node + ws) — one deploy serves all games
games/
  hello/       Blob Tap — Phase 1 demo (arcade)
  room/        Cozy Room — Phase 2 demo (tilemap + NPC dialogue)
  taps/        Tap Party — Phase 3 demo (multiplayer room codes)
scripts/       headless playtests (verify, verify-room, verify-net)
```

## Multiplayer

One relay serves every game — it only creates rooms and forwards messages
(host-authoritative, spec §5). Deploy it once:

1. On Render: **New → Blueprint**, pick this repo — `render.yaml` configures
   an `interverse-relay` web service on the free plan.
2. Copy the service URL (e.g. `https://interverse-relay.onrender.com`).
3. Put it in `games/taps/src/config.ts` (`DEFAULT_RELAY_URL`) and push — or
   test immediately by opening the deployed game with
   `?relay=wss://interverse-relay.onrender.com` (saved to the device after
   the first visit).

Local dev needs no deploy: `pnpm relay` starts it on :8787 and the games
find it automatically on localhost.

## Requirements

- Node.js >= 20
- pnpm 10 (`corepack enable` or `npm i -g pnpm`)

## Run it

```bash
pnpm install
pnpm dev
```

Vite binds to `0.0.0.0`, so it prints a **Network** URL like
`http://192.168.x.x:5173/`. Open that on your phone while it's on the **same
Wi-Fi** as this machine. The on-screen `FPS` readout confirms the frame rate.

Debug lever: `?round=6` shortens the Blob Tap round (3–120 seconds accepted).

## Scripts

| Command          | What it does                                   |
| ---------------- | ---------------------------------------------- |
| `pnpm dev`       | Start the Vite dev server for `games/hello`    |
| `pnpm build`     | Production build of the demo                   |
| `pnpm verify`    | Headless playtest against a running dev server |
| `pnpm typecheck` | Strict TypeScript check across all packages    |
| `pnpm lint`      | ESLint                                         |
| `pnpm format`    | Prettier write                                 |

## Deploy

Pushing to `main` builds `games/hello` and publishes it to GitHub Pages via
`.github/workflows/deploy-pages.yml`. Feature work happens on branches;
merging to `main` is what refreshes the public link.
