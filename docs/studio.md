# Interverse Studio (internals)

> Author-facing how-to lives in **docs/studio-guide.md** — this file is the
> engineering map.

`apps/studio` — the visual game-maker built on the engine. The center pane IS
the engine (`createGame` mounted in a div), so what you edit is exactly what
ships. Dev: `pnpm dev:studio` (port 5179). Verify: `pnpm verify:studio`.

## Architecture: games are DATA

A Studio project is JSON (`ProjectDef` in `src/model.ts`):

- `scenes[]` — levels. Each has a background, a script, and `entities[]`.
- `EntityDef` — kind (blob, npc, crate, lantern, plant, text, button, image)
  plus concrete props: position/scale/rotation, color/radius/seed, text,
  behaviors (`wobble`, `popIn`), `tapSound`, story `lines`.
- `assets` — imported images as data URLs.
- `interverse` — wires the Verium wallet + chip into Play mode.

`src/runtime.ts` interprets defs: `buildView()` renders one (used by the
editor for WYSIWYG), `PlayScene` runs a scene for real — behaviors, tap
sounds, NPC dialogue (engine `DialogueRunner` + ui-kit `DialogueBox`), and
the scene script.

## The panels

- **Palette** (left): drag onto the canvas, or click to place. "Import
  image…" loads a PNG/JPG as an entity.
- **Canvas** (center): live engine. Click to select, drag to move. The
  purple frame is the 720x1280 phone design space.
- **Inspector** (right): every prop of the selection, including SFX and
  behavior toggles. Delete lives here too.
- **Code** (bottom): per-scene script, runs at scene start in Play mode.
  Scripts get `api`: `entity(name)`, `onUpdate(fn)`, `sfx.pop/blip/chime/
  buzz()`, `goto(sceneName)`, `spawn(kind, x, y)`, `say(speaker, ...lines)`,
  `verium`. "Apply" hot-runs it against the live game.
- **Story** (bottom): select a character, one dialogue line per row — they
  say it when tapped in Play mode. Writing a story turns a blob into an npc.
- **AI Chat** (bottom): Claude copilot with tools that edit the project
  (add/update/remove entity, set script, add scene). DEV-TIME ONLY: the
  author pastes their own Anthropic API key; it stays in localStorage and is
  never part of an exported game (spec §8.4 holds).

## Persistence

Autosaved to localStorage; Export downloads `<name>.interverse.json`;
Import loads one. The JSON is the exchange format for everything (AI, export,
future "generate a games/<name> scaffold").

## Windows app (experimental)

`apps/studio/src-tauri` is a Tauri v2 shell (Tauri because it reaches iOS
later, unlike Electron). Build via the manual `Studio Windows app` GitHub
Actions workflow — grab the NSIS installer from the run artifacts. The web
Studio at `/studio/` on the hub is the always-runnable source of truth.

## Debug hooks

`window.__studio` mirrors the editor for headless tests: addEntity, select,
setProp, setStory, setScript/applyScriptNow, play/stop/playEntityCount,
addScene/switchSceneByName, exportJson/importJson. See `src/debug.ts`.
