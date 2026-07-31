# 🏃 The runner kit

Everything needed to build an endless runner: a road drawn in perspective,
three lanes, jump and slide, swipe input, and a track generator that cannot
produce a row you are unable to get through.

`games/rush` (Blob Rush) is the worked example. Run it with `pnpm dev:rush`;
`pnpm verify:rush` plays it headlessly.

## A blob that rolls, wearing a hat that doesn't

```ts
import { rollingBlob } from '@interverse/engine';

const blob = rollingBlob({ radius: 40, color: 0x6ec5ff, spots: 6 });
scene.add(blob.view);

blob.rider.addChild(myHat);   // stays level forever
blob.wheel.addChild(myStripe); // painted on, turns with the body

blob.roll(distanceTravelledThisFrame);
```

A rolling character is two transforms, not one:

| Container | Spins? | What goes in it |
| --- | --- | --- |
| `view` | — | position and scale this |
| `wheel` | yes | the body: silhouette, spots, shading, anything painted **on** |
| `rider` | never | the face, hats, ears, trails — anything **worn** |

Rolling the hat with the body is technically more correct and looks terrible:
the character stops being a character and becomes a texture. A face and a hat
that stay level read as *a blob that is rolling*, which is the thing the
player should see. Same reason a car's wheels spin and its driver does not.

**`roll()` takes ground distance, not time.** It turns the wheel by
`distance / radius`, which is what rolling without slipping actually means —
so speeding up, slowing down and stopping all look right for free, and the
blob never skids. Driving it off a fixed spin rate is the classic version of
this bug and it is visible immediately.

One gotcha, recorded because it cost a screenshot to find: `blobCharacter`
defaults `strokeWidth` to `Math.max(3, radius * 0.06)`, and that floor of 3
assumes a radius in pixels. `rollingBlob` passes the stroke width explicitly,
so authoring at radius 1 and scaling up works — do the same in any art of
your own that is built at unit size.

## Looking down a road

```ts
import { project, depthOf, fogAlpha, depthIndex, DRAW_DISTANCE } from '@interverse/engine';

const p = { cx: w / 2, horizonY: h * 0.34, groundY: h * 0.86, focal: 900 };
const { x, y, scale } = project(sideways, depth, heightAboveRoad, p);
```

One pinhole projection, and everything else derives from the `scale` it
returns — positions, sizes, and how fast things seem to approach. That is why
objects never drift out of agreement with the road they stand on.

- `z` is depth in design units: 0 is the plane the player is on, larger is
  further away.
- Height is applied *after* the scale, so a jump of the same height looks
  smaller further away. That is the only reason a jump reads as a jump rather
  than as a lane change.
- `focal` is the feel knob: larger is flatter and more telephoto, smaller is a
  wide angle where obstacles rush at you.
- `depthIndex(z)` is a painter's-algorithm zIndex — far things first. Let
  PixiJS sort from it rather than sorting a few hundred moving objects
  yourself every frame.
- `fogAlpha(z)` fades things in out of the haze. Objects blinking into
  existence at full opacity is the single most obvious tell that a runner is
  a treadmill.

### The bend

```ts
p.bend = 200;                 // positive bends right, 0 is dead straight
bendAt(1000, 200);  // 200    — drift of the centre line at that depth
bendAt(3000, 200);  // 1800   — three times the depth, nine times the drift
```

Set `bend` on the projection and the road curves. It is added in world units
*before* the perspective divide, so everything standing on the road — the
causeway, obstacles, coins, scenery — swings together instead of sliding
against each other. Lanes stay exactly one lane wide, and the collision test
never sees it at all: the curve is entirely a matter of where the road AHEAD
is, which is how every runner of this kind does it.

Quadratic, because that is the shape a constant-radius curve makes when you
look down it — barely anything underfoot and the far end swung right out of
frame. Linear drift reads as a road built at an angle rather than one that
bends.

The player is at `z = 0`, so a curve never moves them.

Two things to get right when you drive it, both learned the hard way:

- **Draw the road in segments.** A single trapezoid from here to the horizon
  can only ever be straight. Blob Rush slices it into 26 quads spaced by the
  *square* of the fraction, so most of them land in the near half where the
  curve is legible rather than in the two-pixel band at the horizon.
- **Let it commit.** The first cut changed target every 2600 units and eased
  with a time constant over a second — so at speed it never arrived anywhere
  before setting off somewhere else, and the average came out at a bend of 25
  out of a possible 260. It was a straight road with extra maths. Hold a lean
  for roughly twice as long as it takes to reach it.

Store world positions as **absolute** distance from the start of the run and
subtract the player's depth where you need it. Decrementing every object every
frame is more work and accumulates float error into positions that no longer
agree with the track that generated them.

