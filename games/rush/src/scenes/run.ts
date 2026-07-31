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
  Swipe, TrackBuilder, audio, burst, collides, depthIndex, fogAlpha, laneX, project,
  rollingBlob, speedAt, visible,
} from '@interverse/engine';
import type { Hazard, Pickup, Projection, RollingBlob, SwipeDir } from '@interverse/engine';
import { ROAD_HALF, coinView, drawRoad, hazardView, propView, shadowView, skyOf } from '../art.js';
import { hatView } from '../hats.js';
import type { HatView } from '../hats.js';
import { BLOB_COLOR, DIM, GOLD, INK, MINT, ROSE, zone } from '../theme.js';
import type { Zone } from '../theme.js';
import { loadProfile } from '../save.js';

/** Design units per displayed metre. Chosen so a good run is a number with
 *  three digits in it — 20 metres feels like nothing, 2000 feels made up. */
const UNITS_PER_METRE = 12;

/** Distance between corners. Far enough apart that a turn is an event. */
const TURN_EVERY = 14_000;

/** How close a corner has to be before a sideways swipe means "turn" rather
 *  than "change lane". Generous: missing a corner because you were early is
 *  a worse feeling than any amount of difficulty. */
const TURN_WINDOW = 1500;

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
  private sky!: Graphics;
  private proj: Projection = { ...DEFAULT_PROJECTION };

  private readonly rider = new LaneRider(1);
  private readonly moves = new RunnerMoves();
  private builder = new TrackBuilder({ spacing: 620, density: 0.76 });
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
  private turnZ = TURN_EVERY;
  private turnDir = 1;
  private turned = false;
  private turnSign = new Container();
  private turnSignKey = '';
  private over = false;
  private swipe!: Swipe;

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

  protected override onEnter(): void {
    this.layoutProjection();
    this.sky = skyOf(this.zone, this.game.viewWidth, this.proj.horizonY);
    this.stage.addChild(this.sky);
    this.world.sortableChildren = true;
    this.roadG.zIndex = -1e6;
    this.world.addChild(this.roadG);
    this.stage.addChild(this.world);

    const profile = loadProfile();
    this.blob = rollingBlob({ radius: 1, color: BLOB_COLOR, seed: 4, spots: 6 });
    this.wearHat(profile.wearing);
    this.blobShadow.zIndex = 1;
    this.blob.view.zIndex = 2;
    this.world.addChild(this.turnSign, this.blobShadow, this.blob.view);

    this.speed = speedAt(0);
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
    if (!this.turned && this.turnZ < TURN_WINDOW) {
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

  private tickTurn(moved: number): void {
    this.turnZ -= moved;
    if (this.turned) return;
    // Ran past the corner without turning: that is a wall, and a wall is the
    // one thing in this game that ends a run outright.
    if (this.turnZ < -HIT_DEPTH) this.end('corner');
  }

  private takeCorner(): void {
    this.turned = true;
    this.zoneN++;
    this.purse += 25;
    this.shake = 0.6;
    this.banner(`${this.zone.name.toUpperCase()}!`, 1.6);
    audio.chime();
    this.add(burst('confetti', this.proj.cx, this.proj.groundY - 120), this.hudLayer);

    // Rebuild the world for the new zone. A corner is a hard cut, which is
    // exactly why it is worth having: it is the only moment in an endless
    // runner where everything is allowed to change at once.
    for (const h of this.hazards) this.destroyView(h.view);
    for (const c of this.coins) this.destroyView(c.view);
    for (const p of this.props) this.destroyView(p.view);
    this.hazards = [];
    this.coins = [];
    this.props = [];
    this.propFrontier = 0;
    this.builder = new TrackBuilder({ spacing: 620, density: 0.76 });
    this.rider.snapTo(1);
    this.sky.destroy();
    this.sky = skyOf(this.zone, this.game.viewWidth, this.proj.horizonY);
    this.stage.addChildAt(this.sky, 0);
    this.hudLayer.removeChildren();
    this.buildHud();
    this.turnZ = TURN_EVERY;
    this.turnDir = Math.random() < 0.5 ? -1 : 1;
    this.turned = false;
    this.fillTrack();
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
      if (!collides(this.rider.lane, { ...h.data, z: near }, this.moves.airborne, this.moves.sliding)) {
        continue;
      }
      this.hit(h.data);
      return;
    }
  }

  private hit(h: Hazard): void {
    // A pit is not a stumble. There is no version of falling in a hole that
    // you run out of, so it ends the run and says so.
    if (h.kind === 'pit') {
      this.end('pit');
      return;
    }
    this.stumble = STUMBLE_SECS;
    this.chase = Math.min(1, this.chase + CHASE_PER_HIT);
    this.shake = 1;
    audio.buzz();
    this.add(burst('poof', this.proj.cx, this.proj.groundY - 140), this.hudLayer);
    this.banner(this.chase > 0.66 ? 'LAST CHANCE!' : 'OOF!', 1);
  }

  // -------------------------------------------------------------- drawing

  private drawWorld(moved: number): void {
    const p = this.proj;
    const far = DRAW_DISTANCE;
    drawRoad(this.roadG, this.zone, this.distance, p, this.game.viewWidth, this.game.viewHeight, far);

    // Shake by moving the whole world, not the camera maths — the road is
    // redrawn from the projection every frame, so shaking that would fight
    // with the geometry.
    const s = this.shake * this.shake * 9;
    this.world.position.set(s ? (Math.random() - 0.5) * s : 0, s ? (Math.random() - 0.5) * s : 0);

    for (const h of this.hazards) {
      this.placeAt(h.view, laneX(h.data.lane), this.rel(h.data.z), 0, LANE_WIDTH * 0.82, far);
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

  /** Project a unit-sized view onto the road. */
  private placeAt(view: Container, x: number, z: number, height: number, unit: number, far: number): void {
    if (!visible(z, far)) {
      view.visible = false;
      return;
    }
    const q = project(x, Math.max(0, z), height, this.proj);
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
    const q = project(this.rider.x, 0, this.moves.height, this.proj);
    // Squash for the slide; the crouch value is the state machine's, so the
    // art can never disagree with the hitbox.
    const squash = 1 - this.moves.crouch * 0.42;
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
    const ground = project(this.rider.x, 0, 0, this.proj);
    this.blobShadow.position.set(ground.x, ground.y);
    const shrink = 1 - Math.min(0.45, this.moves.height / 420);
    this.blobShadow.scale.set(radius * ground.scale * shrink);
    this.blobShadow.alpha = 0.34 * shrink;
    void far;
  }

  /** The corner sign: an arrow that grows as the turn arrives, and turns
   *  green once a swipe would actually take it. Without it a corner is a
   *  memory test, which is not the same thing as a skill. */
  private drawTurnSign(far: number): void {
    if (this.turned || !visible(this.turnZ, far)) {
      this.turnSign.visible = false;
      return;
    }
    const armed = this.turnZ < TURN_WINDOW;
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
    const q = project(0, Math.max(0, this.turnZ), 240, this.proj);
    this.turnSign.visible = true;
    this.turnSign.position.set(q.x, q.y);
    this.turnSign.scale.set(LANE_WIDTH * 1.5 * q.scale);
    this.turnSign.alpha = fogAlpha(this.turnZ, far);
    this.turnSign.zIndex = depthIndex(this.turnZ) + 0.5;
  }

  // ------------------------------------------------------------- feedback

  private banner(text: string, secs: number): void {
    const t = label(text, 40, GOLD, '800');
    t.anchor.set(0.5);
    t.position.set(this.game.viewWidth / 2, this.game.viewHeight * 0.3);
    this.hudLayer.addChild(t);
    this.banners.push({ t, life: secs });
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
    spin: number;
  } {
    return {
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

  /** Put the next corner right in front of the player, so a test does not
   *  have to run fourteen thousand units to reach one. */
  debugCorner(): number {
    this.turnZ = Math.min(this.turnZ, TURN_WINDOW - 200);
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
