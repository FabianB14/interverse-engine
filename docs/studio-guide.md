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
  | Hero's Errand | Menu → Quest | Title menu, village shop, find 2 chests, boss lair |
  | ⚔️ Blobvale | Co-op RPG · multiplayer | Menu, class pick, shared world, wolves + a direwolf |
  | 🌱 Bloomstead | Cozy farming | Plant, harvest, sell at the stall — no enemies, no fail state |
  | 🕯️ Hushfall | Hide & seek · multiplayer | Light every lantern, reach the gate before the Seeker |

  **Hero's Errand** is the capstone — it uses almost everything in this
  guide at once (a start-button menu level, a shopkeeper NPC selling
  database items, two chests that count into a `chests` variable, a gate
  that only opens at 2, a boss with hearts and an ability, and a victory
  fanfare). Load it and read its ⚡ events and ⛓ Flow map to see how a
  full small game is put together.

  First-person / 3D templates arrive when the engine grows a 3D renderer.

- **🎲 Generate one for me** (top of the ✚ New screen) builds a complete
  game from a few choices: kind (arcade / brawler / RPG / runner /
  survival / cozy), theme (forest / dungeon / city / space / candy),
  1–5 levels, difficulty, and which mechanics to include (shop,
  treasure, boss, skill tree). It writes the levels, terrain, enemies,
  chests, NPCs, ⚡ event wiring, items, music, a title menu and a win
  condition — then hands you an **ordinary editable project**. Nothing is
  locked; generating is a starting point, not a black box. **↻ Reroll**
  keeps your settings and builds a different world, and the same seed
  always rebuilds the same game, art included. Cozy games come out with
  no enemies at all, whatever else you tick — and every generated game is
  checked for a player, a way to finish, and no actor sitting on the
  player's spawn before it is handed over.

- Your project **autosaves** on this device. **Export** downloads a
  `.interverse.json` you can back up, share, or publish (see §7).

## 2 · Build the scene

The left panel starts with the **🌲 Hierarchy** — every level and its
actors as a tree. Click a level to open it, click an actor to select it
(⚡ marks actors with events). Below it, the palette adds new actors.

- **Drag** items from the left palette onto the canvas (or click to place).
- **Click** an entity to select it; **drag** it to move; edit everything else
  in the right-hand **inspector** — position, scale, rotation, color, blob
  look, text, font size.
- **Import image…** turns any PNG/JPG/WebP into an actor — or just **drop
  the file onto the canvas**, which is what most people try first.
- **🖼 Art** in the toolbar is the library of everything you have
  imported: thumbnails, file size, how many actors use each one, a
  🧹 button for art nothing points at, and a running total with a warning
  past 2 MB (players download all of it). Deleting a picture blanks the
  actors that used it rather than leaving them pointing at nothing.
- **✂ Slice** opens the spritesheet slicer: it draws the **frame grid on
  top of your picture** and updates live as you change the frame size, so
  you can see when it lines up instead of guessing numbers. ✨ Guess
  starts you somewhere sensible, and **Use this picture** applies it to
  the actor you choose. Name frame ranges as 🎬 Clips in the inspector to
  get `idle` / `walk` / `attack` animations.
- "Models" here means 2D sprite art — the engine is 2D. Dropping a `.glb`
  or `.fbx` tells you so and suggests rendering it to a spritesheet,
  rather than failing silently.
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

## 3¼ · ⚡ Abilities — the buttons your players tap

This is where a mobile game's controls really get made. **Select an actor**
and the inspector has an **⚡ Abilities** section: tick the abilities that
actor should have. When that actor is the player, each one becomes an
**on-screen button automatically** — no code, no `api.ability()` call.

**✚ Create an ability…** makes a new one and opens the editor. You choose
what it *does* from a list, and only the numbers that effect uses are
shown:

| Effect | What it does | You set |
| --- | --- | --- |
| 🗡 Attack nearby enemies | Hits everything in reach | Damage, Reach |
| 🏹 Shoot the nearest enemy | Fires a homing shot | Damage, Shot speed |
| ❤ Heal yourself | Restores hearts | Hearts |
| 👟 Dash forward | Leaps the way you face | Distance |
| 🐣 Drop something | Spawns an actor beside you | What to drop |
| 📝 Custom code | Anything the list misses | Your code |

