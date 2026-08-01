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
  can only ever be straight. Blob Rush slices it into 40 quads spaced by the
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

### Corners

A bend sways the road while you keep facing the same way. A **corner** is the
other thing: the path stops going where it was going, heads off at a right
angle, and the camera swings round to follow it.

```ts
const frame = { ahead: distanceToCorner, dir: +1, yaw: yawFor(distanceToCorner, +1) };
projectPath(lateral, depth, height, p, frame);
```

One piecewise map does all of it:

| depth | where it goes |
| --- | --- |
| before the corner | straight ahead, as usual |
| after the corner | sideways, starting from the corner's depth |

So the road ahead visibly **ends** and a run of road crosses it left-to-right.
That is what a right angle looks like from a hundred metres back, and it is a
far better warning than an arrow: it shows the player the shape of the thing
they have to do instead of symbolising it. Blob Rush still draws a small arrow
for *which way*, but it is deliberately quiet now — the road is the signal.

Then `yaw` rotates the world about the camera — a real rotation, not a pan.

**The identity that makes it seamless.** The yaw completing and the player
reaching the corner coincide exactly, so at that instant the turned frame and
a fresh straight frame produce identical output. Drop the corner on that frame
and nothing moves — no blend, no seam. There is a test for this in both
directions, and it is the load-bearing property of the whole design.

**Keep `TURN_ARC` short.** All of the yaw happens while the runner is still on
the old road, and a camera that has turned 45° while its owner is running
straight puts the ground under them at 45° too. That is correct for a head
turning and wrong for a runner turning, and you can see it as the boards
underfoot tilting. Under about a quarter-second of running confines it to a
stub right under the player while the new road swings in to fill the frame —
which is what a snap-turn at a junction actually looks like. A long luxurious
swing shows the seam.

Draw the road in **segments** (Blob Rush uses 40) or it cannot turn: a single
trapezoid to the horizon is always straight.

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
lets skill decide the score instead. The defaults open at **700** and reach
**2400**, over a ramp of 22000 units: halfway takes about 15000, so getting
fast is something a run *earns* rather than something that happens to it in
the first few seconds.

## Everything that paces a runner is a duration

This is the single rule that keeps a runner playable across a 3× speed range,
and it is easy to violate one constant at a time:

| Measured in | Why |
| --- | --- |
| `LANE_SNAP_SECS` | seconds | a dodge measured in *distance* arrives after the obstacle once you are quick |
| `JUMP_SECS` | seconds | ditto — and short, or a long hang clears the obstacle *after* the one you jumped for |
| `fairDistance` | seconds × speed | nothing spawns closer than you can see and act |
| `rowGap` | mostly speed | see below |
| corner interval | seconds × speed | otherwise corners arrive 3× as often by the end |
| bend hold | seconds × speed | otherwise the road stops committing to a lean |

Anything left as a bare distance silently rescales itself as the run speeds
up, and always in the direction of *harder*, for no reason anyone chose.

`rowGap(speed)` is the interesting one, because it deliberately does **not**
fully keep up:

```ts
rowGap(speed) === ROW_GAP_BASE + speed * ROW_GAP_PER_SPEED;  // 420 + 0.5·v
```

The gap grows with speed but by less than speed does, so the *time* between
obstacles still shortens — 1.10s at the opening pace, 0.68s at the cap. That
one line is the whole difficulty curve: the game does get harder, just
deliberately, and slowly enough that it never stops being readable. A constant
gap gives you the same curve by accident and far more steeply.

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

| Hazard | In Blob Rush | Answer |
| --- | --- | --- |
| `block` | a fallen log across the boards | jump it, or go round |
| `barrier` | a branch caught on two stumps at chest height | slide under |
| `pit` | boards rotted through into the water | jump — nothing else works |
| `low` | a curtain of hanging vines | slide; **jumping into an overhang is the mistake it exists to punish** |

### Making a hazard obvious

Three signals, at three ranges, and they must not compete:

1. **A stain on the boards in the blocked lane** — long range. The object is a
   few pixels tall when it appears, but a stripe lying flat on the road keeps
   its full width all the way out, so this is what tells you which lane to
   leave while there is still time to leave it. Keep it faint.
2. **The silhouette** — mid range. Things you go OVER sit solidly on the road;
   things you go UNDER touch the ground *nowhere*. This does the real work.
3. **The action colour** — everywhere. Amber means get over it, cyan means get
   under it, on every hazard without exception. At speed, in a swamp where
   everything is a shade of wet green, the player is not identifying a log
   versus a branch — they are reading a colour, and they can do that from the
   far end of the draw distance.

Two mistakes worth not repeating, both found by looking rather than by
assertion. Chevrons above each hazard started as two big ones apiece; with
four hazards on screen the swamp disappeared behind a wall of arrows — **the
warning has to be quieter than the thing it is warning about.** And the
hazard art was scaled so a single obstacle was *wider than its own lane*,
which made one blocked lane look like a wall and read as unfair. Author
hazards to fit inside `LANE_WIDTH` with room to spare.

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

Zones swap on a corner: the causeway ahead ends and another crosses it, you
swipe the way it goes, the camera swings a full right angle to follow, and the
road comes out leaning that way so the turn has a direction you can feel.
Corners come about every eleven seconds and the road wanders between them, so
you are usually running toward something you cannot fully see.

Getting a corner wrong is the one mistake with no recovery — everything else
is a stumble that costs speed and lets the chase meter tick up, and running
clean pays it back down.

Coins buy hats, which is the whole meta-game: they have no other use, and a
runner whose only progression is a number needs somewhere for that number to
go. The shop preview rolls the entire time you browse it, because the promise
it is making — *whatever you put on this blob stays level while the blob does
not* — is easier to see than to explain.
