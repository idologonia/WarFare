import { describe, expect, it } from 'vitest';
import { freshMission, place, isolate } from './helpers';
import { computeResult } from '@/game/scenarios/result';

describe('полон', () => {
  it('боєздатний не здається; з низькою мораллю — здається, його ведуть і передають у тил', () => {
    const m = freshMission(21);
    m.dispatch({ type: 'startBattle' });
    const s = m.state;
    const a = s.units.find((u) => u.side === 'blue' && !u.inVehicle)!;
    const b = s.units.find((u) => u.side === 'red')!;
    const c = s.units.filter((u) => u.side === 'red')[1];
    isolate(s, [a, b, c]);
    a.status = b.status = c.status = 'active';
    a.ap = 100;
    s.turn.side = 'blue';
    const [ex, ey] = s.scenario.evacZone!;
    place(a, { x: ex, y: ey, z: 0 });
    place(b, { x: ex + 1, y: ey, z: 0 });
    place(c, { x: 20, y: 2, z: 0 });
    expect(m.dispatch({ type: 'capture', unitId: a.id, targetId: b.id }).ok).toBe(false);
    b.morale = 5;
    expect(m.dispatch({ type: 'capture', unitId: a.id, targetId: b.id }).ok).toBe(true);
    expect(b.status).toBe('captured');
    expect(m.dispatch({ type: 'pickUp', unitId: a.id, targetId: b.id }).ok).toBe(true);
    expect(m.dispatch({ type: 'evacuate', unitId: a.id }).ok).toBe(true);
    expect(b.prisoner).toBe(true);
    expect(computeResult(s, null, 'withdrawal').perSide.red.captured).toBe(1);
  });
});
