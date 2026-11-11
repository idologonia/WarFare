import { describe, expect, it } from 'vitest';
import { createMission, Mission } from '@/game/simulation/mission';
import { content } from '@/content';

describe('нові карти й сценарії', () => {
  for (const id of ['industrial_assault', 'treeline_night'])
    it(`${id}: створюється, розгортається й кілька ходів грається`, () => {
      const s = createMission(id, { seed: 5, controllers: { blue: 'ai', red: 'ai' } });
      const m = new Mission(s);
      expect(s.map.width).toBe(content().maps.get(s.scenario.mapId)!.width);
      expect(s.units.filter((u) => u.pos).length).toBeGreaterThan(10);
      expect(m.dispatch({ type: 'startBattle' }).ok).toBe(true);
      for (let i = 0; i < 4; i++) expect(m.dispatch({ type: 'endTurn' }).ok).toBe(true);
    });
});
