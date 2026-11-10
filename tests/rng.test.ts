import { describe, expect, it } from 'vitest';
import { Rng } from '@/core/rng';

describe('Rng', () => {
  it('детермінований за seed і серіалізується', () => {
    const a = Rng.fromSeed('test');
    const seq = [a.next(), a.next(), a.next()];
    const b = Rng.fromSeed('test');
    expect([b.next(), b.next(), b.next()]).toEqual(seq);
    const c = new Rng(a.state);
    const d = new Rng(a.state);
    expect(c.int(0, 100)).toBe(d.int(0, 100));
  });
  it('int у межах', () => {
    const r = new Rng(1);
    for (let i = 0; i < 1000; i++) {
      const v = r.int(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
    }
  });
});
