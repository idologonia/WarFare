import { describe, expect, it } from 'vitest';
import { freshMission, ctxOf, place, isolate } from './helpers';
import { coverAgainst, effectiveCover, estimateHit } from '@/game/combat/hit';
import { resolveFire, damageEdge } from '@/game/combat/fire';
import { getEdge, moveNeighbors } from '@/game/maps/map';
import { swapMagazine } from '@/game/inventory/inventory';
import { applyHit, applyTreatment, tickInjuries, treatmentOptions } from '@/game/injuries/injuries';
import { computeApMax } from '@/game/units/derived';

describe('укриття і шанс влучання', () => {
  it('мішки з піском дають половинне укриття, сидячи — повне', () => {
    const m = freshMission();
    const s = m.state;
    // мішки — тонкі, на північній межі клітинок (10..12,14); ціль стоїть просто за ними
    expect(coverAgainst(s, { x: 11, y: 14, z: 0 }, { x: 11, y: 11, z: 0 })).toBe(1);
    expect(effectiveCover(1, 'crouched')).toBe(2);
    // з півдня укриття немає
    expect(coverAgainst(s, { x: 11, y: 14, z: 0 }, { x: 11, y: 20, z: 0 })).toBe(0);
    // біля тонкої стіни будинку — повне укриття
    expect(coverAgainst(s, { x: 12, y: 11, z: 0 }, { x: 12, y: 6, z: 0 })).toBe(2);
  });

  it('укриття і дальність зменшують шанс; межі 5..95', () => {
    const m = freshMission();
    const s = m.state;
    const [a, b] = s.units.filter((u) => u.side === 'blue');
    const t = s.units.find((u) => u.side === 'red')!;
    isolate(s, [a, b, t]);
    t.status = 'active';
    place(a, { x: 11, y: 11, z: 0 });
    place(t, { x: 11, y: 14, z: 0 });
    const covered = estimateHit(s, a, t, 'snap');
    place(t, { x: 11, y: 13, z: 0 });
    const open = estimateHit(s, a, t, 'snap');
    expect(open.chance).toBeGreaterThan(covered.chance);
    expect(covered.factors.some((f) => f.label.includes('укриття'))).toBe(true);
    place(t, { x: 11, y: 23, z: 0 });
    const far = estimateHit(s, a, t, 'aimed');
    expect(far.chance).toBeGreaterThanOrEqual(5);
    expect(far.chance).toBeLessThanOrEqual(95);
  });
});

describe('стрільба', () => {
  it('витрачає набої з магазину, вільний постріл б’є в оточення', () => {
    const m = freshMission();
    const s = m.state;
    const a = s.units.find((u) => u.side === 'blue')!;
    isolate(s, [a]);
    place(a, { x: 11, y: 12, z: 0 });
    const before = a.inventory.primary!.magazine!.rounds;
    const ctx = ctxOf(s);
    resolveFire(ctx, a, { cell: { x: 11, y: 14, z: 0 } }, 'snap');
    expect(a.inventory.primary!.magazine!.rounds).toBe(before - 1);
    expect(ctx.ev.some((e) => e.t === 'fired')).toBe(true);
  });

  it('руйнування тонкої стіни: стіна → пошкоджена → пролом (прохідний)', () => {
    const m = freshMission();
    const s = m.state;
    const ctx = ctxOf(s);
    const c = { x: 12, y: 10, z: 0 };
    expect(getEdge(s.map, c, 's')!.defId).toBe('brick_wall');
    damageEdge(ctx, c, 's', 300);
    expect(getEdge(s.map, c, 's')!.defId).toBe('brick_wall_damaged');
    damageEdge(ctx, c, 's', 400);
    expect(getEdge(s.map, c, 's')!.defId).toBe('brick_rubble');
    expect(moveNeighbors(s.map, { x: 12, y: 11, z: 0 }).some((st) => st.to.x === 12 && st.to.y === 10)).toBe(true);
  });
});

describe('магазини', () => {
  it('заміна магазину зберігає залишок набоїв у старому магазині', () => {
    const m = freshMission();
    const u = m.state.units.find((x) => x.classId === 'rifleman')!;
    const w = u.inventory.primary!;
    const oldMag = w.magazine!;
    oldMag.rounds = 7;
    const r = swapMagazine(u);
    expect(r.ok).toBe(true);
    expect(w.magazine!.rounds).toBe(30);
    expect(u.inventory.pouches).toContain(oldMag);
    expect(oldMag.rounds).toBe(7);
  });
  it('несумісний магазин не підходить: ПКМ не бере магазин автомата', () => {
    const m = freshMission();
    const mg = m.state.units.find((x) => x.classId === 'mg1')!;
    mg.inventory.pouches = [{ id: 'x1', defId: 'mag_ak545_30', rounds: 30 }];
    mg.inventory.backpackItems = [];
    mg.inventory.primary!.magazine!.rounds = 0;
    expect(swapMagazine(mg).ok).toBe(false);
  });
});

