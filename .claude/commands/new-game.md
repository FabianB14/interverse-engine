---
description: Scaffold a new game from the template (party | cozy | rpg | arcade)
argument-hint: <name> <genre>
---

Scaffold a new Interverse game named "$1" (genre: "$2") and leave it runnable.

1. Copy `games/_template` to `games/$1` (skip `node_modules`, `dist`).
2. Rewrite identity:
   - `package.json` name -> `@interverse/$1`
   - `src/game.ts`: `GAME_TITLE` -> a fun title-cased name, `GAME_TAG` -> `"$1"`
   - `index.html` `<title>` -> the game name
   - `vite.config.ts`: assign the next free dev port (check existing games with
     the MCP tool `list_games`; used so far: 5173–5175, 5180 reserved for the
     template — start at 5176). Same number +(4173-5173) offset does NOT apply:
     just set preview to `port - 1000`.
   - Rename the debug hook `__lobby` in all scenes to `__$1` (keep the shape).
3. Genre adjustments:
   - **party** — keep as-is: menu -> code keypad -> lobby is the starting point.
   - **arcade** — single-device: delete `JoinScene`/`LobbyScene`/`config.ts` and
     net usage; model scenes on `games/hello` (Title -> Play -> Results, saves).
   - **cozy / rpg** — single-device world game: replace lobby flow with a map
     scene modeled on `games/room` (tilemap rows + painters, joystick, camera;
     rpg adds NPC dialogue JSON). Read docs/tilemap.md and docs/dialogue.md.
4. `pnpm install` (links the new workspace package), then `pnpm typecheck`
   and `pnpm lint` — both must be green.
5. Optionally add the game to `site/index.html` and the Pages workflow's
   assemble step when it's ready to publish; not required at scaffold time.
6. Report: game dir, dev command (`pnpm --filter @interverse/$1 dev`), port,
   and suggest `/playtest $1` to see it on a phone.

Rules: keep TypeScript strict clean, use engine palettes (no ad-hoc colors),
keep the game runnable at every step (CLAUDE.md).
