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
  | Sunset Street | 2.5D · 3 screens wide | A long street to journey down, camera follows |
  | Blob Dash | 2D | Endless runner with jumping + ramping speed |
  | Slash Frenzy | 2D | Fruit-ninja tap-slashing |
  | Blob Arena | Top-down | Action survival waves |
  | A Quiet Evening | 2D | Cozy room, stories, no fail state |
  | Tiny Quest | Top-down RPG | NPCs, training, branching **skill tree** |
  | Hilltop Hop | Gravity run · wide | Run + JUMP across 3 screens, camera follows |
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
- The purple frame marks the world bounds. Like real mobile games, players
  see a WINDOW into it: a portrait phone shows a tall window, a rotated
  (landscape) phone or tablet shows a wide ~720-tall one — never a skinny
  letterboxed strip, and never the whole map at once on big levels.

## 3 · Views, level size, camera & gravity

Every level has a **View** (how it's seen), a **length** (how far the board
runs), and **Gravity** (a physics toggle). Rotating the device is neither —
a landscape phone/tablet simply sees a wide window into the same world,
like every classic mobile RPG.

- **👁 Top-down** — the player moves freely in all directions.
- **👁 2.5D** — plays like *Castle Crashers*: the board is **one landscape
  screen tall (720)** with a backdrop above the **horizon** and a walkable
  ground band below it, and the journey runs **left-to-right** — you never
  see the whole map at once. Walking "up" walks a short way *into* the
  scene (slower than the run, and never past the horizon); characters keep
  near-constant size — depth reads through draw order and a subtle
  far/near scale, not fake 3D shrinking. The editor shows the
  backdrop/ground split and previews depth immediately when you switch,
  and switching views snaps the board to the right height.
- **⛶ Level length** — 1 to 4 screens long (length is the only size knob;
  top-down boards are one portrait screen tall, 2.5D boards one landscape
  screen tall). The **camera follows your player** automatically
  (comfortable deadzone, clamped to the world). In the editor, scroll with
  the wheel/trackpad to pan along the board; faint guide lines mark each
  screen.
- **Gravity** — level physics, not a view, and it adapts to the view:
  - *Top-down levels*: platformer physics — ← → run, ↑ / W / joystick-up
    to **jump** (Hilltop Hop is the example).
  - *2.5D levels*: the **brawler jump** (Castle Crashers) — **Space** or
    the auto-added **Jump button** hops you above the ground plane with a
    shadow below; you keep steering in every direction while airborne and
    **land wherever you are on the plane** — never yanked back to the row
    you jumped from. Airborne heroes also sail safely over monsters.
    Sunset Street ships with it on.
- **📱 Fit** — a rotated device isn't a game style, it's just a wider
  window into the same world. The Fit button previews exactly that in the
  editor: it outlines what a **rotated (landscape)** or **portrait** phone
  screen sees and dims everything outside, so you can check your layout
  fits before playing. Click it again to cycle rotated → portrait → off.

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

### Fight: monsters, bosses, abilities, hearts & leveling

Drag a **👾 Monster** or **👹 Boss** from the palette — they're real actors
with combat stats in the inspector: **Health**, **Contact damage**, **XP
reward**, **Move speed**, and a **Behavior** AI you pick from a dropdown:

| Behavior | What it does |
| --- | --- |
| 🏃 Chase | hunts the player |
| ↔ Patrol | walks left-right around its spot |
| 🎲 Wander | drifts randomly |
| 🛡 Guard | stays home, chases when you get close, then returns |

Monsters show a health bar when hurt; a Boss gets a big named bar at the
top of the screen. Touching a mob costs the player a **heart** (with
knockback + a moment of invincibility) — at zero hearts the game ends.
Hearts switch on automatically when a player and mobs share a scene, or
set them yourself with `api.hearts(5)`.

