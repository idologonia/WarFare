import { dist2d, toTenths, type Cell } from '@/core/grid';
import { content, droneDef, itemDef } from '@/content';
import { cellAt, groundHeight } from '@/game/maps/map';
import { explode } from '@/game/combat/fire';
import { damageVehicle, vehicleAt } from '@/game/vehicles';
import { applyHit } from '@/game/injuries/injuries';
import { float, newId, onField, type Ctx, type MissionState } from '@/game/simulation/state';
import { cellCenter, trace, type Point } from '@/game/visibility/los';
import { targetPoints } from '@/game/visibility/visibility';
import type { DroneItemDefinition, DronePayload, DroneState, SideId, Unit } from '@/game/types';

/**
 * Дрони — умовні ігрові системи: окрема одиниця з власними AP і батареєю,
 * оператор вразливий (менше AP, без overwatch, втрата оператора — втрата дрона).
 */
const RD = () => content().rules.drones;

export function drones(s: MissionState): DroneState[] {
  return (s.drones ?? []).filter((d) => !d.destroyed);
}

export function droneById(s: MissionState, id: string): DroneState | undefined {
  return (s.drones ?? []).find((d) => d.id === id);
}

/** Висота польоту дрона (одиниці поверху) — над найвищим поверхом карти. */
export const droneAltitude = (s: MissionState) => s.map.levels - 1 + 0.9 + RD().altitude;

export const droneAlt = (s: MissionState, d: DroneState) => d.alt ?? s.map.levels;

export function dronePoint(s: MissionState, d: DroneState): Point {
  const a = droneAlt(s, d);
  return { x: d.x + 0.5, y: d.y + 0.5, h: a >= s.map.levels ? droneAltitude(s) : a + 0.85 };
}

/** Чи можна дрону бути в клітинці на висоті alt: над ним відкрите небо, без високих об'єктів. */
export function airOk(s: MissionState, x: number, y: number, alt: number): boolean {
  if (x < 0 || y < 0 || x >= s.map.width || y >= s.map.height) return false;
  if (alt >= s.map.levels) return true;
  for (let z = alt + 1; z < s.map.levels; z++) if (s.map.cells[z][y][x].floor) return false;
  const c = s.map.cells[alt][y][x];
  const o = c.object ? content().objects.get(c.object.defId) : null;
  if (o && o.blocksMove && o.height >= 0.8) return false;
  return !c.vehicle;
}

export function changeAltitude(ctx: Ctx, d: DroneState, delta: number): string | null {
  const s = ctx.s;
  const a = droneAlt(s, d) + delta;
  if (a < 0 || a > s.map.levels) return 'Далі не можна';
  if (!airOk(s, d.x, d.y, a)) return 'Тут не опуститися — дах або перешкода';
  const cost = toTenths(RD().altitudeCost) * Math.abs(delta);
  if (d.ap < cost) return 'Недостатньо AP дрона';
  d.ap -= cost;
  d.alt = a;
  ctx.ev.push({ t: 'drone', droneId: d.id });
  return null;
}

/** Дрони в рюкзаку оператора: індекс у рюкзаку й опис. */
export function droneItems(u: Unit): { index: number; defId: string; name: string }[] {
  return u.inventory.backpackItems
    .map((e, index) => ({ e, index }))
    .filter(({ e }) => itemDef(e.item.defId).kind === 'drone')
    .map(({ e, index }) => ({ index, defId: e.item.defId, name: itemDef(e.item.defId).name }));
}

export function launchDrone(ctx: Ctx, u: Unit, backpackIndex: number, payload?: DronePayload): DroneState | string {
  const s = ctx.s;
  const e = u.inventory.backpackItems[backpackIndex];
  if (!e || itemDef(e.item.defId).kind !== 'drone') return 'Немає дрона';
  if (u.piloting && droneById(s, u.piloting) && !droneById(s, u.piloting)!.destroyed) return 'Оператор уже керує дроном';
  if (!u.pos) return 'Оператор має бути на полі';
  const def = droneDef(itemDef<DroneItemDefinition>(e.item.defId).drone);
  u.inventory.backpackItems.splice(backpackIndex, 1);
  const d: DroneState = {
    id: newId(s, 'd'),
    defId: def.id,
    side: u.side,
    operatorId: u.id,
    itemDefId: e.item.defId,
    x: u.pos.x,
    y: u.pos.y,
    ap: toTenths(def.ap) / 2, // у перший хід — половина (зліт)
    battery: def.battery,
    drops: def.drops ?? 0,
    destroyed: false,
    payload: payload && (def.warheads?.[payload] || def.drops_?.[payload]) ? payload : undefined,
  };
  (s.drones ??= []).push(d);
  u.piloting = d.id;
  u.overwatch = 0;
  ctx.ev.push({ t: 'drone', droneId: d.id });
  float(ctx, u.id, `${def.name}: зліт`, 'info');
  return d;
}