Plus a cooldown, an icon, a particle burst, a sound, and an optional
**key** — handy while editing on a desktop, though phone players just tap
the button. A line under the dropdown tells you in words what the ability
will do, and switching the effect resets the numbers so you never end up
with "heal 130 hearts".

Deleting an ability also removes it from every actor that had it, so
nobody is left with a button that does nothing.

**🌳 From a skill tree**: give a skill node a `grants` field with an
ability id and investing in that node hands the ability over mid-game —
the button appears as the player unlocks it. Point an actor at a tree with
the **🌳 Skill tree** dropdown in its inspector (trees live in the
project database under an id).

## 3½ · 🎮 Controls — key and button binds

**🎮 Controls** in the toolbar (also the first item in the left palette)
is where every control lives. Each one has a NAME, and keys and the
on-screen button are two bindings of that same name — which is how one
game serves both a phone player and a keyboard player.

- Six controls exist from the start: **move left / right / up / down**,
  **jump**, and **talk / use**. Their defaults are the keys the engine has
  always used (arrows + WASD, Space to jump, E or Enter to interact) —
  now editable rather than baked in.
- **Click a keycap and press a key** to rebind it. Esc cancels, Backspace
  clears. **+ key** binds a second key to the same control, so ← and A can
  both mean left.
- If two controls share a key you get a ⚠ warning rather than a silent
  steal — sometimes sharing is what you want.
- **+ Add an action** makes a new named control (Dash, Block, Shout).
  Tick **on-screen button** and phone players get a real button for it.
- **Touch steering** picks between a 🕹 joystick and ✜ d-pad buttons.
- From code, `api.ability('Dash', { icon: 'boot', key: 'q' }, fn)` still
  works — and if a control with that name exists in the table, the table
  wins, so a player can rebind an ability the author hard-coded.

## 3¾ · Paint the world (Tiles)

Hit **🗺 Tiles** in the toolbar and the palette becomes a paintbox: grass,
flowers, dirt and stone paths, sand, water, rock walls, trees, brick.
Click/drag on the canvas to paint terrain (18×32 grid per level), use the
eraser to clear, and **✓ Done painting** to go back to placing things.

Tiles marked *solid* (water, rock, trees, brick) **block players** in Play
mode automatically — paint a maze and it just works. The Garden Explorer
template ships with a painted garden to start from.

**🎲 Generate a level** (bottom of the paintbox) builds one for you:
**Maze** (rock walls, fully-connected dirt paths), **Dungeon** (brick
walls, stone rooms joined by corridors), **Island** (grassy heart, sandy
shore, water, scattered trees). Generated tiles are ordinary paint —
touch them up by hand afterwards. From code the same generators power
endless games: `api.setTiles(api.gen.dungeon())` rebuilds the level
live, collision included.

## 4 · Animations, VFX, SFX

- **Wobble** — idle animation toggle (inspector).
- **Pop-in** — spawn juice toggle.
- **Tap sound** — pop / blip / chime / buzz when the entity is tapped.
- **Spritesheet animations** — Import an image that contains animation
  frames in a grid, then set **Frame width / Frame height / Frames-per-sec**
  in the inspector. Frames read left-to-right, top-to-bottom and loop.
  (Frame size 0 = still image.)
- **✨ VFX particle bursts** — `api.vfx('confetti', x, y)` with presets
  `confetti · sparkle · poof · hearts · embers · coins`, and a matching
  ✨ event action. Lots of juice is automatic: defeats poof, coin
  pickups sparkle, level-ups rain confetti, enraging bosses spray
  embers.
- **Imported model animations** — import a spritesheet, set the frame
  size, then define **🎬 Clips** in the inspector (name + frame range +
  fps: idle, walk, attack…) and switch them from code with
  `api.playClip('Hero', 'walk')`. Characters and models also
  **auto-face** their movement direction.
- **Property animation from code** — `api.tween(thing, { x, y, rotation,
  alpha, scale }, seconds)` for cutscenes and juice.
