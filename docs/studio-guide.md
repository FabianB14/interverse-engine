# Making a game with Interverse Studio — the guide

Interverse Studio is the visual game maker for the Interverse engine. It runs
in your browser (the `Studio` card on the hub) and as a Windows app. What you
edit is the real engine, live — press **▶ Play** at any moment.

## 1 · Start

- **✚ New** — pick a template:

  | Template | View | What you get |
  | --- | --- | --- |
  | Blank | 2D | Empty canvas + a hero |
  | Garden Explorer | Top-down | Walk anywhere, collect fireflies |
  | Sunset Street | Side 2.5D | Depth-scaled street — walk "into" the scene |
  | Blob Dash | Side 2D | Endless runner with jumping + ramping speed |
  | Slash Frenzy | 2D | Fruit-ninja tap-slashing |
  | Blob Arena | Top-down | Action survival waves |
  | A Quiet Evening | 2D | Cozy room, stories, no fail state |
  | Tiny Quest | Top-down RPG | NPCs, training, branching **skill tree** |
  | Hilltop Hop | Side view | Run + JUMP with built-in gravity |
  | Firefly Party | Multiplayer co-op | Host a room code, catch fireflies together |

  First-person / 3D templates arrive when the engine grows a 3D renderer.

- Your project **autosaves** on this device. **Export** downloads a
  `.interverse.json` you can back up, share, or publish (see §7).

## 2 · Build the scene

- **Drag** items from the left palette onto the canvas (or click to place).
- **Click** an entity to select it; **drag** it to move; edit everything else
  in the right-hand **inspector** — position, scale, rotation, color, blob
  look, text, font size.
- **Import image…** turns any PNG/JPG into an entity.
- The purple frame is the phone screen (720×1280 design units). Players on
  any device see this space, letterboxed.

## 3 · Views: top-down, side, 2.5D

Every level has a **View** (toolbar selector) that sets how it plays — and
the editor previews it immediately when you switch:

- **👁 Top-down** — the player moves freely in all directions.
- **👁 Side view** — gravity is built in: ← → run, ↑ / W / joystick-up to
  **jump**. Great for platform-y games (try the Hilltop Hop template).
- **👁 2.5D depth** — things higher on screen are further away: they scale
  down and sort behind, so walking "up" walks *into* the scene. Drag an
  entity up the canvas and watch it shrink into the distance — then press
  ▶ Play and walk it. Sunset Street is the worked example.

The engine renders with **WebGPU/WebGL** (PixiJS) — hardware-accelerated on
phones and desktops alike.

## 3½ · Paint the world (Tiles)

Hit **🗺 Tiles** in the toolbar and the palette becomes a paintbox: grass,
flowers, dirt and stone paths, sand, water, rock walls, trees, brick.
Click/drag on the canvas to paint terrain (18×32 grid per level), use the
eraser to clear, and **✓ Done painting** to go back to placing things.

Tiles marked *solid* (water, rock, trees, brick) **block players** in Play
mode automatically — paint a maze and it just works. The Garden Explorer
template ships with a painted garden to start from.

## 4 · Animations, VFX, SFX

- **Wobble** — idle animation toggle (inspector).
- **Pop-in** — spawn juice toggle.
- **Tap sound** — pop / blip / chime / buzz when the entity is tapped.
- **Spritesheet animations** — Import an image that contains animation
  frames in a grid, then set **Frame width / Frame height / Frames-per-sec**
  in the inspector. Frames read left-to-right, top-to-bottom and loop.
  (Frame size 0 = still image.)
- **Property animation from code** — `api.tween(thing, { x, y, rotation,
  alpha, scale }, seconds)` for cutscenes and juice.
- From code: `api.sfx.pop()`, `.blip()`, `.chime()`, `.buzz()`.

## 5 · Stories (narratives)

Select a character → **Story** tab → one line per row → **Save story**.
In Play mode, tapping them plays the lines through the dialogue box
(typewriter, tap-to-advance). Writing a story upgrades a Blob into a Story
character. From code you can also narrate directly:
`api.say('Narrator', 'Night falls…', 'Something stirs.')`.

## 6 · Levels

**+ Level** adds a scene; the toolbar dropdown switches between them. Each
level has its own background, entities, and script. Move players between
levels with `api.goto('Level 2')`.

## 7 · The Code window

Each scene has a script that runs when the scene starts in Play mode.
**Apply to game** also hot-runs it against the live game. The whole API:

```js
api.entity('Hero')            // the entity by name (a live engine object)
api.entities()                // all of them, keyed by name
api.player('Hero', 320)       // WASD/arrows + touch joystick movement
api.onUpdate((dt) => { ... }) // run every frame
api.every(1.5, () => { ... }) // repeat on a timer
api.after(3, () => { ... })   // run once, later
api.spawn('crate', x, y)      // create entities from code
api.remove(thing)             // ...and remove them (name or reference)
api.overlap(a, b, 60)         // circle collision test
api.onTap(thing, () => {})    // tap handler (name or reference)
api.score.add(1)              // score with an automatic HUD
api.random(10, 20)
api.sfx.chime()
api.say('Elder', 'Hello!')    // dialogue from code
api.goto('Level 2')           // switch levels
api.gameOver('YOU WIN! 🌟')   // end screen with the score
api.verium                    // the local Verium wallet (earn/spend)
```

### Skill trees

```js
api.skills.define({
  title: 'CHAMPION PATHS',
  points: 1,
  nodes: [
    { id: 'strength', name: 'Strength', emoji: '💪', cost: 1 },
    { id: 'blade', name: 'Blade Arts', emoji: '⚔️', cost: 2, requires: ['strength'] },
  ],
});
api.skills.addPoints(1);          // grant points (quests, training, ...)
api.skills.open();                // show the tree overlay
api.skills.isUnlocked('blade');   // gate your gameplay on skills
api.skills.onUnlock((id) => {});  // react to unlocks
```

Node positions are laid out automatically from `requires` chains — linear
paths and branching trees both work. Unlocks persist per project.

## 8 · Multiplayer blocks

Tick **Multiplayer** in the toolbar and press ▶ Play — you get a lobby:
**HOST A ROOM** (share the 4-letter code), **JOIN** a friend's code, or play
solo. It's drop-in co-op: friends can join mid-game, and every player's
avatar walks around live in everyone else's world (name tag included) with
no netcode written. Try the **Firefly Party** template to see it wired up.

From the Code window (`api.net` is null when playing solo):

```js
if (api.net) {
  api.net.code                    // the room code
  api.net.isHost                  // am I the host?
  api.net.players()               // everyone in the room
  api.net.setState('score', 5)    // shared state — host-authoritative,
  api.net.state('score')          //   synced to every player
  api.net.onState((k, v) => {})   // react to changes
  api.net.send({ hi: true })      // custom messages
  api.net.onMessage((from, d) => {})
}
```

The pattern for shared objects: when a player takes/changes something, set a
state key; every client (including late joiners, who get a full state sync)
applies it locally. Firefly Party's script is a worked example.

## 9 · Publish — your repo, and the Interverse world

**🌍 Publish** opens two paths (your credentials stay on YOUR device):

1. **Push to your GitHub repo** — paste a fine-grained token (Contents:
   write), pick `owner/repo`, push. You get a **play link** — anyone can play
   your game instantly through the Studio player
   (`…/studio/?load=<your-file>&play=1`). Update = push again.
2. **Add it to the Interverse world** — enter your Interverse (IVX) node URL
   and developer name; Studio registers the game (`POST /games/register`),
   stores the world `gameId` in the project, and keeps the returned reward
   api-key on your device only. With the **Interverse** toolbar toggle on,
   Play mode shows the local Verium wallet — and the on-chain IVX balance
   once a wallet address is configured in the project.

## 10 · AI copilot

The primary AI dev cycle is **Claude Code over MCP — no API key**: open
this repo in Claude Code and the `interverse` MCP server exposes studio
tools (`studio_open`, `studio_project`, `studio_add_entity`,
`studio_update_entity`, `studio_set_script`, `studio_load_template`,
`studio_play`, `studio_screenshot`). Claude attaches to your running
Studio (`pnpm dev:studio`), edits the project, presses Play, and LOOKS at
the result — the full engine dev loop.

The in-app **AI Chat** tab is the fallback for people without Claude Code:
paste an Anthropic API key (stored locally, never shipped) and ask.

## 11 · Installing Studio (Windows, iOS, Android)

Studio is an installable app straight from the URL:

- **Windows / desktop** (Chrome or Edge): click **⬇ Install** in the
  toolbar — or the install icon in the address bar. Studio opens in its own
  window like any app.
- **iPhone / iPad** (Safari): tap **⬇ Install** for the steps — Share →
  **Add to Home Screen** → Add.
- **Android**: Chrome offers the install banner, or ⬇ Install.

There's also a native Windows installer: the `Studio Windows app` GitHub
Actions workflow builds one (Tauri shell — the same shell that will target
iOS natively later). The web Studio is always the source of truth.