## Lanes, jumps and slides

```ts
import { LaneRider, RunnerMoves, speedAt } from '@interverse/engine';

const rider = new LaneRider(1);   // three lanes, middle
const moves = new RunnerMoves();

if (swipedLeft) rider.step(-1);   // false if already at the edge
if (swipedUp) moves.jump();
rider.update(dt);
moves.update(dt);
// moves.height, moves.crouch, moves.airborne, moves.sliding
```

`LaneRider` closes the gap at a **constant rate**, not exponentially — an
exponential never quite arrives, and "never quite in the lane" is a hitbox bug
waiting to be filed as "it hit me when I dodged".

`RunnerMoves` is three rules about what a thumb actually does:

- **A swipe just before touchdown is buffered, not dropped.** Players swipe
  early; a runner that ignores an early swipe reads as "it didn't register my
  input", which is the one complaint nobody forgives.
- **A down-swipe in mid-air is a fast fall**, not a refusal. The player asked
  to get low; the game's job is to get them low.
- **Jumping out of a slide is legal at any point.** Being stuck in an
  animation while a wall arrives is not a difficulty, it is a bug.

`speedAt(distance)` ramps toward a cap rather than growing forever. Without a
cap every run ends the same way — at the speed where reaction time runs out —
which makes the last few seconds identical for a beginner and an expert. A cap
lets skill decide the score instead. The defaults are 1020 out of the gate up
to 2600, reached over about 7000 units.

At that pace, **durations must stay durations**. `LANE_SNAP_SECS` and
`JUMP_SECS` are times, not distances, so a dodge takes the same fraction of a
second at 2600 as it did at 1020. Anything measured in distance instead
arrives *after* the obstacle once the run gets going. Jump airtime is
deliberately short for the same reason: a long hang clears the obstacle after
the one you jumped for, which turns a dodge into a coin flip.

## The track

```ts
import { TrackBuilder, collides, survives, HAZARD_RULES } from '@interverse/engine';

const track = new TrackBuilder({ lanes: 3, spacing: 620, density: 0.76 });
const { hazards, pickups } = track.build(playerZ, DRAW_DISTANCE, speed);
```

The generator is the game; everything else is polish on top of "is the next
thing fair, and is it different from the last thing". Three rules enforce it:

- **There is always a way through.** Every row leaves at least one lane
  takeable. A runner that can generate an unwinnable row trains players to
  blame the game, and they are right to.
- **A hazard is never a surprise.** Nothing spawns closer than
  `fairDistance(speed)` — a function of the *current* speed, not a constant.
  At 1500/s a gap that was generous at 620/s is an ambush. This is why the
  game stays fair as it gets faster.
- **The same kind twice is a pattern, three times is a rut.** The picker
  refuses to repeat itself a third time.

Four hazards, each with exactly one answer, in one table that both the
collision test and any tutorial text read from — so they cannot drift apart:

| Hazard | Answer |
| --- | --- |
| `block` | jump it, or go round |
| `barrier` | slide under |
| `pit` | jump — nothing else works |
| `low` | slide; **jumping into an overhang is the mistake it exists to punish** |

## Swipes

```ts
import { Swipe } from '@interverse/engine';

scene.add(new Swipe({ onSwipe: (dir) => act(dir), onTap: () => jump() }));
```

Fires as soon as the drag passes the threshold, **not on release** — waiting
for the finger to lift adds however long the player takes to let go, which at
running speed is the difference between clearing a barrier and eating it. One
swipe per gesture, and the dominant axis wins outright, because nobody swipes
in a straight line. Arrow keys and WASD are bound too, so a runner is playable
at the desk it is being built at.

## Blob Rush

A rotting causeway through a swamp, with the water either side and cypress,
mangrove, dead wood and reeds pushing in at the edges. Four zones — Misty Bog,
Cypress Deep, Sunken Ruins, Blackwater — which are the same swamp at
increasing depths and darkening hours rather than four unrelated biomes.
Somewhere that gets stranger the further in you go is a place; a temple
followed by a glacier is a slideshow.

Zones swap on a corner: swipe the way the arrow points, the world whips round,
and the road comes out leaning that way so the turn has a direction you can
feel. Corners come about every 11000 units, and the road wanders between them,
so you are usually running toward something you cannot fully see.

Getting a corner wrong is the one mistake with no recovery — everything else
is a stumble that costs speed and lets the chase meter tick up, and running
clean pays it back down.

Coins buy hats, which is the whole meta-game: they have no other use, and a
runner whose only progression is a number needs somewhere for that number to
go. The shop preview rolls the entire time you browse it, because the promise
it is making — *whatever you put on this blob stays level while the blob does
not* — is easier to see than to explain.
