import { describe, expect, it } from 'vitest';
import { BRANCH_COLORS, SkillState, normalizeSkillTree, tierCount } from '../src/skilltree.js';

/** The exact tree the Tiny Quest template has always defined. It is the
 *  back-compat canary: every published game passing this shape must keep
 *  laying out and behaving the way it did before branches existed. */
const LEGACY = {
  title: 'CHAMPION PATHS',
  points: 1,
  nodes: [
    { id: 'strength', name: 'Strength', emoji: '💪', cost: 1 },
    { id: 'focus', name: 'Focus', emoji: '🧘', cost: 1 },
    { id: 'blade', name: 'Blade Arts', emoji: '⚔️', cost: 2, requires: ['strength'] },
    { id: 'guard', name: 'Iron Guard', emoji: '🛡️', cost: 2, requires: ['strength'] },
    { id: 'spark', name: 'Spark', emoji: '✨', cost: 2, requires: ['focus'] },
    { id: 'storm', name: 'Storm Call', emoji: '🌩️', cost: 3, requires: ['spark'] },
  ],
};

describe('legacy trees still work', () => {
  const t = normalizeSkillTree(LEGACY);

  it('becomes one branch with the same six nodes', () => {
    expect(t.branches).toHaveLength(1);
    expect(t.branches[0]!.nodes.map((n) => n.id)).toEqual(['strength', 'focus', 'blade', 'guard', 'spark', 'storm']);
  });

  it('derives tiers from the requires chain', () => {
    const tiers = Object.fromEntries(t.branches[0]!.nodes.map((n) => [n.id, n.tier]));
    expect(tiers).toEqual({ strength: 0, focus: 0, blade: 1, guard: 1, spark: 1, storm: 2 });
    expect(tierCount(t.branches[0]!)).toBe(3);
  });

  it('adds NO tier gate — an old tree must not suddenly lock', () => {
    expect(t.pointsPerTier).toBe(0);
    const s = new SkillState(t);
    s.addPoints(10);
    // 'storm' is tier 2 but only gated by requires, exactly as before.
    expect(s.canInvest('storm')).toBe('needsRequires');
    s.invest('focus');
    s.invest('spark');
    expect(s.canInvest('storm')).toBe('ok');
  });

  it('makes every legacy node single-rank', () => {
    for (const n of t.branches[0]!.nodes) expect(n.maxRank).toBe(1);
  });
});

describe('branches, tiers and ranks', () => {
  const def = normalizeSkillTree({
    points: 0,
    pointsPerTier: 5,
    branches: [
      {
        id: 'might',
        name: 'MIGHT',
        nodes: [
          { id: 'str', name: 'Strength', emoji: 'sword', cost: 1, maxRank: 5, tier: 0 },
          { id: 'deep', name: 'Deep Cut', emoji: 'sword', cost: 1, maxRank: 3, tier: 1 },
        ],
      },
      {
        id: 'guile',
        name: 'GUILE',
        nodes: [{ id: 'dodge', name: 'Dodge', emoji: 'boot', cost: 1, maxRank: 5, tier: 0 }],
      },
    ],
  });

  it('colours unlabelled branches from the palette', () => {
    expect(def.branches[0]!.color).toBe(BRANCH_COLORS[0]);
    expect(def.branches[1]!.color).toBe(BRANCH_COLORS[1]);
  });

  it('invests up to maxRank and then reports maxed', () => {
    const s = new SkillState(def);
    s.addPoints(10);
    for (let i = 0; i < 5; i++) expect(s.invest('str')).toBe(true);
    expect(s.rankOf('str')).toBe(5);
    expect(s.canInvest('str')).toBe('maxed');
    expect(s.invest('str')).toBe(false);
  });

  it('refuses when the player cannot afford it', () => {
    const s = new SkillState(def);
    expect(s.canInvest('str')).toBe('noPoints');
  });

  /** The rule that makes a build a choice: spreading points across
   *  branches must never open a deep tier. */
  it('gates tiers PER BRANCH, not on total points spent', () => {
    const s = new SkillState(def);
    s.addPoints(12); // enough left over to isolate the GATE from the wallet
    for (let i = 0; i < 5; i++) s.invest('dodge'); // 5 points, all in GUILE
    expect(s.totalSpent()).toBe(5);
    expect(s.spentIn('might')).toBe(0);
    expect(s.canInvest('deep')).toBe('needsTier'); // still shut
    for (let i = 0; i < 5; i++) s.invest('str'); // now 5 in MIGHT
    expect(s.canInvest('deep')).toBe('ok');
  });

  it('refunds every spent point on respec', () => {
    const s = new SkillState(def);
    s.addPoints(10);
    s.invest('str');
    s.invest('dodge');
    expect(s.points).toBe(8);
    expect(s.respec()).toBe(2);
    expect(s.points).toBe(10);
    expect(s.unlockedIds()).toEqual([]);
  });
});

describe('saves', () => {
  const def = normalizeSkillTree({
    points: 3,
    branches: [{ id: 'b', name: 'B', nodes: [{ id: 'x', name: 'X', emoji: '✦', cost: 1, maxRank: 3, tier: 0 }] }],
  });

  it('round-trips ranks and points', () => {
    const s = new SkillState(def);
    s.invest('x');
    s.invest('x');
    const t = new SkillState(def);
    t.load(s.save());
    expect(t.rankOf('x')).toBe(2);
    expect(t.points).toBe(1);
  });

  /** v1 saved a flat unlocked-id list. Those players must not lose progress. */
  it('migrates a v1 save', () => {
    const s = new SkillState(def);
    s.load({ points: 2, unlocked: ['x'] });
    expect(s.rankOf('x')).toBe(1);
    expect(s.points).toBe(2);
  });

  it('clamps to a lowered maxRank and refunds the difference', () => {
    const smaller = normalizeSkillTree({
      points: 0,
      branches: [{ id: 'b', name: 'B', nodes: [{ id: 'x', name: 'X', emoji: '✦', cost: 1, maxRank: 1, tier: 0 }] }],
    });
    const s = new SkillState(smaller);
    s.load({ points: 0, ranks: [['x', 3]] });
    expect(s.rankOf('x')).toBe(1);
    expect(s.points).toBe(2); // the two ranks that no longer fit came back
  });

  it('drops ranks for nodes the author deleted', () => {
    const s = new SkillState(def);
    s.load({ points: 1, ranks: [['gone', 4]] });
    expect(s.unlockedIds()).toEqual([]);
    expect(s.points).toBe(1);
  });

  it('survives junk without throwing', () => {
    const s = new SkillState(def);
    expect(() => s.load('nonsense')).not.toThrow();
    expect(() => s.load(null)).not.toThrow();
    expect(s.points).toBe(3);
  });
});

describe('malformed definitions', () => {
  it('survives an empty or absent def', () => {
    expect(normalizeSkillTree(undefined).branches).toHaveLength(1);
    expect(normalizeSkillTree({}).branches[0]!.nodes).toEqual([]);
  });

  it('terminates on a requires cycle instead of hanging', () => {
    const t = normalizeSkillTree({
      points: 1,
      nodes: [
        { id: 'a', requires: ['b'] },
        { id: 'b', requires: ['a'] },
      ],
    });
    expect(t.branches[0]!.nodes).toHaveLength(2);
  });
});
