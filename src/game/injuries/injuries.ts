import { content, itemDef } from '@/content';
import { float, newId, type Ctx } from '@/game/simulation/state';
import type { ArmorDefinition, ArmorPiece, BodyPart, Injury, InjuryType, MedicalEffect, Unit } from '@/game/types';
import { BODY_PARTS } from '@/game/types';

export type DamageKind = 'bullet' | 'shrapnel';

export const PART_NAMES: Record<BodyPart, string> = {
  head: 'Голова',
  torso: 'Тулуб',
  leftArm: 'Ліва рука',
  rightArm: 'Права рука',
  leftLeg: 'Ліва нога',
  rightLeg: 'Права нога',
};

export const INJURY_NAMES: Record<InjuryType, string> = {
  gunshotLight: 'Легке кульове',
  gunshotHeavy: 'Важке кульове',
  shrapnelLight: 'Легке осколкове',
  shrapnelHeavy: 'Важке осколкове',
  laceration: 'Рвана рана',
  amputation: 'Ампутація',
  pneumothorax: 'Пневмоторакс',
};

const isLimb = (p: BodyPart) => p !== 'head' && p !== 'torso';

export function pickBodyPart(ctx: Ctx, lowCover: boolean): BodyPart {
  const R = content().rules.damage;
  return ctx.rng.weighted(
    BODY_PARTS.map((p) => {
      let w = R.partWeights[p];
      if (lowCover && (p === 'leftLeg' || p === 'rightLeg')) w *= R.lowCoverHidesLegs;
      return [p, w] as const;
    }),
  );
}

function armorFor(u: Unit, part: BodyPart): ArmorPiece | null {
  for (const a of [u.inventory.helmet, u.inventory.armor]) {
    if (!a || a.durability <= 0) continue;
    const d = itemDef<ArmorDefinition>(a.defId);
    if (d.covers[part]) return a;
  }
  return null;
}

export interface HitOutcome {
  damage: number;
  part: BodyPart;
  killed: boolean;
  downed: boolean;
}

/**
 * Влучання в бійця: броня (може зупинити або послабити й зношується), травма частини тіла,
 * кровотеча, ускладнення. Загальне здоров'я зменшується.
 */
export function applyHit(
  ctx: Ctx,
  target: Unit,
  baseDamage: number,
  penetration: number,
  kind: DamageKind,
  opts: { part?: BodyPart; lowCover?: boolean; attacker?: Unit } = {},
): HitOutcome {
  const R = content().rules.damage;
  const part = opts.part ?? pickBodyPart(ctx, !!opts.lowCover);
  let dmg = baseDamage * (1 + (ctx.rng.next() * 2 - 1) * R.variance);
  let armorStopped = false;
  const armor = armorFor(target, part);
  if (armor) {
    const d = itemDef<ArmorDefinition>(armor.defId);
    if (ctx.rng.next() < (d.covers[part] ?? 0)) {
      if (d.protection >= penetration) {
        dmg *= R.armorStopFactor;
        armorStopped = true;
      } else dmg *= R.armorReduceFactor;
      armor.durability = Math.max(0, armor.durability - R.armorWearPerHit * (kind === 'shrapnel' ? 0.5 : 1));
    }
  }
  dmg = Math.max(1, Math.round(dmg * (part === 'head' ? 1.4 : isLimb(part) ? 0.8 : 1)));

  let injury: InjuryType | null = null;
  if (!armorStopped) {
    const heavy = dmg >= R.heavyThreshold;
    if (kind === 'shrapnel' && isLimb(part) && dmg >= R.amputationThreshold) injury = 'amputation';
    else if (kind === 'shrapnel') injury = heavy ? 'shrapnelHeavy' : ctx.rng.chance(30) ? 'laceration' : 'shrapnelLight';
    else injury = heavy ? 'gunshotHeavy' : 'gunshotLight';

    let bleeding: Injury['bleeding'] = 'none';
    if (injury === 'amputation') bleeding = 'massive';
    else if (heavy) bleeding = ctx.rng.next() < R.massiveBleedChance ? 'massive' : 'light';
    else if (ctx.rng.next() < R.lightBleedChance) bleeding = 'light';

    target.injuries.push({ id: newId(ctx.s, 'inj'), part, type: injury, bleeding, turn: ctx.s.turn.turn });
    if (part === 'torso' && heavy && ctx.rng.next() < R.pneumothoraxChance) {
      target.injuries.push({ id: newId(ctx.s, 'inj'), part, type: 'pneumothorax', bleeding: 'none', turn: ctx.s.turn.turn });
    }
    if (part === 'head' && heavy && ctx.rng.next() < R.headHeavyLethal) dmg = Math.max(dmg, target.health);
    target.stats_mission.woundsTaken++;
  }

  target.health = Math.max(0, target.health - dmg);
  ctx.ev.push({ t: 'damaged', unitId: target.id, part, amount: dmg, injury, armorStopped });
  float(ctx, target.id, armorStopped ? `Броня! −${dmg}` : `−${dmg} ${PART_NAMES[part]}`, 'bad');
  if (opts.attacker) opts.attacker.stats_mission.damageDealt += dmg;
  return { damage: dmg, part, ...checkStatus(ctx, target, opts.attacker) };
}

