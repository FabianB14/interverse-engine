import { describe, expect, it } from 'vitest';
import {
  BASE_HEARTS, BRAWLER_CLASSES, COMBO_WINDOW, Combo, GROUND_BOTTOM_Y, HORIZON_Y, HitStop,
  IFRAME_SECS, Invulnerable, LANE_TOLERANCE, MIN_TELEGRAPH, Telegraph, WaveRunner,
  brawlerClass, clampToGround, decayKnock, depthScale, hitStopFor, inSameLane, knockbackFrom,
  levelFromXp, meleeConnects, onGround, playerTint, spawnSpots, statsFor, xpForLevel, xpToReach,
} from '../src/index.js';

describe('the ground plane', () => {
  it('draws things at the back smaller than things at the front', () => {
    expect(depthScale(HORIZON_Y)).toBeLessThan(depthScale(GROUND_BOTTOM_Y));
    expect(depthScale(GROUND_BOTTOM_Y)).toBe(1);
  });

  /** Over a 400-unit band, real perspective would make the back row
   *  unreadable on a phone. A hint is enough for the eye. */
  it('keeps the size change subtle', () => {
    expect(depthScale(HORIZON_Y)).toBeGreaterThan(0.7);
  });

  it('never scales past its ends, however far out you ask', () => {
    expect(depthScale(-9999)).toBe(depthScale(HORIZON_Y));
    expect(depthScale(99999)).toBe(1);
  });

  /** The horizon is a wall — that is what stops a brawler feeling top-down. */
  it('holds you inside the walkable band', () => {
    expect(clampToGround(0)).toBe(HORIZON_Y);
    expect(clampToGround(99999)).toBe(GROUND_BOTTOM_Y);
    expect(onGround(HORIZON_Y - 1)).toBe(false);
    expect(onGround(HORIZON_Y + 10)).toBe(true);
  });
});

describe('reaching someone', () => {
  const me = { x: 100, y: 800, dir: 1 };

  it('connects in front, in range, in the same lane', () => {
    expect(meleeConnects(me, { x: 200, y: 800 }, 124)).toBe(true);
  });

  it('misses what is out of reach', () => {
    expect(meleeConnects(me, { x: 400, y: 800 }, 124)).toBe(false);
  });

  /** Being level matters more than being near: hitting someone a whole
   *  body-depth up the stage feels like a miss. */
  it('misses what is standing up the stage', () => {
    expect(meleeConnects(me, { x: 140, y: 800 + LANE_TOLERANCE + 20 }, 124)).toBe(false);
    expect(inSameLane(800, 800 + LANE_TOLERANCE + 1)).toBe(false);
  });

  it('misses what is behind you', () => {
    expect(meleeConnects(me, { x: -60, y: 800 }, 124)).toBe(false);
  });

  /** ...but "behind" at point blank is a technicality, not a miss. */
  it('still hits someone standing on top of you', () => {
    expect(meleeConnects(me, { x: 90, y: 800 }, 124)).toBe(true);
  });
});

describe('hit stop', () => {
  it('freezes longer for a heavier hit', () => {
    expect(hitStopFor(3)).toBeGreaterThan(hitStopFor(1));
  });

  /** Past a tenth of a second it stops reading as impact and starts reading
   *  as a dropped frame. */
  it('never freezes long enough to look like a stall', () => {
    expect(hitStopFor(999)).toBeLessThanOrEqual(0.12);
  });

  it('stops the world, then hands time back', () => {
    const hs = new HitStop();
    hs.add(0.1);
    expect(hs.tick(0.016)).toBe(0);
    expect(hs.frozen).toBe(true);
    hs.tick(0.2);
    expect(hs.frozen).toBe(false);
    expect(hs.tick(0.016)).toBe(0.016);
  });

  it('does not stack overlapping hits into a noticeable stall', () => {
    const hs = new HitStop();
    hs.add(0.1);
    hs.add(0.1);
    hs.tick(0.11);
    expect(hs.frozen).toBe(false);
  });
});

describe('knockback', () => {
  it('throws the target the way you were facing', () => {
    expect(knockbackFrom(1, 1).vx).toBeGreaterThan(0);
    expect(knockbackFrom(-1, 1).vx).toBeLessThan(0);
  });

  it('only launches when the hit is a launcher', () => {
    expect(knockbackFrom(1, 1).vz).toBe(0);
    expect(knockbackFrom(1, 1, true).vz).toBeGreaterThan(0);
  });

  /** A brawler where you slide for a second is one you are not playing. */
  it('gives control back quickly', () => {
    let k = knockbackFrom(1, 1);
    for (let i = 0; i < 30; i++) k = decayKnock(k, 1 / 60);
    expect(Math.abs(k.vx)).toBeLessThan(30);
  });
});

