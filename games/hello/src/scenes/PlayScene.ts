import { Graphics } from 'pixi.js';
import type { Text } from 'pixi.js';
import {
  Entity,
  Scene,
  Timer,
  Tween,
  Velocity,
  Wobble,
  audio,
  blobCharacter,
  darken,
  easings,
  makeTappable,
  partyPop,
  pickColor,
  popIn,
  squash,
} from '@interverse/engine';
import { makeText } from '../ui.js';
import { ResultsScene } from './ResultsScene.js';

const ROUND_SECONDS = 30;
const HUD_BOTTOM = 210; // blobs spawn below this line

class BlobEntity extends Entity {
  alive = true;
  vel!: Velocity;

  constructor(
    public readonly radius: number,
    public readonly color: number,
  ) {
    super();
  }
}

interface BlobTapDebug {
  score: () => number;
  timeLeft: () => number;
  blobs: () => { x: number; y: number }[];
}

declare global {
  interface Window {
    __blobtap?: BlobTapDebug;
  }
}

export class PlayScene extends Scene {
  private score = 0;
  private elapsed = 0;
  private roundTime = ROUND_SECONDS;
  private spawnIn = 0.4;
  private over = false;
  private readonly blobs: BlobEntity[] = [];
  private scoreText!: Text;
  private timerFill!: Graphics;
  private timerWidth = 0;

  protected override onEnter(): void {
    const W = this.game.designWidth;

    // Debug lever so headless playtests can run short rounds: ?round=6
    const param = Number(new URLSearchParams(window.location.search).get('round'));
    if (Number.isFinite(param) && param >= 3 && param <= 120) this.roundTime = param;

    // HUD — timer bar + score.
    this.timerWidth = W - 80;
    const barBg = new Graphics()
      .roundRect(40, 44, this.timerWidth, 18, 9)
      .fill({ color: 0xffffff, alpha: 0.15 });
    this.stage.addChild(barBg);
    this.timerFill = new Graphics();
    this.stage.addChild(this.timerFill);

    this.scoreText = makeText('0', 72, { color: partyPop.ink });
    this.scoreText.position.set(W / 2, 130);
    this.stage.addChild(this.scoreText);

    // Debug hook for the headless playtest script (scripts/verify.mjs).
    window.__blobtap = {
      score: () => this.score,
      timeLeft: () => Math.max(0, this.roundTime - this.elapsed),
      blobs: () =>
        this.blobs
          .filter((b) => b.alive && !b.destroyed)
          .map((b) => {
            const p = b.getGlobalPosition();
            return { x: p.x, y: p.y };
          }),
    };
  }

  protected override onExit(): void {
    delete window.__blobtap;
  }

  protected override onUpdate(dt: number): void {
    if (this.over) return;
    this.elapsed += dt;

    // Timer bar, turning urgent-red for the last 5 seconds.
    const left = Math.max(0, 1 - this.elapsed / this.roundTime);
    const urgent = this.roundTime - this.elapsed <= 5;
    this.timerFill.clear();
    if (left > 0) {
      this.timerFill
        .roundRect(40, 44, Math.max(18, this.timerWidth * left), 18, 9)
        .fill(urgent ? 0xff5470 : partyPop.accent);
    }

    // Spawning speeds up over the round.
    this.spawnIn -= dt;
    if (this.spawnIn <= 0) {
      this.spawnBlob();
      const progress = Math.min(1, this.elapsed / this.roundTime);
      this.spawnIn = 0.95 - 0.55 * progress + Math.random() * 0.25;
    }

    // Bounce wandering blobs off the walls (and the HUD line).
    const W = this.game.designWidth;
    const H = this.game.designHeight;
    for (const b of this.blobs) {
      if (b.destroyed || !b.alive) continue;
      if (b.x < b.radius && b.vel.vx < 0) b.vel.vx = Math.abs(b.vel.vx);
      if (b.x > W - b.radius && b.vel.vx > 0) b.vel.vx = -Math.abs(b.vel.vx);
      if (b.y < HUD_BOTTOM + b.radius && b.vel.vy < 0) b.vel.vy = Math.abs(b.vel.vy);
      if (b.y > H - b.radius && b.vel.vy > 0) b.vel.vy = -Math.abs(b.vel.vy);
    }

    if (this.elapsed >= this.roundTime) this.endRound();
  }

