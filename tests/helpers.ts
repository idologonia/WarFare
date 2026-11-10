import { createMission, Mission } from '@/game/simulation/mission';
import { Rng } from '@/core/rng';
import type { Ctx, MissionState } from '@/game/simulation/state';
import type { Cell } from '@/core/grid';
import type { Unit } from '@/game/types';

export function freshMission(seed = 42, opts: Parameters<typeof createMission>[1] = {}): Mission {
  return new Mission(createMission('first_mission', { seed, ...opts }));
}

export function ctxOf(s: MissionState, seed = 7): Ctx {
  return { s, rng: new Rng(seed), ev: [] };
}

/** Поставити бійця в конкретну клітинку (для тестів). */
export function place(u: Unit, c: Cell): void {
  u.pos = { ...c };
}

/** Прибрати всіх бійців з поля, крім заданих. */
export function isolate(s: MissionState, keep: Unit[]): void {
  for (const u of s.units) if (!keep.includes(u)) { u.pos = null; u.status = 'evacuated'; }
}
