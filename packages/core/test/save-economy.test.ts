import { beforeEach, describe, expect, it } from 'vitest';
import { createSave } from '../src/save/save.js';
import { verium } from '../src/economy/wallet.js';

beforeEach(() => {
  window.localStorage.clear();
});

describe('createSave', () => {
  it('round-trips JSON values with fallbacks', () => {
    const s = createSave('t-basic');
    expect(s.get('missing', 'fallback')).toBe('fallback');
    s.set('n', 42);
    s.set('obj', { a: [1, 2] });
    expect(s.get('n', 0)).toBe(42);
    expect(s.get('obj', {})).toEqual({ a: [1, 2] });
    s.remove('n');
    expect(s.get('n', -1)).toBe(-1);
  });

  it('persists through localStorage under a namespaced key', () => {
    const s = createSave('t-persist');
    s.set('k', 'v');
    const raw = window.localStorage.getItem('interverse:t-persist');
    expect(raw).toContain('"v"');
    // a second store over the same namespace sees the data
    const s2 = createSave('t-persist');
    expect(s2.get('k', '')).toBe('v');
  });

  it('migrates older versions through the migrate hook', () => {
    window.localStorage.setItem('interverse:t-mig', JSON.stringify({ v: 1, data: { coins: 5 } }));
    const s = createSave('t-mig', 2, (data, from) => {
      expect(from).toBe(1);
      return { coins: (Number(data.coins) || 0) * 10 };
    });
    expect(s.get('coins', 0)).toBe(50);
  });

  it('keeps namespaces isolated', () => {
    const a = createSave('t-a');
    const b = createSave('t-b');
    a.set('k', 1);
    expect(b.get('k', 0)).toBe(0);
  });
});

describe('verium wallet', () => {
  it('adds, spends, and refuses overdrafts (clamped integers)', () => {
    const start = verium.balance();
    verium.add(10);
    expect(verium.balance()).toBe(start + 10);
    expect(verium.spend(start + 5)).toBe(true);
    expect(verium.balance()).toBe(5);
    expect(verium.spend(9999)).toBe(false);
    expect(verium.balance()).toBe(5);
    verium.add(-3); // ignored
    verium.add(2.9); // floored
    expect(verium.balance()).toBe(7);
  });
});
