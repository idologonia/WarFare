import { describe, expect, it } from 'vitest';
import { freshMission, place, isolate } from './helpers';
import { generateUnit } from '@/game/units/generator';
import { Rng } from '@/core/rng';
import { newId } from '@/game/simulation/state';
import { getEdge } from '@/game/maps/map';
import { countDisposable, launcherOf } from '@/game/combat/launcher';
import { validateMods } from '@/game/equipment/mods';
import { countItems } from '@/game/inventory/inventory';

function withGrenadier(seed: number, classId: string) {
  const m = freshMission(seed);
  m.dispatch({ type: 'startBattle' });
  const s = m.state;
  const g = generateUnit('blue', classId, new Rng(seed), (p) => newId(s, p));
  g.status = 'active';
  g.ap = 200;
  g.apMax = 200;
  s.units.push(g);
  const foe = s.units.find((u) => u.side === 'red')!;
  isolate(s, [g, foe]);
  g.status = 'active';
  foe.status = 'active';
  foe.pos = { x: 22, y: 0, z: 0 };
  return { m, s, g };
}

describe('гранатомети', () => {
  it('РПГ-7: постріл у стіну робить пролом, після пострілу треба зарядити', () => {
    const { m, s, g } = withGrenadier(1, 'grenadier1');
    place(g, { x: 12, y: 17, z: 0 });
    expect(launcherOf(g)!.loaded).toBe(true);
    // ціль — клітинка за південною стіною будинку; стрілець стоїть строго навпроти
    const r = m.dispatch({ type: 'launch', unitId: g.id, kind: 'rpg', cell: { x: 12, y: 10, z: 0 } });
    expect(r.ok).toBe(true);
    expect(r.events.some((e) => e.t === 'rocket')).toBe(true);
    expect(r.events.some((e) => e.t === 'explosion')).toBe(true);
    expect(launcherOf(g)!.loaded).toBe(false);
    expect(m.dispatch({ type: 'launch', unitId: g.id, kind: 'rpg', cell: { x: 12, y: 10, z: 0 } }).ok).toBe(false);
    expect(m.dispatch({ type: 'reloadLauncher', unitId: g.id }).ok).toBe(true);
    expect(launcherOf(g)!.loaded).toBe(true);
    // хоча б одна ділянка стіни зруйнована або пошкоджена
    const walls = [11, 12, 13].map((x) => getEdge(s.map, { x, y: 10, z: 0 }, 's')?.defId);
    expect(walls.some((w) => w !== 'brick_wall' && w !== 'door')).toBe(true);
  });

  it('Bulspike одноразовий: після пострілу зникає', () => {
    const { m, g } = withGrenadier(2, 'grenadier2');
    place(g, { x: 12, y: 20, z: 0 });
    expect(countDisposable(g)).toBe(1);
    expect(m.dispatch({ type: 'launch', unitId: g.id, kind: 'disposable', cell: { x: 12, y: 13, z: 0 } }).ok).toBe(true);
    expect(countDisposable(g)).toBe(0);
    expect(m.dispatch({ type: 'launch', unitId: g.id, kind: 'disposable', cell: { x: 12, y: 13, z: 0 } }).ok).toBe(false);
  });

  it('підствольник: навісний постріл витрачає постріл, лежачи з РПГ не стріляють', () => {
    const { m, g } = withGrenadier(3, 'grenadier2');
    place(g, { x: 12, y: 24, z: 0 });
    const before = countItems(g, (d) => d.id === 'vog');
    expect(m.dispatch({ type: 'launch', unitId: g.id, kind: 'ugl', cell: { x: 12, y: 16, z: 0 } }).ok).toBe(true);
    expect(countItems(g, (d) => d.id === 'vog')).toBe(before - 1);
    expect(m.dispatch({ type: 'launch', unitId: g.id, kind: 'ugl', cell: { x: 12, y: 2, z: 0 } }).ok).toBe(false); // задалеко
    const r1 = withGrenadier(4, 'grenadier1');
    place(r1.g, { x: 12, y: 24, z: 0 });
    r1.g.stance = 'prone';
    expect(r1.m.dispatch({ type: 'launch', unitId: r1.g.id, kind: 'rpg', cell: { x: 12, y: 16, z: 0 } }).ok).toBe(false);
  });

  it('підствольний модуль і ручка не ставляться разом', () => {
    expect(validateMods('ak74', ['underbarrel'])).toEqual([]);
    expect(validateMods('ak74', ['rail', 'foregrip', 'underbarrel']).some((e) => e.includes('разом'))).toBe(true);
    expect(validateMods('ar15', ['underbarrel']).some((e) => e.includes('несумісний'))).toBe(true);
  });
});
