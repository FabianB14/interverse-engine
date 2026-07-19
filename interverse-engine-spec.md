# Interverse Engine — Build Spec
### An AI-native 2D game framework for mobile party games, cozy games, and 2D RPGs

**Author:** Fabian Brooks / Interverse Corp
**Purpose:** This document is the master spec for Claude Code. Work through it phase by phase. Do not skip ahead — each phase must produce something runnable and testable before the next begins.

---

## 1. Vision

Interverse Engine is a TypeScript framework for building 2D mobile games fast. It is:

- **Mobile-first.** Touch input, portrait and landscape layouts, safe-area aware, 60fps on mid-range phones.
- **Web-native, store-ready.** Games run in the browser during development and ship to iOS/Android via Capacitor.
- **Multiplayer by default.** Room-code sessions where every player uses their own phone or tablet. Joiners connect via browser — no install required.
- **AI-native.** Claude Code is the engine's editor. The engine ships with a CLAUDE.md, custom skills/commands, and an MCP server so Claude Code can scaffold games, generate scenes, create code-drawn vector art, and iterate visually.

**Non-goals:** 3D, FPS, physics-heavy AAA anything. Genres in scope: party games, cozy/sim games, 2D RPGs, puzzle games, arcade games.

---

## 2. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript (strict) | Safety + Claude Code works great with it |
| Rendering | PixiJS v8 | Fast WebGL 2D, mobile-proven |
| Physics (optional module) | Matter.js | Already used in Titan Sandbox; only loaded when a game needs it |
| Build | Vite | Instant dev server, HMR |
| Native shell | Capacitor | Ship web build to App Store / Play Store |
| Networking | Node + ws (WebSocket relay server) | Tiny, cheap to host on DigitalOcean |
| Audio | Howler.js | Reliable mobile audio unlock handling |
| State/saves | Engine-provided storage module wrapping localStorage / Capacitor Preferences | One API for web + native |
| Monorepo | pnpm workspaces | `engine/`, `relay/`, `games/*`, `tools/` |

---

## 3. Repository Layout

```
interverse-engine/
├── CLAUDE.md                  # Instructions for Claude Code (Phase 5)
├── .claude/
│   ├── commands/              # /new-game, /new-scene, /new-minigame, /new-art
│   └── skills/                # Engine skills (art style, scene patterns)
├── packages/
│   ├── engine/                # @interverse/engine — the core framework
│   ├── net-client/            # @interverse/net — room/session client
│   └── ui-kit/                # @interverse/ui — mobile UI components
├── relay/                     # Room-code relay server (Node + ws)
├── tools/
│   └── mcp-server/            # interverse-mcp — MCP server for Claude Code
├── games/
│   └── _template/             # Game template used by /new-game
└── docs/
```

---

## 4. Engine Core (`packages/engine`)

### 4.1 Game loop & App shell
- `createGame(config)` boots PixiJS, sets up resize/orientation handling, fixed-timestep update loop with interpolated render.
- Config: target orientation, virtual resolution (design at 720×1280 portrait / 1280×720 landscape, letterbox/scale to fit), background color, initial scene.

### 4.2 Scene system
- `Scene` base class: `onEnter(params)`, `onExit()`, `update(dt)`, plus a `stage` container.
- `SceneManager` with push/pop/replace and simple transitions (fade, slide).
- Scenes declare asset manifests; loader shows progress automatically.

### 4.3 Entities & components (lightweight, not full ECS)
- `Entity` = PixiJS container + optional behaviors (small composable classes with `update(dt)`).
- Built-in behaviors: `Velocity`, `Tween`, `TapHandler`, `DragHandler`, `Timer`, `Animator` (sprite-sheet + procedural).
- Physics behavior (`MatterBody`) only when the physics module is enabled.

### 4.4 Input
- Unified pointer/touch abstraction: tap, double-tap, long-press, drag, swipe, pinch.
- Multi-touch tracking (party games need simultaneous touches).
- Virtual joystick + d-pad components for RPG movement.

### 4.5 Code-drawn vector art system
This is a signature feature. No sprite dependencies required to make a decent-looking game.
- `VectorArt` helpers over PixiJS Graphics: rounded shapes, blob/organic shapes, simple characters (head/body/limb rigs), gradients, soft shadows.
- A small palette system (named palettes, e.g., `cozy-autumn`, `party-pop`) so games look cohesive by default.
- Procedural animation helpers: squash-and-stretch, bounce, wobble, blink. Cozy games live and die on juice.
- Sprites/spritesheets still fully supported for when real art exists.

### 4.6 Tilemaps & world (for RPGs/cozy games)
- Load Tiled (`.tmj`) maps: layers, collision layer, object layer for spawns/triggers.
- Camera with follow, bounds, deadzone, and screen shake.
- Grid movement helper (classic RPG stepping) and free movement helper.

### 4.7 Dialogue & narrative
- Dialogue system: speaker, portrait slot, typewriter text, choices, flags/variables, simple branching.
- Authored in plain YAML/JSON so Claude Code can generate and edit dialogue easily.

### 4.8 Audio
- Music channel with crossfade; SFX pool; mobile audio-unlock handled internally.

### 4.9 Save/storage
- `save.set(key, value)` / `save.get(key)` — JSON-serializable, versioned with migration hooks.

### 4.10 UI Kit (`packages/ui-kit`)
- Mobile-sized (min 44pt touch targets): Button, IconButton, Panel, Modal, Toast, ProgressBar, ScoreBanner, PlayerBadge, TextInput (native-keyboard aware), room-code display and entry components.
- Themeable via the palette system.

---

