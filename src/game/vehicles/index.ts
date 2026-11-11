import { cellKey, dist2d, toTenths, type Cell } from '@/core/grid';
import { content, objectDef, vehicleDef } from '@/content';
import { cellAt, edgeBetween, groundHeight, setEdge } from '@/game/maps/map';
import { createItem, type IdGen } from '@/game/inventory/inventory';
import { applyHit } from '@/game/injuries/injuries';
import { activeUnitAt, float, type Ctx, type MissionState } from '@/game/simulation/state';
import { cellCenter, type Point } from '@/game/visibility/los';
import type { MagazineInstance, MapObjectDefinition, SideId, Unit, VehicleComponent, VehicleState, WeaponInstance } from '@/game/types';

/**
 * Техніка (умовна ігрова система): займає 2×2 клітинки, як у X-COM.
 * Рух — за AP водія; посадка й висадка коштують AP; навідник стріляє з бортової зброї;
 * окремі компоненти пошкоджуються; броня зупиняє слабкі кулі.
 */

export const COMPONENT_NAMES: Record<VehicleComponent, string> = { hull: 'Корпус', engine: 'Двигун', mobility: 'Ходова', weapon: 'Озброєння' };

export function vehicles(s: MissionState): VehicleState[] {
  return s.vehicles ?? [];
}

export function vehicleById(s: MissionState, id: string): VehicleState | undefined {
  return vehicles(s).find((v) => v.id === id);
}

export function footprintAt(defId: string, x: number, y: number): Cell[] {
  const [w, h] = vehicleDef(defId).footprint;
  const out: Cell[] = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) out.push({ x: x + dx, y: y + dy, z: 0 });
  return out;
}

export const footprint = (v: VehicleState) => footprintAt(v.defId, v.x, v.y);

export function vehicleAt(s: MissionState, c: Cell): VehicleState | undefined {
  const id = cellAt(s.map, c)?.vehicle;
  return id ? vehicleById(s, id) : undefined;
}

/** Центр техніки у світових координатах (для прицілювання й огляду). */
export function vehicleCenter(s: MissionState, v: VehicleState, h = 0.5): Point {
  const [w, hh] = vehicleDef(v.defId).footprint;
  return { x: v.x + w / 2, y: v.y + hh / 2, h: groundHeight(s.map, { x: v.x, y: v.y, z: 0 }) + h };
}

/** Що техніка може переїхати й розчавити: паркани, кущі, ящики, мішки (не стіни). */
export function crushable(o: MapObjectDefinition): boolean {
  return !o.wall && ['wood', 'foliage', 'sandbag'].includes(o.material) && o.id !== 'tree' && o.id !== 'tree_damaged';
}

function setOccupancy(s: MissionState, v: VehicleState, on: boolean): void {
  for (const c of footprint(v)) {
    const cell = cellAt(s.map, c);
    if (!cell) continue;
    if (on) {
      cell.vehicle = v.id;
      cell.vehicleHeight = v.destroyed ? 0.55 : vehicleDef(v.defId).height;
    } else if (cell.vehicle === v.id) {
      delete cell.vehicle;
      delete cell.vehicleHeight;
    }
  }
}

/** Чи може техніка стояти з лівим верхнім кутом у (x, y). */
export function canPlace(s: MissionState, defId: string, x: number, y: number, ignoreId?: string): boolean {
  const cells = footprintAt(defId, x, y);
  for (const c of cells) {
    const cell = cellAt(s.map, c);
    if (!cell || !cell.floor) return false;
    if (cell.vehicle && cell.vehicle !== ignoreId) return false;
    if (cell.object && objectDef(cell.object.defId).blocksMove && !crushable(objectDef(cell.object.defId))) return false;
    if (activeUnitAt(s, c)) return false;
    if (cell.buildingId !== undefined && content().terrain.get(cell.terrain)?.indoor) return false;
  }
  // Лише рівна ділянка: без «зависання» на краю пагорба; колісна техніка на пагорби не заїжджає.
  const elev = cells.map((c) => cellAt(s.map, c)!.elevation);
  if (elev.some((e) => e !== elev[0])) return false;
  if (elev[0] > 0 && vehicleDef(defId).kind === 'wheeled') return false;
  // Тонкі стіни всередині площі техніки.
  for (const a of cells)
    for (const b of cells) {
      if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) !== 1) continue;
      const e = edgeBetween(s.map, a, b);
      if (e && objectDef(e.obj.defId).blocksMove && !crushable(objectDef(e.obj.defId))) return false;
    }
  return true;
}

