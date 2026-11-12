import { beforeEach, describe, expect, it } from 'vitest';
import { createMission } from '@/game/simulation/mission';
import { applyMissionResult, applyRosterPicks, newRoster, squadSize } from '@/game/roster';

describe('ростер (вибір бійців як у Door Kickers)', () => {
  beforeEach(() => void 0);
  it('обрані бійці замінюють загін; після місії — досвід, загиблі, поранені', () => {
    const r = newRoster('ua_3oshb', 42);
    expect(r.soldiers.length).toBe(12);
    const s = createMission('first_mission', { seed: 4, controllers: { blue: 'human', red: 'ai' }, factions: { blue: 'ua_3oshb' } });
    const n = squadSize(s, 'blue');
    const picks = r.soldiers.slice(0, Math.min(3, n));
    applyRosterPicks(s, 'blue', picks);
    const blue = s.units.filter((u) => u.side === 'blue' && !u.inVehicle);
    expect(blue.map((u) => u.callsign)).toEqual(picks.map((p) => p.callsign));
    expect(blue[0].stats.training).toBe(picks[0].stats.training);
    expect(blue[0].inventory.primary!.mods).toContain('compensator'); // набір фракції
    blue[0].status = 'dead';
    blue[1].xp = 200;
    blue[2].health = Math.round(blue[2].stats.health * 0.3);
    blue[2].injuries.push({ id: 'i', part: 'leftLeg', type: 'gunshotHeavy', bleeding: 'none', turn: 1 } as never);
    const notes = applyMissionResult(r, s, 'blue');
    expect(r.soldiers[0].status).toBe('kia');
    expect(r.soldiers[1].xp).toBe(200);
    expect(r.soldiers[2].status).toBe('wounded');
    expect(notes.length).toBeGreaterThan(0);
  });
});