## 5. Multiplayer (`relay/` + `packages/net-client`)

### 5.1 Model
- **Room-code sessions**, Jackbox-style but symmetric: every player is on their own device.
- One player taps **Host** → relay creates a room → returns a 4-letter code (unambiguous alphabet, no 0/O/1/I).
- Others tap **Join** in the app **or open the game's web URL in their phone browser** and enter the code. Browser joiners get the full game — this is the viral loop: one install, whole party plays.
- Host device is authoritative for game state (host-authoritative model). Relay just forwards messages.

### 5.2 Relay server (`relay/`)
- Node + `ws`. Endpoints: create room, join room, leave, broadcast, direct message, host migration on disconnect (v2).
- Rooms: max 8 players default, TTL cleanup, heartbeat/ping.
- Stateless enough to run on the cheapest DigitalOcean droplet or App Platform instance.
- No accounts, no PII. Room code + player nickname only.

### 5.3 Client API (`packages/net-client`)
```ts
const session = await net.host();            // → { code: "GLDN" }
const session = await net.join("GLDN", "Fabe");
session.onPlayerJoin(p => ...);
session.onMessage((from, msg) => ...);
session.send({ type: "vote", choice: 2 });   // to host
session.broadcast({ type: "roundStart" });   // host → all
session.state.players                        // live roster
```
- Transport abstracted behind an interface so a LAN/WebRTC transport can be added later without touching game code.
- Built-in sync primitives: shared lobby state, ready-up flow, countdown, score table — so party games don't rewrite the same lobby code every time.

---

## 6. Claude Integration (dev-time, no API key)

The engine treats **Claude Code as its editor.** All integration is local tooling that runs under the developer's Claude subscription. Nothing here calls the Anthropic API from shipped games.

### 6.1 CLAUDE.md (repo root)
Teaches Claude Code: architecture, coding conventions, how to run the dev server, how scenes/entities/dialogue work, the vector art style guide, and the rule "always keep the game runnable."

### 6.2 Custom commands (`.claude/commands/`)
- `/new-game <name> <genre>` — scaffolds `games/<name>` from the template with genre-appropriate modules (party → net-client + lobby scenes; rpg → tilemap + dialogue + grid movement; cozy → tilemap + save-heavy template).
- `/new-scene <game> <name>` — adds a scene, wires it into the scene manager.
- `/new-minigame <game> <name>` — adds a party-game round module (intro → play → results contract).
- `/new-art <description>` — generates a code-drawn VectorArt asset in the house style.
- `/playtest` — builds, launches dev server, prints the LAN URL + QR code so real phones can join instantly.

### 6.3 MCP server (`tools/mcp-server`)
An MCP server named `interverse` exposing tools Claude Code can call:
- `list_games`, `list_scenes(game)`, `get_engine_docs(topic)`
- `run_dev(game)` / `stop_dev` — manage the dev server
- `screenshot(game, scene?)` — headless-browser screenshot of the running game so Claude can *see* its work and iterate on visuals
- `create_room` / `join_room_bot(n)` — spin up headless fake players against the relay to test multiplayer flows without needing five phones
- `validate_dialogue(file)`, `validate_tilemap(file)`

The `screenshot` and `join_room_bot` tools are the highest-value items — they close the loop so Claude Code can build, look, test multiplayer, and fix without human round-trips.

### 6.4 Skills (`.claude/skills/`)
- `vector-art-style` — the Interverse house art style: palettes, shape language, animation juice rules.
- `party-game-design` — round structure, pacing, score balancing patterns.
- `cozy-rpg-patterns` — map/dialogue/save conventions.

---

## 7. Build Phases

**Phase 0 — Monorepo bootstrap.** pnpm workspaces, TypeScript strict, Vite, ESLint/Prettier, one "hello scene" rendering on a phone via LAN URL. *Done when: a bouncing vector-art blob runs at 60fps on your phone's browser.*

**Phase 1 — Engine core.** Game loop, scenes, entities/behaviors, input, vector art system, audio, save. *Done when: a single-device demo game (tap-the-blobs arcade toy) is playable.*

**Phase 2 — UI kit + tilemap + dialogue.** *Done when: a tiny walkable RPG room with one NPC conversation runs on a phone.*

**Phase 3 — Multiplayer.** Relay server deployed to DigitalOcean, net-client, lobby/ready/score primitives. *Done when: 3 phones in the house join a room by code and see each other's taps in real time.*

**Phase 4 — Claude tooling.** CLAUDE.md, commands, MCP server with screenshot + bot-player tools, skills. *Done when: `/new-game test party` followed by `/playtest` produces a joinable lobby with zero hand-written code.*

**Phase 5 — First game.** A 4–8 player party game built entirely on the framework (target: 2–4 weeks). Candidate concepts: social deduction lite, drawing/guessing, trivia with a twist, reaction-time duels. *Done when: it's on TestFlight/Play internal testing and a family game night actually happens on it.*

**Phase 6 — Harden & extract.** Whatever game one hacked around becomes engine features. Write docs. Now it's a real engine.

---

## 8. Constraints & Principles

1. **Runnable at all times.** Every phase ends with something you can open on a phone.
2. **The game pays for the engine.** No engine feature gets built until a game needs it (Phases 0–4 build only what Phase 5's game requires).
3. **Browser joiners are sacred.** Never add a feature that breaks install-free joining.
4. **No API keys in games.** All AI is dev-time via Claude Code.
5. **Performance budget:** 60fps on a 3-year-old mid-range Android phone; initial load under 3MB for browser joiners.
6. **Kid-safe defaults.** Nicknames filtered, no chat by default — party games are for living rooms with kids in them.