function stepAllowed(s: MissionState, v: VehicleState, x: number, y: number, dx: number, dy: number): boolean {
  if (!canPlace(s, v.defId, x + dx, y + dy, v.id)) return false;
  for (const c of footprintAt(v.defId, x, y)) {
    const e = edgeBetween(s.map, c, { x: c.x + dx, y: c.y + dy, z: 0 });
    if (e && objectDef(e.obj.defId).blocksMove && !crushable(objectDef(e.obj.defId))) return false;
  }
  return true;
}

export function canMove(v: VehicleState): boolean {
  return !v.destroyed && v.hp.engine > 0 && v.hp.mobility > 0 && !!v.driver;
}

export interface VehicleNode {
  x: number;
  y: number;
  cost: number;
  prev: string | null;
}

/** Досяжні положення техніки (4 напрямки) за бюджетом AP водія (у десятих). */
export function vehicleReachable(s: MissionState, v: VehicleState, budget: number): Map<string, VehicleNode> {
  const step = toTenths(vehicleDef(v.defId).moveCost);
  const nodes = new Map<string, VehicleNode>();
  const k = (x: number, y: number) => `${x},${y}`;
  nodes.set(k(v.x, v.y), { x: v.x, y: v.y, cost: 0, prev: null });
  const queue = [k(v.x, v.y)];
  while (queue.length) {
    const key = queue.shift()!;
    const n = nodes.get(key)!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const c = n.cost + step;
      if (c > budget) continue;
      const nk = k(n.x + dx, n.y + dy);
      if (nodes.has(nk) || !stepAllowed(s, v, n.x, n.y, dx, dy)) continue;
      nodes.set(nk, { x: n.x + dx, y: n.y + dy, cost: c, prev: key });
      queue.push(nk);
    }
  }
  return nodes;
}

export function vehiclePath(nodes: Map<string, VehicleNode>, x: number, y: number): { x: number; y: number }[] | null {
  let key: string | null = `${x},${y}`;
  if (!nodes.has(key)) return null;
  const out: { x: number; y: number }[] = [];
  while (key) {
    const n: VehicleNode = nodes.get(key)!;
    out.push({ x: n.x, y: n.y });
    key = n.prev;
  }
  return out.reverse();
}

/** Рух техніки: розчавлює легкі перешкоди на шляху. */
export function moveVehicle(ctx: Ctx, v: VehicleState, path: { x: number; y: number }[]): void {
  const s = ctx.s;
  for (let i = 1; i < path.length; i++) {
    const dx = path[i].x - path[i - 1].x;
    const dy = path[i].y - path[i - 1].y;
    for (const c of footprintAt(v.defId, path[i - 1].x, path[i - 1].y)) {
      const to = { x: c.x + dx, y: c.y + dy, z: 0 };
      const e = edgeBetween(s.map, c, to);
      if (e && crushable(objectDef(e.obj.defId))) {
        setEdge(s.map, e.cell, e.side, null);
        ctx.ev.push({ t: 'object', cell: e.cell, defId: null });
      }
    }
    setOccupancy(s, v, false);
    v.x = path[i].x;
    v.y = path[i].y;
    v.facing = dx > 0 ? 1 : dx < 0 ? 3 : dy > 0 ? 2 : 0;
    for (const c of footprint(v)) {
      const cell = cellAt(s.map, c)!;
      if (cell.object && crushable(objectDef(cell.object.defId))) {
        cell.object = null;
        ctx.ev.push({ t: 'object', cell: c, defId: null });
      }
      // Внутрішні межі площі (паркан між клітинками) теж розчавлюються.
      for (const side of ['n', 'w'] as const) {
        const e = cell.edges?.[side];
        const other = side === 'n' ? { x: c.x, y: c.y - 1, z: 0 } : { x: c.x - 1, y: c.y, z: 0 };
        if (e && crushable(objectDef(e.defId)) && footprint(v).some((f) => f.x === other.x && f.y === other.y)) {
          setEdge(s.map, c, side, null);
          ctx.ev.push({ t: 'object', cell: c, defId: null });
        }
      }
    }
    setOccupancy(s, v, true);
  }
  ctx.ev.push({ t: 'vehicle', vehicleId: v.id, path: path.map((p) => ({ x: p.x, y: p.y, z: 0 })) });
}