- From code: `api.sfx.pop()`, `.blip()`, `.chime()`, `.buzz()`.
- **Music** — looping chiptune BGM, synthesized live (no downloads):
  `api.music.play('adventure' | 'cozy' | 'battle' | 'spooky')`,
  `.stop()`, and `.fanfare()` — a victory jingle that ducks the BGM and
  lets it resume, RPG-Maker style. Events have a 🎵 Music action too, so
  no code is needed. Volumes: `api.music.setVolume('music'|'sfx'|'master',
  0..1)` — remembered per device. Garden Explorer opens on 'adventure',
  Blob Arena on 'battle'.

## 4¼ · 🏠 Menus — main, pause and settings

Every game needs screens that are not gameplay. Three come built in, and
all of them are reachable from a plain button with **no code**:

- **⚙ Settings** — music and sound volume (remembered per device) and a
  language switch when your project has a 🌐 language table. Add a button,
  give it a 👆 tap event with the **⚙ Open settings** action.
- **⏸ Pause** — Resume · Settings · Restart level · Main menu, from the
  **⏸ Pause the game** action. A ⏸ button in the corner is all it takes.
  Gameplay actually stops while it is open.
- **🏠 Title** — the save-slot screen (Continue / New game + volumes) from
  the **🏠 Show the title screen** action, or `api.title()`.

A **main menu** is just a level: a Text actor for the name, and Button
actors whose tap events 🚪 go to your first level or ⚙ open settings.
Blobvale, Bloomstead and Hushfall all start with one — load any of them
and look at the `Menu` level to see the pattern.

From code: `api.menu.settings()`, `api.menu.pause()`, `api.menu.close()`,
`api.menu.isOpen()`.

## 4½ · Events — build logic with no code

Select anything and use **⚡ Events** in the inspector (RPG-Maker style):
pick a **trigger** — 👆 When tapped · 🚶 When the player touches it ·
🎬 When the level starts · ⏲ Every N seconds — then stack **actions**
from a list: 💬 Say message, 🪙 Give coins, ⭐ Add score, ✨ Grant XP,
❤ Heal hearts, 🔊 Play sound, 🐣 Spawn a thing, 🗑 Remove this,
🚪 Go to level, 🔛/⏹ Turn a switch on/off, 🔢 Add to variable,
🛒 Open shop, 🎒 Open inventory, 🏆 Win, 💀 Lose.

**🎥 Camera direction** (code): `api.camera.panTo(x, y, secs)` parks the
camera somewhere (a door opening across the map), `api.camera.follow('Hero')`
returns it, `.shake(power, secs)` for impacts, `.letterbox(true)` for
cutscene bars. And **imported models animate themselves**: clips named
`idle` / `walk` / `jump` auto-switch as players and mobs move — a state
machine with zero wiring.

Three extras make real quests possible:
- **only if switch…** — the event runs only while a named switch is ON.
  A chest can `Turn switch ON: opened`, and a door gated with
  `only if switch: opened` starts working after the chest is found.
- **needs variable… ≥ n** — the event runs only once a counter has
  reached a number. Switches answer *did it happen?*; variables answer
  *how many?* Give two chests a `🔢 Add to variable: chests +1` action
  and gate the gate on `needs variable: chests` ≥ `2`, and the player
  must find **both** before it opens. That's a collect-N quest with no
  code at all.
- **once** — fire at most one time per play.

Switches and variables are shared with the Code window
(`api.switches.on/off/isOn`, `api.vars.get/set/add`), so no-code events
and scripts work on the same world state.

### Level events — logic the level owns

Click empty ground (nothing selected) and the inspector becomes the
**level**. It has its own ⚡ events, using the same blocks actors use but
with no actor involved:

- 🎬 **When the level starts** — set the music, say a line, spawn a wave.
- ⏲ **Every N seconds** — a timer that belongs to the room, not to a prop.
- 👆 **When the screen is tapped** — fires on empty ground.
- 🏁 **When every enemy is defeated** — the arena-clear trigger. It only
  arms once a mob has actually existed, so a peaceful level never
  instantly "wins".

Actors run first (each firing its own 🎬 start), then the level's events,
then the Code window — so code always gets the last word.

## 4⅝ · The 🗄 Database — items, shops, languages

