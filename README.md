# Interverse Engine

An AI-native 2D game framework for mobile party games, cozy games, and 2D RPGs.
See [`interverse-engine-spec.md`](./interverse-engine-spec.md) for the master spec.

> **Status: Phase 1 — Engine core.**
> Scenes, entities/behaviors, tap input, vector art + palettes + juice,
> procedural audio, and versioned saves — demoed by **Blob Tap**, a playable
> single-device arcade toy.
>
> **Play it:** https://fabianb14.github.io/interverse-engine/ (auto-deployed
> from `main`).

## Layout

```
packages/
  engine/      @interverse/engine — core framework
    src/app/       createGame(): PixiJS boot, letterbox resize, fixed-timestep loop
    src/scene/     Scene + SceneManager (replace/push/pop, fade transition)
    src/entity/    Entity + behaviors (Velocity, Timer, Tween, Wobble)
    src/input/     makeTappable() — multi-touch-safe tap
    src/art/       drawBlob, blobCharacter, palettes, juice (popIn/squash)
    src/audio/     procedural SFX with mobile audio unlock
    src/save/      versioned localStorage wrapper
games/
  hello/       Blob Tap — the Phase 1 demo game (Title → Play → Results)
scripts/
  verify.mjs   headless playtest: taps through the game, checks score + FPS
```

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