/** Переліт по прямій (над перешкодами); ціна — AP дрона за клітинку. */
export function moveCost(d: DroneState, x: number, y: number): number {
  const steps = Math.max(Math.abs(x - d.x), Math.abs(y - d.y));
  return steps * toTenths(droneDef(d.defId).moveCost);
}

export function flyDrone(ctx: Ctx, d: DroneState, x: number, y: number): string | null {
  const s = ctx.s;
  if (x < 0 || y < 0 || x >= s.map.width || y >= s.map.height) return 'Поза картою';
  const cost = moveCost(d, x, y);
  if (cost > d.ap) return 'Недостатньо AP дрона';
  const path: { x: number; y: number }[] = [{ x: d.x, y: d.y }];
  let cx = d.x;
  let cy = d.y;
  const alt = droneAlt(s, d);
  while (cx !== x || cy !== y) {
    cx += Math.sign(x - cx);
    cy += Math.sign(y - cy);
    if (!airOk(s, cx, cy, alt)) return 'На цій висоті шлях перекрито — підніміть дрон';
    path.push({ x: cx, y: cy });
  }
  d.ap -= cost;
  d.x = x;
  d.y = y;
  ctx.ev.push({ t: 'drone', droneId: d.id, path });
  return null;
}

/** Відхилення точки ураження: залежить від точності дрона й навченості оператора. */
function scatter(ctx: Ctx, d: DroneState, target: Cell): Cell {
  const op = ctx.s.units.find((u) => u.id === d.operatorId);
  const acc = (droneDef(d.defId).accuracy ?? 0.5) * (0.6 + (op?.stats.training ?? 50) / 125);
  if (ctx.rng.chance(Math.min(95, acc * 100))) return target;
  const a = ctx.rng.next() * Math.PI * 2;
  const c = { x: Math.round(target.x + Math.cos(a)), y: Math.round(target.y + Math.sin(a)), z: target.z };
  return cellAt(ctx.s.map, c) ? c : target;
}

/** Найвища підлога в клітинці (куди падає/влітає боєприпас згори) — дах або земля. */
function impactLevel(s: MissionState, x: number, y: number, preferZ?: number): number {
  if (preferZ !== undefined && cellAt(s.map, { x, y, z: preferZ })?.floor) return preferZ;
  for (let z = s.map.levels - 1; z >= 0; z--) if (s.map.cells[z][y][x].floor) return z;
  return 0;
}

/** Атака FPV: дрон летить у ціль і вибухає (одноразово). */
export function fpvAttack(ctx: Ctx, d: DroneState, target: Cell): string | null {
  const s = ctx.s;
  const def = droneDef(d.defId);
  if (def.kind !== 'fpv' || !def.warhead) return 'Це не ударний дрон';
  const cost = moveCost(d, target.x, target.y);
  if (cost > d.ap) return 'Ціль задалеко для залишку AP дрона';
  const hit = scatter(ctx, d, target);
  const z = impactLevel(s, hit.x, hit.y, target.z);
  const land = { x: hit.x, y: hit.y, z };
  ctx.ev.push({ t: 'drone', droneId: d.id, attack: land });
  const op = s.units.find((u) => u.id === d.operatorId);
  const wh = (d.payload && def.warheads?.[d.payload]) || def.warhead!;
  const v = vehicleAt(s, land);
  if (v && z === 0) damageVehicle(ctx, v, wh.damage, wh.penetration, wh.type === 'heat', op);
  const victim = s.units.find((u) => onField(u) && u.status !== 'dead' && u.pos && u.pos.x === land.x && u.pos.y === land.y && u.pos.z === z);
  if (victim) applyHit(ctx, victim, wh.damage, wh.penetration, wh.type === 'incendiary' ? 'burn' : 'bullet', { attacker: op && victim.side !== op.side ? op : undefined, part: 'torso' });
  explode(ctx, land, cellCenter(land, groundHeight(s.map, land) + 0.3), { ...wh.blast, ignite: wh.ignite ?? wh.blast.ignite }, op ?? null);
  destroyDrone(ctx, d, false);
  return null;
}

/** Скид боєприпасу з дрона в клітинку під ним. */
export function droneDrop(ctx: Ctx, d: DroneState): string | null {
  const s = ctx.s;
  const def = droneDef(d.defId);
  if (def.kind !== 'dropper' || !def.dropBlast) return 'Цей дрон без скиду';
  if (d.drops <= 0) return 'Скидів не лишилось';
  if (d.ap < toTenths(2)) return 'Недостатньо AP дрона';
  d.ap -= toTenths(2);
  d.drops--;
  const hit = scatter(ctx, d, { x: d.x, y: d.y, z: 0 });
  const z = impactLevel(s, hit.x, hit.y);
  const land = { x: hit.x, y: hit.y, z };
  const at = cellCenter(land, groundHeight(s.map, land) + 0.15);
  ctx.ev.push({ t: 'grenade', unitId: d.operatorId, from: dronePoint(s, d), to: at });
  const op = s.units.find((u) => u.id === d.operatorId);
  explode(ctx, land, at, (d.payload && def.drops_?.[d.payload]) || def.dropBlast, op ?? null);
  return null;
}

