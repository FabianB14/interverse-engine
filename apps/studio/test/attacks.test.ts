import { describe, expect, it } from 'vitest';
import {
  ATTACK_IDS, ATTACK_SPECS, CHARGE_TIME, MIN_WINDUP, SHOT_SPEED, SLAM_RADIUS, SLAM_TIME,
  attackDuration, attackShots, attackSpec, isAttackPattern, ringAngles, slamHits, slamRadius,
  spreadAngles, windupFor,
} from '../src/attacks.js';
import { defaultEntity, parseProject, defaultProject } from '../src/model.js';

const deg = (r: number): number => Math.round((r * 180) / Math.PI);

describe('the shapes an attack makes', () => {
  it('fans a spread evenly around where the player is', () => {
    expect(spreadAngles(0, 3, Math.PI / 2).map(deg)).toEqual([-45, 0, 45]);
  });

  it('is just the one shot when there is only one', () => {
    expect(spreadAngles(1.2, 1, Math.PI)).toEqual([1.2]);
  });

  it('closes a ring with no gap and no repeat', () => {
    const a = ringAngles(0, 4).map(deg);
    expect(a).toEqual([0, 90, 180, 270]);
  });
});

describe('what each pattern fires', () => {
  it('aims one shot at the player', () => {
    const s = attackShots('aimed', 1);
    expect(s).toHaveLength(1);
    expect(s[0]!.angle).toBe(1);
    expect(s[0]!.speed).toBe(SHOT_SPEED);
  });

  it('spreads three', () => {
    expect(attackShots('spread', 0)).toHaveLength(3);
  });

  /** A burst is three shots on ONE trigger — if they all left at once it
   *  would just be a spread stacked on itself. */
  it('staggers a burst in time, not in angle', () => {
    const s = attackShots('burst', 0.5);
    expect(s.map((x) => x.delay)).toEqual([0, 0.14, 0.28]);
    expect(new Set(s.map((x) => x.angle)).size).toBe(1);
  });

  it('rings shots all the way round', () => {
    const s = attackShots('ring', 0);
    expect(s).toHaveLength(10);
    expect(new Set(s.map((x) => Math.round(x.angle * 100))).size).toBe(10);
  });

  /** Charge and slam move the enemy or push out a wave; firing nothing is
   *  the right answer, not a missing case. */
  it('fires nothing for the melee patterns', () => {
    expect(attackShots('charge', 0)).toEqual([]);
    expect(attackShots('slam', 0)).toEqual([]);
    expect(attackShots('contact', 0)).toEqual([]);
  });

  /** The cooldown may not restart until the attack is actually over, or a
   *  burst would overlap the next burst. */
  it('reports how long it lasts', () => {
    expect(attackDuration('burst')).toBeCloseTo(0.28);
    expect(attackDuration('charge')).toBe(CHARGE_TIME);
    expect(attackDuration('aimed')).toBe(0);
  });
});

describe('the telegraph', () => {
  it('gives every ranged pattern a wind-up', () => {
    for (const s of ATTACK_SPECS) {
      if (s.id !== 'contact') expect(s.windup).toBeGreaterThan(0);
    }
  });

  it('has none for an enemy that only walks into you', () => {
    expect(windupFor('contact', false)).toBe(0);
  });

  it('shortens when a boss enrages', () => {
    expect(windupFor('ring', true)).toBeLessThan(windupFor('ring', false));
  });

  /** "You could not have known" is not a difficulty setting: however angry
   *  the boss gets, the tell has to stay long enough to react to. */
  it('never shortens the tell out of existence', () => {
    for (const id of ATTACK_IDS) {
      const w = windupFor(id, true);
      if (w > 0) expect(w).toBeGreaterThanOrEqual(MIN_WINDUP);
    }
  });
});

describe('the shockwave', () => {
  it('starts at the enemy and ends at its full reach', () => {
    expect(slamRadius(0)).toBe(0);
    expect(slamRadius(SLAM_TIME)).toBe(SLAM_RADIUS);
  });

  /** A ring, not a growing disc — standing at the centre once it has passed
   *  is safe, which is the whole reason it is dodgeable. */
  it('hits only where the ring is right now', () => {
    const mid = SLAM_TIME / 2;
    expect(slamHits(mid, slamRadius(mid))).toBe(true);
    expect(slamHits(mid, 0)).toBe(false);
    expect(slamHits(mid, SLAM_RADIUS)).toBe(false);
  });

  it('does not hit before it starts or after it is gone', () => {
    expect(slamHits(-0.1, 0)).toBe(false);
    expect(slamHits(SLAM_TIME + 0.1, SLAM_RADIUS)).toBe(false);
  });
});

describe('saving an attack', () => {
  it('defaults a plain enemy to contact', () => {
    expect(defaultEntity('mob', 0, 0).attack).toBe('contact');
  });

  it('gives a boss something worth fighting', () => {
    const boss = defaultEntity('boss', 0, 0);
    expect(boss.attack).not.toBe('contact');
    expect(boss.shootEvery).toBeGreaterThan(0);
  });

  /** Projects made before patterns existed said "shoots every N secs" and
   *  meant one aimed shot. They must keep meaning exactly that. */
  it('reads an old ranged enemy as an aimed shot', () => {
    const p = defaultProject();
    const mob = defaultEntity('mob', 100, 100);
    mob.shootEvery = 1.5;
    delete (mob as Partial<typeof mob>).attack;
    p.scenes[0]!.entities.push(mob);
    const out = parseProject(JSON.stringify(p));
    expect(out.scenes[0]!.entities.at(-1)!.attack).toBe('aimed');
  });

  it('reads an old melee enemy as contact', () => {
    const p = defaultProject();
    const mob = defaultEntity('mob', 100, 100);
    delete (mob as Partial<typeof mob>).attack;
    p.scenes[0]!.entities.push(mob);
    expect(parseProject(JSON.stringify(p)).scenes[0]!.entities.at(-1)!.attack).toBe('contact');
  });

  it('refuses a pattern the engine does not have', () => {
    const p = defaultProject();
    const mob = defaultEntity('mob', 100, 100);
    (mob as { attack: string }).attack = 'nuke';
    p.scenes[0]!.entities.push(mob);
    expect(parseProject(JSON.stringify(p)).scenes[0]!.entities.at(-1)!.attack).toBe('contact');
  });
});

describe('the pattern table', () => {
  it('describes every pattern it offers', () => {
    for (const s of ATTACK_SPECS) {
      expect(s.hint.length).toBeGreaterThan(20);
      expect(s.label.length).toBeGreaterThan(0);
    }
  });

  it('falls back rather than returning undefined', () => {
    expect(attackSpec('nonsense').id).toBe('contact');
  });

  it('knows a real pattern from a made-up one', () => {
    expect(isAttackPattern('spread')).toBe(true);
    expect(isAttackPattern('sideways')).toBe(false);
    expect(isAttackPattern(7)).toBe(false);
  });
});
