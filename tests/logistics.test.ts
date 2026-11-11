import { describe, expect, it } from 'vitest';
import { freshMission, place, isolate } from './helpers';
import { caches } from '@/game/logistics';
import { itemDef } from '@/content';
import { createMission } from '@/game/simulation/mission';

describe('логістика', () => {
  it('склади сценарію: взяти магазин з ящика, покласти назад, далеко — не можна', () => {
    const m = freshMission(5);
    m.dispatch({ type: 'startBattle' });
    const s = m.state;
    const box = caches(s).find((c) => c.side === 'blue' && c.pos)!;
    expect(box).toBeTruthy();
    expect(s.map.cells[0][box.pos!.y][box.pos!.x].object?.defId).toBe('crates');
    const u = s.units.find((x) => x.side === 'blue' && !x.inVehicle)!;
    const foe = s.units.find((x) => x.side === 'red')!;
    isolate(s, [u, foe]);
    foe.status = 'active';
    place(foe, { x: 20, y: 2, z: 0 });
    u.status = 'active';
    u.ap = 100;
    s.turn.side = 'blue';
    const mi = box.items.findIndex((i) => itemDef(i.defId).kind === 'medical');
    place(u, { x: box.pos!.x + 5, y: box.pos!.y, z: 0 });
    expect(m.dispatch({ type: 'moveItem', unitId: u.id, from: { owner: box.id, area: 'pouches', index: mi }, to: { owner: u.id, area: 'belt' } }).ok).toBe(false);
    place(u, { x: box.pos!.x + 1, y: box.pos!.y, z: 0 });
    u.inventory.belt = [];
    const n0 = box.items.length;
    const r = m.dispatch({ type: 'moveItem', unitId: u.id, from: { owner: box.id, area: 'pouches', index: mi }, to: { owner: u.id, area: 'belt' } });
    expect(r.ok ? '' : r.error).toBe('');
    expect(box.items.length).toBe(n0 - 1);
    expect(u.inventory.belt.length).toBe(1);
    // Покласти назад.
    { const r2 = m.dispatch({ type: 'moveItem', unitId: u.id, from: { owner: u.id, area: 'belt', index: 0 }, to: { owner: box.id, area: 'pouches' } }); expect(r2.ok ? '' : r2.error).toBe(''); }
    expect(box.items.length).toBe(n0);
  });

  it('передача живому бійцю поруч: гранату можна, зброю — ні', () => {
    const m = freshMission(6);
    m.dispatch({ type: 'startBattle' });
    const s = m.state;
    const [a, b] = s.units.filter((x) => x.side === 'blue' && !x.inVehicle);
    const foe = s.units.find((x) => x.side === 'red')!;
    isolate(s, [a, b, foe]);
    foe.status = 'active';
    place(foe, { x: 20, y: 2, z: 0 });
    for (const x of [a, b]) { x.status = 'active'; x.ap = 100; }
    s.turn.side = 'blue';
    place(a, { x: 5, y: 28, z: 0 });
    place(b, { x: 6, y: 28, z: 0 });
    a.inventory.belt = [{ id: 'gx', defId: 'rgd5', uses: 1 }];
    b.inventory.belt = [];
    expect(m.dispatch({ type: 'moveItem', unitId: a.id, from: { owner: a.id, area: 'belt', index: 0 }, to: { owner: b.id, area: 'belt' } }).ok).toBe(true);
    expect(b.inventory.belt[0].defId).toBe('rgd5');
    expect(m.dispatch({ type: 'moveItem', unitId: a.id, from: { owner: a.id, area: 'primary' }, to: { owner: b.id, area: 'primary' } }).ok).toBe(false);
  });

  it('техніка везе вантаж постачання', () => {
    const s = createMission('armor_assault', { seed: 3 });
    const cargo = (s.supplies ?? []).filter((c: { vehicleId?: string }) => c.vehicleId);
    expect(cargo.length).toBeGreaterThan(0);
    expect(cargo[0].items.length).toBeGreaterThan(5);
  });
});
