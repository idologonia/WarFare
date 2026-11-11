import { dist2d, type Cell } from '@/core/grid';
import { content } from '@/content';
import { groundHeight, objAt } from '@/game/maps/map';
import { visionRange } from '@/game/units/derived';
import { offAxis } from '@/game/units/facing';
import { isActive, onField, other, type Ctx, type MissionState } from '@/game/simulation/state';
import type { SideId, Stance, Unit, VehicleState } from '@/game/types';
import { cellCenter, losIgnore, trace, type Point } from './los';
import { crew, crewProxy, vehicleCenter, vehicles } from '@/game/vehicles';
import { droneSees, drones } from '@/game/drones';

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
  // Сектор огляду: позаду й збоку — лише впритул (чути/боковий зір). Екіпаж техніки бачить навколо.
  const V = content().rules.vision;
  const off = observer.inVehicle ? 0 : offAxis(observer, from, to);
  if (off > V.fov / 2 && distance > V.peripheralRange) return { seen: false, identified: false, concealment: 0, distance };
  let range = visionRange(s, observer, off <= V.flashlightCone / 2);
  // Увімкнений ліхтар уночі видно здалеку (якщо є пряма видимість).
  if (s.scenario.timeOfDay === 'night' && target.lightOn) range = Math.max(range, content().rules.vision.lightVisibleRange);
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
  if (s.map.cells[to.z][to.y][to.x].smoke) conceal += 6;
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
/** Спостерігачі сторони: бійці на полі й екіпажі техніки (з власною машиною, прозорою для огляду). */
export function observersOf(s: MissionState, side: SideId): { u: Unit; vehicle?: string }[] {
  const out: { u: Unit; vehicle?: string }[] = s.units.filter((u) => u.side === side && isActive(u)).map((u) => ({ u }));
  for (const v of vehicles(s)) {
    if (v.side !== side || v.destroyed) continue;
    const c = crew(s, v).find((x) => x.status === 'active');
    if (c) out.push({ u: crewProxy(s, v, c), vehicle: v.id });
  }
  return out;
}

function seeAs(s: MissionState, o: { u: Unit; vehicle?: string }, target: Unit): SightResult {
  if (o.vehicle) losIgnore.ids.add(o.vehicle);
  try {
    return canSee(s, o.u, target);
  } finally {
    if (o.vehicle) losIgnore.ids.delete(o.vehicle);
  }
}

/** Чи бачить сторона техніку (пряма видимість хоча б однієї клітинки корпусу). */
export function vehicleSeenBy(s: MissionState, side: SideId, v: VehicleState): boolean {
  if (s.revealAll || v.side === side) return true;
  const center = vehicleCenter(s, v, 0.5);
  for (const o of observersOf(s, side)) {
    const range = visionRange(s, o.u) + 3;
    if (Math.hypot(center.x - o.u.pos!.x - 0.5, center.y - o.u.pos!.y - 0.5) > range) continue;
    losIgnore.ids.add(v.id);
    if (o.vehicle) losIgnore.ids.add(o.vehicle);
    try {
      if (!trace(s.map, eyePoint(s, o.u.pos!, o.u.stance), center, { skipStart: o.u.pos! }).blocked) return true;
    } finally {
      losIgnore.ids.delete(v.id);
      if (o.vehicle) losIgnore.ids.delete(o.vehicle);
    }
  }
  return false;
}

export function updateContacts(ctx: Ctx): void {
  const { s } = ctx;
  for (const side of ['blue', 'red'] as SideId[]) {
    const observers = observersOf(s, side);
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
        const r = seeAs(s, o, target);
        if (r.seen) {
          seen = true;
          if (r.identified) identified = true;
          if (identified) break;
        }
      }
      // Розвідка з дронів сторони (згори; тепловізор бачить уночі й крізь дим).
      if (!seen) for (const d of drones(s)) if (d.side === side && droneSees(s, d, target)) {
        seen = true;
        identified = true;
        break;
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

/**
 * Клітинки, які бачить сторона (для затемнення, як у X-COM). Ключ — "x,y,z".
 * Перевірка — сектор огляду + лінія видимості до центру клітинки на висоті пояса.
 */
export function visibleCells(s: MissionState, side: SideId): Set<string> {
  const out = new Set<string>();
  const V = content().rules.vision;
  const m = s.map;
  for (const o of observersOf(s, side)) {
    const u = o.u;
    if (!u.pos) continue;
    const range = Math.ceil(visionRange(s, u));
    const eye = eyePoint(s, u.pos, u.stance);
    if (o.vehicle) losIgnore.ids.add(o.vehicle);
    for (let z = 0; z < m.levels; z++)
      for (let y = Math.max(0, u.pos.y - range); y <= Math.min(m.height - 1, u.pos.y + range); y++)
        for (let x = Math.max(0, u.pos.x - range); x <= Math.min(m.width - 1, u.pos.x + range); x++) {
          const key = `${x},${y},${z}`;
          if (out.has(key)) continue;
          const c = { x, y, z };
          if (z > 0 && !m.cells[z][y][x].floor) continue;
          const d = dist2d(u.pos, c) + Math.abs(z - u.pos.z) * 0.5;
          const off = o.vehicle ? 0 : offAxis(u, u.pos, c);
          if (d <= 1.5 && z === u.pos.z) {
            out.add(key);
            continue;
          }
          if (off > V.fov / 2 && d > V.peripheralRange) continue;
          if (d > visionRange(s, u, off <= V.flashlightCone / 2)) continue;
          const p = cellCenter(c, groundHeight(m, c) + 0.3);
          if (!trace(m, eye, p, { skipStart: u.pos!, skipEnd: c }).blocked) out.add(key);
        }
    if (o.vehicle) losIgnore.ids.delete(o.vehicle);
  }
  return out;
}
