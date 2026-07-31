/**
 * ⚔ A stage: walk right, gates close, fight, walk on, boss.
 *
 * The structure comes from the engine's WaveRunner and the feel comes from
 * the engine's combat kit, so what is left here is the world — spawning
 * bodies, moving them, and drawing the result. That split is why this file
 * is readable at all: nothing in it re-implements a combo or a gate.
 *
 * Co-op is folded into the same scene rather than forked into a second one,
 * on the principle that solo is a party of one who happens to be the host.
 * Everything gated on `this.simulating` is host-only work; everything else
 * runs identically whether there are four phones in the room or none.
 */

import { Container, Graphics, Text } from 'pixi.js';
import {
  Camera, Combo, Entity, GROUND_BOTTOM_Y, HORIZON_Y, HitStop, Invulnerable, Scene, Telegraph,
  VirtualJoystick, audio, brawlerClass, burst, clampToGround, decayKnock, depthScale,
  hitStopFor, inReviveRange, knockbackFrom, meleeConnects, partyCenter, partyHpScale, partyWiped,
  pickTarget, playerTint, reviveProgress, smoothTo, spawnSpots, standing, statsFor, tetheredX,
  REVIVE_HEARTS, REVIVE_SECS, WaveRunner,
} from '@interverse/engine';
import type { Knock, PartyMember, Stats, WaveSpec } from '@interverse/engine';
import { UIButton } from '@interverse/ui';
import { fighter, scenery, stageBackdrop } from '../art.js';
import { BIOMES, wavesFor } from '../levels.js';
import type { FoeId, Stage } from '../levels.js';
import { bossAt, damageThrough, foeAt } from '../enemies.js';
import type { FoeSpec } from '../enemies.js';
import { loadRun } from '../save.js';
import { BODY_HZ, SNAP_HZ, asMsg } from '../net.js';
import type { BodyMsg, FoeSnap, HitMsg, ShotSnap, SnapMsg } from '../net.js';
import type { Party } from './lobby.js';

/** One live enemy: its stats, its body, and the little state machine that
 *  decides what it is doing this frame. On a joiner the state machine never
 *  runs — tx/ty/tz are the host's last word and the body eases toward it. */
interface Foe {
  id: number;
  spec: FoeSpec;
  body: Entity;
  /** The bit that moves up when launched — kept separate from the entity so
   *  height never touches the y that decides depth, sorting and lanes. */
  lift: Container;
  ring: Graphics;
  bar: Graphics;
  hp: number;
  maxHp: number;
  dir: number;
  knock: Knock;
  tell: Telegraph;
  cool: number;
  z: number;
  vz: number;
  wander: number;
  /** Joiner-side interpolation target. */
  tx: number;
  ty: number;
  tz: number;
}

interface Shot {
  id: number;
  g: Graphics;
  vx: number;
  vy: number;
  ttl: number;
  dmg: number;
  color: number;
  tx: number;
  ty: number;
}

/** A friend's blob, as drawn on your screen. */
interface Mate {
  body: Entity;
  lift: Container;
  tag: Text;
  down: Graphics;
  classId: string;
  slot: number;
}

export interface FightResult {
  won: boolean;
  xp: number;
  coins: number;
}

const SHOT_SPEED = 300;
const GRAVITY = 2400;

export class FightScene extends Scene {
  private world = new Container();
  private hudLayer = new Container();
  private camera!: Camera;
  private stick!: VirtualJoystick;
  private hero!: Entity;
  private heroLift = new Container();
  private stats!: Stats;
  private hearts = 0;
  private heartsMax = 0;
  private readonly combo = new Combo();
  private readonly iframes = new Invulnerable();
  private readonly stop = new HitStop();
  private knock: Knock = { vx: 0, vy: 0, vz: 0 };
  private z = 0;
  private vz = 0;
  private dir = 1;
  private foes: Foe[] = [];
  private shots: Shot[] = [];
  private nextFoeId = 1;
  private nextShotId = 1;
  private runner!: WaveRunner;
  private limitX = 0;
  private gate = new Graphics();
  private heartsText!: Text;
  private partyText!: Text;
  private arrow!: Text;
  private banners: { t: Text; life: number }[] = [];
  private fades: { g: Container; life: number; max: number }[] = [];
  private over = false;
  private earnedXp = 0;
  private earnedCoins = 0;
  private readonly seenTips = new Set<string>();

  // ------------------------------------------------------------- co-op
  /** Whose machine decides the world. Solo counts: a party of one. */
  private simulating = true;
  private me = 'solo';
  private slot = 0;
  private downed = false;
  private revive = 0;
  private reviveRing = new Graphics();
  private readonly members = new Map<string, PartyMember>();
  private readonly mates = new Map<string, Mate>();
  private bodyClock = 0;
  private snapClock = 0;
  private readonly offs: (() => void)[] = [];
  /** Banners the host has already sent; a snapshot repeating one must not
   *  make it flash four times. */
  private lastBanner = '';

  constructor(
    private readonly def: Stage,
    private readonly onDone: (r: FightResult) => void,
    private readonly party: Party | null = null,
  ) {
    super();
  }

  private get coop(): boolean {
    return this.party !== null;
  }

