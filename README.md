# Interverse Engine

An AI-native 2D game framework for mobile party games, cozy games, and 2D RPGs.
See [`interverse-engine-spec.md`](./interverse-engine-spec.md) for the master spec.

> **Status: Phase 0 — Monorepo bootstrap.**
> A bouncing code-drawn vector-art blob rendering at 60fps in the browser.

## Layout

```
packages/
  engine/      @interverse/engine — core framework (app shell + vector art)
games/
  hello/       Phase 0 demo — the bouncing blob
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
Wi-Fi** as this machine to test at 60fps. The on-screen `FPS` readout confirms
the frame rate.

## Scripts

| Command          | What it does                                |
| ---------------- | ------------------------------------------- |
| `pnpm dev`       | Start the Vite dev server for `games/hello` |
| `pnpm build`     | Production build of the demo                |
| `pnpm typecheck` | Strict TypeScript check across all packages |
| `pnpm lint`      | ESLint                                      |
| `pnpm format`    | Prettier write                              |
