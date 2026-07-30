/**
 * VFX particles (§4.5 juice) — one-shot code-vector bursts, no textures.
 * A burst is a self-destroying Entity: spawn it, add it to a scene, done.
 * Presets cover the moments games actually need: wins, hits, pickups,
 * deaths, magic, love.
 */
import { Graphics } from 'pixi.js';
import { Entity } from '../entity/Entity.js';
import type { Behavior } from '../entity/Entity.js';

export type VfxPreset = 'confetti' | 'sparkle' | 'poof' | 'hearts' | 'embers' | 'coins';

interface ParticleSpec {
  count: number;
  /** Launch speed range (design units/sec). */
  speed: [number, number];
  /** Upward bias (negative = rises); gravity pulls back down. */
  gravity: number;
  life: [number, number];
  size: [number, number];
  colors: number[];
  shape: 'rect' | 'circle' | 'heart' | 'spark';
  spin: boolean;
}

export const VFX_PRESETS: Record<VfxPreset, ParticleSpec> = {
  confetti: {
    count: 26,
    speed: [180, 420],
    gravity: 700,
    life: [0.7, 1.2],
    size: [5, 9],
    colors: [0xff6f91, 0xffd166, 0x8affc1, 0x6fc3ff, 0xc77dff],
    shape: 'rect',
    spin: true,
  },
  sparkle: {
    count: 10,
    speed: [60, 180],
    gravity: -40,
    life: [0.3, 0.6],
    size: [3, 6],
    colors: [0xffffff, 0xffd166, 0xfff3ae],
    shape: 'spark',
    spin: false,
  },
  poof: {
    count: 12,
    speed: [50, 150],
    gravity: -120,
    life: [0.4, 0.8],
    size: [8, 16],
    colors: [0xcfcfe0, 0x9a97b8, 0xe6e4f0],
    shape: 'circle',
    spin: false,
  },
  hearts: {
    count: 8,
    speed: [60, 160],
    gravity: -220,
    life: [0.7, 1.1],
    size: [6, 11],
    colors: [0xff6f91, 0xff8fb3, 0xffb3c9],
    shape: 'heart',
    spin: false,
  },
  embers: {
    count: 18,
    speed: [80, 260],
    gravity: -160,
    life: [0.5, 1.0],
    size: [3, 7],
    colors: [0xff8f5b, 0xffd166, 0xff5b5b],
    shape: 'circle',
    spin: false,
  },
  coins: {
    count: 10,
    speed: [160, 320],
    gravity: 800,
    life: [0.5, 0.9],
    size: [5, 8],
    colors: [0xffd166, 0xffe9a8],
    shape: 'circle',
    spin: true,
  },
};

interface Particle {
  g: Graphics;
  vx: number;
  vy: number;
  spin: number;
  life: number;
  age: number;
}

/** Pure step (unit-testable): advance one particle by dt. */
export function stepParticle(p: Particle, gravity: number, dt: number): void {
  p.age += dt;
  p.vy += gravity * dt;
  p.g.x += p.vx * dt;
  p.g.y += p.vy * dt;
  p.g.rotation += p.spin * dt;
  p.g.alpha = Math.max(0, 1 - p.age / p.life);
}

class BurstBehavior implements Behavior {
  constructor(
    private readonly parts: Particle[],
    private readonly gravity: number,
  ) {}

  update(dt: number, entity: Entity): void {
    let alive = 0;
    for (const p of this.parts) {
      if (p.age >= p.life) continue;
      stepParticle(p, this.gravity, dt);
      alive++;
    }
    if (alive === 0 && !entity.destroyed) entity.destroy({ children: true });
  }
}

/** One-shot particle burst at (x, y). Add it to a scene; it cleans itself
 *  up when the last particle fades. */
export function burst(preset: VfxPreset, x: number, y: number, random: () => number = Math.random): Entity {
  const spec = VFX_PRESETS[preset] ?? VFX_PRESETS.sparkle;
  const root = new Entity();
  root.position.set(x, y);
  root.zIndex = 1e8; // above depth-sorted world contents
  const parts: Particle[] = [];
  for (let i = 0; i < spec.count; i++) {
    const g = new Graphics();
    const size = spec.size[0] + random() * (spec.size[1] - spec.size[0]);
    const color = spec.colors[Math.floor(random() * spec.colors.length)]!;
    if (spec.shape === 'rect') g.rect(-size / 2, -size / 2, size, size * 0.6).fill(color);
    else if (spec.shape === 'circle') g.circle(0, 0, size / 2).fill(color);
    else if (spec.shape === 'heart') {
      g.circle(-size * 0.22, -size * 0.15, size * 0.28)
        .fill(color)
        .circle(size * 0.22, -size * 0.15, size * 0.28)
        .fill(color)
        .poly([-size * 0.46, 0, 0, size * 0.5, size * 0.46, 0])
        .fill(color);
    } else {
      // spark: little 4-point star
      g.poly([0, -size, size * 0.25, -size * 0.25, size, 0, size * 0.25, size * 0.25, 0, size, -size * 0.25, size * 0.25, -size, 0, -size * 0.25, -size * 0.25])
        .fill(color);
    }
    const angle = random() * Math.PI * 2;
    const speed = spec.speed[0] + random() * (spec.speed[1] - spec.speed[0]);
    parts.push({
      g,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - (spec.gravity > 0 ? speed * 0.4 : 0),
      spin: spec.spin ? (random() - 0.5) * 12 : 0,
      life: spec.life[0] + random() * (spec.life[1] - spec.life[0]),
      age: 0,
    });
    root.addChild(g);
  }
  root.addBehavior(new BurstBehavior(parts, spec.gravity));
  return root;
}
