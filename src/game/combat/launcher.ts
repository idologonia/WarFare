import { dist2d, sameCell, type Cell } from '@/core/grid';
import { content, itemDef } from '@/content';
import { cellAt, groundHeight } from '@/game/maps/map';
import { applyHit } from '@/game/injuries/injuries';
import { float, onField, type Ctx, type MissionState } from '@/game/simulation/state';
import { cellCenter, trace, type Point } from '@/game/visibility/los';
import { eyePoint, targetPoints } from '@/game/visibility/visibility';
import type { MagazineDefinition, MagazineInstance, Unit, Warhead, WeaponDefinition } from '@/game/types';
import { damageEdge, damageObject, explode } from './fire';

/**
 * Гранатомети — умовні ігрові системи.
 * РПГ: прямий постріл, вибух у точці влучання (боєць, стіна, земля); пробиває тонкі стіни.
 * Підствольний модуль: навісний постріл у клітинку, невеликий осколковий вибух.
 */
const L = () => content().rules.launcher;

export function launcherOf(u: Unit): { def: WeaponDefinition; loaded: boolean } | null {
  const w = u.inventory.secondary;
  if (!w) return null;
  const def = itemDef<WeaponDefinition>(w.defId);
  if (def.category !== 'launcher' || def.disposable) return null;
  return { def, loaded: (w.magazine?.rounds ?? 0) > 0 };
}

export const hasUnderbarrel = (u: Unit) => !!u.inventory.primary?.mods.includes('underbarrel');

/** Постріл до підствольника: спершу в підсумках, потім у рюкзаку. */
export function uglAmmo(u: Unit): { where: 'pouch' | 'backpack'; index: number } | null {
  const pi = u.inventory.pouches.findIndex((p) => p.defId === 'vog');
  if (pi >= 0) return { where: 'pouch', index: pi };
  const bi = u.inventory.backpackItems.findIndex((e) => e.item.defId === 'vog');
  return bi >= 0 ? { where: 'backpack', index: bi } : null;
}

export function takeUglAmmo(u: Unit, loc: { where: 'pouch' | 'backpack'; index: number }): void {
  if (loc.where === 'pouch') u.inventory.pouches.splice(loc.index, 1);
  else u.inventory.backpackItems.splice(loc.index, 1);
}

/** Запасний постріл до гранатомета (певного типу або будь-який): з підсумків або рюкзака. */
export function findRocket(u: Unit, ammoId?: string): { where: 'pouch' | 'backpack'; index: number } | null {
  const l = launcherOf(u);
  if (!l) return null;
  const ok = (id: string) => (ammoId ? id === ammoId : l.def.magazines.includes(id));
  const pi = u.inventory.pouches.findIndex((p) => ok(p.defId));
  if (pi >= 0) return { where: 'pouch', index: pi };
  const bi = u.inventory.backpackItems.findIndex((e) => ok(e.item.defId));
  return bi >= 0 ? { where: 'backpack', index: bi } : null;
}

/** Кількість запасних пострілів кожного типу. */
export function rocketStock(u: Unit): { id: string; name: string; count: number }[] {
  const l = launcherOf(u);
  if (!l) return [];
  return l.def.magazines.map((id) => ({
    id,
    name: itemDef(id).name,
    count: u.inventory.pouches.filter((p) => p.defId === id).length + u.inventory.backpackItems.filter((e) => e.item.defId === id).length,
  }));
}

export function reloadLauncher(u: Unit, ammoId?: string): boolean {
  const w = u.inventory.secondary;
  const f = findRocket(u, ammoId);
  if (!w || !f) return false;
  const item = (f.where === 'pouch' ? u.inventory.pouches.splice(f.index, 1)[0] : u.inventory.backpackItems.splice(f.index, 1)[0].item) as MagazineInstance;
  w.magazine = { ...item, rounds: 1 };
  return true;
}

/** Бойова частина зарядженого пострілу (або вбудована в одноразовий гранатомет). */
export function warheadOf(def: WeaponDefinition, ammoId?: string | null): Warhead {
  const w = ammoId ? itemDef<MagazineDefinition>(ammoId).warhead : undefined;
  return w ?? { type: 'heat', damage: def.damage, penetration: def.penetration, blast: def.blast! };
}

export function loadedAmmo(u: Unit): string | null {
  const w = u.inventory.secondary;
  return w?.magazine && w.magazine.rounds > 0 ? w.magazine.defId : null;
}

/** Одноразовий гранатомет у спорядженні (рюкзак або пояс). */
export function findDisposable(u: Unit): { where: 'backpack' | 'secondary'; index: number; def: WeaponDefinition } | null {
  const sec = u.inventory.secondary;
  if (sec && itemDef<WeaponDefinition>(sec.defId).disposable) return { where: 'secondary', index: 0, def: itemDef<WeaponDefinition>(sec.defId) };
  const i = u.inventory.backpackItems.findIndex((e) => itemDef<WeaponDefinition>(e.item.defId).disposable);
  return i >= 0 ? { where: 'backpack', index: i, def: itemDef<WeaponDefinition>(u.inventory.backpackItems[i].item.defId) } : null;
}

export function countDisposable(u: Unit): number {
  return u.inventory.backpackItems.filter((e) => itemDef<WeaponDefinition>(e.item.defId).disposable).length + (u.inventory.secondary && itemDef<WeaponDefinition>(u.inventory.secondary.defId).disposable ? 1 : 0);
}

/** Очікуване відхилення пострілу РПГ у клітинках (для підказки). */
export function rpgScatter(u: Unit, target: Cell): number {
  return dist2d(u.pos!, target) * L().rpgScatterPerCell * (1.3 - u.stats.training / 100);
}

