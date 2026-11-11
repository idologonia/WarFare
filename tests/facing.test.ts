import { describe, expect, it } from 'vitest';
import { freshMission, place, isolate } from './helpers';
import { canSee } from '@/game/visibility/visibility';
import { dirTo } from '@/game/units/facing';

describe('напрямок погляду', () => {
  it('8 напрямків; позаду не бачить, після повороту — бачить; поворот коштує AP', () => {
    expect([dirTo(0, -1), dirTo(1, 0), dirTo(0, 1), dirTo(-1, -1)]).toEqual([0, 2, 4, 7]);
    const m = freshMission(11);
    m.dispatch({ type: 'startBattle' });
    const s = m.state;
    const a = s.units.find((u) => u.side === 'blue' && !u.inVehicle)!;
    const b = s.units.find((u) => u.side === 'red')!;
    isolate(s, [a, b]);
    a.status = b.status = 'active';
    s.turn.side = 'blue';
    a.ap = 100;
    place(a, { x: 5, y: 20, z: 0 });
    place(b, { x: 5, y: 26, z: 0 });
    a.facing = 0;
    expect(canSee(s, a, b).seen).toBe(false);
    const ap0 = a.ap;
    expect(m.dispatch({ type: 'turn', unitId: a.id, facing: 4 }).ok).toBe(true);
    expect(ap0 - a.ap).toBe(5);
    expect(canSee(s, a, b).seen).toBe(true);
    // Рух розвертає бійця за останнім кроком.
    m.dispatch({ type: 'move', unitId: a.id, to: { x: 6, y: 20, z: 0 }, mode: 'standard' });
    expect(a.facing).toBe(2);
  });
});