export function crew(s: MissionState, v: VehicleState): Unit[] {
  const ids = [v.driver, v.gunner, ...v.passengers].filter(Boolean) as string[];
  return ids.map((id) => s.units.find((u) => u.id === id)).filter(Boolean) as Unit[];
}

export function freeSeats(v: VehicleState): number {
  return (v.driver ? 0 : 1) + (v.gunner || !v.weapon ? 0 : 1) + vehicleDef(v.defId).passengers - v.passengers.length;
}

/** Чи стоїть боєць поруч із технікою (будь-яка з 8 сусідніх клітинок площі). */
export function adjacentToVehicle(v: VehicleState, c: Cell): boolean {
  if (c.z !== 0) return false;
  return footprint(v).some((f) => Math.abs(f.x - c.x) <= 1 && Math.abs(f.y - c.y) <= 1) && !footprint(v).some((f) => f.x === c.x && f.y === c.y);
}

export type Seat = 'driver' | 'gunner' | 'passenger';

export function embark(v: VehicleState, u: Unit, seat?: Seat): string | null {
  const want: Seat | null = seat ?? (!v.driver ? 'driver' : v.weapon && !v.gunner ? 'gunner' : v.passengers.length < vehicleDef(v.defId).passengers ? 'passenger' : null);
  if (!want) return 'Вільних місць немає';
  if (want === 'driver') {
    if (v.driver) return 'Місце водія зайняте';
    v.driver = u.id;
  } else if (want === 'gunner') {
    if (!v.weapon) return 'Немає бортової зброї';
    if (v.gunner) return 'Місце навідника зайняте';
    v.gunner = u.id;
  } else {
    if (v.passengers.length >= vehicleDef(v.defId).passengers) return 'Десантне відділення заповнене';
    v.passengers.push(u.id);
  }
  u.inVehicle = v.id;
  u.pos = null;
  u.overwatch = 0;
  return null;
}

export function leaveSeat(v: VehicleState, u: Unit): void {
  if (v.driver === u.id) v.driver = null;
  if (v.gunner === u.id) v.gunner = null;
  v.passengers = v.passengers.filter((id) => id !== u.id);
  delete u.inVehicle;
}

/** Вільні клітинки навколо техніки (для висадки й евакуації екіпажу). */
export function exitCells(s: MissionState, v: VehicleState): Cell[] {
  const out: Cell[] = [];
  const seen = new Set<string>();
  for (const f of footprint(v))
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const c = { x: f.x + dx, y: f.y + dy, z: 0 };
        const k = cellKey(c);
        if (seen.has(k) || !adjacentToVehicle(v, c)) continue;
        seen.add(k);
        const cell = cellAt(s.map, c);
        if (cell?.floor && !cell.vehicle && !activeUnitAt(s, c) && !(cell.object && objectDef(cell.object.defId).blocksMove)) out.push(c);
      }
  return out;
}

export function spawnVehicle(s: MissionState, side: SideId, defId: string, x: number, y: number, id: IdGen): VehicleState {
  const d = vehicleDef(defId);
  let weapon: WeaponInstance | null = null;
  if (d.weapon) {
    weapon = createItem(d.weapon, id) as WeaponInstance;
    weapon.magazine = createItem(d.weaponAmmo!, id) as MagazineInstance;
  }
  const v: VehicleState = {
    id: id('v'),
    defId,
    side,
    x,
    y,
    facing: side === 'blue' ? 0 : 2,
    hp: { ...d.components },
    driver: null,
    gunner: null,
    passengers: [],
    weapon,
    ammoStock: d.ammoStock,
    destroyed: false,
  };
  // Фарбування: М113 — койот, L200 — олива, чорний або сірий (за ідентифікатором).
  if (defId === 'm113') v.paint = '#9b8357';
  if (defId === 'l200') v.paint = ['#55603f', '#1f2022', '#7b7e82'][[...v.id].reduce((a, c) => a + c.charCodeAt(0), 0) % 3];
  (s.vehicles ??= []).push(v);
  setOccupancy(s, v, true);
  return v;
}

