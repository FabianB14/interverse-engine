/**
 * 🏃 The run.
 *
 * The player never moves forward. The world moves at them, obstacles' `z`
 * counting down toward zero, and "distance" is just the total of how much
 * world has gone past. That inversion is what makes an endless runner cheap
 * enough to run at 60fps on a phone — there is no level, only a queue.
 *
 * What the engine supplies: the projection, the lanes, the jump/slide state
 * machine, the swipe reader, and the track generator that guarantees every
 * row has a way through. What is left here is the world — spawning bodies,
 * moving them, drawing them, and deciding when you have been caught.
 */

import { Container, Graphics, Text } from 'pixi.js';
import {
  DEFAULT_PROJECTION, DRAW_DISTANCE, HIT_DEPTH, LANE_WIDTH, LaneRider, RunnerMoves, Scene,
  RUN_HEIGHT, Swipe, TrackBuilder, audio, burst, collides, depthIndex,
  fogAlpha, laneX, playerBand, projectPath, rollingBlob, speedAt, visible, yawFor,
} from '@interverse/engine';
import type {
  CornerFrame, Hazard, Pickup, Projection, RollingBlob, SwipeDir,
} from '@interverse/engine';
import {
  HAZARD_UNIT, ROAD_HALF, coinView, drawLaneMark, drawRoad, hazardGlyph, hazardView,
  propView, shadowView, skyOf,
} from '../art.js';
import { hatView } from '../hats.js';
import type { HatView } from '../hats.js';
import { BLOB_COLOR, DIM, GOLD, INK, MINT, ROSE, zone } from '../theme.js';
import type { Zone } from '../theme.js';
import { loadProfile } from '../save.js';

/** Design units per displayed metre. Chosen so a good run is a number with
 *  three digits in it — 20 metres feels like nothing, 2000 feels made up. */
const UNITS_PER_METRE = 12;

/**
 * SECONDS between corners, not units.
 *
 * Corners are the only thing in a runner that changes where you are rather
 * than what is in front of you, so they have to come often enough to be part
 * of the rhythm — far apart, they are a quiz you take twice a run.
 *
 * Measured in time for the same reason the row gap is: the run more than
 * triples in speed, so a fixed distance would mean corners arriving three
 * times as often by the end. The rhythm should be the rhythm throughout.
 */
const TURN_SECS = 11;

/** How close a corner has to be before a sideways swipe means "turn" rather
 *  than "change lane". Generous, and scaled by speed below: missing a corner
 *  because you were early is a worse feeling than any amount of difficulty. */
const TURN_WINDOW = 1500;

/**
 * How hard the road wanders between corners, and how fast it changes its
 * mind.
 *
 * The bend is decoration — lanes are still lanes and the collision test never
 * sees it — but it is the decoration that turns a corridor into a place. It
 * eases rather than snapping, because a road that changes curvature in one
 * frame reads as a glitch, not a bend.
 */
const BEND_MAX = 260;
/**
 * How long the road holds one lean, and how fast it eases into it.
 *
 * These two have to be read together. An early version changed its mind
 * every 2600 UNITS and eased with a time constant of over a second — so at
 * speed it never arrived anywhere before setting off somewhere else, and the
 * average came out at a bend of about 25 out of 260. The road was, in
 * practice, straight.
 *
 * Now it commits, and it commits in SECONDS: a lean is held about three
 * times as long as it takes to reach, at any speed.
 */
const BEND_SECS = 3.4;
const BEND_EASE = 2.4;

/**
 * The road is only allowed to turn a corner once you have committed to it.
 *
 * Before that it is drawn as a right angle you can SEE — the causeway ahead
 * stops and a wall of road runs across it — which is a far better warning
 * than any arrow, because it shows the player the shape of the thing they
 * have to do rather than symbolising it.
 */

/** What one hit costs, and how fast running clean pays it back. Three hits
 *  in quick succession is the end; spaced out, they are survivable. */
const CHASE_PER_HIT = 0.34;
const CHASE_RECOVER = 0.055;

const COIN_VALUE = 1;
const STUMBLE_SECS = 0.5;

