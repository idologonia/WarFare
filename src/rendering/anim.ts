import type { Scene } from './babylon';

interface Tween {
  start: number;
  dur: number;
  fn: (t: number) => void;
  done: () => void;
}

/** Прості твіни поверх циклу рендерингу. */
export class Animator {
  private tweens: Tween[] = [];
  speed = 1;

  constructor(scene: Scene) {
    scene.onBeforeRenderObservable.add(() => this.tick());
  }

  tween(durMs: number, fn: (t: number) => void): Promise<void> {
    return new Promise((done) => {
      if (durMs <= 0) {
        fn(1);
        done();
        return;
      }
      this.tweens.push({ start: performance.now(), dur: durMs / this.speed, fn, done });
    });
  }

  wait(ms: number): Promise<void> {
    return this.tween(ms, () => {});
  }

  private tick(): void {
    const now = performance.now();
    const keep: Tween[] = [];
    for (const tw of this.tweens) {
      const t = Math.min(1, (now - tw.start) / tw.dur);
      tw.fn(t);
      if (t >= 1) tw.done();
      else keep.push(tw);
    }
    this.tweens = keep;
  }
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