describe('combos', () => {
  it('walks the chain and wraps round', () => {
    const c = new Combo();
    expect(c.swing()!.damage).toBe(1);
    c.tick(0.3);
    expect(c.swing()!.damage).toBeCloseTo(1.1);
    c.tick(0.3);
    expect(c.swing()!.launch).toBe(true);
    c.tick(0.5);
    expect(c.swing()!.damage).toBe(1);
  });

  it('refuses to swing again mid-swing', () => {
    const c = new Combo();
    c.swing();
    expect(c.swing()).toBeNull();
    expect(c.busy).toBe(true);
  });

  /** Pausing resets the chain — that is what turns mashing into rhythm. */
  it('starts over if you wait too long', () => {
    const c = new Combo();
    c.swing();
    c.tick(COMBO_WINDOW + 0.1);
    expect(c.step).toBe(0);
    expect(c.swing()!.damage).toBe(1);
  });

  it('reports where in the chain you are', () => {
    const c = new Combo();
    expect(c.step).toBe(0);
    c.swing();
    expect(c.step).toBe(1);
  });
});

describe('invulnerability', () => {
  /** Without it, three enemies is not a fight, it is a stunlock. */
  it('refuses a second hit while it lasts', () => {
    const iv = new Invulnerable();
    expect(iv.hit()).toBe(true);
    expect(iv.hit()).toBe(false);
    iv.tick(IFRAME_SECS + 0.01);
    expect(iv.hit()).toBe(true);
  });

  it('is visible while it lasts', () => {
    const iv = new Invulnerable();
    iv.hit();
    const seen = new Set<number>();
    for (let i = 0; i < 20; i++) {
      seen.add(iv.alpha);
      iv.tick(0.03);
    }
    expect(seen.size).toBeGreaterThan(1); // it flashes
  });
});

describe('telegraphs', () => {
  it('runs, then lands exactly once', () => {
    const t = new Telegraph();
    t.start(0.4);
    expect(t.tick(0.2)).toBe(false);
    expect(t.running).toBe(true);
    expect(t.tick(0.3)).toBe(true);
    expect(t.tick(0.3)).toBe(false); // not again
  });

  /** However angry an enemy gets, the tell has to stay long enough to react
   *  to — "you could not have known" is not a difficulty setting. */
  it('is never shortened out of existence', () => {
    const t = new Telegraph();
    t.start(0.001);
    expect(t.tick(MIN_TELEGRAPH - 0.01)).toBe(false);
  });

  it('closes in as the moment approaches', () => {
    const t = new Telegraph();
    t.start(0.4);
    t.tick(0.2);
    expect(t.progress).toBeCloseTo(0.5, 1);
  });

  it('can be called off', () => {
    const t = new Telegraph();
    t.start(1);
    t.cancel();
    expect(t.running).toBe(false);
  });
});

describe('wave gates', () => {
  const waves = [
    { atX: 500, enemies: ['a', 'b'] },
    { atX: 900, enemies: ['c'] },
  ];

  it('holds the player at the gate until it is cleared', () => {
    const w = new WaveRunner(waves, 2000);
    expect(w.limitX).toBe(500);
    expect(w.update(100)).toBeNull();
    expect(w.update(480)).toEqual(waves[0]);
    expect(w.progress.alive).toBe(2);
    w.defeated();
    expect(w.limitX).toBe(500); // still fighting
    w.defeated();
    expect(w.limitX).toBe(900); // opened, on to the next
  });

  it('only spawns a wave once', () => {
    const w = new WaveRunner(waves, 2000);
    expect(w.update(480)).toEqual(waves[0]);
    expect(w.update(480)).toBeNull();
  });

  it('opens the level once every wave is done', () => {
    const w = new WaveRunner(waves, 2000);
    w.update(480);
    w.defeated();
    w.defeated();
    w.update(880);
    w.defeated();
    expect(w.finished).toBe(true);
    expect(w.limitX).toBe(2000);
  });

  /** A wave with nothing in it is a checkpoint, not a fight you cannot win. */
  it('does not wedge on an empty wave', () => {
    const w = new WaveRunner([{ atX: 300, enemies: [] }], 1000);
    w.update(300);
    expect(w.finished).toBe(true);
  });

  it('is finished immediately with no waves at all', () => {
    expect(new WaveRunner([], 800).finished).toBe(true);
    expect(new WaveRunner([], 800).limitX).toBe(800);
  });

  it('announces an opening exactly once', () => {
    const w = new WaveRunner(waves, 2000);
    w.update(480);
    w.defeated();
    w.defeated();
    expect(w.takeOpened()).toBe(true);
    expect(w.takeOpened()).toBe(false);
  });

  it('ignores deaths when nothing is being fought', () => {
    const w = new WaveRunner(waves, 2000);
    w.defeated();
    expect(w.progress.alive).toBe(0);
    expect(w.limitX).toBe(500);
  });
});