/**
 * Everything in the world stores an ABSOLUTE z — its distance from the start
 * of the run — and the player's depth is subtracted only where it is needed.
 *
 * The obvious alternative is to store player-relative depths and decrement
 * them all every frame. That is one subtraction per object per frame instead
 * of one at read time, and after a few minutes of running it has accumulated
 * float error into positions that no longer agree with the track that
 * generated them.
 */
interface LiveHazard {
  data: Hazard;
  view: Container;
}

interface LiveCoin {
  data: Pickup;
  view: Container;
  taken: boolean;
}

interface Prop {
  z: number;
  side: number;
  view: Container;
}

export interface RunResult {
  metres: number;
  coins: number;
  zone: string;
  cause: 'hit' | 'pit' | 'corner';
}

export class RunScene extends Scene {
  private world = new Container();
  private hudLayer = new Container();
  private roadG = new Graphics();
  private laneMarkG = new Graphics();
  private sky!: Graphics;
  private proj: Projection = { ...DEFAULT_PROJECTION };

  private readonly rider = new LaneRider(1);
  private readonly moves = new RunnerMoves();
  // Spacing is left to the engine's speed-driven default: a fixed gap is a
  // shrinking gap in time as the run accelerates. Density is a touch below
  // the default so more rows come through empty — the beat between obstacles
  // is what makes the next one land.
  private builder = new TrackBuilder({ density: 0.68 });
  private blob!: RollingBlob;
  private blobShadow = shadowView();
  private hatOn: HatView | null = null;

  private hazards: LiveHazard[] = [];
  private coins: LiveCoin[] = [];
  private props: Prop[] = [];
  private propFrontier = 0;

  private distance = 0;
  private purse = 0;
  private speed = 0;
  private chase = 0;
  private stumble = 0;
  private zoneN = 0;
  private turnZ = 0;
  private turnDir = 1;
  private turned = false;
  private turnSign = new Container();
  private turnSignKey = '';
  /**
   * The live corner, or null on a straight stretch.
   *
   * `ahead` is how far the corner is; the camera's yaw is derived from it, so
   * the two can never disagree. When `ahead` reaches zero the yaw is exactly
   * a right angle, and a fresh straight frame produces identical output —
   * which is why the scene can drop this on that frame with nothing moving.
   */
  private corner: CornerFrame | null = null;
  /** Where the road is bending right now, and where it is heading. */
  private bend = 0;
  private bendTarget = 0;
  private bendNext = 0;
  private over = false;
  private swipe!: Swipe;
  /**
   * Test-only: keep the run alive through stumbles and pits.
   *
   * A headless playtest drives the blob straight down the middle without
   * dodging anything, and at full pace that is dead in a few seconds.
   * The mechanics it wants to check — lanes, jumps, corners, the bend — all
   * take longer than that to exercise. Corner misses still end the run,
   * because that is one of the things being checked.
   */
  private safe = false;

  private metresText!: Text;
  private coinsText!: Text;
  private chaseBar!: Graphics;
  private banners: { t: Text; life: number }[] = [];
  /** Screen shake, decayed each frame. */
  private shake = 0;

  constructor(private readonly onDone: (r: RunResult) => void) {
    super();
  }

  private get zone(): Zone {
    return zone(this.zoneN);
  }

  /**
   * How far out a corner starts accepting the swipe.
   *
   * Scaled by speed for the same reason hazards are: a window measured in
   * distance shrinks in TIME as the run gets faster, so a corner that was
   * comfortable at the start becomes a reflex test at the end — for no
   * reason anyone chose.
   */
  private get turnWindow(): number {
    return Math.max(TURN_WINDOW, this.speed * 1.6);
  }

