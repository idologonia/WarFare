import { describe, expect, it } from 'vitest';
import { freshMission, place, isolate, ctxOf } from './helpers';
import { createMission, Mission } from '@/game/simulation/mission';
import { canPlace, crew, damageVehicle, footprint, spawnVehicle, embark, vehicleReachable } from '@/game/vehicles';
import { isStandable, getEdge } from '@/game/maps/map';
import { trace, cellCenter } from '@/game/visibility/los';
import { generateUnit } from '@/game/units/generator';
import { Rng } from '@/core/rng';
import { newId } from '@/game/simulation/state';
import { setExtraArmor } from '@/game/equipment/loadout';
import { applyHit } from '@/game/injuries/injuries';
import { totalWeight } from '@/game/inventory/inventory';

function withVehicle(seed: number, defId: string, x: number, y: number) {
  const m = freshMission(seed);
  m.dispatch({ type: 'startBattle' });
  const s = m.state;
  const id = (p: string) => newId(s, p);
  const v = spawnVehicle(s, 'blue', defId, x, y, id);
  const d = generateUnit('blue', 'driver', new Rng(seed), id);
  const g = generateUnit('blue', 'rifleman', new Rng(seed + 1), id);
  d.ap = g.ap = 120;
  s.units.push(d, g);
  embark(v, d, 'driver');
  embark(v, g, 'gunner');
  return { m, s, v, d, g };
}