**Ranged enemies** — set **Shoot every** (secs) in the inspector and the
mob fires glowing projectiles at the player; they're dodgeable (sidestep,
or jump over them in 2.5D). **Bosses have phases**: at half HP a boss
*enrages* — it flushes red, moves 40% faster, and shoots almost twice as
often, with an announcement toast. **NPC routes**: walk any character
along a looping waypoint path with
`api.patrol('Villager', [[160, 300], [560, 300]], 90)` — great for town
life (the Garden Explorer's gardener strolls one).

**Ability buttons** are how the player fights back — real on-screen
buttons (bottom-right, like every mobile action game) with a cooldown
sweep and an optional keyboard hotkey:

```js
api.ability('Slash', { icon: 'sword', cooldown: 0.5, key: 'j' }, () => {
  api.meleeAttack(140, 1);          // hit mobs within 140 for 1 damage
});
api.ability('Heal', { icon: 'heart', cooldown: 8, key: 'h' }, () => {
  api.hearts(3);                    // any code works — it's just a button
});
```

Built-in icons: `sword fire bolt snow shield boot heart star` — or use an
imported image with `icon: '@<assetId>'`. More combat tools:

```js
api.meleeAttack(140, 1)     // swing around the player, returns hits
api.hurt('Warden', 2)       // damage a mob/boss by name
api.hpOf('Warden')          // its current HP (0 = defeated)
api.onDefeat((name) => {})  // react to any defeat (loot! win checks!)
```

**Leveling** ties it together: call `api.levels()` and defeated mobs grant
their XP reward toward a level curve with a HUD — and **every level-up
awards a skill point** into `api.skills`, so leveling and your skill tree
are one system. `api.xp.add(n)` grants XP from quests; `api.level()` reads
the current level. The **Blob Arena** template shows the whole loop:
slimes with different AI, two mapped abilities, hearts, XP, and a boss.

### Saving — your game, and your players' progress

Two save systems, both on-device:

**💾 Save (the toolbar button)** keeps the whole game in **My Games** —
one named slot per project. Open **✚ New** and your saved games are
listed at the top: open any of them, or 🗑 delete one. (The editor also
autosaves your current project continuously; Export/Import still moves
games between devices as files.)

**The in-game save file** is for players: each game gets its own
persistent storage that survives closing the browser.

```js
api.save.set('quest', 'met-the-elder')  // any JSON-serializable value
api.save.get('quest', '')               // read with a fallback
api.save.remove('quest');  api.save.clear()
```

Progress persists automatically, no code needed: with `api.levels()` on,
**XP and level carry over between plays** (skill unlocks already did);
`api.gameOver` tracks the **best score** and shows it on the end screen;
and defeated mobs **drop coins** that scatter where they fall — walk
over them to bank them (🪙 HUD chip). The balance persists in the save
file, ready for shops:

```js
api.coins.get()                  // current balance
api.coins.spend(10)              // true if they could afford it
api.coins.add(5)                 // grant bonus coins from code
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

No API key needed — the AI dev cycle runs on your **Claude Code login**,
two ways:

1. **The AI Chat tab + the local bridge.** One-time setup on the
   computer you build on — no `pnpm install`, no npm dependencies:
   - Install **Node.js** (nodejs.org) and **Claude Code**
     (claude.com/claude-code); run `claude` once in any terminal to
     sign in.
   - Get the `interverse-engine` repo — `git clone`, or just GitHub's
     **Download ZIP**, unzipped anywhere.

   Then whenever you want the copilot: **double-click `start-ai.cmd`**
   (Windows) or run `./start-ai.sh` / `pnpm ai`, leave the window open,
   and open the Studio — the chat shows "✦ Connected" within a few
   seconds and the key box disappears (it retries automatically, so the
   order doesn't matter). Type "add a spooky forest" or "give the boss
   a second phase" and Claude edits the live project through studio
   tools. Works from the dev server AND the installed app / hosted
   page. The bridge signs in with whatever `claude` is logged in as; if
   the repo's dependencies happen to be installed it uses the Claude
   Agent SDK, otherwise it drives the `claude` CLI directly — same
   result either way.

   **If the chat says it can't find the bridge:**
   - The bridge must run on the **same computer as the browser** —
     `pnpm ai` on your PC won't reach a phone. (Phones: use the API-key
     fallback, or build on the PC and Publish.)
   - Look at the `pnpm ai` terminal — it prints exactly what's wrong
     (`pnpm install` not run yet, port already in use) and logs
     "studio connected" when the chat finds it.
   - On the hosted https page use **Chrome or Edge** — Safari blocks
     pages from talking to local programs, so the bridge can't connect
     there (the dev server at `localhost:5179` works in any browser).
2. **Claude Code driving the Studio directly over MCP.** Open this repo
   in Claude Code and the `interverse` MCP server exposes studio tools
   (`studio_open`, `studio_project`, `studio_add_entity`,
   `studio_update_entity`, `studio_set_script`, `studio_load_template`,
   `studio_play`, `studio_screenshot`). Claude attaches to your running
   Studio (`pnpm dev:studio`), edits the project, presses Play, and
   LOOKS at the result — the full engine dev loop.

Only if you have neither (e.g. a friend using just the website): the AI
Chat tab falls back to an Anthropic API key, stored locally on that
device and never shipped in a game.

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