describe('where a wave appears', () => {
  const spots = spawnSpots(6, 1000, HORIZON_Y, GROUND_BOTTOM_Y, () => 0.5);

  it('makes one spot per enemy', () => {
    expect(spots).toHaveLength(6);
  });

  it('never stacks two on the same pixel', () => {
    expect(new Set(spots.map((s) => `${s.x},${s.y}`)).size).toBe(6);
  });

  /** Being surrounded is the genre's whole texture; a wave that only ever
   *  arrives from the front is a queue. */
  it('comes from behind as well as ahead', () => {
    expect(spots.some((s) => s.x < 1000)).toBe(true);
    expect(spots.some((s) => s.x > 1000)).toBe(true);
  });

  it('puts everyone on the ground', () => {
    for (const s of spots) expect(onGround(s.y)).toBe(true);
  });
});

describe('the roster', () => {
  it('offers real choices, not reskins', () => {
    const powers = new Set(BRAWLER_CLASSES.map((c) => c.power));
    const speeds = new Set(BRAWLER_CLASSES.map((c) => c.speed));
    expect(powers.size).toBeGreaterThan(2);
    expect(speeds.size).toBeGreaterThan(2);
  });

  /** Four blobs in a scrum is the moment you must be able to find yourself. */
  it('gives every class its own colour and silhouette', () => {
    expect(new Set(BRAWLER_CLASSES.map((c) => c.color)).size).toBe(BRAWLER_CLASSES.length);
    expect(new Set(BRAWLER_CLASSES.map((c) => `${c.hat}/${c.held}`)).size).toBe(BRAWLER_CLASSES.length);
  });

  it('describes each one', () => {
    for (const c of BRAWLER_CLASSES) expect(c.blurb.length).toBeGreaterThan(20);
  });

  it('falls back rather than returning undefined', () => {
    expect(brawlerClass('nonsense').id).toBe(BRAWLER_CLASSES[0]!.id);
  });

  /** Two players who picked the same class still have to be tellable apart. */
  it('tints players in the same class apart', () => {
    const base = 0x6fc3ff;
    expect(playerTint(base, 0)).toBe(base);
    expect(playerTint(base, 1)).not.toBe(base);
  });
});

describe('stats and levelling', () => {
  it('turns a class into numbers you fight with', () => {
    const s = statsFor(brawlerClass('brute'));
    const r = statsFor(brawlerClass('rogue'));
    expect(s.power).toBeGreaterThan(r.power);
    expect(r.speed).toBeGreaterThan(s.speed);
    expect(s.hearts).toBeGreaterThan(r.hearts);
  });

  /** A class multiplier must never hand you a corpse. */
  it('never leaves anyone with no hearts', () => {
    const glass = { ...brawlerClass('rogue'), hearts: 0.01 };
    expect(statsFor(glass).hearts).toBeGreaterThanOrEqual(1);
  });

  it('makes upgrades worth taking', () => {
    const plain = statsFor(brawlerClass('knight'));
    const grown = statsFor(brawlerClass('knight'), { power: 5, speed: 5, hearts: 3 });
    expect(grown.power).toBeGreaterThan(plain.power);
    expect(grown.speed).toBeGreaterThan(plain.speed);
    expect(grown.hearts).toBe(plain.hearts + 3);
  });

  it('starts everyone with hearts to spare', () => {
    expect(statsFor(brawlerClass('knight')).hearts).toBe(BASE_HEARTS);
  });

  /** Early levels come fast so progress is felt; later ones are earned. */
  it('costs more the further you get', () => {
    expect(xpForLevel(5)).toBeGreaterThan(xpForLevel(1));
    expect(xpForLevel(10)).toBeGreaterThan(xpForLevel(5));
  });

  it('agrees with itself about what level you are', () => {
    for (const level of [1, 2, 5, 9]) {
      expect(levelFromXp(xpToReach(level))).toBe(level);
      expect(levelFromXp(xpToReach(level + 1) - 1)).toBe(level);
    }
  });

  it('starts at level 1 with nothing', () => {
    expect(levelFromXp(0)).toBe(1);
  });
});
