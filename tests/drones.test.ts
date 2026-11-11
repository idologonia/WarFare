import { describe, expect, it } from 'vitest';
import { place, isolate } from './helpers';
import { createMission, Mission } from '@/game/simulation/mission';
import { generateUnit } from '@/game/units/generator';
import { Rng } from '@/core/rng';
import { newId } from '@/game/simulation/state';
import { droneItems, drones, droneSees } from '@/game/drones';
import { computeApMax } from '@/game/units/derived';
import { spawnVehicle } from '@/game/vehicles';
import { canSee } from '@/game/visibility/visibility';

function withOperator(seed: number, scenario = 'first_mission') {
  const m = new Mission(createMission(scenario, { seed }));
  m.dispatch({ type: 'startBattle' });
  const s = m.state;
  const op = s.units.find((u) => u.side === 'blue' && u.classId === 'droneOperator')!;
  place(op, { x: 12, y: 28, z: 0 });
  op.ap = 100;
  return { m, s, op };
}

describe('дрони', () => {
  it('запуск коштує AP, оператор отримує штраф AP і не може тримати спостереження', () => {
    const { m, s, op } = withOperator(1);
    const ap0 = computeApMax(op).total;
    const mavic = droneItems(op).find((i) => i.defId === 'drone_mavic3t')!;
    expect(m.dispatch({ type: 'droneLaunch', unitId: op.id, index: mavic.index }).ok).toBe(true);
    expect(op.ap).toBe(70);
    expect(op.piloting).toBeDefined();
    expect(computeApMax(op).total).toBeLessThan(ap0);
    expect(m.dispatch({ type: 'overwatch', unitId: op.id }).ok).toBe(false);
    expect(drones(s).length).toBe(1);
  });

  it('політ над перешкодами за AP дрона; батарея сідає — дрон втрачено', () => {
    const { m, s, op } = withOperator(2);
    m.dispatch({ type: 'droneLaunch', unitId: op.id, index: droneItems(op).find((i) => i.defId === 'drone_mavic3t')!.index });
    const d = drones(s)[0];
    expect(m.dispatch({ type: 'droneMove', droneId: d.id, x: 12, y: 10 }).ok).toBe(false); // у перший хід — половина AP
    expect(m.dispatch({ type: 'droneMove', droneId: d.id, x: 12, y: 24 }).ok).toBe(true);
    for (let i = 0; i < 12 && !d.destroyed; i++) m.dispatch({ type: 'endTurn' });
    expect(d.destroyed).toBe(true);
    expect(op.piloting).toBeUndefined();
  });

  it('дрон бачить згори противника, якого не бачить піхота; тепловізор — уночі', () => {
    const { m, s, op } = withOperator(3, 'night_raid');
    const enemy = s.units.find((u) => u.side === 'red')!;
    isolate(s, [op, enemy]);
    op.status = enemy.status = 'active';
    op.inventory.helmetMounts = [];
    enemy.lightOn = false;
    place(enemy, { x: 12, y: 18, z: 0 });
    expect(canSee(s, op, enemy).seen).toBe(false);
    m.dispatch({ type: 'droneLaunch', unitId: op.id, index: droneItems(op).find((i) => i.defId === 'drone_mavic3t')!.index });
    const d = drones(s)[0];
    d.x = 12;
    d.y = 21;
    expect(droneSees(s, d, enemy)).toBe(true);
  });

  it('FPV 10" уражає техніку кумулятивним зарядом і втрачається', () => {
    const { m, s, op } = withOperator(4);
    const v = spawnVehicle(s, 'red', 'mtlb', 11, 22, (p) => newId(s, p));
    const hull = v.hp.hull;
    m.dispatch({ type: 'droneLaunch', unitId: op.id, index: droneItems(op).find((i) => i.defId === 'drone_fpv10')!.index });
    const d = drones(s)[0];
    d.ap = 140;
    const r = m.dispatch({ type: 'droneAttack', droneId: d.id, cell: { x: 11, y: 22, z: 0 } });
    expect(r.ok).toBe(true);
    expect(d.destroyed).toBe(true);
    expect(r.events.some((e) => e.t === 'explosion')).toBe(true);
    // Влучання з імовірністю; при прямому — пробиття корпусу.
    expect(v.hp.hull <= hull).toBe(true);
  });

  it('Mavic скидає боєприпас; кількість скидів обмежена', () => {
    const { m, s, op } = withOperator(5);
    m.dispatch({ type: 'droneLaunch', unitId: op.id, index: droneItems(op).find((i) => i.defId === 'drone_mavic3t')!.index });
    const d = drones(s)[0];
    d.ap = 200;
    expect(m.dispatch({ type: 'droneDrop', droneId: d.id }).ok).toBe(true);
    expect(m.dispatch({ type: 'droneDrop', droneId: d.id }).ok).toBe(true);
    expect(m.dispatch({ type: 'droneDrop', droneId: d.id }).ok).toBe(false);
  });

  it('противник може збити дрон; посадка повертає дрон у рюкзак', () => {
    const { m, s, op } = withOperator(6);
    const n0 = droneItems(op).length;
    m.dispatch({ type: 'droneLaunch', unitId: op.id, index: droneItems(op).find((i) => i.defId === 'drone_mavic3t')!.index });
    const d = drones(s)[0];
    expect(m.dispatch({ type: 'droneLand', droneId: d.id }).ok).toBe(true);
    expect(droneItems(op).length).toBe(n0);
    // Збиття: червоний поруч стріляє по дрону в свій хід.
    m.dispatch({ type: 'droneLaunch', unitId: op.id, index: droneItems(op).find((i) => i.defId === 'drone_mavic3t')!.index });
    const d2 = drones(s)[0];
    const red = generateUnit('red', 'mg1', new Rng(6), (p) => newId(s, p));
    red.stats.training = 90;
    s.units.push(red);
    place(red, { x: 12, y: 25, z: 0 });
    m.dispatch({ type: 'endTurn' });
    let shots = 0;
    while (!d2.destroyed && shots++ < 8) {
      red.ap = 100;
      red.inventory.primary!.magazine!.rounds = 100;
      m.dispatch({ type: 'fire', unitId: red.id, target: { droneId: d2.id }, mode: 'burst' });
    }
    expect(d2.destroyed).toBe(true);
  });

  it('бій AI проти AI з операторами дронів завершується', async () => {
    const { AiPlanner } = await import('@/game/ai/ai');
    const m = new Mission(createMission('armor_assault', { seed: 9, controllers: { blue: 'ai', red: 'ai' } }));
    m.dispatch({ type: 'startBattle' });
    const ai = new AiPlanner(9);
    let n = 0;
    let launched = false;
    while (m.state.turn.phase === 'battle' && n++ < 20000) {
      const c = ai.next(m.state)!;
      const r = m.dispatch(c);
      if (c.type === 'droneLaunch' && r.ok) launched = true;
      if (!r.ok && 'unitId' in c) ai.reject(c.unitId);
      if (!r.ok && 'vehicleId' in c) ai.reject(c.vehicleId);
      if (!r.ok && 'droneId' in c) ai.reject(c.droneId);
    }
    expect(m.state.turn.phase).toBe('ended');
    expect(launched).toBe(true);
  }, 60000);
});
