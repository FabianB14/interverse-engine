# Engine gap analysis — Interverse vs Unreal, Unity, Godot, RPG Maker

Researched July 2026 against Unreal 5.7/5.8 (UE6 announced), Unity 6.2
(Unity AI open beta), Godot 4.6, and RPG Maker MZ/WITH/Unite. Full feature
notes per engine live in the research this distills; this doc is the
actionable comparison: what Interverse already has, what it's missing, and
what to build next — always under spec §8: **the game pays for the engine**
(features get built when a game needs them).

## Where Interverse is already ahead

These are the bets the big engines validate:

- **Tiny instant web + PWA delivery.** Unreal has no web export. Godot's
  web builds are 30–50MB. Unity's are 5–20MB+. RPG Maker is lean but
  store-less. Interverse ships <3MB, installs from a URL, and browser
  joiners are sacred. Nobody else occupies this ground.
- **Agentic AI editor.** Unity ships Unity AI (Ask/Plan/Agent) at $10+/mo;
  Unreal 5.8 has an experimental MCP plugin; UE6 promises more; Godot and
  RPG Maker have nothing. Interverse's editor *is* Claude Code (MCP
  studio_* tools + the no-key AI bridge) — the industry is moving toward
  our architecture, not away from it.
- **Hosted multiplayer with room codes.** Godot has replication but no
  hosted lobby/relay — and its multiplayer adoption suffers for it. Unity
  charges through UGS. Interverse's relay + 4-letter codes + drop-in
  avatars/state sync is the "it just works" tier out of the box.
- **Playable-from-minute-zero.** RPG Maker proves this is the #1 retention
  lever; our 9 templates + working combat/leveling/saves at New Project
  match it for more genres than RPGs.
- **Zero-code progression.** Automatic XP/level persistence, best scores,
  coin loot banking, skill trees — every general engine (UE/Unity/Godot)
  leaves ALL of this to third-party plugins. Only RPG Maker ships it.

## Feature matrix (the 25 highest-leverage features)

✓ have · ◐ partial · ✗ missing. Engines listed = who does it well.

