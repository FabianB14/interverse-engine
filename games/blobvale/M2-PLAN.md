# Blobvale Milestone 2 — Combat (working plan)

Status: IN PROGRESS. Delete this file when M2 ships.

## Scope

- Slime mobs at camps: host-simulated AI (idle wander -> aggro within 260u
  -> chase -> melee attack), synced in the existing 10Hz snapshot.
- Class abilities on a big tap button (auto-aim nearest target):
  - Knight: sword arc — 3-tile cone, high dmg, taunts hit mobs onto him
  - Archer: arrow — longest range single target
  - Mage: fireball — AoE splash at target
  - Cleric: heal pulse — heals allies within radius (attacks weakly)
  - Rogue: dash-strike — teleport-dash to target, crit chance
- HP: players (bar under blob) + mobs (bar over slime); downed players
  respawn at spawn after 5s. Floating damage/heal numbers.
- XP + levels: kills grant XP to all players in range; level-up = +10% dmg
  and +5% max HP per level, chime + burst. HUD: level + XP bar + HP.

## Protocol additions (host-authoritative)

- snap gains: mobs: {id: {x,y,hp,max}}, hp: {playerId: {hp,max,lvl,xp}}
- client -> host: {type:'cast'} (host resolves aim/damage using known pos)
- host -> all: {type:'fx', kind:'slash'|'arrow'|'fire'|'heal'|'dash'|'hit'|
  'die'|'levelup', x,y, id?, amount?} — clients render juice from fx events.

## Files

- map.ts: add 'm' camp markers (objects name 'camp'), keep layout
- src/combat.ts: MOB stats, ability defs (range/dmg/cooldown), xpForLevel
- WorldScene: host sim loop, ability button + cooldown ring, HP bars,
  fx renderer, respawn, level HUD
- verify-blobvale.mjs: host casts -> mob hp drops on a joiner's screen;
  kill a slime -> xp increments everywhere; zero errors.

## Done when

3 headless phones fight a slime camp: joiner sees mob move + take damage,
slime dies, everyone's XP rises, no console errors. Then phones test.
