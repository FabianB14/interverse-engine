import { describe, expect, it } from 'vitest';
import {
  PARTY_TETHER,
  REVIVE_SECS,
  emptyMember,
  inReviveRange,
  partyCenter,
  partyHpScale,
  partyLimit,
  partyWiped,
  pickTarget,
  reviveProgress,
  standing,
  tetheredX,
} from '../src/index.js';
import type { PartyMember } from '../src/index.js';

function member(id: string, x: number, y = 0, downed = false): PartyMember {
  return { ...emptyMember(id, id, 'knight'), x, y, downed, hearts: downed ? 0 : 3, heartsMax: 3 };
}

describe('reviving', () => {
  it('fills over REVIVE_SECS while a friend stands over you', () => {
    let p = 0;
    for (let i = 0; i < 20; i++) p = reviveProgress(p, true, 0.1);
    expect(p).toBe(REVIVE_SECS);
  });

  it('decays rather than resetting when the rescuer steps away', () => {
    const p = reviveProgress(1.5, false, 0.2);
    // Lost some, kept most — a half-second knockback must not throw away
    // the work already done.
    expect(p).toBeLessThan(1.5);
    expect(p).toBeGreaterThan(1);
  });

  it('never goes below zero or above the full time', () => {
    expect(reviveProgress(0.1, false, 5)).toBe(0);
    expect(reviveProgress(REVIVE_SECS, true, 5)).toBe(REVIVE_SECS);
  });

  it('is generous about what counts as standing over someone', () => {
    expect(inReviveRange({ x: 0, y: 0 }, { x: 80, y: 40 })).toBe(true);
    expect(inReviveRange({ x: 0, y: 0 }, { x: 300, y: 0 })).toBe(false);
  });
});

describe('party outcomes', () => {
  it('is only wiped when everyone is down', () => {
    expect(partyWiped([member('a', 0, 0, true), member('b', 0, 0, false)])).toBe(false);
    expect(partyWiped([member('a', 0, 0, true), member('b', 0, 0, true)])).toBe(true);
  });

  it('is not wiped when there is no party at all', () => {
    expect(partyWiped([])).toBe(false);
  });

  it('lists who is still fighting', () => {
    const all = [member('a'), member('b', 0, 0, true)];
    expect(standing(all).map((m) => m.id)).toEqual(['a']);
  });
});

describe('scaling', () => {
  it('is 1x for a solo run', () => {
    expect(partyHpScale(1)).toBe(1);
  });

  it('grows sublinearly — each extra player adds less than a whole player', () => {
    for (let n = 2; n <= 8; n++) {
      const added = partyHpScale(n) - partyHpScale(n - 1);
      expect(added).toBeGreaterThan(0);
      expect(added).toBeLessThan(1);
    }
  });

  it('still leaves a party killing things faster than one player alone', () => {
    // Four players stack close to 4x damage on a boss; 2.8x health means the
    // fight is longer than a quarter of solo, but shorter than solo.
    expect(4 / partyHpScale(4)).toBeGreaterThan(1);
    expect(partyHpScale(4)).toBeCloseTo(2.8);
  });

  it('treats nonsense counts as one player', () => {
    expect(partyHpScale(0)).toBe(1);
    expect(partyHpScale(-3)).toBe(1);
  });
});

describe('targeting', () => {
  it('picks the nearest standing player', () => {
    const party = [member('far', 500), member('near', 60)];
    expect(pickTarget({ x: 0, y: 0 }, party)?.id).toBe('near');
  });

  it('ignores downed players even when they are closest', () => {
    const party = [member('down', 10, 0, true), member('up', 400)];
    expect(pickTarget({ x: 0, y: 0 }, party)?.id).toBe('up');
  });

  it('has nobody to attack when the party is wiped', () => {
    expect(pickTarget({ x: 0, y: 0 }, [member('a', 0, 0, true)])).toBeNull();
  });
});

describe('camera and tether', () => {
  it('centres on the average of those still standing', () => {
    const c = partyCenter([member('a', 100, 20), member('b', 300, 60)]);
    expect(c).toEqual({ x: 200, y: 40 });
  });

  it('falls back to the whole party once everyone is down', () => {
    const c = partyCenter([member('a', 100, 0, true), member('b', 300, 0, true)]);
    expect(c?.x).toBe(200);
  });

  it('has no opinion about an empty party', () => {
    expect(partyCenter([])).toBeNull();
  });

  it('stops a runner rather than dragging them back', () => {
    expect(tetheredX(200, 0)).toBe(200);
    expect(tetheredX(PARTY_TETHER + 500, 0)).toBe(PARTY_TETHER);
    expect(tetheredX(-PARTY_TETHER - 500, 0)).toBe(-PARTY_TETHER);
  });

  it('makes the gate a wall at the same place for everyone', () => {
    expect(partyLimit(1200)).toBe(1200);
  });
});
