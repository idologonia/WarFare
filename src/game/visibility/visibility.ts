import { dist2d, type Cell } from '@/core/grid';
import { content } from '@/content';
import { groundHeight, objAt } from '@/game/maps/map';
import { visionRange } from '@/game/units/derived';
import { isActive, onField, other, type Ctx, type MissionState } from '@/game/simulation/state';
import type { SideId, Stance, Unit } from '@/game/types';
import { cellCenter, trace, type Point } from './los';

export function eyePoint(s: MissionState, cell: Cell, stance: Stance): Point {
  return cellCenter(cell, groundHeight(s.map, cell) + content().rules.vision.eyeHeight[stance]);
}

/** Точки цілі для огляду/влучання: корпус і голова. */
export function targetPoints(s: MissionState, cell: Cell, stance: Stance): Point[] {
  const g = groundHeight(s.map, cell);
  const b = content().rules.vision.bodyHeight[stance];
  return [cellCenter(cell, g + b), cellCenter(cell, g + b + 0.15)];
}

export interface SightResult {
  seen: boolean;
  identified: boolean;
  concealment: number;
  distance: number;
}

/**
 * Чи бачить спостерігач ціль. Дальність залежить від часу доби, погоди, сприйняття;
 * рослинність на лінії та в клітинці цілі зменшує дальність виявлення.
 */
export function canSeeFrom(s: MissionState, observer: Unit, from: Cell, fromStance: Stance, target: Unit): SightResult {
  const to = target.pos!;
  const distance = dist2d(from, to) + Math.abs(from.z - to.z) * 0.5;
  const range = visionRange(s, observer);
  const none = { seen: false, identified: false, concealment: 0, distance };
  if (distance > range) return none;
  const eye = eyePoint(s, from, fromStance);
  let best: number | null = null;
  for (const p of targetPoints(s, to, target.stance)) {
    const tr = trace(s.map, eye, p, { skipStart: from, skipEnd: to });
    if (!tr.blocked && (best === null || tr.concealment < best)) best = tr.concealment;
  }
  if (best === null) return none;
  let conceal = best;
  const own = objAt(s.map, to);
  if (own && own.cover === 0 && own.concealment) conceal += own.concealment * (target.stance === 'prone' ? 2 : target.stance === 'crouched' ? 1.5 : 1);
  const effRange = range - conceal;
  if (distance > effRange) return { ...none, concealment: conceal };
  return {
    seen: true,
    identified: distance <= effRange * content().rules.vision.identifyFraction || distance <= 3,
    concealment: conceal,
    distance,
  };
}

export const canSee = (s: MissionState, observer: Unit, target: Unit): SightResult =>
  canSeeFrom(s, observer, observer.pos!, observer.stance, target);

/**
 * Оновлення знань сторони про противника. Якщо один союзник виявив противника — знають усі.
 * Після втрати контакту лишається остання відома позиція.
 */
export function updateContacts(ctx: Ctx): void {
  const { s } = ctx;
  for (const side of ['blue', 'red'] as SideId[]) {
    const observers = s.units.filter((u) => u.side === side && isActive(u));
    const known = s.contacts[side];
    for (const target of s.units) {
      if (target.side === side) continue;
      if (!onField(target)) {
        if (known[target.id]) known[target.id].visible = false;
        continue;
      }
      let seen = false;
      let identified = false;
      for (const o of observers) {
        const r = canSee(s, o, target);
        if (r.seen) {
          seen = true;
          if (r.identified) identified = true;
          if (identified) break;
        }
      }
      const prev = known[target.id];
      if (seen) {
        if (!prev || !prev.visible) ctx.ev.push({ t: 'contact', side, unitId: target.id });
        known[target.id] = {
          unitId: target.id,
          pos: { ...target.pos! },
          visible: true,
          identified: identified || (prev?.identified ?? false),
          lastSeenTurn: s.turn.turn,
        };
      } else if (prev) {
        prev.visible = false;
      }
    }
  }
}

/** Чи бачить сторона бійця зараз (для рендерингу і прицілювання). */
export function sideSees(s: MissionState, side: SideId, unitId: string): boolean {
  if (s.revealAll) return true;
  const u = s.units.find((x) => x.id === unitId);
  if (u && u.side === side) return true;
  return s.contacts[side][unitId]?.visible ?? false;
}

export const enemySide = other;
