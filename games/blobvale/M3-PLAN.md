# Blobvale Milestone 3 (working plan) — delete when shipped

## Wave A: bug fixes + name entry (ship first)

1. BUG duplicate names: replaced by real names (below); host also dedupes
   display names in the lobby (append 2/3… if taken).
2. BUG grey/wrong class color: client roster handlers must OVERWRITE
   classes (`=` not `??=`) and rebuild a remote player's character when
   their class changes (world + lobby chips). classById fallback stays but
   should rarely trigger.
3. NAME ENTRY: NameScene (keypad A-Z + space + ⌫, 10 chars, kid-safe strip)
   shown on first launch and editable from Menu ("playing as NAME Blob —
   tap to change"). Display name = `<Name> Blob`. Saved via createSave
   ('blobvale', key 'name'). playerName() uses it; relay still sanitizes.
   ?name= query lever for tests.

## Wave B: M3 core

- BOSS: 'B' marker in map north end; big slime (radius 60, ~400hp, dmg 12,
  slow), phase 2 under 50% (faster, spawns 2 minions). Boss bar top of
  screen when engaged. Victory: fx 'boss-down', big XP (100), chest fx.
- UPGRADE CARDS: on level-up, chooser overlay with 2 cards (host rolls,
  sendTo choices; player picks; host applies): +20% dmg | +25% max HP |
  -20% cooldown. Stats extend {dmgMul, cdMul}.
- CUSTOMIZATION: in lobby under class picker: blob tint row (5 shades of
  class color) + accessory toggle (hat/none). Cosmetic only; rides roster
  as `looks: Record<id, {shade: number}>`.

## Verify additions

- Two phones join with ?name=Ana and ?name=Ana -> lobby shows "Ana Blob"
  and "Ana2 Blob" (dedupe) — assert via debug names().
- Class-change race: joiner picks knight then cleric before start; other
  phone's roster must show cleric (assert classes() debug).
- Wave B: warp to boss, cast until phase 2 then death; assert bossHp seen
  on joiner, upgrade overlay appears on level-up, pick applies (dmgMul).