  protected override onEnter(): void {
    this.layoutProjection();
    this.sky = skyOf(this.zone, this.game.viewWidth, this.proj.horizonY);
    this.stage.addChild(this.sky);
    this.world.sortableChildren = true;
    this.roadG.zIndex = -1e6;
    // Just above the road, below everything standing on it.
    this.laneMarkG.zIndex = -9e5;
    this.world.addChild(this.roadG, this.laneMarkG);
    this.stage.addChild(this.world);

    const profile = loadProfile();
    this.blob = rollingBlob({ radius: 1, color: BLOB_COLOR, seed: 4, spots: 6 });
    this.wearHat(profile.wearing);
    this.blobShadow.zIndex = 1;
    this.blob.view.zIndex = 2;
    this.world.addChild(this.turnSign, this.blobShadow, this.blob.view);

    this.speed = speedAt(0);
    // The first corner and the first lean, in the units the opening speed
    // makes of them.
    this.turnZ = this.speed * TURN_SECS;
    this.bendNext = this.speed * BEND_SECS;
    // Start already leaning. A run that opens on a dead-straight corridor
    // and only starts bending half a minute in has told the player, in the
    // most memorable moment it gets, that the road is straight.
    this.bend = (Math.random() < 0.5 ? -1 : 1) * BEND_MAX * 0.5;
    this.bendTarget = -this.bend * 0.7;
    this.fillTrack();

    this.stage.addChild(this.hudLayer);
    this.buildHud();
    this.swipe = new Swipe({
      onSwipe: (d) => this.input(d),
      // A tap is a jump. On a phone the most common panic input is a poke,
      // and the most common right answer is to get off the ground.
      onTap: () => this.input('up'),
      width: this.game.viewWidth * 2,
      height: this.game.viewHeight * 2,
    });
    this.swipe.position.set(this.game.viewWidth / 2, this.game.viewHeight / 2);
    this.add(this.swipe);
    audio.music.play('battle');
  }

  protected override onExit(): void {
    this.swipe?.dispose();
    audio.music.stop();
  }

  protected override onResize(): void {
    this.layoutProjection();
    this.sky?.destroy();
    this.sky = skyOf(this.zone, this.game.viewWidth, this.proj.horizonY);
    this.stage.addChildAt(this.sky, 0);
    this.hudLayer.removeChildren();
    this.buildHud();
  }

  /** The road is anchored to the actual viewport, so it fills a tall phone
   *  and a wide desktop window without either letterboxing or clipping. */
  private layoutProjection(): void {
    const w = this.game.viewWidth;
    const h = this.game.viewHeight;
    this.proj = {
      cx: w / 2,
      horizonY: h * 0.34,
      // Not the very bottom: the player's own blob has to sit fully on
      // screen with room for its shadow, or you cannot see the thing you
      // are aiming.
      groundY: h * 0.86,
      // A wider screen shows more road for the same focal length, so this
      // keeps the sense of speed constant across devices.
      focal: 900 * (w / 1280),
    };
  }

  // ------------------------------------------------------------------ hat

  private wearHat(id: string): void {
    if (this.hatOn) {
      this.blob.rider.removeChild(this.hatOn.view);
      this.hatOn.view.destroy({ children: true });
    }
    const h = hatView(id, 1, BLOB_COLOR);
    // On the RIDER, never the wheel: the body turns a full rotation every
    // 2πr of road, and the hat has to sit level through every one of them.
    this.blob.rider.addChild(h.view);
    this.hatOn = h;
  }

  // ------------------------------------------------------------------ HUD

  private buildHud(): void {
    const W = this.game.viewWidth;
    this.metresText = label('0 m', 34, INK, '800');
    this.metresText.position.set(18, 14);
    this.coinsText = label('🪙 0', 24, GOLD, '800');
    this.coinsText.position.set(18, 56);
    const zoneName = label(this.zone.name, 20, DIM);
    zoneName.anchor.set(1, 0);
    zoneName.position.set(W - 18, 16);
    this.chaseBar = new Graphics();
    this.hudLayer.addChild(this.metresText, this.coinsText, zoneName, this.chaseBar);
    this.refreshHud();
  }

  private refreshHud(): void {
    this.metresText.text = `${Math.floor(this.distance / UNITS_PER_METRE)} m`;
    this.coinsText.text = `🪙 ${this.purse}`;
    // How close the thing behind you is. Drawn as a bar rather than a number
    // because the player needs to read it without looking away from the road.
    const W = this.game.viewWidth;
    const w = Math.min(320, W * 0.3);
    const x = W / 2 - w / 2;
    this.chaseBar.clear();
    this.chaseBar.roundRect(x, 18, w, 14, 7).fill({ color: 0x000000, alpha: 0.35 });
    const t = Math.min(1, this.chase);
    if (t > 0.02) {
      this.chaseBar
        .roundRect(x, 18, w * t, 14, 7)
        .fill(t > 0.66 ? ROSE : t > 0.33 ? GOLD : MINT);
    }
  }