/** Оновлення статусу після шкоди: смерть або непритомність. */
export function checkStatus(ctx: Ctx, u: Unit, attacker?: Unit): { killed: boolean; downed: boolean } {
  const R = content().rules;
  if (u.status !== 'active' && u.status !== 'down') return { killed: false, downed: false };
  if (u.health <= 0) {
    u.status = 'dead';
    u.overwatch = 0;
    dropCarried(ctx, u);
    ctx.ev.push({ t: 'status', unitId: u.id, status: 'dead' });
    if (attacker) {
      attacker.stats_mission.kills++;
      attacker.xp += R.xp.kill;
    }
    moraleEvent(ctx, u, 'killed', attacker);
    return { killed: true, downed: false };
  }
  if (u.status === 'active' && u.health <= R.damage.downThreshold) {
    u.status = 'down';
    u.overwatch = 0;
    u.stance = 'prone';
    dropCarried(ctx, u);
    ctx.ev.push({ t: 'status', unitId: u.id, status: 'down' });
    float(ctx, u.id, 'Без свідомості', 'bad');
    moraleEvent(ctx, u, 'down', attacker);
    return { killed: false, downed: true };
  }
  if (u.status === 'active') u.morale = Math.max(0, u.morale + R.morale.hit);
  return { killed: false, downed: false };
}

function dropCarried(ctx: Ctx, u: Unit): void {
  if (!u.carrying) return;
  const c = ctx.s.units.find((x) => x.id === u.carrying);
  if (c) {
    c.carriedBy = null;
    c.pos = u.pos ? { ...u.pos } : null;
  }
  u.carrying = null;
}

function moraleEvent(ctx: Ctx, victim: Unit, kind: 'killed' | 'down', attacker?: Unit): void {
  const M = content().rules.morale;
  for (const o of ctx.s.units) {
    if (o.status !== 'active' || o === victim) continue;
    if (o.side === victim.side) o.morale = Math.max(0, o.morale + (kind === 'killed' ? M.allyKilled : M.allyDown));
    else if (o === attacker) o.morale = Math.min(o.stats.morale, o.morale + M.enemyKilled);
  }
}

/** Кровотечі та пневмоторакс на початку ходу сторони. */
export function tickInjuries(ctx: Ctx, u: Unit): void {
  if (u.status !== 'active' && u.status !== 'down') return;
  const B = content().rules.bleeding;
  let loss = 0;
  for (const i of u.injuries) {
    if (i.bleeding === 'massive') loss += B.massive;
    else if (i.bleeding === 'light') loss += B.light;
    if (i.type === 'pneumothorax' && !i.sealed) loss += B.pneumothorax;
  }
  // Непризначене важке поранення тулуба без наліпки може перейти в пневмоторакс.
  const torso = u.injuries.find((i) => i.part === 'torso' && i.type === 'gunshotHeavy' && !i.sealed);
  if (torso && !u.injuries.some((i) => i.type === 'pneumothorax') && ctx.rng.chance(20)) {
    u.injuries.push({ id: newId(ctx.s, 'inj'), part: 'torso', type: 'pneumothorax', bleeding: 'none', turn: ctx.s.turn.turn });
    float(ctx, u.id, 'Пневмоторакс!', 'bad');
  }
  if (loss > 0) {
    u.health = Math.max(0, u.health - loss);
    float(ctx, u.id, `Кровотеча −${loss}`, 'bad');
    checkStatus(ctx, u);
  }
}