  protected override onEnter(): void {
    const run = loadRun();
    if (this.party) {
      this.me = this.party.session.id;
      this.simulating = this.party.session.isHost;
      this.slot = Math.max(0, this.party.order.indexOf(this.me));
    }
    const classId = this.party ? (this.party.classes[this.me] ?? run.classId) : run.classId;
    const cls = brawlerClass(classId);
    // Upgrades are the local player's own — a co-op run is four campaigns
    // meeting for an hour, not one shared save.
    this.stats = statsFor(cls, run.upgrades);
    this.heartsMax = this.stats.hearts;
    this.hearts = this.heartsMax;

    const biome = BIOMES[this.def.biome]!;
    this.world.sortableChildren = true;
    this.stage.addChild(this.world);
    const back = stageBackdrop(biome, this.def.length, HORIZON_Y, GROUND_BOTTOM_Y);
    back.zIndex = -1e6;
    const props = scenery(biome, this.def.length, HORIZON_Y);
    props.zIndex = -1e5;
    this.gate.zIndex = 1e7;
    this.world.addChild(back, props, this.gate);

    this.hero = new Entity();
    this.heroLift.addChild(
      fighter({
        radius: 34,
        // Duplicate classes are legal, so the tint by slot is what keeps two
        // knights telling themselves apart mid-scrum.
        color: playerTint(cls.color, this.slot),
        seed: 5, hat: cls.hat, held: cls.held,
      }),
    );
    this.hero.addChild(this.heroLift);
    this.reviveRing.zIndex = 5;
    this.hero.addChild(this.reviveRing);
    // Spread the party out along the start line so four blobs do not begin
    // the stage standing inside one another. Well inside revive range, so
    // the first thing anyone learns about going down is that it is fixable.
    // Staggered back and centred on the ground band, so no slot starts
    // jammed against the left wall or the front edge.
    this.hero.position.set(300 - this.slot * 56, GROUND_BOTTOM_Y - 130 + (this.slot - 1.5) * 34);
    this.add(this.hero, this.world);

    this.runner = new WaveRunner(wavesFor(this.def), this.def.length - 200);
    this.limitX = this.runner.limitX;
    this.camera = new Camera(this.world, this.game.viewWidth, this.game.viewHeight, {
      // A deadzone means small steps do not shove the whole stage around —
      // in a brawler the camera should feel like a room, not a leash.
      deadzoneWidth: 220,
    });
    this.camera.setBounds(0, 0, this.def.length, 720);
    this.camera.follow(this.hero);

    this.setupParty();

    this.stage.addChild(this.hudLayer);
    this.buildHud();
    // Floating stick over the left half: on a phone your thumb lands where
    // it lands, and a fixed ring is a ring you keep missing.
    this.stick = new VirtualJoystick({
      dynamic: true,
      hitWidth: this.game.viewWidth * 0.55,
      hitHeight: this.game.viewHeight,
    });
    this.add(this.stick);
    const attack = new UIButton('👊', {
      width: 132, height: 132, fill: 0xff6f91, fontSize: 46, onTap: () => this.swing(),
    });
    attack.position.set(this.game.viewWidth - 112, this.game.viewHeight - 112);
    this.add(attack);
    const jump = new UIButton('⤒', {
      width: 108, height: 108, fill: 0x8affc1, fontSize: 40, onTap: () => this.jump(),
    });
    jump.position.set(this.game.viewWidth - 254, this.game.viewHeight - 96);
    this.add(jump);
    audio.music.play('battle');
  }

  protected override onExit(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
    audio.music.stop();
  }

  // ---------------------------------------------------------------- party

  private setupParty(): void {
    this.members.set(this.me, this.selfMember());
    if (!this.party) return;
    const session = this.party.session;
    for (const id of this.party.order) {
      if (id === this.me) continue;
      this.addMate(id);
    }
    this.offs.push(
      session.onMessage((from, data) => this.onNet(from, data)),
      session.onPlayerLeave((id) => this.dropMate(id)),
      // A host that vanishes takes the world with it. Ending the stage is
      // kinder than leaving four people swinging at a frozen boss.
      session.onClose(() => {
        if (!this.over) this.finish(false);
      }),
    );
  }

  private selfMember(): PartyMember {
    return {
      id: this.me,
      name: this.party?.names[this.me] ?? 'You',
      classId: this.party?.classes[this.me] ?? loadRun().classId,
      x: this.hero?.x ?? 220,
      y: this.hero?.y ?? GROUND_BOTTOM_Y - 130,
      z: this.z,
      dir: this.dir,
      hearts: this.hearts,
      heartsMax: this.heartsMax,
      downed: this.downed,
    };
  }

  private addMate(id: string): void {
    if (this.mates.has(id)) return;
    const slot = Math.max(0, this.party?.order.indexOf(id) ?? 0);
    const classId = this.party?.classes[id] ?? 'knight';
    const cls = brawlerClass(classId);
    const body = new Entity();
    const lift = new Container();
    lift.addChild(
      fighter({ radius: 34, color: playerTint(cls.color, slot), seed: 5 + slot, hat: cls.hat, held: cls.held }),
    );
    const tag = new Text({
      text: this.party?.names[id] ?? 'Player',
      style: { fontFamily: 'system-ui, sans-serif', fontSize: 16, fontWeight: '700', fill: 0xe6e4f0 },
    });
    tag.anchor.set(0.5, 1);
    // Clear of the tallest hat in the roster — a name label sitting inside a
    // hood reads as part of the blob rather than as a label.
    tag.position.set(0, -82);
    const down = new Graphics();
    body.addChild(down, lift, tag);
    body.position.set(220, GROUND_BOTTOM_Y - 130);
    this.add(body, this.world);
    this.mates.set(id, { body, lift, tag, down, classId, slot });
    this.members.set(id, {
      id, name: tag.text, classId,
      x: body.x, y: body.y, z: 0, dir: 1,
      hearts: 1, heartsMax: 1, downed: false,
    });
  }

