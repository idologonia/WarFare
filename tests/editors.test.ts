import { describe, expect, it } from 'vitest';
import { content, registerMap, registerScenario } from '@/content';
import { Rng } from '@/core/rng';
import { buildMap } from '@/game/maps/map';
import { createMission } from '@/game/simulation/mission';
import { fromDefinition, newMap, toDefinition, detectBuildings, validateMap } from '@/tools/mapModel';
import { newScenario, validateScenario } from '@/tools/scenarioEditor';
import { sandboxAddUnit, sandboxGiveWeapon, sandboxRemove, sandboxTeleport } from '@/tools/sandbox';
import { countItems } from '@/game/inventory/inventory';

describe('редактор карт', () => {
  it('карта переживає перетворення визначення → редактор → визначення', () => {
    const def = content().maps.get('village')!;
    const back = toDefinition(fromDefinition(def));
    const a = buildMap(def, new Rng(5));
    const b = buildMap(back, new Rng(5));
    expect(JSON.stringify(b.cells)).toBe(JSON.stringify(a.cells));
    expect(back.buildings.length).toBe(2);
  });

  it('нова карта: будівля визначається автоматично, сходи без поверху — попередження', () => {
    const m = newMap('t', 'Тест', 12, 12, 2);
    for (let y = 2; y <= 5; y++) for (let x = 2; x <= 6; x++) m.cells[0][y][x] = { terrain: 'floor', floor: true, elevation: 0, object: null };
    m.cells[0][3][3].stairsUp = true;
    expect(detectBuildings(m)).toEqual([[2, 2, 6, 5]]);
    expect(validateMap(m).warnings.length).toBeGreaterThan(0);
    m.cells[1][3][3] = { terrain: 'floor', floor: true, elevation: 0, object: null };
    expect(validateMap(m).warnings.some((w) => w.includes('порожнечу'))).toBe(false);
  });

  it('збережену карту можна використати в місії', () => {
    const m = newMap('custom_map', 'Поле', 16, 16, 1);
    m.cells[0][8][8].object = { defId: 'sandbags', hp: 140 };
    registerMap(toDefinition(m));
    const sc = newScenario('custom_map');
    sc.id = 'custom_sc';
    expect(validateScenario(sc)).toEqual([]);
    registerScenario(sc);
    const s = createMission('custom_sc', { seed: 1 });
    expect(s.map.width).toBe(16);
    expect(s.units.filter((u) => u.side === 'red').every((u) => u.pos)).toBe(true);
  });
});

describe('редактор сценаріїв', () => {
  it('перевіряє місце в зоні розгортання і наявність гравця', () => {
    const sc = newScenario('village');
    sc.sides.blue.deployZone = [0, 0, 0, 0];
    sc.sides.red.controller = 'ai';
    sc.sides.blue.controller = 'ai';
    const errors = validateScenario(sc);
    expect(errors.some((e) => e.includes('вільних клітинок'))).toBe(true);
    expect(errors.some((e) => e.includes('гравця'))).toBe(true);
  });

  it('спорядження сторони: додаткові гранати і без броні', () => {
    const sc = newScenario('village');
    sc.id = 'loadout_sc';
    sc.sides.red.loadout = { extraMags: 1, extraGrenades: 2, noArmor: true };
    registerScenario(sc);
    const s = createMission('loadout_sc', { seed: 2 });
    const red = s.units.filter((u) => u.side === 'red');
    expect(red.every((u) => u.inventory.armor === null && u.inventory.helmet === null)).toBe(true);
    expect(red.every((u) => countItems(u, (d) => d.kind === 'grenade') >= 2)).toBe(true);
  });
});

describe('пісочниця', () => {
  it('працює лише в тестовому режимі; додає, переносить, прибирає, міняє зброю', () => {
    const normal = createMission('first_mission', { seed: 3 });
    expect(() => sandboxAddUnit(normal, 'red', 'rifleman', { x: 10, y: 15, z: 0 })).toThrow();
    const s = createMission('first_mission', { seed: 3, revealAll: true });
    const u = sandboxAddUnit(s, 'red', 'scout', { x: 10, y: 15, z: 0 });
    expect(typeof u).not.toBe('string');
    const unit = u as Exclude<typeof u, string>;
    expect(sandboxAddUnit(s, 'blue', 'rifleman', { x: 10, y: 15, z: 0 })).toBe('Клітинка зайнята');
    expect(sandboxTeleport(s, unit.id, { x: 12, y: 6, z: 2 })).toBeNull();
    expect(unit.pos).toEqual({ x: 12, y: 6, z: 2 });
    sandboxGiveWeapon(s, unit.id, 'lmg_k1');
    expect(unit.inventory.primary!.defId).toBe('lmg_k1');
    sandboxRemove(s, unit.id);
    expect(s.units.includes(unit)).toBe(false);
  });
});
