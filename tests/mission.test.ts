import { describe, expect, it } from 'vitest';
import { freshMission, place, isolate } from './helpers';
import { AiPlanner } from '@/game/ai/ai';
import { Mission } from '@/game/simulation/mission';
import type { MissionState } from '@/game/simulation/state';
import { unitReachable } from '@/game/combat/movement';

function runAiVsAi(seed: number): MissionState {
  const m = freshMission(seed, { controllers: { blue: 'ai', red: 'ai' } });
  expect(m.dispatch({ type: 'startBattle' }).ok).toBe(true);
  const ai = new AiPlanner(seed);
  let guard = 0;
  while (m.state.turn.phase === 'battle' && guard++ < 20000) {
    const cmd = ai.next(m.state)!;
    const r = m.dispatch(cmd);
    if (!r.ok && 'unitId' in cmd) ai.reject(cmd.unitId);
    if (!r.ok && 'vehicleId' in cmd) ai.reject(cmd.vehicleId);
    if (!r.ok && 'droneId' in cmd) ai.reject(cmd.droneId);
    if (!r.ok && cmd.type === 'endTurn') throw new Error(r.error);
  }
  return m.state;
}

describe('хід і команди', () => {
  it('розгортання → бій; рух витрачає AP; хід переходить до AI', () => {
    const m = freshMission(5);
    const blue = m.state.units.filter((u) => u.side === 'blue');
    expect(blue.every((u) => u.pos === null)).toBe(true);
    expect(m.dispatch({ type: 'deploy', unitId: blue[0].id, cell: { x: 10, y: 28, z: 0 } }).ok).toBe(true);
    expect(m.dispatch({ type: 'deploy', unitId: blue[1].id, cell: { x: 10, y: 5, z: 0 } }).ok).toBe(false);
    expect(m.dispatch({ type: 'startBattle' }).ok).toBe(true);
    expect(m.state.turn.phase).toBe('battle');
    const u = blue[0];
    const ap = u.ap;
    expect(ap).toBeGreaterThan(0);
    const r = m.dispatch({ type: 'move', unitId: u.id, to: { x: 10, y: 26, z: 0 }, mode: 'standard' });
    expect(r.ok).toBe(true);
    expect(u.ap).toBe(ap - 20);
    expect(m.dispatch({ type: 'endTurn' }).ok).toBe(true);
    expect(m.state.turn.side).toBe('red');
    expect(m.dispatch({ type: 'move', unitId: u.id, to: { x: 10, y: 25, z: 0 }, mode: 'standard' }).ok).toBe(false);
  });

  it('режими руху мають різну вартість; швидкий — лише стоячи', () => {
    const m = freshMission(6);
    m.dispatch({ type: 'startBattle' });
    const u = m.state.units.find((x) => x.side === 'blue')!;
    const fast = unitReachable(m.state, u, 'fast').size;
    const careful = unitReachable(m.state, u, 'careful').size;
    expect(fast).toBeGreaterThan(careful);
    u.stance = 'crouched';
    expect(m.dispatch({ type: 'move', unitId: u.id, to: { ...u.pos!, y: u.pos!.y - 1 }, mode: 'fast' }).ok).toBe(false);
  });

  it('overwatch перериває рух противника пострілом', () => {
    let reacted = false;
    for (let seed = 1; seed < 15 && !reacted; seed++) {
      const m = freshMission(seed);
      m.dispatch({ type: 'startBattle' });
      const s = m.state;
      const b = s.units.find((u) => u.side === 'blue')!;
      const r = s.units.find((u) => u.side === 'red')!;
      isolate(s, [b, r]);
      b.status = 'active';
      r.status = 'active';
      place(b, { x: 10, y: 20, z: 0 });
      place(r, { x: 10, y: 13, z: 0 });
      m.dispatch({ type: 'endTurn' }); // хід червоних
      m.dispatch({ type: 'overwatch', unitId: r.id });
      m.dispatch({ type: 'endTurn' }); // хід синіх
      const res = m.dispatch({ type: 'move', unitId: b.id, to: { x: 13, y: 16, z: 0 }, mode: 'fast' });
      reacted = res.events.some((e) => e.t === 'reaction');
    }
    expect(reacted).toBe(true);
  });

  it('евакуація загиблого дає підкріплення через кілька ходів', () => {
    const m = freshMission(9);
    m.dispatch({ type: 'startBattle' });
    const s = m.state;
    const [a, d] = s.units.filter((u) => u.side === 'blue');
    place(a, { x: 2, y: 30, z: 0 });
    place(d, { x: 3, y: 30, z: 0 });
    d.status = 'dead';
    d.health = 0;
    a.ap = 100;
    expect(m.dispatch({ type: 'pickUp', unitId: a.id, targetId: d.id }).ok).toBe(true);
    expect(m.dispatch({ type: 'fire', unitId: a.id, target: { cell: { x: 2, y: 10, z: 0 } }, mode: 'snap' }).ok).toBe(false);
    expect(m.dispatch({ type: 'evacuate', unitId: a.id }).ok).toBe(true);
    expect(d.status).toBe('evacuated');
    const reserve = s.units.find((u) => u.status === 'reserve');
    expect(reserve).toBeDefined();
    for (let i = 0; i < 6 && reserve!.status === 'reserve'; i++) m.dispatch({ type: 'endTurn' });
    expect(reserve!.status).toBe('active');
  });

  it('стан місії серіалізується і продовжується однаково', () => {
    const m = freshMission(11, { controllers: { blue: 'ai', red: 'ai' } });
    m.dispatch({ type: 'startBattle' });
    const copy = new Mission(JSON.parse(JSON.stringify(m.state)));
    const ai1 = new AiPlanner(3);
    const ai2 = new AiPlanner(3);
    for (let i = 0; i < 40; i++) {
      const c1 = ai1.next(m.state)!;
      const c2 = ai2.next(copy.state)!;
      expect(c2).toEqual(c1);
      m.dispatch(c1);
      copy.dispatch(c2);
    }
    expect(JSON.stringify(copy.state)).toBe(JSON.stringify(m.state));
  });
});

describe('повна місія AI проти AI', () => {
  it('завершується з результатом і статистикою', () => {
    const results: string[] = [];
    for (const seed of [1, 2, 3]) {
      const s = runAiVsAi(seed);
      expect(s.turn.phase).toBe('ended');
      expect(s.result).not.toBeNull();
      const r = s.result!;
      expect(r.perSide.blue.roundsUsed + r.perSide.red.roundsUsed).toBeGreaterThan(0);
      results.push(`${seed}: ${r.winner ?? 'нічия'} (${r.reason}) за ${r.turns} ходів; втрати С/Ч ${r.perSide.blue.killed}/${r.perSide.red.killed}`);
    }
    console.log(results.join('\n'));
  }, 120000);

  it('детермінована: той самий seed — той самий результат', () => {
    const a = runAiVsAi(21);
    const b = runAiVsAi(21);
    expect(JSON.stringify(a.result)).toBe(JSON.stringify(b.result));
  }, 120000);
});
