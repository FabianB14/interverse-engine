---
name: cozy-rpg-patterns
description: Map, dialogue, and save conventions for cozy games and 2D RPGs on the Interverse engine. Use when building world scenes, NPCs, conversations, or persistent progression.
---

# Cozy / RPG patterns

Reference implementation: `games/room` (map, joystick, camera, NPC).

## Maps

- Author as ASCII rows + legend (`tileMapFromRows`) — readable, diffable,
  easy to generate. 64px tiles; rooms 15–25 tiles across so the camera has
  something to do.
- Legend chars: `#` wall, `.` floor, letters for props (solid) — lowercase
  for props, uppercase for object/spawn markers (`@` player, `F`/named NPCs).
- Tile painters: floor gets per-tile shade variation from the rng; props sit
  ON a painted floor tile (call the floor painter first). Three shapes max.
- Collision: mark solid in the legend; move actors with `moveWithCollision`
  using a "feet box" smaller than the art (half-extents ~22x16 for a 30r
  blob) so characters can overlap prop tops.

## NPCs & dialogue

- NPC = blob character + `Wobble` idle + oversized tap target
  (`hitRadius ~2x radius`) + a "!" prompt when the player is within talking
  range (~150 units). Gate talks on proximity, not just taps.
- Dialogue lives in `src/dialogue/*.json` (validate with the MCP
  `validate_dialogue` tool). Keep lines ≤ 2 sentences; every conversation
  ends in ≤ 6 taps.
- Branch on memory: track met/quest flags, enter alternate nodes
  (`runner.start(met ? 'again' : 'intro')`). NPCs that remember you are the
  whole cozy genre.
- Freeze movement and hide the joystick while `box.isOpen`; restore in
  `onClosed`.

## Saves

- One `createSave('<game>', version)` store per game. Namespaced keys:
  `flags.met_fern`, `inventory.seeds`, `best.harvest`.
- Save on meaningful moments (conversation end, room exit), not every frame.
- Bump the version + write a migration when a key's shape changes; never
  strand an old save.

## Feel

- Camera deadzone ~140x180 so small steps don't scroll the world.
- Walk speed 240–280 units/s; walk bob always on.
- Ambient motion everywhere: plants and NPCs wobble at randomized phases.