| # | Feature | Us | Best-in-class | Notes |
| --- | --- | --- | --- | --- |
| 1 | Playable-at-minute-zero templates | ✓ | RPG Maker | 9 genre templates incl. combat/skill demos |
| 2 | Tiny instant web/PWA export | ✓ | (nobody) | <3MB; publish to GitHub Pages + ?load= links |
| 3 | Zero-config autotiling | ✗ | RPG Maker A-tiles | our painter paints single tiles; no edge/corner resolution |
| 4 | Beginner scripting + hot reload | ✓ | Godot GDScript | Code window `api`, Apply-to-game hot-runs live |
| 5 | Command-list eventing (no-code logic) | ✗ | RPG Maker events | our AI chat covers some of this; a pick-a-command block list would close it |
| 6 | Composable prefabs/scenes | ◐ | Godot scenes | levels yes; no reusable entity prefab yet |
| 7 | Automatic save/load | ◐ | RPG Maker | api.save + auto XP/coins/best; no multi-slot save UI in games |
| 8 | Content database editor | ✗ | RPG Maker Database | items/skills/enemies as form-edited data; would supercharge RPG template + AI editing |
| 9 | High-level multiplayer replication | ✓ | Unreal | avatars + shared state + messages, no netcode |
| 10 | Hosted lobby/relay + room codes | ✓ | Unity UGS | our relay serves every game |
| 11 | Input action map / remapping | ◐ | Godot InputMap | fixed WASD/touch/hotkeys (RPG-Maker-style fixed is fine for now) |
| 12 | Drop-in follow camera | ◐ | Unity Cinemachine | follow/deadzone/bounds ✓; no shake/zoom/zones helpers |
| 13 | Keyframe-anything + tweens | ◐ | Godot AnimationPlayer | behaviors + api.tween ✓; no timeline editor |
| 14 | Animation state machines | ✗ | Unity Animator | spritesheets play one loop; no idle/run/attack states |
| 15 | In-editor AI agent | ✓ | Unity AI | ours is free with a Claude login and edits the live project |
| 16 | Bundled style-consistent assets | ✓ | RPG Maker | code-vector art, palettes, icons — no art block |
| 17 | 2D skeletal animation | ✗ | Unity 2D Animation | low priority for the blob style |
| 18 | 2D particles with presets | ◐ | Godot GPUParticles2D | juice (popIn/squash/rings) exists; no particle system |
| 19 | Dialogue with portraits/choices | ✓ | RPG Maker | DialogueRunner branching/flags + DialogueBox + Story tab |
| 20 | Responsive UI + theming | ◐ | Godot Control/Theme | adaptive viewport + UI kit ✓; no user-facing UI builder |
| 21 | Audio buses / music system | ✗ | Godot buses | 4 synth sfx only; no BGM/music layer (RM's auto-resume ME model is worth stealing) |
| 22 | Localization string tables | ✗ | Godot/Unity | cheap if designed early; not yet needed by a game |
| 23 | Grid pathfinding out of the box | ◐ | Godot AStarGrid2D | mob AI + waypx patrols ✓; no A* around walls |
| 24 | 2D lighting (lights/shadows/normals) | ✗ | Unity URP 2D | lantern glow is faked; cheapest "looks pro" upgrade |
| 25 | Asset/plugin marketplace | ✗ | Unity Asset Store | Interverse world publishing is the seed of ours |

## Prioritized roadmap

Each item should land WITH a game/template that needs it (spec §8.2).

**Tier 1 — biggest beginner leverage, buildable now**
1. **Autotiling terrains** (#3): paint "grass" and edges/corners resolve
   against neighbors, RPG-Maker-style. Our painter + legend already knows
   tile types; add a neighbor-mask variant per terrain.
2. **No-code event blocks** (#5): a pick-from-list command system (When
   tapped / When touched / Show message / Give coins / Switch level /
   Spawn mob…) compiled onto the existing `api`. RPG Maker proves this is
   THE non-coder unlock; it also gives the AI chat a safer edit target.
3. **Music + audio buses** (#21): a small BGM layer (looping synth music
   or imported audio, music/sfx volume split, RM-style fanfare-then-resume)
   — every template instantly feels finished.
4. **In-game save slots UI** (#7): `api.save` already persists; add the
   RM-style continue/slots screen so players resume adventures.
5. **Particle presets** (#18): confetti/sparkle/smoke/burst one-liners
   (`api.burst('sparkle', x, y)`) — juice is our house style.

**Tier 2 — content depth**
6. **Content database** (#8): a Database tab (items/skills/mobs as rows,
   curve editor for leveling) that templates and `api` read — RPG Maker's
   crown jewel, and perfectly LLM-editable JSON.
7. **Entity prefabs** (#6): save any configured entity (a tuned boss, a
   styled button) as a reusable palette item per project.
8. **Camera helpers** (#12): `api.camera.shake()/zoom()/focus()` + zones.
9. **Animation states** (#14): idle/walk/action rows on one spritesheet,
   auto-switched by movement, with an `api.animState()` override.
10. **A* pathfinding** (#23): `api.moveTo(mob, x, y)` around solid tiles
    (AStarGrid over the painted tilemap).

**Tier 3 — polish & scale**
11. **2D lighting** (#24): point lights + darkness overlay + occlusion —
    Hushfall's fog system is halfway there; generalize it.
12. **Localization** (#22), **input remapping** (#11), **skeletal
    animation** (#17) — when a shipped game demands them.
13. **Marketplace** (#25): grow Interverse world publishing into
    discovery + remixable shared assets (RPG Maker WITH's asset-sharing
    model, but web-native).

## Anti-goals (deliberate)

- **3D / first-person** — stays a locked tile until the 2D platform is
  deep (UE's fate in 2D shows what half-attention produces).
- **Giant general marketplaces** — RM shows curated + format-guaranteed
  beats huge + messy for beginners; our code-vector format is the contract.
- **Per-seat AI pricing** — Unity charges $10-30/mo for what our bridge
  does with the Claude login the creator already has.