export interface TreatmentOption {
  effect: MedicalEffect;
  injuryId: string | null;
  label: string;
}

/** Які дії медицини доречні для пацієнта (комбіноване лікування — кілька засобів на одну травму). */
export function treatmentOptions(patient: Unit): TreatmentOption[] {
  const out: TreatmentOption[] = [];
  for (const i of patient.injuries) {
    const where = PART_NAMES[i.part];
    if (i.bleeding === 'massive' && isLimb(i.part) && !i.tourniquet) out.push({ effect: 'tourniquet', injuryId: i.id, label: `Турнікет: ${where}` });
    if (i.bleeding === 'massive') out.push({ effect: 'packing', injuryId: i.id, label: `Тампонада: ${where}` });
    if (i.bleeding === 'light') out.push({ effect: 'bandage', injuryId: i.id, label: `Бинт: ${where}` });
    if (i.part === 'torso' && i.type !== 'pneumothorax' && !i.sealed && i.type !== 'shrapnelLight')
      out.push({ effect: 'chestSeal', injuryId: i.id, label: `Оклюзійна наліпка: ${where}` });
    if (i.type === 'pneumothorax' && !i.sealed) out.push({ effect: 'needle', injuryId: i.id, label: 'Декомпресійна голка' });
  }
  if (patient.injuries.length) out.push({ effect: 'pills', injuryId: null, label: 'Пілпак (знеболення)' });
  return out;
}

/** Застосувати медичний засіб (вартість AP і наявність предмета перевіряє команда). */
export function applyTreatment(ctx: Ctx, patient: Unit, effect: MedicalEffect, injuryId: string | null): string | null {
  const i = injuryId ? patient.injuries.find((x) => x.id === injuryId) : null;
  switch (effect) {
    case 'tourniquet':
      if (!i || i.bleeding !== 'massive' || !isLimb(i.part)) return 'Турнікет потрібен лише при масивній кровотечі кінцівки';
      i.tourniquet = true;
      i.bleeding = 'none';
      break;
    case 'packing':
      if (!i || i.bleeding !== 'massive') return 'Тампонада потрібна при масивній кровотечі';
      i.bleeding = 'light';
      break;
    case 'bandage':
      if (!i || i.bleeding !== 'light') return 'Бинт зупиняє лише легку кровотечу';
      i.bleeding = 'none';
      i.bandaged = true;
      break;
    case 'chestSeal':
      if (!i || i.part !== 'torso') return 'Наліпка — лише для поранень тулуба';
      i.sealed = true;
      break;
    case 'needle':
      if (!i || i.type !== 'pneumothorax') return 'Голка — лише при пневмотораксі';
      i.sealed = true;
      break;
    case 'pills':
      patient.health = Math.min(patient.stats.health, patient.health + 6);
      patient.morale = Math.min(patient.stats.morale, patient.morale + 10);
      break;
  }
  // Стабілізований непритомний може прийти до тями.
  if (patient.status === 'down' && patient.health > content().rules.damage.downThreshold) {
    patient.status = 'active';
    patient.stance = 'prone';
    ctx.ev.push({ t: 'status', unitId: patient.id, status: 'active' });
  }
  return null;
}

export function bleedingRate(u: Unit): number {
  const B = content().rules.bleeding;
  return u.injuries.reduce(
    (s, i) => s + (i.bleeding === 'massive' ? B.massive : i.bleeding === 'light' ? B.light : 0) + (i.type === 'pneumothorax' && !i.sealed ? B.pneumothorax : 0),
    0,
  );
}
