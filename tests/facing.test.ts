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
    expect(ap0 - a.ap).toBe(0);
    expect(canSee(s, a, b).seen).toBe(true);
    // Рух розвертає бійця за останнім кроком.
    m.dispatch({ type: 'move', unitId: a.id, to: { x: 6, y: 20, z: 0 }, mode: 'standard' });
    expect(a.facing).toBe(2);
  });
});

import { revealShooter } from '@/game/combat/fire';
import { ctxOf } from './helpers';

describe('звук пострілу й глушник', () => {
  it('без глушника вороги в 14 клітинках чують стрільця; з глушником — лише впритул', () => {
    const m = freshMission(12);
    m.dispatch({ type: 'startBattle' });
    const s = m.state;
    const a = s.units.find((u) => u.side === 'blue' && !u.inVehicle)!;
    const b = s.units.find((u) => u.side === 'red')!;
    isolate(s, [a, b]);
    a.status = b.status = 'active';
    place(a, { x: 5, y: 20, z: 0 });
    place(b, { x: 5, y: 10, z: 0 });
    a.inventory.primary!.mods = ['suppressor'];
    s.contacts.red = {};
    revealShooter(ctxOf(s), a);
    expect(s.contacts.red[a.id]).toBeUndefined();
    a.inventory.primary!.mods = [];
    revealShooter(ctxOf(s), a);
    expect(s.contacts.red[a.id]?.pos).toEqual(a.pos);
    expect(s.contacts.red[a.id]?.visible).toBe(false);
  });
});