  private dropMate(id: string): void {
    const mate = this.mates.get(id);
    if (mate) {
      this.remove(mate.body);
      this.mates.delete(id);
    }
    this.members.delete(id);
  }

  private onNet(from: string, data: unknown): void {
    const msg = asMsg(data);
    if (!msg || this.over) return;
    if (msg.type === 'body') {
      // Each player owns their own body, so this is accepted as told —
      // including by the host, which never second-guesses where you stood.
      if (!this.mates.has(from)) this.addMate(from);
      const m = this.members.get(from);
      if (m) {
        m.x = msg.x;
        m.y = msg.y;
        m.z = msg.z;
        m.dir = msg.dir;
        m.hearts = msg.hearts;
        m.heartsMax = msg.heartsMax;
        m.downed = msg.downed;
      }
      return;
    }
    if (msg.type === 'hit' && this.simulating) {
      this.resolveHit(msg);
      return;
    }
    if (msg.type === 'snap' && !this.simulating) {
      this.applySnap(msg);
      return;
    }
    if (msg.type === 'end' && !this.simulating) {
      this.earnedXp = msg.xp;
      this.earnedCoins = msg.coins;
      this.finish(msg.won);
    }
  }

  // ------------------------------------------------------------------ HUD

  private buildHud(): void {
    this.heartsText = new Text({
      text: '',
      style: { fontFamily: 'system-ui, sans-serif', fontSize: 30, fontWeight: '800', fill: 0xff6f91 },
    });
    this.heartsText.position.set(18, 14);
    // The party's health, one line under yours: knowing a friend is one hit
    // from going down is what turns four players into a team.
    this.partyText = new Text({
      text: '',
      style: { fontFamily: 'system-ui, sans-serif', fontSize: 18, fontWeight: '700', fill: 0x9a97b8 },
    });
    this.partyText.position.set(18, 52);
    const name = new Text({
      text: `${this.def.n}. ${this.def.name}`,
      style: { fontFamily: 'system-ui, sans-serif', fontSize: 22, fontWeight: '700', fill: 0xe6e4f0 },
    });
    name.anchor.set(0.5, 0);
    name.position.set(this.game.viewWidth / 2, 14);
    // The "keep going" arrow, shown only while the way ahead is actually
    // open — so it is an instruction rather than decoration.
    this.arrow = new Text({
      text: '▶',
      style: { fontFamily: 'system-ui, sans-serif', fontSize: 44, fontWeight: '800', fill: 0x8affc1 },
    });
    this.arrow.anchor.set(0.5);
    this.arrow.position.set(this.game.viewWidth - 56, this.game.viewHeight / 2);
    this.hudLayer.addChild(this.heartsText, this.partyText, name, this.arrow);
    this.refreshHearts();
  }

  private refreshHearts(): void {
    const full = Math.max(0, this.hearts);
    this.heartsText.text = this.downed
      ? '💀 DOWN'
      : '♥'.repeat(full) + '·'.repeat(Math.max(0, this.heartsMax - full));
    if (!this.coop) return;
    this.partyText.text = [...this.members.values()]
      .filter((m) => m.id !== this.me)
      .map((m) => `${m.name}: ${m.downed ? '💀' : '♥'.repeat(Math.max(0, m.hearts))}`)
      .join('   ');
  }

  protected override onResize(w: number, h: number): void {
    this.camera?.setViewSize(w, h);
    this.arrow.position.set(w - 56, h / 2);
  }

  // --------------------------------------------------------------- update

  protected override onUpdate(dt: number): void {
    if (this.over) return;
    // Hit stop freezes the WORLD. The fades and banners keep running, or a
    // freeze would also freeze the feedback that explains it.
    const step = this.stop.tick(dt);
    this.iframes.tick(dt);
    this.combo.tick(dt);
    this.heroLift.alpha = this.downed ? 0.45 : this.iframes.alpha;
    this.tickFades(dt);
    if (step <= 0) return;

    this.moveHero(step);
    this.tickRevive(step);
    this.camera.update(step);
    if (this.simulating) {
      this.tickWaves();
      for (const f of [...this.foes]) this.moveFoe(f, step);
      this.tickShots(step);
    } else {
      this.tickGhosts(step);
    }
    // Damage to YOUR blob is decided on YOUR machine, on both sides of the
    // wire: waiting for a round-trip to feel your own hit is the one delay
    // nobody forgives.
    this.checkHeroHits();
    this.tickMates(step);
    this.syncNet(step);
    this.drawGate();
    this.arrow.visible = !this.runner.finished && this.runner.progress.state === 'travelling';
    if (this.simulating) this.checkOutcome();
  }