The **🗄** toolbar button opens the project database:

- **🎁 Items** — one table of items for the whole game: emoji, id, name,
  coin price, and a use-effect (heal / coins / xp). Reference them
  everywhere: the 🎁 Give item event action, and from code —
  `api.items.give('potion')`, `.count`, `.use` (applies the effect),
  `.buy` (spends coins at the table price), and `api.items.open()` — a
  ready-made 🎒 inventory screen where players tap items to use them.
- **🛒 The shop screen** — every item you give a **price** above 0 is
  already for sale. Give a shopkeeper NPC a 👆 tap event with the
  **🛒 Open shop** action and you have a working store: the panel lists
  the wares with prices, shows the live coin wallet, and tapping a row
  buys it (a buzz if the player is short). From code it's
  `api.shop.open()`. No shop scene to build — the database *is* the shop.
- **🌐 Languages** — a translation table. Any text starting with `@key`
  (labels, buttons, stories, 💬 events) shows the player's language:
  `{"en": {"greet": "Hello"}, "es": {"greet": "Hola"}}`. From code:
  `api.t('greet')`, `api.setLang('es')` (remembered per device).

## 4¾ · The ⛓ Flow tab — your game as a graph

The **Flow** tab (bottom panel) is the visual scripting map: every level
and every actor with ⚡ events appears as a draggable node card. Wires
show the connections that make quests work — gold wires from a
switch-setter to every event gated on that switch, purple wires from
🚪 go-to-level actions to their destination level. Click a node to select
that actor for editing in the inspector; double-click a level node to
open it.

**Wire authoring**: drag from a node's ◉ port onto another node and the
logic writes itself — **actor → level** adds a 🚪 door action;
**actor → actor** invents a switch, makes the source set it, and gates
the target's events on it. A chest-opens-door quest is one drag. Levels
can be a wire source too, not just a destination.

**Drag off into empty space** and you get a **search box** instead
(Unreal Blueprints' move): type a few letters and pick what should
happen — any ⚡ action, a new trigger, a **new level with the door to it
already written**, or a new actor placed where you dropped. Arrow keys
and Enter work; Esc cancels and changes nothing. The list is
scope-aware, so a level is never offered "remove this".

The bottom panel has three states, from the buttons at the right of its
tab bar: docked (the default), **▾ minimized** when you want the whole
canvas, and **⇱ undocked** — a floating card you can drag by its tab bar
and resize from the corner, so the Code window or the Flow map can be as
big as you like while the canvas keeps the full width underneath. **⇲**
docks it again, and whichever state you left it in is remembered on this
device.

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

### Dress-up: cosmetics & attachments

Every **character actor** (blob, story character, monster, boss) has a
**🎩 Hat** and **🗡 Held item** in the inspector — crowns, wizard hats,
horns, halos; swords, shields, staffs, lanterns, flowers — all drawn in
the house art style and attached to the body (they wobble and flip with
it). Restyle live from code, which is exactly how cosmetic shops work:

```js
if (api.coins.spend(25)) api.outfit('Hero', { hat: 'crown', held: 'sword' });
```

### What everything is (the actor taxonomy)

Everything you place in a scene is an **actor** — selectable, editable in
the inspector, scriptable by name, and eligible for ⚡ events. The
palette groups them by what they're for:

| Group | Kinds | Extra powers |
| --- | --- | --- |
| **Characters** | Blob, Story character | outfits, stories, player control |
| **Enemies** | Monster, Boss | HP/AI/loot, outfits, boss bar |
| **Props** | Crate, Lantern, Plant | events, tap sounds |
| **UI** | Text, Button | fonts, tap handlers |
| **Assets** | Imported images | spritesheet clips, any art you own |

### The title / save-slot screen

`api.title()` at the top of your first level's script gives players a
proper front door: the game's name, **▶ CONTINUE** (only when a save
file exists), **✚ NEW GAME** (wipes the save file AND skill unlocks),
and 🎵/🔊 volume bars — gameplay stays paused until they choose.

### Skill trees

**🌳 Skills** are branch-based, like a Borderlands character sheet.
`api.skills.define()` takes named **branches**, each with a colour, an
optional big hex **action skill**, and a grid of skills in **tiers**:

