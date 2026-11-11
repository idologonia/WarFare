import { createMission, Mission } from '@/game/simulation/mission';
import type { Command } from '@/game/simulation/commands';
import type { MissionState } from '@/game/simulation/state';
import type { Difficulty, SideId } from '@/game/types';

/**
 * Мережева місія: однаково створюється на сервері й у клієнтів (детермінована за seed).
 * Обидві сторони — гравці; розгортання автоматичне; бій починається одразу.
 */
export function createOnlineMission(scenarioId: string, seed: number, difficulty: Difficulty): MissionState {
  const state = createMission(scenarioId, { seed, difficulty, controllers: { blue: 'human', red: 'human' }, revealAll: false });
  const m = new Mission(state);
  for (const side of ['blue', 'red'] as SideId[]) m.dispatch({ type: 'autoDeploy', side });
  m.dispatch({ type: 'startBattle' });
  return m.state;
}

/** Чи належить команда стороні гравця (свої бійці, техніка, дрони; хід — свій). */
export function commandAllowed(s: MissionState, side: SideId, cmd: Command): string | null {
  if (s.turn.side !== side) return 'Зараз не ваш хід';
  const c = cmd as Partial<{ side: SideId; unitId: string; vehicleId: string; droneId: string }>;
  if (c.side && c.side !== side) return 'Чужа сторона';
  if (c.unitId && s.units.find((u) => u.id === c.unitId)?.side !== side) return 'Це не ваш боєць';
  if (c.vehicleId && (s.vehicles ?? []).find((v) => v.id === c.vehicleId)?.side !== side) return 'Це не ваша техніка';
  if (c.droneId && (s.drones ?? []).find((d) => d.id === c.droneId)?.side !== side) return 'Це не ваш дрон';
  return null;
}