  private moveHero(dt: number): void {
    const v = this.downed ? { x: 0, y: 0 } : this.stick.value;
    const speed = this.stats.speed;
    this.knock = decayKnock(this.knock, dt);
    // Depth movement is a slower lane than the run — walking "into" the
    // screen must never be the fastest way across it.
    let nx = Math.max(120, Math.min(this.limitX, this.hero.x + (v.x * speed + this.knock.vx) * dt));
    if (this.coop) {
      // The tether stops a runner rather than dragging them back: being
      // teleported is worse than being stopped, and stopping is legible.
      const c = partyCenter([...this.members.values()]);
      if (c) nx = tetheredX(nx, c.x);
    }
    const ny = clampToGround(this.hero.y + v.y * speed * 0.62 * dt);
    if (v.x !== 0) this.dir = v.x > 0 ? 1 : -1;
    this.hero.position.set(nx, ny);
    if (this.z > 0 || this.vz !== 0) {
      this.vz -= GRAVITY * dt;
      this.z = Math.max(0, this.z + this.vz * dt);
      if (this.z === 0) this.vz = 0;
    }
    this.heroLift.y = -this.z;
    this.heroLift.scale.x = this.dir >= 0 ? 1 : -1;
    this.hero.scale.set(depthScale(ny));
    this.hero.zIndex = ny;
    const mine = this.members.get(this.me);
    if (mine) {
      mine.x = nx;
      mine.y = ny;
      mine.z = this.z;
      mine.dir = this.dir;
      mine.hearts = this.hearts;
      mine.heartsMax = this.heartsMax;
      mine.downed = this.downed;
    }
  }

  /**
   * Being picked up.
   *
   * The downed player's own machine runs this, because a body's state is its
   * owner's business — and it means the ring you are watching fill is the
   * ring that decides, with no round-trip between the two.
   */
  private tickRevive(dt: number): void {
    if (!this.coop) return;
    this.reviveRing.clear();
    if (!this.downed) {
      this.revive = 0;
      return;
    }
    const helper = standing([...this.members.values()]).some((m) => inReviveRange(m, this.hero));
    this.revive = reviveProgress(this.revive, helper, dt);
    const frac = this.revive / REVIVE_SECS;
    this.reviveRing
      .arc(0, 0, 56, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac)
      .stroke({ color: helper ? 0x8affc1 : 0x9a97b8, width: 7, alpha: 0.9 });
    if (this.revive >= REVIVE_SECS) this.standUp();
  }

  private goDown(): void {
    this.downed = true;
    this.revive = 0;
    this.hearts = 0;
    this.knock = { vx: 0, vy: 0, vz: 0 };
    this.refreshHearts();
    this.banner('DOWNED — hold on!', 2.2);
    audio.buzz();
  }

  private standUp(): void {
    this.downed = false;
    this.revive = 0;
    // Not full: a rescue is a second chance, not a reset, or going down
    // stops mattering.
    this.hearts = REVIVE_HEARTS;
    this.iframes.hit();
    this.refreshHearts();
    this.banner('UP!', 1.2);
    this.add(burst('sparkle', this.hero.x, this.hero.y - 20), this.world);
    audio.chime();
  }

  /** Everyone still standing, as the enemy AI and the gate see them. */
  private party_(): PartyMember[] {
    return [...this.members.values()];
  }

  private tickWaves(): void {
    // The gate opens for the FURTHEST player: one friend hanging back must
    // not be able to hold the whole party at a wall they already beat.
    const live = standing(this.party_());
    const front = live.length ? Math.max(...live.map((m) => m.x)) : this.hero.x;
    const spawn = this.runner.update(front);
    if (spawn) this.spawnWave(spawn);
    if (this.runner.takeOpened()) {
      audio.chime();
      this.banner('CLEAR!');
    }
    this.limitX = this.runner.limitX;
  }

  /** The gate is a wall, so it is drawn as one: a visible barrier exactly
   *  where the invisible limit is. A rule the player cannot see is a bug. */
  private drawGate(): void {
    this.gate.clear();
    const closed = this.simulating
      ? !this.runner.finished && this.runner.progress.state === 'fighting'
      : this.limitX < this.def.length - 260;
    if (!closed) return;
    const x = this.limitX;
    const top = HORIZON_Y - 70;
    const h = GROUND_BOTTOM_Y - top;
    this.gate.rect(x - 7, top, 14, h).fill({ color: 0xffd166, alpha: 0.4 });
    for (let y = top; y < GROUND_BOTTOM_Y; y += 46) {
      this.gate.rect(x - 13, y, 26, 20).fill({ color: 0xffd166, alpha: 0.22 });
    }
  }

  private spawnWave(wave: WaveSpec): void {
    const ids = wave.enemies as FoeId[];
    const front = Math.max(this.hero.x, ...standing(this.party_()).map((m) => m.x));
    const spots = spawnSpots(ids.length, front + 240, HORIZON_Y + 50, GROUND_BOTTOM_Y - 40);
    // More players means more damage per second, so enemies get tougher —
    // sublinearly, or co-op becomes the same fight taking four times as long.
    const hpScale = partyHpScale(this.members.size);
    ids.forEach((id, i) => {
      const isBoss = id === 'boss' && !!this.def.boss;
      const spec = isBoss ? bossAt(this.def.boss!.hp, this.def.tier) : foeAt(id, this.def.tier);
      const named = isBoss ? { ...spec, name: this.def.boss!.name } : spec;
      this.spawnFoe({ ...named, hp: Math.round(named.hp * hpScale) }, spots[i]!.x, spots[i]!.y);
      // Teach by label, once, the first time a new kind turns up.
      if (spec.tip && !this.seenTips.has(spec.id)) {
        this.seenTips.add(spec.id);
        this.banner(spec.tip, 2.8);
      }
    });
    if (wave.banner) this.banner(wave.banner);
    audio.buzz();
  }

