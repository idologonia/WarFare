import { describe, expect, it } from 'vitest';
import { freshMission, place } from './helpers';
import { backpackFits, validateMove } from '@/game/inventory/transfer';
import { generateUnit } from '@/game/units/generator';
import { Rng } from '@/core/rng';
import { newId } from '@/game/simulation/state';
import { treatmentOptions } from '@/game/injuries/injuries';

describe('перекладання й обшук', () => {
  it('у рюкзаку перевіряється місце; підсумки — лише дрібні предмети', () => {
    const m = freshMission(1);
    const u = m.state.units.find((x) => x.side === 'blue' && x.classId === 'rifleman')!;
    const first = u.inventory.backpackItems[0];
    expect(backpackFits(u.inventory, first.item, first.x, first.y, first.item)).toBe(true);
    expect(backpackFits(u.inventory, first.item, 4, 3, first.item)).toBe(false); // магазин 1×2 не вміщується знизу
    expect(validateMove(u, u, { owner: u.id, area: 'primary' }, { owner: u.id, area: 'pouches' })).not.toBeNull();
  });

  it('перекладання в бою коштує AP; обшук тіла — 1 AP, можна взяти зброю й магазини', () => {
    const m = freshMission(2);
    m.dispatch({ type: 'startBattle' });
    const s = m.state;
    const u = s.units.find((x) => x.side === 'blue' && x.classId === 'rifleman')!;
    const body = s.units.find((x) => x.side === 'red')!;
    place(u, { x: 10, y: 28, z: 0 });
    place(body, { x: 11, y: 28, z: 0 });
    body.status = 'dead';
    u.ap = 100;
    // Своє: магазин із рюкзака в пояс не можна, у підсумок — якщо є місце.
    const bi = u.inventory.backpackItems.findIndex((e) => e.item.defId === 'mag_ak545_30');
    expect(m.dispatch({ type: 'moveItem', unitId: u.id, from: { owner: u.id, area: 'backpack', index: bi }, to: { owner: u.id, area: 'belt' } }).ok).toBe(false);
    // Обшук: взяти гранату з поясу тіла у свій рюкзак.
    const gi = body.inventory.belt.findIndex((b) => b.defId === 'rgd5');
    const free = (() => {
      for (let y = 0; y < 4; y++) for (let x = 0; x < 5; x++) if (backpackFits(u.inventory, body.inventory.belt[gi], x, y)) return { x, y };
      return null;
    })()!;
    const ap0 = u.ap;
    const r = m.dispatch({ type: 'moveItem', unitId: u.id, from: { owner: body.id, area: 'belt', index: gi }, to: { owner: u.id, area: 'backpack', ...free } });
    expect(r.ok).toBe(true);
    expect(ap0 - u.ap).toBe(10);
    // Обмін зброєю з тілом.
    const theirs = body.inventory.primary!;
    const mine = u.inventory.primary!;
    expect(m.dispatch({ type: 'moveItem', unitId: u.id, from: { owner: body.id, area: 'primary' }, to: { owner: u.id, area: 'primary' } }).ok).toBe(true);
    expect(u.inventory.primary).toBe(theirs);
    expect(body.inventory.primary).toBe(mine);
    // Живого не обшукати.
    body.status = 'active';
    expect(m.dispatch({ type: 'moveItem', unitId: u.id, from: { owner: body.id, area: 'primary' }, to: { owner: u.id, area: 'primary' } }).ok).toBe(false);
  });
});

describe('бойовий медик', () => {
  it('набором медика стабілізує кровотечу тулуба й приводить до тями; інші набір не використовують', () => {
    const m = freshMission(3);
    m.dispatch({ type: 'startBattle' });
    const s = m.state;
    const medic = generateUnit('blue', 'medic', new Rng(3), (p) => newId(s, p));
    s.units.push(medic);
    const pat = s.units.find((x) => x.side === 'blue' && x.classId === 'rifleman')!;
    place(medic, { x: 10, y: 28, z: 0 });
    place(pat, { x: 11, y: 28, z: 0 });
    medic.ap = 100;
    pat.injuries.push({ id: 'tb', part: 'torso', type: 'gunshotHeavy', bleeding: 'massive', turn: 1 });
    pat.status = 'down';
    pat.health = 15;
    expect(treatmentOptions(pat, true).some((o) => o.effect === 'stabilize')).toBe(true);
    expect(treatmentOptions(pat, false).some((o) => o.effect === 'packing')).toBe(false);
    const r = m.dispatch({ type: 'treat', unitId: medic.id, patientId: pat.id, effect: 'stabilize', injuryId: null });
    expect(r.ok).toBe(true);
    expect(pat.injuries[0].bleeding).toBe('none');
    expect(pat.status).toBe('active');
    // Медик лікує швидше: набір 3 AP з рюкзака (+2) − 1 = 4 AP.
    expect(100 - medic.ap).toBe(40);
    // Звичайний стрілець набір медика не застосує.
    const kit = medic.inventory.backpackItems.find((e) => e.item.defId === 'med_kit_medic')!;
    pat.inventory.backpackItems.push({ ...kit, x: 0, y: 0 });
    pat.ap = 100;
    pat.injuries.push({ id: 'tb2', part: 'leftLeg', type: 'gunshotHeavy', bleeding: 'massive', turn: 1 });
    expect(m.dispatch({ type: 'treat', unitId: pat.id, patientId: medic.id, effect: 'stabilize', injuryId: null }).ok).toBe(false);
  });
});