  // ---------------------------------------------------------------- input

  private input(dir: SwipeDir): void {
    if (this.over) return;
    if (dir === 'up') {
      this.moves.jump();
      audio.blip(1.3);
      return;
    }
    if (dir === 'down') {
      this.moves.slide();
      audio.blip(0.7);
      return;
    }
    // At a corner, sideways means TURN — the same gesture, reinterpreted,
    // which is what makes a corner feel like part of the same vocabulary
    // instead of a special move nobody remembers under pressure.
    if (!this.turned && this.turnZ < this.turnWindow) {
      if ((dir === 'left' ? -1 : 1) === this.turnDir) this.takeCorner();
      else this.end('corner');
      return;
    }
    if (this.rider.step(dir === 'left' ? -1 : 1)) audio.blip(1.1);
  }

  // --------------------------------------------------------------- update

  protected override onUpdate(dt: number): void {
    if (this.over) return;
    this.speed = speedAt(this.distance);
    const stumbling = this.stumble > 0;
    if (stumbling) this.stumble = Math.max(0, this.stumble - dt);
    // A stumble does not stop the world, it slows it — being frozen while a
    // wall arrives is a punishment the player cannot act on.
    const moved = this.speed * (stumbling ? 0.45 : 1) * dt;
    this.distance += moved;

    this.rider.update(dt);
    this.moves.update(dt);
    this.tickBend(dt);
    this.chase = Math.max(0, this.chase - CHASE_RECOVER * dt);
    this.shake = Math.max(0, this.shake - dt * 4);

    this.cull();
    this.fillTrack();
    this.tickTurn(moved);
    this.checkHits();
    this.drawWorld(moved);
    this.tickBanners(dt);
    this.refreshHud();
    if (this.chase >= 1) this.end('hit');
  }

  /** How far ahead of the player something is, right now. */
  private rel(z: number): number {
    return z - this.distance;
  }

  /**
   * The road wanders.
   *
   * A new target every so often, eased toward rather than snapped to. The
   * ease is what sells it: the curvature itself changing gradually is the
   * difference between a bending road and a kinked one.
   */
  private tickBend(dt: number): void {
    if (this.distance >= this.bendNext) {
      this.bendNext = this.distance + this.speed * BEND_SECS * (0.6 + Math.random() * 0.8);
      // Biased away from wherever it currently is, so the road actually
      // swings both ways instead of drifting to one side and staying there.
      const away = this.bend > 0 ? -1 : 1;
      const sign = Math.random() < 0.72 ? away : -away;
      this.bendTarget = sign * BEND_MAX * (0.35 + Math.random() * 0.65);
    }
    this.bend += (this.bendTarget - this.bend) * Math.min(1, BEND_EASE * dt);
  }

  /** Behind the camera is gone. A runner that keeps what it has passed is a
   *  runner that gets slower the longer you survive. */
  private cull(): void {
    this.hazards = this.hazards.filter((h) => this.keep(h.data.z, h.view));
    this.coins = this.coins.filter((c) => this.keep(c.data.z, c.view));
    this.props = this.props.filter((p) => this.keep(p.z, p.view));
  }

  private keep(z: number, view: Container): boolean {
    if (this.rel(z) > -220) return true;
    this.destroyView(view);
    return false;
  }

  private fillTrack(): void {
    const { hazards, pickups } = this.builder.build(this.distance, DRAW_DISTANCE, this.speed);
    for (const h of hazards) this.addHazard(h);
    for (const p of pickups) this.addCoin(p);
    this.fillProps();
  }

  private addHazard(data: Hazard): void {
    const view = hazardView(data.kind, this.zone);
    this.world.addChild(view);
    this.hazards.push({ data, view });
  }

  private addCoin(data: Pickup): void {
    const view = coinView();
    this.world.addChild(view);
    this.coins.push({ data, view, taken: false });
  }

