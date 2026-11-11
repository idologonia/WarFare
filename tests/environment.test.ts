import { describe, expect, it } from 'vitest';
import { freshMission, ctxOf, place, isolate } from './helpers';
import { createMission, Mission } from '@/game/simulation/mission';
import { visionRange } from '@/game/units/derived';
import { canSee } from '@/game/visibility/visibility';
import { deploySmoke, resolveGrenade } from '@/game/combat/fire';
import { getEdge } from '@/game/maps/map';
import { setHelmetMounts } from '@/game/equipment/loadout';
import { estimateHit } from '@/game/combat/hit';
import { launcherOf, warheadOf } from '@/game/combat/launcher';
import { generateUnit } from '@/game/units/generator';
import { Rng } from '@/core/rng';
import { newId } from '@/game/simulation/state';
import { itemDef } from '@/content';
import type { WeaponDefinition } from '@/game/types';

describe('ніч, ПНБ, ліхтар, туман, дощ', () => {
  it('вночі огляд коротший; ПНБ і ліхтар його збільшують', () => {
    const m = new Mission(createMission('night_raid', { seed: 1 }));
    const s = m.state;
    const blue = s.units.find((u) => u.side === 'blue')!;
    const red = s.units.find((u) => u.side === 'red')!;
    expect(visionRange(s, blue)).toBeGreaterThan(visionRange(s, red)); // у синіх ПНБ
    const before = visionRange(s, red);
    red.lightOn = true;
    expect(visionRange(s, red)).toBeGreaterThan(before);
  });

  it('увімкнений ліхтар видає бійця здалеку вночі', () => {
    const m = new Mission(createMission('night_raid', { seed: 2 }));
    const s = m.state;
    const b = s.units.find((u) => u.side === 'blue')!;
    const r = s.units.find((u) => u.side === 'red')!;
    isolate(s, [b, r]);
    b.status = r.status = 'active';
    s.units.filter((u) => u.side === 'blue').forEach((u) => (u.inventory.helmetMounts = []));
    place(b, { x: 17, y: 26, z: 0 });
    place(r, { x: 17, y: 14, z: 0 });
    r.lightOn = false;
    expect(canSee(s, b, r).seen).toBe(false);
    r.lightOn = true;
    expect(canSee(s, b, r).seen).toBe(true);
  });

  it('ПНБ зменшує нічний штраф влучання; кріплення змінюються лише до бою', () => {
    const m = new Mission(createMission('night_raid', { seed: 3 }));
    const s = m.state;
    const b = s.units.find((u) => u.side === 'blue')!;
    const r = s.units.find((u) => u.side === 'red')!;
    place(b, { x: 17, y: 26, z: 0 });
    place(r, { x: 17, y: 20, z: 0 });
    const withNvg = estimateHit(s, b, r, 'snap');
    setHelmetMounts(s, b, 'none');
    const without = estimateHit(s, b, r, 'snap');
    expect(withNvg.chance).toBeGreaterThan(without.chance);
    m.dispatch({ type: 'startBattle' });
    expect(() => setHelmetMounts(s, b, 'nvg_bino')).toThrow();
  });
});

describe('дим і гранати', () => {
  it('димова завіса блокує огляд і розсіюється за кілька ходів', () => {
    const m = freshMission(4);
    m.dispatch({ type: 'startBattle' });
    const s = m.state;
    const b = s.units.find((u) => u.side === 'blue')!;
    const r = s.units.find((u) => u.side === 'red')!;
    isolate(s, [b, r]);
    b.status = r.status = 'active';
    place(b, { x: 17, y: 26, z: 0 });
    place(r, { x: 17, y: 16, z: 0 });
    expect(canSee(s, b, r).seen).toBe(true);
    deploySmoke(ctxOf(s), { x: 17, y: 21, z: 0 }, 2.2, 3);
    expect(canSee(s, b, r).seen).toBe(false);
    for (let i = 0; i < 8; i++) m.dispatch({ type: 'endTurn' });
    expect(s.map.cells[0][21][17].smoke).toBeUndefined();
  });

  it('звичайна граната не руйнує стіну, кумулятивна РКГ-3 — пробиває', () => {
    const m = freshMission(5);
    const s = m.state;
    const u = s.units.find((x) => x.side === 'blue')!;
    place(u, { x: 12, y: 13, z: 0 });
    const wall = { x: 12, y: 10, z: 0 };
    resolveGrenade(ctxOf(s, 1), u, 'f1', { x: 12, y: 11, z: 0 });
    expect(getEdge(s.map, wall, 's')!.defId).toBe('brick_wall');
    resolveGrenade(ctxOf(s, 1), u, 'rkg3', { x: 12, y: 11, z: 0 });
    expect(getEdge(s.map, wall, 's')!.defId).not.toBe('brick_wall');
  });

  it('РПГ-7: два типи пострілів — кумулятивний і осколковий', () => {
    const rpg = itemDef<WeaponDefinition>('rpg7');
    expect(warheadOf(rpg, 'pg7').type).toBe('heat');
    expect(warheadOf(rpg, 'og7').type).toBe('frag');
    expect(warheadOf(rpg, 'og7').blast.objectDamage).toBeLessThan(warheadOf(rpg, 'pg7').blast.objectDamage);
    const m = freshMission(6);
    m.dispatch({ type: 'startBattle' });
    const s = m.state;
    const g = generateUnit('blue', 'grenadier1', new Rng(6), (p) => newId(s, p));
    g.pos = { x: 12, y: 17, z: 0 };
    g.ap = 200;
    s.units.push(g);
    expect(m.dispatch({ type: 'launch', unitId: g.id, kind: 'rpg', cell: { x: 12, y: 12, z: 0 } }).ok).toBe(true);
    expect(m.dispatch({ type: 'reloadLauncher', unitId: g.id, ammo: 'og7' }).ok).toBe(true);
    expect(g.inventory.secondary!.magazine!.defId).toBe('og7');
    expect(launcherOf(g)!.loaded).toBe(true);
  });
});