describe('поранення і медицина', () => {
  it('MARCH: тампонада лише кінцівок, голку — лише інший боєць, турнікет — можна собі', () => {
    const m = freshMission(4);
    m.dispatch({ type: 'startBattle' });
    const u = m.state.units.find((x) => x.side === 'blue' && x.classId === 'rifleman')!;
    u.ap = 200;
    u.injuries.push({ id: 'torsoBleed', part: 'torso', type: 'gunshotHeavy', bleeding: 'massive', turn: 1 });
    u.injuries.push({ id: 'legBleed', part: 'leftLeg', type: 'gunshotHeavy', bleeding: 'massive', turn: 1 });
    u.injuries.push({ id: 'pt', part: 'torso', type: 'pneumothorax', bleeding: 'none', turn: 1 });
    const opts = treatmentOptions(u);
    expect(opts.some((o) => o.effect === 'packing' && o.injuryId === 'torsoBleed')).toBe(false);
    expect(opts[0].march).toBe('M');
    expect(m.dispatch({ type: 'treat', unitId: u.id, patientId: u.id, effect: 'packing', injuryId: 'torsoBleed' }).ok).toBe(false);
    expect(m.dispatch({ type: 'treat', unitId: u.id, patientId: u.id, effect: 'tourniquet', injuryId: 'legBleed' }).ok).toBe(true);
    expect(m.dispatch({ type: 'treat', unitId: u.id, patientId: u.id, effect: 'needle', injuryId: 'pt' }).ok).toBe(false);
  });

  it('оклюзійну наліпку не можна накласти самому собі, а товаришу — можна', () => {
    const m = freshMission(3);
    m.dispatch({ type: 'startBattle' });
    const [a, b] = m.state.units.filter((u) => u.side === 'blue');
    place(a, { x: 10, y: 28, z: 0 });
    place(b, { x: 11, y: 28, z: 0 });
    for (const u of [a, b]) u.injuries.push({ id: `t${u.id}`, part: 'torso', type: 'gunshotHeavy', bleeding: 'none', turn: 1 });
    // наліпка є в рюкзаку стрільця
    const medic = a.inventory.backpackItems.some((e) => e.item.defId === 'med_seal') ? a : b;
    const other = medic === a ? b : a;
    medic.ap = 100;
    const self = m.dispatch({ type: 'treat', unitId: medic.id, patientId: medic.id, effect: 'chestSeal', injuryId: `t${medic.id}` });
    expect(self.ok).toBe(false);
    const buddy = m.dispatch({ type: 'treat', unitId: medic.id, patientId: other.id, effect: 'chestSeal', injuryId: `t${other.id}` });
    expect(buddy.ok).toBe(true);
    expect(other.injuries.find((i) => i.id === `t${other.id}`)!.sealed).toBe(true);
  });

  it('кровотеча знижує здоров’я, турнікет/бинт зупиняють', () => {
    const m = freshMission();
    const s = m.state;
    const u = s.units[0];
    const ctx = ctxOf(s);
    u.injuries.push({ id: 'i1', part: 'leftLeg', type: 'gunshotHeavy', bleeding: 'massive', turn: 1 });
    const h = u.health;
    tickInjuries(ctx, u);
    expect(u.health).toBeLessThan(h);
    expect(applyTreatment(ctx, u, 'tourniquet', 'i1')).toBeNull();
    const h2 = u.health;
    tickInjuries(ctx, u);
    expect(u.health).toBe(h2);
    expect(applyTreatment(ctx, u, 'bandage', 'i1')).not.toBeNull(); // уже не кровоточить
  });

  it('влучання створює травму частини тіла; смерть при нульовому здоров’ї', () => {
    const m = freshMission();
    const s = m.state;
    const u = s.units[0];
    u.inventory.armor = null;
    u.inventory.helmet = null;
    const ctx = ctxOf(s);
    applyHit(ctx, u, 30, 3, 'bullet', { part: 'leftArm' });
    expect(u.injuries.length).toBeGreaterThan(0);
    expect(u.injuries[0].part).toBe('leftArm');
    applyHit(ctx, u, 500, 3, 'bullet', { part: 'torso' });
    expect(u.status).toBe('dead');
  });

  it('пневмоторакс знижує AP, голка знімає штраф', () => {
    const m = freshMission();
    const u = m.state.units[0];
    const base = computeApMax(u).total;
    u.injuries.push({ id: 'p', part: 'torso', type: 'pneumothorax', bleeding: 'none', turn: 1 });
    expect(computeApMax(u).total).toBeLessThan(base);
    applyTreatment(ctxOf(m.state), u, 'needle', 'p');
    expect(computeApMax(u).total).toBe(base);
  });
});