describe('техніка', () => {
  it('займає 2×2 клітинки, блокує рух і огляд', () => {
    const { s, v } = withVehicle(1, 'mtlb', 15, 26);
    expect(footprint(v).length).toBe(4);
    expect(isStandable(s.map, { x: 16, y: 27, z: 0 })).toBe(false);
    const tr = trace(s.map, cellCenter({ x: 15, y: 30, z: 0 }, 0.6), cellCenter({ x: 15, y: 23, z: 0 }, 0.6));
    expect(tr.blocked && tr.blockKind === 'vehicle').toBe(true);
  });

  it('рух за AP водія; розчавлює паркан, але не проходить крізь будинок', () => {
    const { m, s, v, d } = withVehicle(2, 'mtlb', 16, 23);
    // паркан між рядами 21 і 22 (x 16..21, межа n рядка 22)
    expect(getEdge(s.map, { x: 17, y: 22, z: 0 }, 'n')?.defId).toBe('fence');
    const ap0 = d.ap;
    const r = m.dispatch({ type: 'vehicleMove', vehicleId: v.id, x: 16, y: 20 });
    expect(r.ok).toBe(true);
    expect(d.ap).toBeLessThan(ap0);
    expect(v.y).toBe(20);
    expect(getEdge(s.map, { x: 17, y: 22, z: 0 }, 'n')).toBeNull();
    const nodes = vehicleReachable(s, v, 1000);
    expect(nodes.has('12,7')).toBe(false); // всередині будинку
  });

  it('посадка й висадка коштують AP; без водія техніка стоїть', () => {
    const { m, s, v, d } = withVehicle(3, 'mtlb', 15, 26);
    const u = s.units.find((x) => x.side === 'blue' && x.classId === 'rifleman' && !x.inVehicle)!;
    place(u, { x: 14, y: 27, z: 0 });
    u.ap = 100;
    expect(m.dispatch({ type: 'embark', unitId: u.id, vehicleId: v.id }).ok).toBe(true);
    expect(u.inVehicle).toBe(v.id);
    expect(u.pos).toBeNull();
    expect(u.ap).toBe(80);
    expect(m.dispatch({ type: 'disembark', unitId: d.id, cell: { x: 17, y: 26, z: 0 } }).ok).toBe(true);
    expect(v.driver).toBeNull();
    expect(m.dispatch({ type: 'vehicleMove', vehicleId: v.id, x: 15, y: 24 }).ok).toBe(false);
  });

  it('броня зупиняє кулі; кумулятивний постріл пробиває й ранить екіпаж; знищення висаджує екіпаж', () => {
    const { s, v } = withVehicle(4, 'mtlb', 15, 26);
    const ctx = ctxOf(s, 3);
    const hull = v.hp.hull;
    damageVehicle(ctx, v, 25, 3, false);
    expect(v.hp.hull).toBeGreaterThanOrEqual(hull - 2);
    for (let i = 0; i < 6 && !v.destroyed; i++) damageVehicle(ctx, v, 70, 8, true);
    expect(v.destroyed).toBe(true);
    expect(crew(s, v).length).toBe(0);
    expect(s.units.filter((u) => u.classId === 'driver').every((u) => u.pos !== null)).toBe(true);
  });

  it('навідник стріляє з бортової зброї за свої AP', () => {
    const { m, s, v, g } = withVehicle(5, 'mtlb', 15, 26);
    const t = s.units.find((u) => u.side === 'red')!;
    isolate(s, [t, ...s.units.filter((u) => u.inVehicle)]);
    t.status = 'active';
    place(t, { x: 16, y: 20, z: 0 });
    s.revealAll = true;
    const ap = g.ap;
    const r = m.dispatch({ type: 'vehicleFire', vehicleId: v.id, target: { unitId: t.id }, mode: 'burst' });
    expect(r.ok).toBe(true);
    expect(g.ap).toBeLessThan(ap);
    expect(v.weapon!.magazine!.rounds).toBeLessThan(100);
  });

  it('сценарій із технікою: екіпаж створюється, бій AI проти AI завершується', async () => {
    const { AiPlanner } = await import('@/game/ai/ai');
    const m = new Mission(createMission('armor_assault', { seed: 7, controllers: { blue: 'ai', red: 'ai' } }));
    expect(m.state.vehicles!.length).toBe(2);
    expect(m.state.vehicles!.every((v) => v.driver)).toBe(true);
    m.dispatch({ type: 'startBattle' });
    const ai = new AiPlanner(7);
    let n = 0;
    while (m.state.turn.phase === 'battle' && n++ < 20000) {
      const c = ai.next(m.state)!;
      const r = m.dispatch(c);
      if (!r.ok && 'unitId' in c) ai.reject(c.unitId);
      if (!r.ok && 'vehicleId' in c) ai.reject(c.vehicleId);
      if (!r.ok && 'droneId' in c) ai.reject(c.droneId);
    }
    expect(m.state.turn.phase).toBe('ended');
  }, 60000);

  it('canPlace не ставить техніку на стіну чи в будинок', () => {
    const m = freshMission(8);
    expect(canPlace(m.state, 'mtlb', 12, 6)).toBe(false);
    expect(canPlace(m.state, 'mtlb', 20, 28)).toBe(true);
  });
});

describe('розширений захист', () => {
  it('додаткові елементи кріпляться до бронежилета, додають вагу й можуть зупинити влучання', () => {
    const m = freshMission(9);
    const u = m.state.units.find((x) => x.side === 'blue')!;
    const w0 = totalWeight(u.inventory);
    expect(setExtraArmor(m.state, u, ['neck_guard', 'leg_guards', 'side_plates'])).toBeNull();
    expect(totalWeight(u.inventory)).toBeGreaterThan(w0);
    u.inventory.armor = null;
    expect(setExtraArmor(m.state, u, ['neck_guard'])).not.toBeNull();
    expect(setExtraArmor(m.state, u, ['leg_guards'])).toBeNull(); // ноги — без бронежилета теж
    let stopped = 0;
    for (let i = 0; i < 40; i++) {
      const v = m.state.units.find((x) => x.side === 'red')!;
      v.health = 200;
      v.injuries = [];
      v.inventory.extraArmor = [{ id: 'x' + i, defId: 'leg_guards', durability: 999 }];
      const ctx = ctxOf(m.state, i);
      ctx.ev = [];
      applyHit(ctx, v, 25, 2, 'shrapnel', { part: 'leftLeg' });
      if (ctx.ev.some((e) => e.t === 'damaged' && e.armorStopped)) stopped++;
    }
    expect(stopped).toBeGreaterThan(3);
  });
});