  /** Roadside scenery. Not gameplay, entirely feel: without something
   *  passing at the edges, speed is invisible on a straight road. */
  private fillProps(): void {
    while (this.propFrontier < this.distance + DRAW_DISTANCE) {
      this.propFrontier += 420;
      for (const side of [-1, 1]) {
        const view = propView(this.zone);
        this.world.addChild(view);
        this.props.push({ z: this.propFrontier, side, view });
      }
    }
  }

  /**
   * The corner, every frame.
   *
   * The frame exists whether or not you have committed, so the road ahead is
   * always drawn as the right angle it is. The YAW is what waits for the
   * swipe — the camera does not start coming round until you have said you
   * are taking it.
   */
  private tickTurn(moved: number): void {
    this.turnZ -= moved;
    if (this.turnZ > DRAW_DISTANCE) {
      this.corner = null;
      return;
    }
    this.corner = {
      ahead: this.turnZ,
      dir: this.turnDir,
      yaw: this.turned ? yawFor(this.turnZ, this.turnDir) : 0,
    };
    if (this.turned) {
      // The camera has come all the way round: the turned frame and a plain
      // straight one now produce identical output, so this swap moves
      // nothing.
      if (this.turnZ <= 0) this.passCorner();
      return;
    }
    // Ran into the end of the road. A wall is the one thing in this game
    // that ends a run outright.
    if (this.turnZ < -HIT_DEPTH) this.end('corner');
  }

  /** Committing to the corner. All this does is unlock the camera — the
   *  world is not rebuilt until you have actually got round it. */
  private takeCorner(): void {
    this.turned = true;
    this.purse += 25;
    audio.chime();
    this.banner('TURN!', 0.8);
  }

  /** Round the corner and into somewhere new. */
  private passCorner(): void {
    this.corner = null;
    this.turned = false;
    this.zoneN++;
    this.shake = 0.35;
    // Out of the turn already leaning the way you went, so the corner has a
    // direction you can feel and not just a change of scenery.
    this.bend = this.turnDir * BEND_MAX * 1.1;
    this.bendTarget = this.turnDir * BEND_MAX * 0.35;
    this.bendNext = this.distance + this.speed * BEND_SECS;
    this.turnZ = this.speed * TURN_SECS;
    this.turnDir = Math.random() < 0.5 ? -1 : 1;
    this.banner(`${this.zone.name.toUpperCase()}!`, 1.6);
    this.add(burst('confetti', this.proj.cx, this.proj.groundY - 120), this.hudLayer);

    // A corner is the one moment in an endless runner where everything is
    // allowed to change at once — so the whole world is restyled for the new
    // zone. Positions are untouched: only the colours cut, on exactly the
    // frame the banner says where you are.
    this.restyleWorld();
    this.sky.destroy();
    this.sky = skyOf(this.zone, this.game.viewWidth, this.proj.horizonY);
    this.stage.addChildAt(this.sky, 0);
    this.hudLayer.removeChildren();
    this.buildHud();
  }

  /** Swap every view for one in the current zone's colours, keeping the data
   *  — and therefore every position — exactly as it was. */
  private restyleWorld(): void {
    for (const h of this.hazards) {
      this.destroyView(h.view);
      h.view = hazardView(h.data.kind, this.zone);
      this.world.addChild(h.view);
    }
    for (const p of this.props) {
      this.destroyView(p.view);
      p.view = propView(this.zone);
      this.world.addChild(p.view);
    }
  }

  private destroyView(view: Container): void {
    this.world.removeChild(view);
    view.destroy({ children: true });
  }

  private checkHits(): void {
    for (const c of this.coins) {
      if (c.taken || Math.abs(this.rel(c.data.z)) > HIT_DEPTH) continue;
      if (Math.round(this.rider.lane) !== c.data.lane) continue;
      // A jump should not cost you the coins under you — the arc is low
      // enough that "over it" and "through it" are the same intent.
      c.taken = true;
      c.view.visible = false;
      this.purse += COIN_VALUE;
      audio.pop(1.4);
    }
    if (this.stumble > 0) return;
    for (const h of this.hazards) {
      const near = this.rel(h.data.z);
      if (Math.abs(near) > HIT_DEPTH) continue;
      // The real vertical extent of the blob, against the real vertical
      // extent of the obstacle. Not a pair of booleans about what state the
      // player is in — this is the same band the art is drawn from, so what
      // you can see is exactly what you can hit.
      const me = playerBand(this.moves.height, this.moves.crouch);
      if (!collides(this.rider.lane, { ...h.data, z: near }, me)) continue;
      this.hit(h.data);
      return;
    }
  }

