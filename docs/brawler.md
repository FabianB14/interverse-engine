# 🥊 The brawler kit

`@interverse/engine` ships the pieces a 2.5D beat-'em-up is made of, so a
game like **Blob Crashers** (`games/crashers`) is mostly a table of stages
rather than an engine of its own.

## The ground plane

A brawler is neither a platformer nor top-down: it is a flat stage seen at a
slight angle. Two rules do all the work, and both are pure functions of `y`.

```ts
import { HORIZON_Y, GROUND_BOTTOM_Y, depthScale, clampToGround, inSameLane } from '@interverse/engine';

entity.y = clampToGround(entity.y);   // the horizon is a wall
entity.scale.set(depthScale(entity.y)); // further back = slightly smaller
entity.zIndex = entity.y;               // further back draws behind
```

The design space is **1280×720 landscape** — a wide room — with the walkable
band from `HORIZON_Y` (300) to `GROUND_BOTTOM_Y` (690).

`depthScale` is deliberately subtle. Real perspective over a 400-unit band
would make the back row unreadable on a phone; a hint is enough for the eye.

**Lanes** are how a brawler decides whether two fighters can trade blows.
Being *level* with someone matters far more than being near them — a swing
that connects with an enemy a whole body-depth up the stage feels like a
miss — so `meleeConnects` weights depth heavily:

```ts
meleeConnects({ x, y, dir }, target, reach)  // same lane, in front, in range
```

Height is separate from depth on purpose. A brawler jump lifts you *off* the
plane while you keep steering in both axes, so `z` is drawn as an offset
(`airOffset`) and never touches the `y` that decides depth, sorting or lanes.

## Making a hit feel like a hit

Almost none of this is damage numbers.

```ts
import { Combo, HitStop, Invulnerable, hitStopFor, knockbackFrom, decayKnock } from '@interverse/engine';
```

| Piece | What it is for |
| --- | --- |
| `HitStop` | The world stops for ~50ms on contact. The cheapest thing that makes a swing feel like it landed. |
| `Combo` | A three-hit chain — two jabs and a launcher — with a window that resets if you pause. Turns mashing into rhythm. |
| `Invulnerable` | A moment after being hit where nothing can hit you again. |
| `knockbackFrom` / `decayKnock` | Throws the target, and gives control back quickly. |

`Invulnerable` is not polish. Without it a crowd of three is not a fight, it
is a stunlock: each enemy's contact damage lands before you have recovered
from the last. In a game whose premise is being surrounded, it is the
difference between playable and not.

Hit stop applies **only on contact** — freezing on a whiff reads as broken
rather than weighty.

## Telegraphs

```ts
const tell = new Telegraph();
tell.start(0.45);
if (tell.tick(dt)) fire();   // true on the frame it lands
tell.progress                // 0 → 1, for a ring that closes in
```

The engine owns the wind-up because it is a promise to the player rather than
a property of the monster: *something is about to happen, here, and you have
this long to not be there*. `MIN_TELEGRAPH` is a floor no caller can go under
— however angry a boss gets, "you could not have known" is not a difficulty
setting.

A telegraphing enemy should stand still. That IS the tell, and one that keeps
closing while it winds up is not dodgeable.

## Wave gates

Strip a beat-'em-up stage down and it is one rule repeated: walk right until
the game stops you, clear what appears, walk right again.

```ts
const runner = new WaveRunner(waves, endX);

hero.x = Math.min(runner.limitX, hero.x);   // the gate is a wall
const spawn = runner.update(hero.x);        // non-null on the frame it closes
if (spawn) spawnEnemies(spawn.enemies);
onEnemyDefeated(() => runner.defeated());   // the gate opens on the last one
```

`spawnSpots` spreads a wave out so nobody stacks, with one in three arriving
from **behind** — being surrounded is the genre's whole texture, and a wave
that only ever comes from the front is a queue.

An empty wave is a checkpoint, not a fight you cannot win.

## The roster

```ts
import { BRAWLER_CLASSES, brawlerClass, statsFor, levelFromXp, playerTint } from '@interverse/engine';

const stats = statsFor(brawlerClass('brute'), run.upgrades);
// { power, speed, hearts, reach }
```

Four classes covering the corners: all-rounder, fragile-fast, slow-heavy, and
ranged. Every number is a multiplier off 1.0 so the trade is readable at a
glance rather than arithmetic.

Each has its **own colour and its own silhouette** (hat + held item), because
four blobs in a scrum is exactly the moment you must be able to find
yourself. `playerTint` shifts a joiner who picked the same class.

Progression is three blunt knobs. A brawler's growth is felt through bigger
numbers, not new systems, and three is enough to make fifteen stages of it
readable.

## Blob Crashers

`games/crashers` is the worked example: fifteen stages in five acts, each act
ending on a boss. The whole campaign is a table in `src/levels.ts` — where
the gates are, who is behind each one, and what the place looks like — so
difficulty is a column you can read down and adding a stage is adding a row.

Five enemy archetypes, each asking a different question:

| Foe | Teaches |
| --- | --- |
| Grunt | the combo |
| Archer | do not stand still |
| Brute | use the launcher — armour is no use in the air |
| Shaman | target priority (it heals the others) |
| Howler | spacing |

Run it with `pnpm dev:crashers`, and `pnpm verify:crashers` plays a stage end
to end headlessly.
