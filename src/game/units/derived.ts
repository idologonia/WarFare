import { content } from '@/content';
import { toTenths } from '@/core/grid';
import { helmetMount, totalWeight } from '@/game/inventory/inventory';
import type { MissionState } from '@/game/simulation/state';
import type { Unit } from '@/game/types';

const R = () => content().rules;

export function freeWeight(u: Unit): number {
  const r = R().ap;
  return r.freeWeightBase + u.stats.strength * r.freeWeightPerStrength;
}

export function overweight(u: Unit): number {
  return Math.max(0, totalWeight(u.inventory) - freeWeight(u));
}

export interface ApBreakdown {
  total: number;
  parts: { label: string; value: number }[];
}

/** Максимум AP на хід (у десятих) з поясненням: характеристики, стан і спорядження. */
export function computeApMax(u: Unit): ApBreakdown {
  const r = R();
  const parts: { label: string; value: number }[] = [{ label: 'База', value: r.ap.base }];
  const reactionBonus = Math.round((u.stats.reaction - 50) / 20);
  if (reactionBonus) parts.push({ label: 'Реакція', value: reactionBonus });
  if (u.stamina < r.ap.lowStaminaThreshold) parts.push({ label: 'Втома', value: -r.ap.lowStaminaPenalty });
  const ow = overweight(u);
  if (ow > 0) parts.push({ label: 'Перевантаження', value: -Math.round(ow * r.ap.overweightPenaltyPerKg * 10) / 10 });
  const supp = Math.floor(u.suppression / r.ap.suppressionPerAp);
  if (supp) parts.push({ label: 'Придушення', value: -supp });
  if (u.carrying) parts.push({ label: 'Несе пораненого', value: -r.ap.carryingPenalty });
  if (u.piloting) parts.push({ label: 'Керує дроном', value: -R().drones.operatorApPenalty });
  let legs = 0;
  let pneumo = 0;
  for (const inj of u.injuries) {
    if ((inj.part === 'leftLeg' || inj.part === 'rightLeg') && (inj.type.endsWith('Heavy') || inj.type === 'amputation')) legs += 2;
    if (inj.type === 'pneumothorax' && !inj.sealed) pneumo = r.bleeding.pneumothoraxApPenalty;
  }
  if (legs) parts.push({ label: 'Поранення ніг', value: -legs });
  if (pneumo) parts.push({ label: 'Пневмоторакс', value: -pneumo });
  const total = Math.max(r.ap.min, parts.reduce((s, p) => s + p.value, 0));
  return { total: toTenths(total), parts };
}

/**
 * Дальність огляду: день/ніч, ПНБ (множник уночі), ліхтар (+ уночі), туман (обмеження), дощ (−), сприйняття.
 */
export function visionRange(s: MissionState, u: Unit): number {
  const v = R().vision;
  let base = v.dayRange;
  if (s.scenario.timeOfDay === 'night') {
    const nvg = helmetMount(u, 'nvg');
    base = Math.min(v.dayRange, v.nightRange * (nvg?.nightFactor ?? 1));
    if (u.lightOn && !nvg) base += v.flashlightBonus;
  }
  if (s.scenario.weather === 'rain') base -= v.rainPenalty;
  if (s.scenario.weather === 'fog') base = Math.min(base, v.fogRange);
  return base * (1 + ((u.stats.perception - 50) / 10) * v.perceptionBonus);
}

export const eyeHeight = (u: Unit): number => R().vision.eyeHeight[u.stance];
export const bodyHeight = (u: Unit): number => R().vision.bodyHeight[u.stance];

export function hasWound(u: Unit, parts: string[]): boolean {
  return u.injuries.some((i) => parts.includes(i.part));
}