  private hit(h: Hazard): void {
    // A pit is not a stumble. There is no version of falling in a hole that
    // you run out of, so it ends the run and says so.
    if (h.kind === 'pit' && !this.safe) {
      this.end('pit');
      return;
    }
    this.stumble = STUMBLE_SECS;
    if (!this.safe) this.chase = Math.min(1, this.chase + CHASE_PER_HIT);
    this.shake = 1;
    audio.buzz();
    this.add(burst('poof', this.proj.cx, this.proj.groundY - 140), this.hudLayer);
    // Say what would have worked. "OOF" tells the player they failed; the
    // glyph tells them how not to, which is the only part they can use.
    this.banner(this.chase > 0.66 ? 'LAST CHANCE!' : `${hazardGlyph(h.kind)} OOF!`, 1);
  }

  // -------------------------------------------------------------- drawing

  private drawWorld(moved: number): void {
    // The bend goes on the projection, so it is applied once and everything
    // that stands on the road — causeway, obstacles, coins, scenery — swings
    // together. Nothing else in the scene needs to know about it.
    this.proj.bend = this.bend;
    const p = this.proj;
    const far = DRAW_DISTANCE;
    drawRoad(
      this.roadG, this.zone, this.distance, p, this.corner,
      this.game.viewWidth, this.game.viewHeight, far,
    );
    this.drawLaneMarks(far);

    // Shake moves the whole world rather than the camera maths — the road is
    // redrawn from the projection every frame, so shifting that would fight
    // with the geometry. The TURN is not done this way: it is a real yaw
    // inside the projection, which is why the road bends round it instead of
    // the picture sliding sideways.
    const s = this.shake * this.shake * 9;
    this.world.position.set(
      s ? (Math.random() - 0.5) * s : 0,
      s ? (Math.random() - 0.5) * s : 0,
    );

    for (const h of this.hazards) {
      this.placeAt(h.view, laneX(h.data.lane), this.rel(h.data.z), 0, HAZARD_UNIT, far);
    }
    for (const c of this.coins) {
      if (c.taken) continue;
      this.placeAt(c.view, laneX(c.data.lane), this.rel(c.data.z), 110, LANE_WIDTH * 0.82, far);
      // Flip on the spot, so a line of coins shimmers instead of sitting
      // there. Scaling x is cheaper than rotating and reads better at the
      // size a coin actually appears.
      c.view.scale.x = c.view.scale.y * Math.cos(this.distance * 0.008 + c.data.z * 0.01);
    }
    for (const pr of this.props) {
      this.placeAt(pr.view, pr.side * (ROAD_HALF + 190), this.rel(pr.z), 0, LANE_WIDTH * 1.1, far);
    }

    this.drawBlob(moved, far);
    this.drawTurnSign(far);
  }

  /**
   * Paint every blocked lane on the boards.
   *
   * An obstacle is a handful of pixels tall when it first appears, but a
   * stripe lying flat on the road keeps its full width all the way out — so
   * THIS, not the object, is what tells you which lane to leave while there
   * is still time to leave it. Coloured by the answer: amber means get over
   * it, cyan means get under it.
   */
  private drawLaneMarks(far: number): void {
    this.laneMarkG.clear();
    const half = LANE_WIDTH * 0.42;
    for (const h of this.hazards) {
      const z = this.rel(h.data.z);
      if (z < -40 || z > far * 0.8) continue;
      // Fade it out as it arrives. Its whole job is long-range warning; by
      // the time it is underfoot the obstacle itself is the signal, and a
      // bright patch on the boards right in front of you just reads as ice.
      const a = fogAlpha(z, far) * Math.min(1, Math.max(0, z / 700));
      if (a <= 0.02) continue;
      const x = laneX(h.data.lane);
      // A long flat patch reaching back toward the player, so it is visible
      // as a lane and not as a line.
      const z0 = Math.max(0, z - 260);
      const z1 = z + 90;
      drawLaneMark(this.laneMarkG, h.data.kind, [
        projectPath(x - half, z0, 0, this.proj, this.corner),
        projectPath(x + half, z0, 0, this.proj, this.corner),
        projectPath(x + half, z1, 0, this.proj, this.corner),
        projectPath(x - half, z1, 0, this.proj, this.corner),
      ], a);
    }
  }