export function uglScatter(u: Unit, target: Cell): number {
  return dist2d(u.pos!, target) * L().uglScatterPerCell * (1.25 - u.stats.training / 100);
}

/** Чи можна навісно вистрілити з підствольника в клітинку (дальність і дуга над низькими перешкодами). */
export function canLobTo(s: MissionState, u: Unit, cell: Cell): boolean {
  if (!u.pos || !cellAt(s.map, cell)?.floor) return false;
  const d = dist2d(u.pos, cell);
  if (d > L().uglRange || d < 2) return false;
  const from = eyePoint(s, u.pos, 'standing');
  const to = cellCenter(cell, groundHeight(s.map, cell) + 0.3);
  return !trace(s.map, from, to, { skipStart: u.pos, skipEnd: cell, ignoreBelow: 0.6 }).blocked;
}

/** Постріл РПГ у клітинку (або в бійця, що стоїть у ній). AP і наявність пострілу перевіряє команда. */
export function resolveRocket(ctx: Ctx, u: Unit, target: Cell, def: WeaponDefinition, wh: Warhead = warheadOf(def)): void {
  const s = ctx.s;
  u.stats_mission.grenades++;
  const tUnit = s.units.find((v) => onField(v) && v.pos && sameCell(v.pos, target) && v.status !== 'dead');
  const aim: Point = tUnit ? targetPoints(s, target, tUnit.stance)[0] : cellCenter(target, groundHeight(s.map, target) + 0.35);
  const sc = rpgScatter(u, target);
  aim.x += ctx.rng.gaussian(0, sc * 0.5);
  aim.y += ctx.rng.gaussian(0, sc * 0.5);
  aim.h += ctx.rng.gaussian(0, sc * 0.15);
  const from = eyePoint(s, u.pos!, u.stance);
  const tr = trace(s.map, from, aim, { skipStart: u.pos!, extend: 3 });

  // Перший боєць на шляху — пряме влучання.
  let hitUnit: Unit | null = null;
  let end: Point = tr.end;
  const total = Math.hypot(tr.end.x - from.x, tr.end.y - from.y) || 1;
  for (const c of tr.cells) {
    const v = s.units.find((x) => onField(x) && x.status !== 'dead' && x.id !== u.id && x.pos && sameCell(x.pos, c));
    if (!v) continue;
    const t = Math.min(1, Math.hypot(c.x + 0.5 - from.x, c.y + 0.5 - from.y) / total);
    const h = from.h + (tr.end.h - from.h) * t;
    const g = groundHeight(s.map, v.pos!);
    if (h >= g - 0.05 && h <= g + content().rules.vision.bodyHeight[v.stance] + 0.25) {
      hitUnit = v;
      end = cellCenter(v.pos!, h);
      break;
    }
  }
  ctx.ev.push({ t: 'rocket', unitId: u.id, from, to: end });
  const impactCell: Cell = hitUnit ? hitUnit.pos! : { x: Math.floor(end.x), y: Math.floor(end.y), z: Math.max(0, Math.min(s.map.levels - 1, Math.floor(end.h))) };
  // Зведення підривника: надто близько — без вибуху.
  if (dist2d(u.pos!, impactCell) < L().armDistance) {
    float(ctx, u.id, 'Не здетонував', 'info');
    if (hitUnit) applyHit(ctx, hitUnit, 20, 2, 'bullet', { attacker: hitUnit.side === u.side ? undefined : u });
    return;
  }
  if (hitUnit) applyHit(ctx, hitUnit, wh.damage, wh.penetration, 'bullet', { attacker: hitUnit.side === u.side ? undefined : u, part: 'torso' });
  const blast = wh.blast;
  // Влучання в стіну/об'єкт: кумулятивний робить пролом, осколковий — лише вибухає біля перешкоди.
  let land = impactCell;
  if (!hitUnit && tr.blocked) {
    if (tr.blockEdge) damageEdge(ctx, tr.blockEdge.cell, tr.blockEdge.side, blast.objectDamage, true);
    else if (tr.blockCell && tr.blockKind === 'object') damageObject(ctx, tr.blockCell, blast.objectDamage, true);
    const back = { x: end.x - ((end.x - from.x) / total) * 0.3, y: end.y - ((end.y - from.y) / total) * 0.3 };
    land = { x: Math.floor(back.x), y: Math.floor(back.y), z: impactCell.z };
    if (!cellAt(s.map, land)) land = impactCell;
  }
  explode(ctx, land, { ...cellCenter(land, groundHeight(s.map, land) + 0.3) }, { ...blast, objectDamage: blast.objectDamage / 4 }, u);
}

/** Навісний постріл підствольника. */
export function resolveUgl(ctx: Ctx, u: Unit, target: Cell): void {
  const s = ctx.s;
  const sc = uglScatter(u, target);
  let land = { ...target };
  const ang = ctx.rng.next() * Math.PI * 2;
  const r = Math.abs(ctx.rng.gaussian(0, sc));
  const cand = { x: Math.round(target.x + Math.cos(ang) * r), y: Math.round(target.y + Math.sin(ang) * r), z: target.z };
  if (cellAt(s.map, cand)?.floor && canLobTo(s, u, cand)) land = cand;
  const from = eyePoint(s, u.pos!, 'standing');
  const at = cellCenter(land, groundHeight(s.map, land) + 0.15);
  ctx.ev.push({ t: 'grenade', unitId: u.id, from, to: at });
  u.stats_mission.grenades++;
  explode(ctx, land, at, L().ugl, u);
}
