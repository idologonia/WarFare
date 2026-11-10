import { DIRS4, dist2d, sameCell, type Cell } from '@/core/grid';
import { content, itemDef, objectDef } from '@/content';
import { cellAt, groundHeight, isStandable } from '@/game/maps/map';
import { primaryDef } from '@/game/inventory/inventory';
import { applyHit } from '@/game/injuries/injuries';
import { activeUnitAt, float, onField, type Ctx } from '@/game/simulation/state';
import { cellCenter, trace, type Point } from '@/game/visibility/los';
import { eyePoint, targetPoints } from '@/game/visibility/visibility';
import type { FireMode, GrenadeDefinition, Material, Unit } from '@/game/types';
import { coverAgainst, estimateHit, type HitFactor } from './hit';

const BULLET_MATERIAL: Record<Material, number> = {
  wood: 1,
  foliage: 1,
  glass: 1,
  sandbag: 0.35,
  brick: 0.45,
  concrete: 0.2,
  metal: 0.3,
  earth: 0.15,
};

/** Пошкодження об'єкта карти; при порозі — заміна на пошкоджений/зруйнований варіант. */
export function damageObject(ctx: Ctx, cell: Cell, amount: number, explosive = false): void {
  const c = cellAt(ctx.s.map, cell);
  if (!c?.object) return;
  const def = objectDef(c.object.defId);
  const dmg = Math.round(amount * BULLET_MATERIAL[def.material] * (explosive ? 2 : 1));
  if (dmg <= 0) return;
  c.object.hp -= dmg;
  let changed = false;
  while (c.object && c.object.hp <= 0) {
    const d = objectDef(c.object.defId);
    const next: string | null = d.destroyedTo ?? null;
    const overflow: number = -c.object.hp;
    c.object = next ? { defId: next, hp: Math.max(1, objectDef(next).hp - overflow) } : null;
    changed = true;
    if (next) break;
  }
  if (c.object && !changed) {
    const d = objectDef(c.object.defId);
    if (d.damagedTo && c.object.hp <= d.hp / 2) {
      c.object = { defId: d.damagedTo, hp: Math.min(c.object.hp, objectDef(d.damagedTo).hp) };
      changed = true;
    }
  }
  if (changed) ctx.ev.push({ t: 'object', cell, defId: c.object?.defId ?? null });
}

/** Придушення бійців поруч із точкою (промахи й влучання). */
function suppressAround(ctx: Ctx, p: Point, shooter: Unit, amount: number): void {
  const S = content().rules.suppression;
  for (const u of ctx.s.units) {
    if (u.status !== 'active' || u.side === shooter.side || !u.pos) continue;
    const c = cellCenter(u.pos, groundHeight(ctx.s.map, u.pos));
    if (Math.hypot(c.x - p.x, c.y - p.y) <= S.nearMissRadius && Math.abs(c.h - p.h) < 1.2) {
      u.suppression = Math.min(S.max, u.suppression + amount);
    }
  }
}