  /** Project a unit-sized view onto the road. */
  private placeAt(view: Container, x: number, z: number, height: number, unit: number, far: number): void {
    if (!visible(z, far)) {
      view.visible = false;
      return;
    }
    const q = projectPath(x, Math.max(0, z), height, this.proj, this.corner);
    // Past a corner the path runs sideways, so a point can end up beside or
    // behind the camera even though its depth ALONG THE PATH is positive.
    // Those must not be drawn, or they smear across the screen at scale 1.
    if (q.scale <= 0.02 || q.scale > 6) {
      view.visible = false;
      return;
    }
    view.visible = true;
    view.position.set(q.x, q.y);
    view.scale.set(unit * q.scale);
    view.alpha = fogAlpha(z, far);
    view.zIndex = depthIndex(z);
  }

  private drawBlob(moved: number, far: number): void {
    // Rolling driven by ground distance, not by a spin rate: this is what
    // makes speeding up, stumbling and stopping all look right for free.
    this.blob.roll(moved / 46);
    const radius = 46;
    const q = projectPath(this.rider.x, 0, this.moves.height, this.proj, this.corner);
    // The squash IS the hitbox. Derived from the same two constants the
    // collision uses, so a blob that looks low enough to fit is low enough
    // to fit — an eyeballed squash factor is how the two quietly diverge.
    const me = playerBand(this.moves.height, this.moves.crouch);
    const squash = (me.high - me.low) / RUN_HEIGHT;
    // Anchored to the road, not to the blob's centre: scaling about the
    // centre lifts a flattened blob off the ground, so a slide reads as
    // hovering rather than as getting low.
    this.blob.view.position.set(q.x, q.y - radius * q.scale * squash);
    this.blob.view.scale.set(radius * q.scale * (1 + this.moves.crouch * 0.3), radius * q.scale * squash);
    // The hat leans with the lane change rather than staying rigid — a small
    // lie that makes a level hat look worn rather than glued.
    const lean = (this.rider.targetX - this.rider.x) / LANE_WIDTH;
    this.blob.rider.rotation = lean * 0.35;
    if (this.hatOn?.spin) this.hatOn.spin.rotation += moved * 0.004;

    // The shadow stays on the road while the blob leaves it, which is the
    // only cue that says how high you actually are.
    const ground = projectPath(this.rider.x, 0, 0, this.proj, this.corner);
    this.blobShadow.position.set(ground.x, ground.y);
    const shrink = 1 - Math.min(0.45, this.moves.height / 420);
    this.blobShadow.scale.set(radius * ground.scale * shrink);
    this.blobShadow.alpha = 0.34 * shrink;
    void far;
  }

  /**
   * The corner sign.
   *
   * Small now, and deliberately. The road itself turns the right angle in
   * plain view, which is the real warning — an arrow that competes with it
   * for attention is an arrow that makes the road harder to read. All this
   * has to add is WHICH WAY, and it goes green when a swipe would take it.
   */
  private drawTurnSign(far: number): void {
    if (this.turned || !visible(this.turnZ, far)) {
      this.turnSign.visible = false;
      return;
    }
    const armed = this.turnZ < this.turnWindow;
    // Redrawn only when the arrow actually changes — direction and armed
    // state are the only two things about it that ever do.
    const key = `${this.turnDir}:${armed}`;
    if (key !== this.turnSignKey) {
      this.turnSignKey = key;
      this.turnSign.removeChildren();
      const d = this.turnDir;
      this.turnSign.addChild(
        new Graphics()
          .poly([
            d * 0.9, 0, d * 0.2, -0.55, d * 0.2, -0.22,
            -d * 0.9, -0.22, -d * 0.9, 0.22, d * 0.2, 0.22, d * 0.2, 0.55,
          ])
          .fill(armed ? MINT : GOLD),
      );
    }
    const q = projectPath(0, Math.max(0, this.turnZ), 330, this.proj, this.corner);
    this.turnSign.visible = true;
    this.turnSign.position.set(q.x, q.y);
    this.turnSign.scale.set(LANE_WIDTH * 0.55 * q.scale);
    this.turnSign.alpha = fogAlpha(this.turnZ, far);
    this.turnSign.zIndex = depthIndex(this.turnZ) + 0.5;
  }