/**
 * Влучання в техніку. Якщо пробиття ≤ броні — рикошет. Інакше — шкода компоненту,
 * кумулятивний струмінь ранить екіпаж; знищення корпусу — екіпаж виходить поранений.
 */
export function damageVehicle(ctx: Ctx, v: VehicleState, damage: number, penetration: number, heat: boolean, attacker?: Unit): void {
  if (v.destroyed) return;
  const d = vehicleDef(v.defId);
  if (penetration <= d.armor) {
    v.hp.hull = Math.max(0, v.hp.hull - Math.round(damage * 0.04));
    ctx.ev.push({ t: 'vehicleHit', vehicleId: v.id, component: null, penetrated: false });
    return;
  }
  const comp = ctx.rng.weighted<VehicleComponent>([['hull', 50], ['engine', 20], ['mobility', 20], ...(v.weapon ? ([['weapon', 10]] as [VehicleComponent, number][]) : [])]);
  const dmg = Math.round(damage * (heat ? 2.2 : 1));
  v.hp[comp] = Math.max(0, v.hp[comp] - dmg);
  if (comp !== 'hull') v.hp.hull = Math.max(0, v.hp.hull - Math.round(dmg * 0.4));
  ctx.ev.push({ t: 'vehicleHit', vehicleId: v.id, component: comp, penetrated: true });
  const occupants = crew(ctx.s, v);
  if (occupants[0]) float(ctx, occupants[0].id, `${COMPONENT_NAMES[comp]} уражено`, 'bad');
  // Уламки броні та кумулятивний струмінь всередині.
  for (const o of occupants) if (ctx.rng.chance(heat ? 45 : 15)) applyHit(ctx, o, heat ? 30 : 15, 2, 'shrapnel', { attacker });
  if (v.hp.hull <= 0) destroyVehicle(ctx, v, attacker);
}

export function destroyVehicle(ctx: Ctx, v: VehicleState, attacker?: Unit): void {
  const s = ctx.s;
  v.destroyed = true;
  setOccupancy(s, v, true);
  const exits = exitCells(s, v);
  for (const o of crew(s, v)) {
    leaveSeat(v, o);
    applyHit(ctx, o, 25, 2, 'shrapnel', { attacker });
    const c = exits.shift();
    if (c) o.pos = { ...c };
    else {
      o.health = 0;
      o.status = 'dead';
      ctx.ev.push({ t: 'status', unitId: o.id, status: 'dead' });
    }
    if (o.status === 'active' || o.status === 'down' || o.status === 'dead') ctx.ev.push({ t: 'deployed', unitId: o.id, cell: o.pos ?? { x: v.x, y: v.y, z: 0 } });
  }
  v.driver = null;
  v.gunner = null;
  v.passengers = [];
  ctx.ev.push({ t: 'vehicle', vehicleId: v.id });
  float(ctx, attacker?.id ?? '', 'Техніку знищено', 'good');
}

/** Віртуальний спостерігач/стрілець для екіпажу: стоїть у центрі техніки, вище за звичайного бійця. */
export function crewProxy(s: MissionState, v: VehicleState, u: Unit): Unit {
  const c = vehicleCenter(s, v, 0);
  return { ...u, pos: { x: Math.floor(c.x - 0.01), y: Math.floor(c.y - 0.01), z: 0 }, stance: 'standing', inVehicle: v.id };
}

export const vehicleDistance = (v: VehicleState, c: Cell) => Math.min(...footprint(v).map((f) => dist2d(f, c)));

export function cellCenterOf(s: MissionState, c: Cell, h: number): Point {
  return cellCenter(c, groundHeight(s.map, c) + h);
}
