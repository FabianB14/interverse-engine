/**
 * ⚔ A stage: walk right, gates close, fight, walk on, boss.
 *
 * The structure comes from the engine's WaveRunner and the feel comes from
 * the engine's combat kit, so what is left here is the world — spawning
 * bodies, moving them, and drawing the result. That split is why this file
 * is readable at all: nothing in it re-implements a combo or a gate.
 */

import { Container, Graphics, Text } from 'pixi.js';
import {
  Camera, Combo, Entity, GROUND_BOTTOM_Y, HORIZON_Y, HitStop, Invulnerable, Scene, Telegraph,
  VirtualJoystick, audio, brawlerClass, burst, clampToGround, decayKnock, depthScale,
  hitStopFor, knockbackFrom, meleeConnects, spawnSpots, statsFor, WaveRunner,
} from '@interverse/engine';
import type { Knock, Stats, WaveSpec } from '@interverse/engine';
import { UIButton } from '@interverse/ui';
import { fighter, scenery, stageBackdrop } from '../art.js';
import { BIOMES, wavesFor } from '../levels.js';
import type { FoeId, Stage } from '../levels.js';
import { bossAt, damageThrough, foeAt } from '../enemies.js';
import type { FoeSpec } from '../enemies.js';
import { loadRun } from '../save.js';

/** One live enemy: its stats, its body, and the little state machine that
 *  decides what it is doing this frame. */
interface Foe {
  spec: FoeSpec;
  body: Entity;
  /** The bit that moves up when launched — kept separate from the entity so
   *  height never touches the y that decides depth, sorting and lanes. */
  lift: Container;
  ring: Graphics;
  bar: Graphics;
  hp: number;
  dir: number;
  knock: Knock;
  tell: Telegraph;
  cool: number;
  z: number;
  vz: number;
  wander: number;
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
  private shots: { g: Graphics; vx: number; vy: number; ttl: number; dmg: number }[] = [];
  private runner!: WaveRunner;
  private gate = new Graphics();
  private heartsText!: Text;
  private arrow!: Text;
  private banners: { t: Text; life: number }[] = [];
  private fades: { g: Container; life: number; max: number }[] = [];
  private over = false;
  private earnedXp = 0;
  private earnedCoins = 0;
  private readonly seenTips = new Set<string>();

  constructor(
    private readonly def: Stage,
    private readonly onDone: (r: FightResult) => void,
  ) {
    super();
  }

  protected override onEnter(): void {
    const run = loadRun();
    const cls = brawlerClass(run.classId);
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
      fighter({ radius: 34, color: cls.color, seed: 5, hat: cls.hat, held: cls.held }),
    );
    this.hero.addChild(this.heroLift);
    this.hero.position.set(220, GROUND_BOTTOM_Y - 130);
    this.add(this.hero, this.world);

