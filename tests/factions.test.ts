import { describe, expect, it } from 'vitest';
import { createMission } from '@/game/simulation/mission';

describe('фракції', () => {
  it('зброя, обвіс і броня за фракцією', () => {
    const s = createMission('first_mission', { seed: 3, factions: { blue: 'ua_3oshb', red: 'militia' } });
    const blueRifle = s.units.find((u) => u.side === 'blue' && u.classId === 'rifleman')!;
    expect(blueRifle.inventory.primary!.defId).toBe('ak74');
    expect(blueRifle.inventory.primary!.mods).toContain('compensator');
    const scout = s.units.find((u) => u.side === 'blue' && u.classId === 'scout')!;
    expect(scout.inventory.primary!.mods).toContain('suppressor');
    const red = s.units.filter((u) => u.side === 'red' && u.classId === 'rifleman');
    expect(red.every((u) => u.inventory.primary!.defId === 'akm')).toBe(true);
    expect(red.every((u) => u.inventory.armor?.defId !== 'plate_carrier')).toBe(true);
    expect(s.scenario.sides.red.factionId).toBe('militia');
    // У кожного бійця з новою зброєю — відповідні магазини.
    for (const u of s.units) if (u.inventory.primary?.magazine) expect(u.inventory.primary.magazine.defId).toBeTruthy();
  });
});