  private spawnFoe(spec: FoeSpec, x: number, y: number, id = this.nextFoeId++): Foe {
    const body = new Entity();
    const lift = new Container();
    const ring = new Graphics();
    const bar = new Graphics();
    bar.position.set(0, -spec.radius - 28);
    lift.addChild(fighter({ radius: spec.radius, color: spec.color, seed: 11, hat: spec.hat, held: spec.held }));
    body.addChild(ring, lift, bar);
    body.position.set(Math.max(120, x), clampToGround(y));
    this.add(body, this.world);
    const foe: Foe = {
      id, spec, body, lift, ring, bar,
      hp: spec.hp, maxHp: spec.hp, dir: -1, knock: { vx: 0, vy: 0, vz: 0 },
      tell: new Telegraph(),
      cool: spec.every ? spec.every * (0.4 + Math.random() * 0.6) : 0,
      z: 0, vz: 0, wander: 0,
      tx: body.x, ty: body.y, tz: 0,
    };
    this.foes.push(foe);
    this.drawFoeBar(foe);
    return foe;
  }

  private drawFoeBar(f: Foe): void {
    f.bar.clear();
    if (f.hp >= f.maxHp) return;
    const w = f.spec.radius * 1.8;
    f.bar.roundRect(-w / 2, 0, w, 8, 4).fill({ color: 0x000000, alpha: 0.5 });
    f.bar.roundRect(-w / 2, 0, (w * Math.max(0, f.hp)) / f.maxHp, 8, 4).fill(0xff6f91);
  }

  private moveFoe(f: Foe, dt: number): void {
    if (f.body.destroyed) return;
    // Enemies go for whoever is still STANDING. An enemy that keeps hitting
    // a downed body has stopped playing the game, and makes the rescue
    // impossible for exactly as long as it matters.
    const target = pickTarget(f.body, this.party_()) ?? { x: this.hero.x, y: this.hero.y };
    const dx = target.x - f.body.x;
    const dy = target.y - f.body.y;
    const d = Math.hypot(dx, dy) || 1;
    f.dir = dx >= 0 ? 1 : -1;
    let vx = 0;
    let vy = 0;
    // A telegraphing enemy stands still — that IS the tell, and one that
    // keeps closing while it winds up is not dodgeable.
    if (!f.tell.running) {
      if (f.spec.mind === 'keepAway') {
        // Backs off when crowded, closes when abandoned: an archer's whole
        // job is to be somewhere the player is not.
        if (d < 320) {
          vx = -dx / d;
          vy = -dy / d;
        } else if (d > 520) {
          vx = dx / d;
          vy = dy / d;
        }
      } else if (f.spec.mind === 'support') {
        if (d < 420) {
          vx = -dx / d;
          vy = -dy / d;
        }
      } else if (f.spec.mind === 'dart') {
        f.wander += dt;
        vx = dx / d;
        vy = dy / d + Math.sin(f.wander * 7) * 0.9;
      } else {
        vx = dx / d;
        vy = dy / d;
      }
    }
    f.knock = decayKnock(f.knock, dt);
    const nx = Math.max(60, Math.min(this.def.length - 60, f.body.x + (vx * f.spec.speed + f.knock.vx) * dt));
    const ny = clampToGround(f.body.y + vy * f.spec.speed * 0.6 * dt);
    f.body.position.set(nx, ny);
    if (f.z > 0 || f.vz !== 0) {
      f.vz -= GRAVITY * dt;
      f.z = Math.max(0, f.z + f.vz * dt);
      if (f.z === 0) f.vz = 0;
    }
    this.placeFoe(f);

    if (f.tell.running) {
      this.drawTell(f);
      if (f.tell.tick(dt)) this.foeAttack(f, target);
      return;
    }
    if (f.spec.every > 0) {
      f.cool -= dt;
      if (f.cool <= 0 && d < 640) {
        f.cool = f.spec.every;
        f.tell.start(0.45);
      }
    }
  }

  private placeFoe(f: Foe): void {
    f.lift.y = -f.z;
    f.lift.scale.x = f.dir >= 0 ? 1 : -1;
    f.body.scale.set(depthScale(f.body.y));
    f.body.zIndex = f.body.y;
  }

  /** Joiner-side: no AI, just ease every body toward the host's last word.
   *  Easing rather than snapping is what makes 10Hz look like 60. */
  private tickGhosts(dt: number): void {
    for (const f of this.foes) {
      if (f.body.destroyed) continue;
      f.body.position.set(smoothTo(f.body.x, f.tx, dt), smoothTo(f.body.y, f.ty, dt));
      f.z = smoothTo(f.z, f.tz, dt);
      this.placeFoe(f);
      if (f.tell.running) this.drawTell(f);
      else f.ring.clear();
    }
    for (const s of this.shots) {
      s.g.position.set(smoothTo(s.g.x, s.tx, dt, 18), smoothTo(s.g.y, s.ty, dt, 18));
      s.g.zIndex = s.g.y;
    }
  }