    this.runner = new WaveRunner(wavesFor(this.def), this.def.length - 200);
    this.camera = new Camera(this.world, this.game.viewWidth, this.game.viewHeight, {
      // A deadzone means small steps do not shove the whole stage around —
      // in a brawler the camera should feel like a room, not a leash.
      deadzoneWidth: 220,
    });
    this.camera.setBounds(0, 0, this.def.length, 720);
    this.camera.follow(this.hero);

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
    audio.music.stop();
  }

  // ------------------------------------------------------------------ HUD

  private buildHud(): void {
    this.heartsText = new Text({
      text: '',
      style: { fontFamily: 'system-ui, sans-serif', fontSize: 30, fontWeight: '800', fill: 0xff6f91 },
    });
    this.heartsText.position.set(18, 14);
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
    this.hudLayer.addChild(this.heartsText, name, this.arrow);
    this.refreshHearts();
  }

  private refreshHearts(): void {
    const full = Math.max(0, this.hearts);
    this.heartsText.text = '♥'.repeat(full) + '·'.repeat(Math.max(0, this.heartsMax - full));
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
    this.heroLift.alpha = this.iframes.alpha;
    this.tickFades(dt);
    if (step <= 0) return;

    this.moveHero(step);
    this.camera.update(step);
    this.tickWaves();
    for (const f of [...this.foes]) this.moveFoe(f, step);
    this.tickShots(step);
    this.arrow.visible = !this.runner.finished && this.runner.progress.state === 'travelling';
    if (this.runner.finished && this.hero.x > this.def.length - 320) this.finish(true);
  }

  private moveHero(dt: number): void {
    const v = this.stick.value;
    const speed = this.stats.speed;
    this.knock = decayKnock(this.knock, dt);
    // Depth movement is a slower lane than the run — walking "into" the
    // screen must never be the fastest way across it.
    const nx = Math.max(120, Math.min(this.runner.limitX, this.hero.x + (v.x * speed + this.knock.vx) * dt));
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
  }

  private tickWaves(): void {
    const spawn = this.runner.update(this.hero.x);
    if (spawn) this.spawnWave(spawn);
    if (this.runner.takeOpened()) {
      audio.chime();
      this.banner('CLEAR!');
    }
    this.drawGate();
  }

  /** The gate is a wall, so it is drawn as one: a visible barrier exactly
   *  where the invisible limit is. A rule the player cannot see is a bug. */
  private drawGate(): void {
    this.gate.clear();
    if (this.runner.finished || this.runner.progress.state !== 'fighting') return;
    const x = this.runner.limitX;
    const top = HORIZON_Y - 70;
    const h = GROUND_BOTTOM_Y - top;
    this.gate.rect(x - 7, top, 14, h).fill({ color: 0xffd166, alpha: 0.4 });
    for (let y = top; y < GROUND_BOTTOM_Y; y += 46) {
      this.gate.rect(x - 13, y, 26, 20).fill({ color: 0xffd166, alpha: 0.22 });
    }
  }

  private spawnWave(wave: WaveSpec): void {
    const ids = wave.enemies as FoeId[];
    const spots = spawnSpots(ids.length, this.hero.x + 240, HORIZON_Y + 50, GROUND_BOTTOM_Y - 40);
    ids.forEach((id, i) => {
      const isBoss = id === 'boss' && !!this.def.boss;
      const spec = isBoss ? bossAt(this.def.boss!.hp, this.def.tier) : foeAt(id, this.def.tier);
      const named = isBoss ? { ...spec, name: this.def.boss!.name } : spec;
      this.spawnFoe(named, spots[i]!.x, spots[i]!.y);
      // Teach by label, once, the first time a new kind turns up.
      if (spec.tip && !this.seenTips.has(spec.id)) {
        this.seenTips.add(spec.id);
        this.banner(spec.tip, 2.8);
      }
    });
    if (wave.banner) this.banner(wave.banner);
    audio.buzz();
  }

  private spawnFoe(spec: FoeSpec, x: number, y: number): void {
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
      spec, body, lift, ring, bar,
      hp: spec.hp, dir: -1, knock: { vx: 0, vy: 0, vz: 0 },
      tell: new Telegraph(),
      cool: spec.every ? spec.every * (0.4 + Math.random() * 0.6) : 0,
      z: 0, vz: 0, wander: 0,
    };
    this.foes.push(foe);
    this.drawFoeBar(foe);
  }

  private drawFoeBar(f: Foe): void {
    f.bar.clear();
    if (f.hp >= f.spec.hp) return;
    const w = f.spec.radius * 1.8;
    f.bar.roundRect(-w / 2, 0, w, 8, 4).fill({ color: 0x000000, alpha: 0.5 });
    f.bar.roundRect(-w / 2, 0, (w * Math.max(0, f.hp)) / f.spec.hp, 8, 4).fill(0xff6f91);
  }

  private moveFoe(f: Foe, dt: number): void {
    if (f.body.destroyed) return;
    const dx = this.hero.x - f.body.x;
    const dy = this.hero.y - f.body.y;
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
    f.lift.y = -f.z;
    f.lift.scale.x = f.dir >= 0 ? 1 : -1;
    f.body.scale.set(depthScale(ny));
    f.body.zIndex = ny;

    if (f.tell.running) {
      this.drawTell(f);
      if (f.tell.tick(dt)) this.foeAttack(f);
      return;
    }
    if (f.spec.every > 0) {
      f.cool -= dt;
      if (f.cool <= 0 && d < 640) {
        f.cool = f.spec.every;
        f.tell.start(0.45);
      }
    }
    // Contact damage. Airborne sails over — that is the jump's whole use.
    if (d < f.spec.radius + 42 && this.z < 44) this.hurtHero(f.spec.damage, f.dir);
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

  private foeAttack(f: Foe): void {
    f.ring.clear();
    if (f.spec.mind === 'support') {
      // Heals the most hurt ally in range, which is what makes a shaman a
      // priority target rather than a nuisance.
      const hurt = this.foes
        .filter((o) => o !== f && !o.body.destroyed && o.hp < o.spec.hp)
        .filter((o) => Math.hypot(o.body.x - f.body.x, o.body.y - f.body.y) < 440)
        .sort((a, b) => a.hp / a.spec.hp - b.hp / b.spec.hp)[0];
      if (hurt) {
        hurt.hp = Math.min(hurt.spec.hp, hurt.hp + Math.ceil(hurt.spec.hp * 0.35));
        this.drawFoeBar(hurt);
        this.add(burst('sparkle', hurt.body.x, hurt.body.y), this.world);
        audio.chime();
      }
      return;
    }
    const dx = this.hero.x - f.body.x;
    const dy = this.hero.y - f.body.y;
    const d = Math.hypot(dx, dy) || 1;
    const g = new Graphics().circle(0, 0, 14).fill(f.spec.color).circle(0, 0, 7).fill(0xffffff);
    g.position.set(f.body.x, f.body.y - 12);
    g.zIndex = 1e6;
    this.world.addChild(g);
    this.shots.push({
      g, vx: (dx / d) * SHOT_SPEED, vy: (dy / d) * SHOT_SPEED, ttl: 2.6, dmg: f.spec.damage,
    });
    audio.blip(0.7);
  }

  private tickShots(dt: number): void {
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i]!;
      s.g.x += s.vx * dt;
      s.g.y += s.vy * dt;
      s.g.zIndex = s.g.y;
      s.ttl -= dt;
      const hit = this.z < 44 && Math.hypot(s.g.x - this.hero.x, s.g.y - this.hero.y) < 42;
      if (hit) this.hurtHero(s.dmg, s.vx >= 0 ? 1 : -1);
      if (hit || s.ttl <= 0) {
        s.g.destroy();
        this.shots.splice(i, 1);
      }
    }
  }

  // --------------------------------------------------------------- combat

  private swing(): void {
    const step = this.combo.swing();
    if (!step) return;
    const reach = this.stats.reach + (step.reach - 124);
    const me = { x: this.hero.x, y: this.hero.y, dir: this.dir };
    let hits = 0;
    for (const f of [...this.foes]) {
      if (f.body.destroyed) continue;
      if (!meleeConnects(me, { x: f.body.x, y: f.body.y }, reach + f.spec.radius)) continue;
      hits++;
      // Armour is the brute's identity and the launcher is the answer to it,
      // so airborne targets take the hit in full.
      f.hp -= damageThrough(f.spec, this.stats.power * step.damage, f.z > 20);
      f.knock = knockbackFrom(this.dir, step.launch ? 1.3 : 0.7);
      if (step.launch) f.vz = 520;
      f.tell.cancel();
      f.ring.clear();
      this.drawFoeBar(f);
      this.add(burst('poof', f.body.x, f.body.y - 20), this.world);
      if (f.hp <= 0) this.defeat(f);
    }
    // Hit stop only on contact: freezing on a whiff feels broken, not weighty.
    if (hits) {
      this.stop.add(hitStopFor(this.stats.power * step.damage));
      audio.pop(1.2);
    } else {
      audio.blip(0.6);
    }
    this.swingArc(reach);
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
    if (this.z > 0) return;
    this.vz = 900;
    audio.blip(1.3);
  }

  private defeat(f: Foe): void {
    this.earnedXp += f.spec.xp;
    this.earnedCoins += Math.max(1, Math.round(f.spec.xp / 3));
    this.add(burst('confetti', f.body.x, f.body.y), this.world);
    audio.chime();
    this.foes = this.foes.filter((o) => o !== f);
    this.remove(f.body);
    this.runner.defeated();
  }

  private hurtHero(dmg: number, fromDir: number): void {
    // Without i-frames a crowd of three is not a fight, it is a stunlock.
    if (!this.iframes.hit()) return;
    this.hearts -= dmg;
    this.knock = knockbackFrom(-fromDir, 0.8);
    this.stop.add(hitStopFor(dmg));
    this.refreshHearts();
    audio.buzz();
    this.add(burst('poof', this.hero.x, this.hero.y - 20), this.world);
    if (this.hearts <= 0) this.finish(false);
  }

  // ------------------------------------------------------------ feedback

  private banner(text: string, secs = 1.7): void {
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

  debugState(): { hearts: number; foes: number; limitX: number; heroX: number; done: boolean } {
    return {
      hearts: this.hearts,
      foes: this.foes.length,
      limitX: this.runner.limitX,
      heroX: Math.round(this.hero.x),
      done: this.runner.finished,
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
}
