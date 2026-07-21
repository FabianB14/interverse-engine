---
description: Add a party-game round module (intro -> play -> results contract)
argument-hint: <game> <RoundName>
---

Add a round module named "$2" to the party game `games/$1`.

Rounds follow a three-beat contract so they can be sequenced by a lobby:

1. Create `games/$1/src/rounds/$2.ts` exporting a class with:
   - `intro(scene, session, players)` — 2–4s title card explaining the rule
     (one sentence, readable from a couch).
   - `play(scene, session, players, onDone)` — the actual round. The HOST is
     authoritative: joiners `session.send()` inputs, host validates, scores,
     and `session.broadcast()`s state. 20–45 seconds, always with a visible
     timer.
   - `results(scene, session, scores)` — reveal scores with juice
     (staggered pop-ins, `audio.chime()` for the leader).
2. Wire it into the game's lobby/round sequencing so it actually runs.
3. Read `.claude/skills/party-game-design/SKILL.md` for pacing and scoring
   rules; docs/net.md for the messaging patterns.
4. Verify: `pnpm typecheck && pnpm lint`, then run the relay + dev server and
   use MCP `create_room`/`join_room_bot` (with `sendTap`) plus `screenshot`
   to watch the round behave with fake players.
