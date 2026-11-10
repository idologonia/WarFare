import { describe, expect, it } from 'vitest';
import { freshMission, place, isolate } from './helpers';
import { validateMods, modEffects } from '@/game/equipment/mods';
import { equipWeapon, setGrenadeType } from '@/game/equipment/loadout';
import { estimateHit } from '@/game/combat/hit';
import { countItems, swapMagazine, totalWeight } from '@/game/inventory/inventory';

describe('модифікації зброї', () => {
  it('сумісність і вимоги: коліматор на АК-74 потребує планки, на АК-12 — ні', () => {
    expect(validateMods('ak74', ['reddot']).some((e) => e.includes('планки'))).toBe(true);
    expect(validateMods('ak74', ['rail', 'reddot'])).toEqual([]);
    expect(validateMods('ak12', ['reddot'])).toEqual([]);
    expect(validateMods('ak12', ['rail']).some((e) => e.includes('вбудовану'))).toBe(true);
    expect(validateMods('ar15', ['reddot', 'scope4']).some((e) => e.includes('одне місце'))).toBe(true);
    expect(validateMods('ar15', ['magnifier']).some((e) => e.includes('Коліматор'))).toBe(true);
    expect(validateMods('pkm', ['foregrip']).some((e) => e.includes('несумісний'))).toBe(true);
  });

  it('приціл 4х покращує прицільний постріл на дальній дистанції', () => {
    const m = freshMission(8);
    const s = m.state;
    const a = s.units.find((u) => u.side === 'blue')!;
    const t = s.units.find((u) => u.side === 'red')!;
    isolate(s, [a, t]);
    t.status = 'active';
    place(a, { x: 17, y: 26, z: 0 });
    place(t, { x: 17, y: 16, z: 0 });
    equipWeapon(s, a, 'ak12', []);
    const plain = estimateHit(s, a, t, 'aimed').chance;
    equipWeapon(s, a, 'ak12', ['scope4']);
    expect(modEffects(a.inventory.primary).aimedFar).toBe(12);
    expect(estimateHit(s, a, t, 'aimed').chance).toBeGreaterThan(plain);
  });

  it('модифікації змінюються лише до бою; вага враховує обвіс', () => {
    const m = freshMission(9);
    const u = m.state.units.find((x) => x.side === 'blue')!;
    equipWeapon(m.state, u, 'ak74', []);
    const w0 = totalWeight(u.inventory);
    equipWeapon(m.state, u, 'ak74', ['rail', 'reddot']);
    expect(totalWeight(u.inventory)).toBeGreaterThan(w0);
    m.dispatch({ type: 'startBattle' });
    expect(() => equipWeapon(m.state, u, 'ak74', [])).toThrow();
  });
});

describe('магазини й гранати', () => {
  it('магазин РПК підходить до АК-74, але не до АКМ; Minimi бере магазини STANAG', () => {
    const m = freshMission(10);
    const u = m.state.units.find((x) => x.side === 'blue')!;
    expect(equipWeapon(m.state, u, 'ak74', [], 'mag_rpk545_45')).toEqual([]);
    expect(u.inventory.primary!.magazine!.rounds).toBe(45);
    expect(equipWeapon(m.state, u, 'akm', [], 'mag_rpk545_45').length).toBeGreaterThan(0);
    expect(equipWeapon(m.state, u, 'minimi', [], 'stanag_30')).toEqual([]);
    u.inventory.primary!.magazine!.rounds = 0;
    expect(swapMagazine(u).ok).toBe(true);
  });

  it('тип гранат змінюється, кількість зберігається', () => {
    const m = freshMission(11);
    const u = m.state.units.find((x) => x.side === 'blue' && x.classId === 'scout')!;
    const n = countItems(u, (d) => d.kind === 'grenade');
    setGrenadeType(m.state, u, 'f1');
    expect(countItems(u, (d) => d.id === 'f1')).toBe(n);
  });
});