  /** Contact and projectile damage against the LOCAL hero, run on every
   *  machine against whatever foes it can see. Airborne sails over — that is
   *  the jump's whole use. */
  private checkHeroHits(): void {
    if (this.downed) return;
    for (const f of this.foes) {
      if (f.body.destroyed) continue;
      const d = Math.hypot(this.hero.x - f.body.x, this.hero.y - f.body.y);
      if (d < f.spec.radius + 42 && this.z < 44) this.hurtHero(f.spec.damage, f.dir);
    }
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i]!;
      if (this.z >= 44) continue;
      if (Math.hypot(s.g.x - this.hero.x, s.g.y - this.hero.y) >= 42) continue;
      this.hurtHero(s.dmg, s.vx >= 0 ? 1 : -1);
      // Only the host removes a shot from the world; a joiner just stops
      // being hit by it until the next snapshot drops it.
      if (this.simulating) {
        s.g.destroy();
        this.shots.splice(i, 1);
      }
    }
  }

  /** A ring that closes in as the moment approaches, so "how long have I
   *  got" is readable at a glance and without a HUD. */
  private drawTell(f: Foe): void {
    const left = 1 - f.tell.progress;
    f.ring.clear();
    f.ring
      .circle(0, 0, f.spec.radius * (1.5 + left * 1.4))
      .stroke({ color: 0xffd166, width: 4, alpha: 0.35 + (1 - left) * 0.5 });
  }

  private foeAttack(f: Foe, target: { x: number; y: number }): void {
    f.ring.clear();
    if (f.spec.mind === 'support') {
      // Heals the most hurt ally in range, which is what makes a shaman a
      // priority target rather than a nuisance.
      const hurt = this.foes
        .filter((o) => o !== f && !o.body.destroyed && o.hp < o.maxHp)
        .filter((o) => Math.hypot(o.body.x - f.body.x, o.body.y - f.body.y) < 440)
        .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
      if (hurt) {
        hurt.hp = Math.min(hurt.maxHp, hurt.hp + Math.ceil(hurt.maxHp * 0.35));
        this.drawFoeBar(hurt);
        this.add(burst('sparkle', hurt.body.x, hurt.body.y), this.world);
        audio.chime();
      }
      return;
    }
    const dx = target.x - f.body.x;
    const dy = target.y - f.body.y;
    const d = Math.hypot(dx, dy) || 1;
    this.addShot(this.nextShotId++, f.body.x, f.body.y - 12, f.spec.color, f.spec.damage,
      (dx / d) * SHOT_SPEED, (dy / d) * SHOT_SPEED);
    audio.blip(0.7);
  }

  private addShot(id: number, x: number, y: number, color: number, dmg: number, vx: number, vy: number): Shot {
    const g = new Graphics().circle(0, 0, 14).fill(color).circle(0, 0, 7).fill(0xffffff);
    g.position.set(x, y);
    g.zIndex = 1e6;
    this.world.addChild(g);
    const shot: Shot = { id, g, vx, vy, ttl: 2.6, dmg, color, tx: x, ty: y };
    this.shots.push(shot);
    return shot;
  }

  private tickShots(dt: number): void {
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i]!;
      s.g.x += s.vx * dt;
      s.g.y += s.vy * dt;
      s.g.zIndex = s.g.y;
      s.ttl -= dt;
      if (s.ttl <= 0) {
        s.g.destroy();
        this.shots.splice(i, 1);
      }
    }
  }

  /** Friends' blobs, eased toward the last body message each of them sent. */
  private tickMates(dt: number): void {
    for (const [id, mate] of this.mates) {
      const m = this.members.get(id);
      if (!m) continue;
      mate.body.position.set(smoothTo(mate.body.x, m.x, dt), smoothTo(mate.body.y, m.y, dt));
      mate.lift.y = -m.z;
      mate.lift.scale.x = m.dir >= 0 ? 1 : -1;
      mate.lift.alpha = m.downed ? 0.45 : 1;
      mate.body.scale.set(depthScale(mate.body.y));
      mate.body.zIndex = mate.body.y;
      mate.down.clear();
      // A downed friend needs to be findable from across the stage, so they
      // are marked rather than just dimmed.
      if (m.downed) mate.down.circle(0, 0, 56).stroke({ color: 0xff6f91, width: 5, alpha: 0.85 });
    }
  }

  // ------------------------------------------------------------------ net

  private syncNet(dt: number): void {
    if (!this.party) return;
    const session = this.party.session;
    this.bodyClock += dt;
    if (this.bodyClock >= 1 / BODY_HZ) {
      this.bodyClock = 0;
      const body: BodyMsg = {
        type: 'body',
        x: Math.round(this.hero.x), y: Math.round(this.hero.y), z: Math.round(this.z),
        dir: this.dir, hearts: this.hearts, heartsMax: this.heartsMax, downed: this.downed,
      };
      if (session.isHost) session.broadcast(body);
      else session.send(body);
    }
    if (!this.simulating) return;
    this.snapClock += dt;
    if (this.snapClock < 1 / SNAP_HZ) return;
    this.snapClock = 0;
    const foes: FoeSnap[] = this.foes
      .filter((f) => !f.body.destroyed)
      .map((f) => ({
        i: f.id, k: f.spec.id, x: Math.round(f.body.x), y: Math.round(f.body.y),
        z: Math.round(f.z), d: f.dir,
        h: Math.max(0, Math.min(1, f.hp / f.maxHp)),
        t: f.tell.running ? f.tell.progress : -1,
      }));
    const shots: ShotSnap[] = this.shots.map((s) => ({
      i: s.id, x: Math.round(s.g.x), y: Math.round(s.g.y), c: s.color,
    }));
    const snap: SnapMsg = {
      type: 'snap', foes, shots,
      party: this.party_(),
      limitX: Math.round(this.limitX),
    };
    if (this.lastBanner) {
      snap.banner = this.lastBanner;
      this.lastBanner = '';
    }
    session.broadcast(snap);
  }

  private applySnap(msg: SnapMsg): void {
    this.limitX = msg.limitX;
    const seen = new Set<number>();
    for (const s of msg.foes) {
      seen.add(s.i);
      let f = this.foes.find((o) => o.id === s.i);
      if (!f) {
        // A joiner learns an enemy exists from its first snapshot, and
        // builds the body from the archetype id rather than trusting stats
        // over the wire it has no use for.
        const spec = s.k === 'boss' && this.def.boss
          ? bossAt(this.def.boss.hp, this.def.tier)
          : foeAt(s.k as FoeId, this.def.tier);
        f = this.spawnFoe(spec, s.x, s.y, s.i);
        f.body.position.set(s.x, s.y);
      }
      f.tx = s.x;
      f.ty = s.y;
      f.tz = s.z;
      f.dir = s.d;
      f.hp = s.h * f.maxHp;
      this.drawFoeBar(f);
      if (s.t >= 0) {
        if (!f.tell.running) f.tell.start(0.45);
      } else {
        f.tell.cancel();
      }
    }
    // The host is the only thing that decides an enemy is gone.
    for (const f of [...this.foes]) {
      if (!seen.has(f.id)) this.removeFoe(f, false);
    }

    const shotIds = new Set(msg.shots.map((s) => s.i));
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i]!;
      if (shotIds.has(s.id)) continue;
      s.g.destroy();
      this.shots.splice(i, 1);
    }
    for (const snap of msg.shots) {
      const existing = this.shots.find((s) => s.id === snap.i);
      if (existing) {
        existing.tx = snap.x;
        existing.ty = snap.y;
      } else {
        const s = this.addShot(snap.i, snap.x, snap.y, snap.c, 1, 0, 0);
        s.tx = snap.x;
        s.ty = snap.y;
      }
    }

    for (const m of msg.party) {
      if (m.id === this.me) continue;
      if (!this.mates.has(m.id)) this.addMate(m.id);
      const mine = this.members.get(m.id);
      if (mine) Object.assign(mine, m);
    }
    if (msg.banner) this.banner(msg.banner);
    this.refreshHearts();
  }

  /**
   * A joiner's swing, re-checked here.
   *
   * The claim carries where they stood and how hard they hit, but not what
   * it hit — the host re-runs the reach test against its own enemy
   * positions. Sending the swing instead of the damage is what stops a
   * modified client from deleting a boss.
   */
  private resolveHit(msg: HitMsg): void {
    const me = { x: msg.x, y: msg.y, dir: msg.dir };
    // A joiner sees the world ~a snapshot late, so the reach it swung with
    // is granted a little slack rather than punishing them for their ping.
    const reach = Math.min(msg.reach, this.stats.reach + 60) + 26;
    const damage = Math.min(msg.damage, 24);
    for (const f of [...this.foes]) {
      if (f.body.destroyed) continue;
      if (!meleeConnects(me, { x: f.body.x, y: f.body.y }, reach + f.spec.radius)) continue;
      this.landHit(f, damage, msg.dir, msg.launch);
    }
  }

  private landHit(f: Foe, damage: number, dir: number, launch: boolean): void {
    // Armour is the brute's identity and the launcher is the answer to it,
    // so airborne targets take the hit in full.
    f.hp -= damageThrough(f.spec, damage, f.z > 20);
    f.knock = knockbackFrom(dir, launch ? 1.3 : 0.7);
    if (launch) f.vz = 520;
    f.tell.cancel();
    f.ring.clear();
    this.drawFoeBar(f);
    this.add(burst('poof', f.body.x, f.body.y - 20), this.world);
    if (f.hp <= 0) this.defeat(f);
  }

  // --------------------------------------------------------------- combat

  private swing(): void {
    if (this.downed) return;
    const step = this.combo.swing();
    if (!step) return;
    const reach = this.stats.reach + (step.reach - 124);
    const damage = this.stats.power * step.damage;
    this.swingArc(reach);
    if (!this.simulating) {
      // A joiner shows its own swing instantly and asks the host to make it
      // count. The arc is honest either way — it is a swing, not a hit.
      const hit: HitMsg = {
        type: 'hit',
        x: Math.round(this.hero.x), y: Math.round(this.hero.y), dir: this.dir,
        reach, damage, launch: !!step.launch,
      };
      this.party?.session.send(hit);
      audio.blip(0.9);
      return;
    }
    const me = { x: this.hero.x, y: this.hero.y, dir: this.dir };
    let hits = 0;
    for (const f of [...this.foes]) {
      if (f.body.destroyed) continue;
      if (!meleeConnects(me, { x: f.body.x, y: f.body.y }, reach + f.spec.radius)) continue;
      hits++;
      this.landHit(f, damage, this.dir, !!step.launch);
    }
    // Hit stop only on contact: freezing on a whiff feels broken, not weighty.
    if (hits) {
      this.stop.add(hitStopFor(damage));
      audio.pop(1.2);
    } else {
      audio.blip(0.6);
    }
  }

  /** A visible arc, so a swing that missed still reads as a swing. */
  private swingArc(reach: number): void {
    const arc = new Graphics()
      .arc(0, 0, reach * 0.8, -0.85, 0.85)
      .stroke({ color: 0xffffff, width: 7, alpha: 0.75 });
    arc.position.set(this.hero.x + this.dir * 26, this.hero.y - 12);
    arc.scale.x = this.dir;
    arc.zIndex = 1e6;
    this.world.addChild(arc);
    this.fades.push({ g: arc, life: 0.18, max: 0.18 });
  }

  private jump(): void {
    if (this.z > 0 || this.downed) return;
    this.vz = 900;
    audio.blip(1.3);
  }

  private removeFoe(f: Foe, celebrate: boolean): void {
    if (celebrate) {
      this.add(burst('confetti', f.body.x, f.body.y), this.world);
      audio.chime();
    }
    this.foes = this.foes.filter((o) => o !== f);
    this.remove(f.body);
  }

  private defeat(f: Foe): void {
    this.earnedXp += f.spec.xp;
    this.earnedCoins += Math.max(1, Math.round(f.spec.xp / 3));
    this.removeFoe(f, true);
    this.runner.defeated();
  }

  private hurtHero(dmg: number, fromDir: number): void {
    // Without i-frames a crowd of three is not a fight, it is a stunlock.
    if (this.downed || !this.iframes.hit()) return;
    this.hearts -= dmg;
    this.knock = knockbackFrom(-fromDir, 0.8);
    this.stop.add(hitStopFor(dmg));
    audio.buzz();
    this.add(burst('poof', this.hero.x, this.hero.y - 20), this.world);
    if (this.hearts <= 0) {
      // Solo, running out of hearts ends the stage. In co-op it is a problem
      // your friends can solve — which is the whole difference between four
      // people playing together and four people playing alone side by side.
      if (this.coop) this.goDown();
      else this.finish(false);
      return;
    }
    this.refreshHearts();
  }

  /** Host-only: has the stage been won or lost? */
  private checkOutcome(): void {
    if (this.over) return;
    if (this.coop && partyWiped(this.party_())) {
      this.endParty(false);
      return;
    }
    const live = standing(this.party_());
    const front = live.length ? Math.max(...live.map((m) => m.x)) : this.hero.x;
    if (this.runner.finished && front > this.def.length - 320) this.endParty(true);
  }

  private endParty(won: boolean): void {
    if (this.party?.session.isHost) {
      // Everyone banks the same reward: the fight was shared, so the XP is.
      this.party.session.broadcast({
        type: 'end', won, xp: this.earnedXp, coins: this.earnedCoins,
      });
    }
    this.finish(won);
  }

  // ------------------------------------------------------------ feedback

  private banner(text: string, secs = 1.7): void {
    if (this.simulating && this.coop) this.lastBanner = text;
    const t = new Text({
      text,
      style: {
        fontFamily: 'system-ui, sans-serif', fontSize: 38, fontWeight: '800',
        fill: 0xffd166, align: 'center', stroke: { color: 0x1a1226, width: 6 },
      },
    });
    t.anchor.set(0.5);
    t.position.set(this.game.viewWidth / 2, this.game.viewHeight * 0.28);
    this.hudLayer.addChild(t);
    this.banners.push({ t, life: secs });
  }

  private tickFades(dt: number): void {
    for (let i = this.banners.length - 1; i >= 0; i--) {
      const b = this.banners[i]!;
      b.life -= dt;
      b.t.alpha = Math.max(0, Math.min(1, b.life * 2.5));
      if (b.life <= 0) {
        b.t.destroy();
        this.banners.splice(i, 1);
      }
    }
    for (let i = this.fades.length - 1; i >= 0; i--) {
      const f = this.fades[i]!;
      f.life -= dt;
      f.g.alpha = Math.max(0, f.life / f.max);
      if (f.life <= 0) {
        f.g.destroy();
        this.fades.splice(i, 1);
      }
    }
  }

  private finish(won: boolean): void {
    if (this.over) return;
    this.over = true;
    this.onDone({ won, xp: this.earnedXp, coins: this.earnedCoins });
  }

  // ------------------------------------------------- headless test hooks

  debugState(): {
    hearts: number; foes: number; limitX: number; heroX: number; done: boolean;
    downed: boolean; party: number; host: boolean; revive: number;
  } {
    return {
      hearts: this.hearts,
      foes: this.foes.length,
      limitX: Math.round(this.limitX),
      heroX: Math.round(this.hero.x),
      done: this.runner.finished,
      downed: this.downed,
      party: this.members.size,
      host: this.simulating,
      revive: Math.round(this.revive * 100) / 100,
    };
  }

  /** Drive the hero from a test without a joystick. */
  debugMove(x: number, y: number): void {
    this.stick.value.x = x;
    this.stick.value.y = y;
  }

  debugSwing(): void {
    this.swing();
  }

  /** Wipe the current fight — the fastest way for a test to get to the end
   *  of a stage without playing fifteen minutes of it. */
  debugClear(): void {
    for (const f of [...this.foes]) this.defeat(f);
  }

  /** Knock the local player down without waiting to be hit five times. */
  debugDown(): void {
    if (this.coop && !this.downed) this.goDown();
  }

  /** Where everyone is, as this machine believes it. */
  debugParty(): PartyMember[] {
    return this.party_().map((m) => ({ ...m, x: Math.round(m.x), y: Math.round(m.y) }));
  }
}
