import { describe, expect, it } from 'vitest';
import { Mission } from '@/game/simulation/mission';
import { commandAllowed, createOnlineMission } from '@/net/onlineMission';

describe('мережа HGS: спільні правила клієнта й сервера', () => {
  it('однакова місія з однакового seed (сервер і обидва клієнти)', () => {
    const a = createOnlineMission('first_mission', 777, 'medium');
    const b = createOnlineMission('first_mission', 777, 'medium');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.turn.phase).toBe('battle');
    expect(a.controllers).toEqual({ blue: 'human', red: 'human' });
  });

  it('дії однаково застосовуються на обох копіях; чужі дії відхиляються', () => {
    const srv = new Mission(createOnlineMission('first_mission', 9, 'medium'));
    const cli = new Mission(createOnlineMission('first_mission', 9, 'medium'));
    const blue = srv.state.units.find((u) => u.side === 'blue' && u.pos && !u.inVehicle)!;
    const red = srv.state.units.find((u) => u.side === 'red')!;
    const mv = { type: 'move' as const, unitId: blue.id, to: { x: blue.pos!.x, y: blue.pos!.y - 1, z: 0 }, mode: 'standard' as const };
    expect(commandAllowed(srv.state, 'red', mv)).not.toBeNull(); // не його хід
    expect(commandAllowed(srv.state, 'blue', { type: 'stance', unitId: red.id, stance: 'prone' })).toBe('Це не ваш боєць');
    expect(commandAllowed(srv.state, 'blue', mv)).toBeNull();
    for (const cmd of [mv, { type: 'endTurn' as const }]) {
      expect(srv.dispatch(cmd).ok).toBe(true);
      expect(cli.dispatch(cmd).ok).toBe(true);
    }
    expect(JSON.stringify(cli.state)).toBe(JSON.stringify(srv.state));
  });
});
