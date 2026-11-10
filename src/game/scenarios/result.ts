import type { MissionState } from '@/game/simulation/state';
import type { MissionResult, SideId } from '@/game/types';

/** Підсумок місії: втрати, поранення, витрачені БК і медицина, ефективність бійців. */
export function computeResult(s: MissionState, winner: SideId | null, reason: MissionResult['reason']): MissionResult {
  const perSide = {} as MissionResult['perSide'];
  for (const side of ['blue', 'red'] as SideId[]) {
    const us = s.units.filter((u) => u.side === side && u.status !== 'reserve');
    perSide[side] = {
      killed: us.filter((u) => u.status === 'dead' || (u.status === 'evacuated' && u.health <= 0)).length,
      wounded: us.filter((u) => u.health > 0 && u.injuries.length > 0).length,
      evacuated: us.filter((u) => u.status === 'evacuated').length,
      leftOnField: us.filter((u) => (u.status === 'dead' || u.status === 'down') && (u.pos || u.carriedBy)).length,
      roundsUsed: us.reduce((a, u) => a + u.stats_mission.roundsUsed, 0),
      grenades: us.reduce((a, u) => a + u.stats_mission.grenades, 0),
      medsUsed: us.reduce((a, u) => a + u.stats_mission.medsUsed, 0),
    };
  }
  return {
    winner,
    reason,
    turns: s.turn.turn,
    perSide,
    units: s.units
      .filter((u) => u.status !== 'reserve')
      .map((u) => ({ id: u.id, name: `${u.name} «${u.callsign}»`, side: u.side, status: u.status, stats: { ...u.stats_mission }, health: u.health, injuries: u.injuries.length })),
  };
}