  // ------------------------------------------------------------- feedback

  private banner(text: string, secs: number): void {
    const t = label(text, 40, GOLD, '800');
    t.anchor.set(0.5);
    this.hudLayer.addChild(t);
    this.banners.push({ t, life: secs });
    // Stack rather than overlap. A corner and a stumble can land in the same
    // second, and two messages printed on top of each other are worse than
    // either of them alone.
    this.banners.forEach((b, i) => {
      b.t.position.set(this.game.viewWidth / 2, this.game.viewHeight * 0.3 + i * 46);
    });
  }

  private tickBanners(dt: number): void {
    for (let i = this.banners.length - 1; i >= 0; i--) {
      const b = this.banners[i]!;
      b.life -= dt;
      b.t.alpha = Math.max(0, Math.min(1, b.life * 3));
      if (b.life <= 0) {
        b.t.destroy();
        this.banners.splice(i, 1);
      }
    }
  }

  private end(cause: RunResult['cause']): void {
    if (this.over) return;
    this.over = true;
    audio.buzz();
    this.onDone({
      metres: Math.floor(this.distance / UNITS_PER_METRE),
      coins: this.purse,
      zone: this.zone.name,
      cause,
    });
  }

  // ------------------------------------------------- headless test hooks

  debugState(): {
    metres: number; coins: number; lane: number; airborne: boolean; sliding: boolean;
    hazards: number; chase: number; turnZ: number; zone: string; speed: number; over: boolean;
    spin: number; bend: number; yaw: number; turning: boolean;
  } {
    return {
      bend: Math.round(this.bend),
      yaw: Math.round((this.corner?.yaw ?? 0) * 1000) / 1000,
      turning: this.turned,
      metres: Math.floor(this.distance / UNITS_PER_METRE),
      coins: this.purse,
      lane: this.rider.lane,
      airborne: this.moves.airborne,
      sliding: this.moves.sliding,
      hazards: this.hazards.length,
      chase: Math.round(this.chase * 100) / 100,
      turnZ: Math.round(this.turnZ),
      zone: this.zone.name,
      speed: Math.round(this.speed),
      over: this.over,
      spin: Math.round(this.blob.spin * 100) / 100,
    };
  }

  debugSwipe(dir: SwipeDir): void {
    this.input(dir);
  }

  /** Survive stumbles and pits, so a test can reach the mechanics that take
   *  longer than four seconds to get to. Corner misses still end the run. */
  debugSafe(on: boolean): void {
    this.safe = on;
    if (on) this.chase = 0;
  }

  /** Put the next corner right in front of the player, so a test does not
   *  have to run eleven thousand units to reach one. */
  debugCorner(): number {
    this.turnZ = Math.min(this.turnZ, this.turnWindow - 200);
    return this.turnDir;
  }

  /**
   * The numbers that prove cosmetics do not spin with the blob.
   *
   * `wheel` is the body's rotation and runs all the way round; `hat` and
   * `lean` are the cosmetic's own tilt and the rider's, and together they
   * are the hat's actual angle on screen — which must stay near level no
   * matter what the wheel is doing.
   */
  debugHat(): { hat: number; lean: number; wheel: number; children: number } {
    const r = (n: number): number => Math.round(n * 1000) / 1000;
    return {
      hat: r(this.hatOn?.view.rotation ?? 0),
      lean: r(this.blob.rider.rotation),
      wheel: r(this.blob.wheel.rotation),
      children: this.hatOn?.view.children.length ?? 0,
    };
  }
}

function label(text: string, size: number, fill: number, weight: '700' | '800' = '700'): Text {
  return new Text({
    text,
    style: { fontFamily: 'system-ui, sans-serif', fontSize: size, fontWeight: weight, fill },
  });
}
