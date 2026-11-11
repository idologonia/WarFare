import { describe, expect, it } from 'vitest';
import { freshMission, ctxOf, place, isolate } from './helpers';
import { createMission, Mission } from '@/game/simulation/mission';
import { ignite, tickFire, litByFire } from '@/game/combat/burn';
import { canSee } from '@/game/visibility/visibility';

describe('пожежі', () => {
  it('підпал обпікає бійця (броня не рятує), вогонь згасає з часом', () => {
    const m = freshMission(4);
    m.dispatch({ type: 'startBattle' });
    const s = m.state;
    const u = s.units.find((x) => x.side === 'blue' && !x.inVehicle)!;
    place(u, { x: 6, y: 20, z: 0 });
    const ctx = ctxOf(s);
    const h0 = u.health;
    ignite(ctx, { x: 6, y: 20, z: 0 }, 1.5, 2, null);
    expect(u.health).toBeLessThan(h0);
    expect(u.injuries.some((i) => i.type === 'burn')).toBe(true);
    expect(s.map.cells[0][20][6].fire).toBe(2);
    for (let i = 0; i < 6; i++) tickFire(ctx);
    expect(s.map.cells[0][20][6].fire).toBeUndefined();
  });

  it('уночі вогонь освітлює; опущений ПНБ засвічується, відкинутий — бачить', () => {
    const m = new Mission(createMission('night_raid', { seed: 2 }));
    m.dispatch({ type: 'startBattle' });
    const s = m.state;
    const a = s.units.find((x) => x.side === 'blue' && !x.inVehicle)!;
    const b = s.units.find((x) => x.side === 'red')!;
    isolate(s, [a, b]);
    a.status = b.status = 'active';
    b.lightOn = false;
    a.inventory.helmetMounts = [{ id: 'n1', defId: 'nvg_bino' }];
    a.nvgUp = false;
    a.facing = 4;
    place(a, { x: 8, y: 10, z: 0 });
    place(b, { x: 8, y: 18, z: 0 });
    ignite(ctxOf(s), { x: 9, y: 18, z: 0 }, 0.5, 3, null);
    expect(litByFire(s, b.pos!)).toBe(true);
    expect(canSee(s, a, b).seen).toBe(false);
    a.nvgUp = true;
    expect(canSee(s, a, b).seen).toBe(true);
  });
});
