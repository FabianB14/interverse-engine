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

## 3 · Animations, VFX, SFX

- **Wobble** — idle animation toggle (inspector).
- **Pop-in** — spawn juice toggle.
- **Tap sound** — pop / blip / chime / buzz when the entity is tapped.
- From code: `api.sfx.pop()`, `.blip()`, `.chime()`, `.buzz()`.

## 4 · Stories (narratives)

Select a character → **Story** tab → one line per row → **Save story**.
In Play mode, tapping them plays the lines through the dialogue box
(typewriter, tap-to-advance). Writing a story upgrades a Blob into a Story
character. From code you can also narrate directly:
`api.say('Narrator', 'Night falls…', 'Something stirs.')`.

## 5 · Levels

**+ Level** adds a scene; the toolbar dropdown switches between them. Each
level has its own background, entities, and script. Move players between
levels with `api.goto('Level 2')`.

## 6 · The Code window

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

## 7 · Multiplayer blocks

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

## 8 · Publish — your repo, and the Interverse world

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

## 9 · AI copilot

The **AI Chat** tab is a dev-time copilot: paste your Anthropic API key
(stored locally, never shipped) and ask — "add a forest of 8 plants",
"make the button jump to Level 2", "write the wizard's story". Claude edits
the project through tools while you watch the canvas change.

## 10 · The Windows app (and iOS later)

The `Studio Windows app` GitHub Actions workflow builds a desktop installer
(Tauri shell). Tauri is the same shell that will target iOS when we get
there. The web Studio is always the source of truth.
