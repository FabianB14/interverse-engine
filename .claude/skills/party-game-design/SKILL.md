---
name: party-game-design
description: Round structure, pacing, and score-balancing patterns for Interverse party games. Use when designing or implementing multiplayer rounds, lobbies, or scoring.
---

# Party game design patterns

Target: 4–8 people in a living room, every player on their own phone, kids
present. The phone is a controller AND a private screen — use both.

## Structure

- Game = lobby -> N rounds -> final podium. 3–5 rounds, 20–45s each; a full
  game under 10 minutes so "one more game" is easy to say yes to.
- Round contract: **intro** (2–4s, one-sentence rule, big type) -> **play**
  (always with a visible countdown) -> **results** (staggered score reveal,
  slowest-first so the leader lands last).
- The host phone is the "main screen" when propped on a table: show shared
  state big there; joiners get private/interactive views.

## Netcode (host-authoritative)

- Joiners send INPUTS (`session.send`), never state. Host validates, scores,
  and broadcasts state snapshots. Late joiners get a full snapshot on join.
- Design for the relay's reality: messages are ordered per-connection but
  phones lag — timestamp with host round-time, ignore stale inputs.
- Always handle `onPlayerLeave` mid-round (skip their turn, keep score) and
  `onClose` (host gone -> friendly "party ended" back to menu).

## Scoring & fairness

- Points scale 10/100/1000-style so nobody computes decimals out loud.
- Rubber-banding: last place gets a visible-but-small catch-up bonus
  (~10–15%); never enough to feel rigged.
- Reward speed AND correctness separately when possible (first correct
  answer bonus) so slow-but-right players still score.
- Everyone scores something every round. Zero-point rounds feel terrible.

## Kid-safe & couch-proof

- No free-text anywhere a stranger could see; generated names are fine.
- Readable from 2 meters: min 30px text in design space for shared info.
- Rounds must survive a phone locking mid-round (rejoin-friendly state).