/** Позиція для стрільби наосліп/з-за кута: власна клітинка або сусідня відкрита (боєць не виходить з укриття). */
export function blindOrigin(ctx: Pick<Ctx, 's'>, shooter: Unit, target: Cell): Cell {
  const s = ctx.s;
  const from = shooter.pos!;
  let best = from;
  let bestScore = -1;
  for (const c of [from, ...DIRS4.map(([dx, dy]) => ({ x: from.x + dx, y: from.y + dy, z: from.z }))]) {
    if (!sameCell(c, from) && (!isStandable(s.map, c) || activeUnitAt(s, c))) continue;
    const eye = eyePoint(s, c, 'standing');
    let score = 0;
    for (const p of targetPoints(s, target, 'standing')) if (!trace(s.map, eye, p, { skipStart: c, skipEnd: target }).blocked) score++;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

/** Куля по траєкторії: перевіряє бійців на шляху (friendly fire) і перешкоди. */
function flyBullet(ctx: Ctx, shooter: Unit, from: Point, to: Point, exclude: Set<string>, damage: number, pen: number): { end: Point; hitUnit: string | null } {
  const s = ctx.s;
  const tr = trace(s.map, from, to, { skipStart: shooter.pos!, extend: 6 });
  // Бійці, через клітинки яких проходить куля, до точки зупинки.
  for (const c of tr.cells) {
    const victims = s.units.filter((u) => onField(u) && u.status !== 'dead' && !exclude.has(u.id) && u.id !== shooter.id && u.pos && sameCell(u.pos, c));
    for (const v of victims) {
      // Висота кулі в цій клітинці.
      const cx = c.x + 0.5;
      const cy = c.y + 0.5;
      const total = Math.hypot(tr.end.x - from.x, tr.end.y - from.y) || 1;
      const t = Math.min(1, Math.hypot(cx - from.x, cy - from.y) / total);
      const h = from.h + (tr.end.h - from.h) * t;
      const g = groundHeight(s.map, v.pos!);
      const top = g + content().rules.vision.bodyHeight[v.stance] + 0.2;
      if (h >= g - 0.05 && h <= top && ctx.rng.chance(v.status === 'active' ? 55 : 35)) {
        applyHit(ctx, v, damage, pen, 'bullet', { attacker: v.side === shooter.side ? undefined : shooter });
        if (v.side === shooter.side) float(ctx, v.id, 'Дружній вогонь!', 'bad');
        return { end: cellCenter(v.pos!, h), hitUnit: v.id };
      }
    }
  }
  if (tr.blocked && tr.blockCell && tr.blockKind === 'object') damageObject(ctx, tr.blockCell, damage);
  return { end: tr.end, hitUnit: null };
}

export interface FireTarget {
  unitId?: string;
  cell?: Cell;
}

/** Постріл (одиночний, черга, прицільний, наосліп) у бійця або вільно в точку. AP списує команда. */
export function resolveFire(ctx: Ctx, shooter: Unit, target: FireTarget, mode: FireMode, extra?: HitFactor): void {
  const s = ctx.s;
  const R = content().rules;
  const wi = shooter.inventory.primary!;
  const w = primaryDef(shooter)!;
  const mag = wi.magazine!;
  const tUnit = target.unitId ? s.units.find((u) => u.id === target.unitId) ?? null : null;
  const aimCell = tUnit?.pos ?? target.cell!;
  const origin = mode === 'blind' ? blindOrigin(ctx, shooter, aimCell) : shooter.pos!;
  const stance = mode === 'blind' ? 'standing' : shooter.stance;
  const from = eyePoint(s, origin, stance);
  from.h -= 0.08;

  const count = Math.min(mag.rounds, mode === 'burst' ? w.burst : 1);
  const known = tUnit ? s.contacts[shooter.side][tUnit.id] : undefined;
  const est = tUnit ? estimateHit(s, shooter, tUnit, mode, { from: origin, stance, identified: known?.identified ?? true, extra }) : null;
  const shots: { to: Point; hitUnit: string | null }[] = [];
  const dist = dist2d(origin, aimCell);
  const lowCover = tUnit?.pos ? coverAgainst(s, tUnit.pos, origin) === 1 : false;

  for (let i = 0; i < count; i++) {
    mag.rounds--;
    shooter.stats_mission.roundsUsed++;
    shooter.stats_mission.shots++;
    shooter.xp += R.xp.shot;
    const aimPoint = tUnit?.pos
      ? targetPoints(s, tUnit.pos, tUnit.stance)[0]
      : cellCenter(aimCell, groundHeight(s.map, aimCell) + 0.5);
    const chance = est ? Math.max(R.hit.min, est.chance - i * R.fire.burstShotPenalty) : 0;
    if (tUnit && onField(tUnit) && est && ctx.rng.chance(chance)) {
      // Влучання: якщо лінія вогню перекрита (наосліп), куля б'є в перешкоду.
      const tr = trace(s.map, from, aimPoint, { skipStart: origin, skipEnd: tUnit.pos! });
      if (tr.blocked && est.lineOfFire === false) {
        if (tr.blockCell && tr.blockKind === 'object') damageObject(ctx, tr.blockCell, w.damage);
        shots.push({ to: tr.end, hitUnit: null });
        continue;
      }
      shooter.stats_mission.hits++;
      shooter.xp += R.xp.hit;
      applyHit(ctx, tUnit, w.damage, w.penetration, 'bullet', { lowCover, attacker: tUnit.side === shooter.side ? undefined : shooter });
      tUnit.suppression = Math.min(R.suppression.max, tUnit.suppression + R.suppression.hitBonus);
      shots.push({ to: aimPoint, hitUnit: tUnit.id });
    } else {
      // Промах або вільний постріл: відхилення залежить від навченості та дальності.
      const spread = (0.25 + (100 - shooter.stats.training) / 160) * (1 + dist / 12) * (mode === 'aimed' ? 0.6 : mode === 'blind' ? 1.8 : 1);
      const missFactor = tUnit ? 1 : 0.5;
      const dev: Point = {
        x: aimPoint.x + ctx.rng.gaussian(0, spread * 0.45 * missFactor),
        y: aimPoint.y + ctx.rng.gaussian(0, spread * 0.45 * missFactor),
        h: aimPoint.h + ctx.rng.gaussian(0, spread * 0.25 * missFactor),
      };
      // Гарантуємо промах повз ціль, якщо кидок не вдався.
      if (tUnit && Math.hypot(dev.x - aimPoint.x, dev.y - aimPoint.y) < 0.35) {
        const a = ctx.rng.next() * Math.PI * 2;
        dev.x = aimPoint.x + Math.cos(a) * 0.45;
        dev.y = aimPoint.y + Math.sin(a) * 0.45;
      }
      const exclude = new Set<string>(tUnit ? [tUnit.id] : []);
      const res = flyBullet(ctx, shooter, from, dev, exclude, w.damage, w.penetration);
      if (res.hitUnit) shooter.stats_mission.hits++;
      shots.push({ to: res.end, hitUnit: res.hitUnit });
      if (tUnit && !res.hitUnit && i === 0) float(ctx, tUnit.id, 'Промах', 'info');
    }
    suppressAround(ctx, shots[shots.length - 1].to, shooter, R.suppression.perBullet * w.suppression);
  }
  ctx.ev.push({ t: 'fired', unitId: shooter.id, from, shots, targetUnit: tUnit?.id ?? null });
  if (shooter.weaponState === 'carry') shooter.weaponState = 'low';
}

export function grenadeRange(u: Unit): number {
  const G = content().rules.grenade;
  return G.rangeBase + u.stats.strength * G.rangePerStrength;
}

/** Чи можна докинути гранату в клітинку (дуга над низькими перешкодами, не крізь стіни й перекриття). */
export function canThrowTo(ctx: Pick<Ctx, 's'>, u: Unit, cell: Cell): boolean {
  const s = ctx.s;
  if (!u.pos || !cellAt(s.map, cell)?.floor) return false;
  if (dist2d(u.pos, cell) > grenadeRange(u)) return false;
  const from = eyePoint(s, u.pos, 'standing');
  const to = cellCenter(cell, groundHeight(s.map, cell) + 0.3);
  return !trace(s.map, from, to, { skipStart: u.pos, skipEnd: cell, ignoreBelow: 0.6 }).blocked;
}

export function resolveGrenade(ctx: Ctx, u: Unit, defId: string, target: Cell): void {
  const s = ctx.s;
  const G = content().rules.grenade;
  const g = itemDef<GrenadeDefinition>(defId);
  const d = dist2d(u.pos!, target);
  const scatter = d * G.scatterPerCell * (1.2 - u.stats.training / 100);
  let land = { ...target };
  const ang = ctx.rng.next() * Math.PI * 2;
  const r = Math.abs(ctx.rng.gaussian(0, scatter));
  const cand = { x: Math.round(target.x + Math.cos(ang) * r), y: Math.round(target.y + Math.sin(ang) * r), z: target.z };
  if (cellAt(s.map, cand)?.floor && canThrowTo(ctx, u, cand)) land = cand;
  const from = eyePoint(s, u.pos!, 'standing');
  const at = cellCenter(land, groundHeight(s.map, land) + 0.15);
  ctx.ev.push({ t: 'grenade', unitId: u.id, from, to: at });
  ctx.ev.push({ t: 'explosion', at, radius: g.radius });
  u.stats_mission.grenades++;

  // Бійці: стіни захищають, шкода спадає з відстанню, кілька осколків.
  for (const v of s.units) {
    if (!onField(v) || v.pos!.z !== land.z) continue;
    const dd = dist2d(v.pos!, land);
    if (dd > g.radius) continue;
    const tp = targetPoints(s, v.pos!, v.stance)[0];
    if (dd > 0.1 && trace(s.map, at, tp, { skipStart: land, skipEnd: v.pos! }).blocked) continue;
    const k = 1 - dd / (g.radius + 0.5);
    const frags = Math.max(1, Math.round(g.fragments * k + ctx.rng.next()));
    const per = (g.damage * k * (v.stance === 'prone' ? 0.7 : 1)) / Math.sqrt(frags);
    for (let i = 0; i < frags && onField(v) && v.status !== 'dead'; i++) {
      applyHit(ctx, v, per, 2, 'shrapnel', { attacker: v.side === u.side ? undefined : u });
    }
    if (v.status === 'active') v.suppression = Math.min(100, v.suppression + 40);
  }
  // Оточення.
  const rad = Math.ceil(g.radius);
  for (let y = land.y - rad; y <= land.y + rad; y++)
    for (let x = land.x - rad; x <= land.x + rad; x++) {
      const c = { x, y, z: land.z };
      const dd = dist2d(c, land);
      if (dd > g.radius || !cellAt(s.map, c)?.object) continue;
      damageObject(ctx, c, g.damage * (1 - dd / (g.radius + 0.5)), true);
    }
}
