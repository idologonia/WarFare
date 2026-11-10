/**
 * Детермінований генератор випадкових чисел (mulberry32).
 * Стан — одне 32-бітне число, тому легко серіалізується разом із місією.
 */
export class Rng {
  constructor(public state: number) {
    this.state = state >>> 0;
  }

  static fromSeed(seed: number | string): Rng {
    if (typeof seed === 'number') return new Rng(seed);
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return new Rng(h >>> 0);
  }

  /** [0, 1) */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Ціле в [min, max] включно. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Відсотковий кидок: true з імовірністю pct/100. */
  chance(pct: number): boolean {
    return this.next() * 100 < pct;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  /** Вибір за вагами: [[значення, вага], ...]. */
  weighted<T>(items: readonly (readonly [T, number])[]): T {
    const total = items.reduce((s, [, w]) => s + w, 0);
    let r = this.next() * total;
    for (const [v, w] of items) {
      r -= w;
      if (r < 0) return v;
    }
    return items[items.length - 1][0];
  }

  /** Нормальний розподіл (Box–Muller). */
  gaussian(mean = 0, sd = 1): number {
    const u = Math.max(1e-9, this.next());
    const v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}