export function landDrone(ctx: Ctx, d: DroneState): string | null {
  const s = ctx.s;
  const op = s.units.find((u) => u.id === d.operatorId);
  if (!op?.pos) return 'Оператор недоступний';
  if (Math.max(Math.abs(op.pos.x - d.x), Math.abs(op.pos.y - d.y)) > 1) return 'Дрон має бути над оператором або поруч';
  const def = itemDef(d.itemDefId);
  const [gw, gh] = op.inventory.backpack ? (itemDef(op.inventory.backpack.defId) as unknown as { grid: [number, number] }).grid : [0, 0];
  let placed = false;
  for (let y = 0; y < gh && !placed; y++)
    for (let x = 0; x < gw && !placed; x++) {
      const [w, h] = def.size;
      if (x + w > gw || y + h > gh) continue;
      const busy = op.inventory.backpackItems.some((e) => {
        const [ew, eh] = itemDef(e.item.defId).size;
        return x < e.x + ew && x + w > e.x && y < e.y + eh && y + h > e.y;
      });
      if (!busy) {
        op.inventory.backpackItems.push({ item: { id: newId(s, 'i'), defId: d.itemDefId, uses: 1 }, x, y });
        placed = true;
      }
    }
  if (!placed) return 'У рюкзаку немає місця для дрона';
  d.destroyed = true;
  delete op.piloting;
  ctx.ev.push({ t: 'drone', droneId: d.id, lost: true });
  float(ctx, op.id, 'Дрон посаджено', 'info');
  return null;
}

export function destroyDrone(ctx: Ctx, d: DroneState, shotDown: boolean): void {
  d.destroyed = true;
  const op = ctx.s.units.find((u) => u.id === d.operatorId);
  if (op?.piloting === d.id) delete op.piloting;
  ctx.ev.push({ t: 'drone', droneId: d.id, lost: true });
  if (shotDown && op) float(ctx, op.id, 'Дрон збито', 'bad');
}

/** Початок ходу сторони: батарея −1, AP дрона відновлюється; без оператора чи батареї — падає. */
export function tickDrones(ctx: Ctx, side: SideId): void {
  for (const d of drones(ctx.s)) {
    if (d.side !== side) continue;
    const op = ctx.s.units.find((u) => u.id === d.operatorId);
    d.battery -= 1;
    if (!op || op.status !== 'active' || d.battery <= 0) {
      if (op) float(ctx, op.id, d.battery <= 0 ? 'Батарея дрона сіла — дрон втрачено' : 'Зв’язок із дроном втрачено', 'bad');
      destroyDrone(ctx, d, false);
      continue;
    }
    d.ap = toTenths(droneDef(d.defId).ap);
  }
}

/** Чи бачить дрон ціль: радіус огляду згори, пряма видимість (дахи й перекриття закривають). */
export function droneSees(s: MissionState, d: DroneState, target: Unit): boolean {
  if (!target.pos) return false;
  const def = droneDef(d.defId);
  let range = def.vision;
  if (!def.thermal && s.scenario.timeOfDay === 'night') range *= 0.5;
  if (!def.thermal && s.scenario.weather === 'fog') range *= 0.6;
  if (dist2d({ x: d.x, y: d.y, z: 0 }, target.pos) > range) return false;
  const eye = dronePoint(s, d);
  for (const p of targetPoints(s, target.pos, target.stance)) {
    const tr = trace(s.map, eye, p, { skipEnd: target.pos });
    // Тепловізор бачить крізь дим і рослинність; звичайна камера — ні.
    if (!tr.blocked && (def.thermal || tr.concealment < 6)) return true;
  }
  return false;
}

/** Чи помічає сторона ворожий дрон (чути й видно в небі поблизу). */
export function droneNoticedBy(s: MissionState, side: SideId, d: DroneState): boolean {
  if (s.revealAll || d.side === side) return true;
  return s.units.some((u) => u.side === side && u.status === 'active' && u.pos && dist2d(u.pos, { x: d.x, y: d.y, z: 0 }) <= RD().hearRange);
}

/** Шанс збити дрон з особистої зброї (маленька швидка ціль). */
export function shootDroneChance(shooter: Unit, d: DroneState): number {
  const R = RD();
  const dist = dist2d(shooter.pos!, { x: d.x, y: d.y, z: 0 });
  const low = d.alt !== undefined && d.alt < 2 ? R.lowFlyBonus : 0;
  return Math.max(5, Math.min(75, Math.round(R.shootBase + low + shooter.stats.training * R.shootTrainingFactor - dist * R.shootRangePenalty)));
}