```js
api.skills.define({
  title: 'VAULT HUNTER',
  points: 1,
  pointsPerTier: 5,          // points spent IN a branch to open its next tier
  branches: [{
    id: 'brawl', name: 'BRAWLER', color: 0xff6b6b,
    action: { id: 'rampage', name: 'Rampage', emoji: 'fire', cost: 1, maxRank: 1, tier: 0 },
    nodes: [
      { id: 'muscle', name: 'Muscle', emoji: 'sword', cost: 1, maxRank: 5, tier: 0 },
      { id: 'cleave', name: 'Cleave', emoji: 'sword', cost: 1, maxRank: 3, tier: 1 },
    ],
  }],
});
```

- **maxRank** makes a skill investable several times — the `0/5` badge.
- **Tier gating is per branch**: spending five points in GUNSLINGER does
  nothing for BRAWLER's tier 1. That is the rule that makes a build a
  choice rather than a checklist, and locked tiers say exactly what opens
  them.
- **↺ RESPEC** refunds every point, so experimenting is free.
- Icons use the built-in art ids (`sword fire bolt snow shield boot heart
  star`); any other string is drawn as an emoji.
- Three branches do not fit across a 720-wide portrait phone, so portrait
  shows **one branch with a switcher** and landscape shows them side by
  side; either way the panel shrinks to fit rather than running off screen.
- Older `api.skills.define({ title, points, nodes })` trees keep working
  exactly as before — they become a single branch with tiers read from
  the `requires` chain and no point gate.

The **Vault Hunter** template is the worked example.

## 7¾ · Where your game lives (and what MCP is for)

Your game is one JSON file, and it can live in four places:

1. **This device** — continuous autosave + named **💾 My Games** slots.
2. **A folder on your computer** — Publish → *A folder on this computer*
   saves `<name>.interverse.json` anywhere you pick (documents, a synced
   drive, or a local git checkout you commit yourself). Chrome/Edge;
   on Safari/iPhone use Export/Import — the files are identical.
3. **Your GitHub repo** — Publish → *Push to your GitHub repo* with your
   own token; everyone gets a play link.
4. **The Interverse world** — register it against an IVX node.

Separately from ALL of that: the **MCP connection is for editing the
ENGINE and the Studio itself** — Claude Code attaches to the
interverse-engine repo through the `interverse` MCP server (studio_*
tools) to build features, fix bugs, and drive the dev cycle. Your game
projects never need MCP; they're data files in the places above.

### Finding your way around the api

The Code window has a **🔍 Find a command** dock down its right side —
every call the engine offers, grouped (Player, Actors, Timing, Combat,
Progress, World, Screens, Items, Looks, Audio, Save, Language,
Multiplayer). Type to filter (it matches names, descriptions and the
preset lists, so "confetti" finds the particle call), click an entry to
read its signature and example, and **double-click** — or press
**⤵ Insert into script** — to drop a working line at your cursor.

An empty Code window now shows a runnable starter script rather than a
blinking cursor, and pressing **Apply to game** on an empty script runs
that starter, so the first thing you do produces a result.

When a script fails, the error appears **under the code** with a
plain-language hint ("There is no *apu* here. Every command starts with
api.") instead of a browser pop-up.

## 7⅞ · 📍 Where your project lives

Next to the project name the toolbar shows **where this game is saved** —
`● on this device`, or `✓ owner/repo@branch` once you connect one. The dot
means unsaved changes, the tick means saved. Click it to change any of it.

- **💾 Save** writes back to wherever the project lives: a device slot, or
  a commit to your repo. It is one button whatever the answer is.
- **🐙 Connect a GitHub repo** — owner, repo, branch, path and a
  fine-grained token. **📂 Open from repo** pulls the project in and links
  it; **🔗 Link only** links the copy you already have open.
- **✚ New → 📂 Open one you already have** does the same from the start
  screen, alongside opening a `.interverse.json` file.

Your token stays in this device's browser storage and **never enters the
game file** — that is why the repo link is stored per device rather than
inside the project (spec §8.4: no credentials ship with a game). The
exported JSON is pure game data, safe to publish anywhere.

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