  private spawnBlob(): void {
    const W = this.game.designWidth;
    const H = this.game.designHeight;
    const radius = 42 + Math.random() * 40;
    const color = pickColor(partyPop.colors);
    const blob = new BlobEntity(radius, color);

    const char = blobCharacter({ radius, color, seed: 1 + Math.floor(Math.random() * 1000) });
    blob.addChild(char.view);
    blob.position.set(
      radius + 20 + Math.random() * (W - (radius + 20) * 2),
      HUD_BOTTOM + radius + Math.random() * (H - HUD_BOTTOM - radius * 2 - 40),
    );

    const angle = Math.random() * Math.PI * 2;
    const speed = 50 + Math.random() * 90;
    blob.vel = new Velocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
    blob.addBehavior(blob.vel);
    blob.addBehavior(
      new Wobble({
        target: char.body,
        amount: 0.05,
        speed: 2 + Math.random() * 2,
        phase: Math.random() * 6,
      }),
    );
    popIn(blob, { duration: 0.3 });
    makeTappable(blob, () => this.hit(blob), { hitRadius: radius * 1.6 });

    // Lifetime: shrink away if not tapped in time — that's a miss.
    const life = 2.6 + Math.random() * 1.2;
    blob.addBehavior(
      new Timer(life, () => {
        if (!blob.alive || this.over) return;
        blob.alive = false;
        blob.eventMode = 'none';
        blob.addBehavior(
          new Tween(blob.scale, { x: 0.01, y: 0.01 }, 0.3, {
            ease: easings.inQuad,
            onDone: () => this.removeBlob(blob),
          }),
        );
      }),
    );

    this.blobs.push(blob);
    this.add(blob);
  }

  private hit(blob: BlobEntity): void {
    if (!blob.alive || this.over) return;
    blob.alive = false;
    blob.eventMode = 'none';

    const points = blob.radius < 55 ? 15 : 10; // small blobs are worth more
    this.score += points;
    this.scoreText.text = String(this.score);
    audio.pop(0.8 + (82 - blob.radius) / 60);

    this.burst(blob.x, blob.y, blob.color, blob.radius);
    this.floatText(`+${points}`, blob.x, blob.y - blob.radius);

    squash(blob, {
      amount: 0.4,
      duration: 0.16,
      onDone: () => {
        blob.addBehavior(
          new Tween(blob.scale, { x: 0.01, y: 0.01 }, 0.12, {
            ease: easings.inQuad,
            onDone: () => this.removeBlob(blob),
          }),
        );
      },
    });
  }

  private removeBlob(blob: BlobEntity): void {
    const i = this.blobs.indexOf(blob);
    if (i >= 0) this.blobs.splice(i, 1);
    this.remove(blob);
  }

  private burst(x: number, y: number, color: number, radius: number): void {
    const count = 8;
    for (let i = 0; i < count; i++) {
      const p = new Entity();
      const r = 6 + Math.random() * 8;
      p.addChild(new Graphics().circle(0, 0, r).fill(i % 2 === 0 ? color : darken(color, 0.25)));
      p.position.set(x, y);
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5;
      const speed = 180 + Math.random() * 220 + radius;
      p.addBehavior(new Velocity(Math.cos(angle) * speed, Math.sin(angle) * speed));
      p.addBehavior(new Tween(p, { alpha: 0 }, 0.45, { ease: easings.outQuad }));
      p.addBehavior(new Tween(p.scale, { x: 0.2, y: 0.2 }, 0.45, { ease: easings.outQuad }));
      p.addBehavior(new Timer(0.5, () => this.remove(p)));
      this.add(p);
    }
  }

  private floatText(content: string, x: number, y: number): void {
    const t = new Entity();
    t.addChild(makeText(content, 40, { color: partyPop.accent }));
    t.position.set(x, y);
    t.addBehavior(new Velocity(0, -110));
    t.addBehavior(new Tween(t, { alpha: 0 }, 0.7, { ease: easings.inQuad }));
    t.addBehavior(new Timer(0.75, () => this.remove(t)));
    this.add(t);
  }

  private endRound(): void {
    if (this.over) return;
    this.over = true;
    audio.buzz();
    this.game.scenes.replace(new ResultsScene(this.score));
  }
}
