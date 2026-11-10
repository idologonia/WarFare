import type { Rng } from '@/core/rng';
import { DIRS8, type Cell } from '@/core/grid';
import { objectDef, terrainDef } from '@/content';
import type { EdgeObject, EdgeSide, MapCell, MapDefinition, MapObjectDefinition, MapState } from '@/game/types';

/** Створює стан карти з ручної основи; клітинки з `variation` заповнюються процедурно за seed. */
export function buildMap(def: MapDefinition, rng: Rng): MapState {
  const cells: MapCell[][][] = [];
  def.layers.forEach((rows, z) => {
    if (rows.length !== def.height) throw new Error(`Карта ${def.id}: поверх ${z} має ${rows.length} рядків замість ${def.height}`);
    const level: MapCell[][] = [];
    rows.forEach((row, y) => {
      const chars = [...row];
      if (chars.length !== def.width) throw new Error(`Карта ${def.id}: рядок ${y} поверху ${z} має довжину ${chars.length}`);
      level.push(
        chars.map((ch, x) => {
          const l = def.legend[ch];
          if (!l) throw new Error(`Карта ${def.id}: невідомий символ «${ch}» у (${x},${y},${z})`);
          let objId = l.object ?? null;
          if (l.variation) objId = rng.weighted(l.variation.map(([o, w]) => [o, w] as const));
          const cell: MapCell = {
            terrain: l.terrain,
            floor: z === 0 ? true : l.floor !== false,
            elevation: l.elevation ?? 0,
            object: objId ? { defId: objId, hp: objectDef(objId).hp } : null,
          };
          if (l.stairsUp) cell.stairsUp = true;
          return cell;
        }),
      );
    });
    cells.push(level);
  });
  const map0: MapState = { id: def.id, name: def.name, width: def.width, height: def.height, levels: cells.length, cells };
  for (const [x, y, z, side, id] of def.edges ?? []) setEdge(map0, { x, y, z }, side, { defId: id, hp: objectDef(id).hp });
  for (const [x, y, z, rot] of def.rotations ?? []) {
    const o = cells[z]?.[y]?.[x]?.object;
    if (o) o.rot = rot;
  }
  def.buildings.forEach(([x0, y0, x1, y1], i) => {
    for (const level of cells)
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) level[y][x].buildingId = i;
  });
  return { id: def.id, name: def.name, width: def.width, height: def.height, levels: cells.length, cells };
}

export function inBounds(map: MapState, c: Cell): boolean {
  return c.x >= 0 && c.y >= 0 && c.z >= 0 && c.x < map.width && c.y < map.height && c.z < map.levels;
}

export function cellAt(map: MapState, c: Cell): MapCell | undefined {
  return inBounds(map, c) ? map.cells[c.z][c.y][c.x] : undefined;
}

export function objAt(map: MapState, c: Cell): MapObjectDefinition | null {
  const cell = cellAt(map, c);
  return cell?.object ? objectDef(cell.object.defId) : null;
}

/** Висота поверхні клітинки в одиницях поверху. */
export function groundHeight(map: MapState, c: Cell): number {
  const cell = cellAt(map, c);
  return c.z + (cell && c.z === 0 ? cell.elevation : 0);
}

/** Чи можна стояти в клітинці (без урахування бійців). */
export function isStandable(map: MapState, c: Cell): boolean {
  const cell = cellAt(map, c);
  if (!cell || !cell.floor) return false;
  const o = cell.object ? objectDef(cell.object.defId) : null;
  return !o || !o.blocksMove;
}

export function isSlowTerrain(map: MapState, c: Cell): boolean {
  const cell = cellAt(map, c);
  if (!cell) return false;
  const o = cell.object ? objectDef(cell.object.defId) : null;
  return terrainDef(cell.terrain).slow > 0 || (!!o && !o.blocksMove && (o.concealment ?? 0) > 0) || o?.id.endsWith('rubble') === true;
}

export function isIndoor(map: MapState, c: Cell): boolean {
  const cell = cellAt(map, c);
  return !!cell && cell.buildingId !== undefined && terrainDef(cell.terrain).indoor === true;
}

export interface Step {
  to: Cell;
  diagonal: boolean;
  stairs: boolean;
}

/** Сусідні клітинки для руху: 8 напрямків на поверсі + сходи. Без «зрізання» кутів стін. */
export function moveNeighbors(map: MapState, c: Cell): Step[] {
  const out: Step[] = [];
  for (const [dx, dy] of DIRS8) {
    const to = { x: c.x + dx, y: c.y + dy, z: c.z };
    if (!isStandable(map, to)) continue;
    const diagonal = dx !== 0 && dy !== 0;
    if (diagonal) {
      // Діагональ — лише якщо обидва обхідні шляхи «буквою Г» вільні (без зрізання кутів стін).
      const a = { x: c.x + dx, y: c.y, z: c.z };
      const b = { x: c.x, y: c.y + dy, z: c.z };
      if (!isStandable(map, a) || !isStandable(map, b)) continue;
      if (edgeBlocksMove(map, c, a) || edgeBlocksMove(map, a, to) || edgeBlocksMove(map, c, b) || edgeBlocksMove(map, b, to)) continue;
    } else if (edgeBlocksMove(map, c, to)) continue;
    // Пагорб: різкий перепад заборонено не робимо — висоти невеликі.
    out.push({ to, diagonal, stairs: false });
  }
  const here = cellAt(map, c);
  if (here?.stairsUp) {
    const up = { x: c.x, y: c.y, z: c.z + 1 };
    if (isStandable(map, up)) out.push({ to: up, diagonal: false, stairs: true });
  }
  if (c.z > 0) {
    const down = { x: c.x, y: c.y, z: c.z - 1 };
    if (cellAt(map, down)?.stairsUp && isStandable(map, down)) out.push({ to: down, diagonal: false, stairs: true });
  }
  return out;
}

/** Усі клітинки з підлогою в прямокутнику (на будь-якому поверсі), придатні для розгортання. */
export function cellsInZone(map: MapState, zone: [number, number, number, number]): Cell[] {
  const [x0, y0, x1, y1] = zone;
  const out: Cell[] = [];
  for (let z = 0; z < map.levels; z++)
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const c = { x, y, z };
        if (isStandable(map, c)) out.push(c);
      }
  return out;
}

export function inZone(c: Cell, zone: [number, number, number, number] | null): boolean {
  if (!zone) return false;
  const [x0, y0, x1, y1] = zone;
  return c.z === 0 && c.x >= x0 && c.x <= x1 && c.y >= y0 && c.y <= y1;
}

// ---------- Межі клітинок (тонкі стіни) ----------

/** Канонічне місце зберігання межі: північ/захід клітинки; південь/схід — у сусіда (або на краю карти). */
function edgeSlot(map: MapState, c: Cell, side: EdgeSide): { cell: MapCell; key: EdgeSide } | null {
  let t = c;
  let key = side;
  if (side === 's' && c.y + 1 < map.height) {
    t = { x: c.x, y: c.y + 1, z: c.z };
    key = 'n';
  } else if (side === 'e' && c.x + 1 < map.width) {
    t = { x: c.x + 1, y: c.y, z: c.z };
    key = 'w';
  }
  const cell = cellAt(map, t);
  return cell ? { cell, key } : null;
}

export function getEdge(map: MapState, c: Cell, side: EdgeSide): EdgeObject | null {
  const sl = edgeSlot(map, c, side);
  return sl?.cell.edges?.[sl.key] ?? null;
}

export function setEdge(map: MapState, c: Cell, side: EdgeSide, obj: EdgeObject | null): void {
  const sl = edgeSlot(map, c, side);
  if (!sl) return;
  if (obj) (sl.cell.edges ??= {})[sl.key] = obj;
  else if (sl.cell.edges) {
    delete sl.cell.edges[sl.key];
    if (!Object.keys(sl.cell.edges).length) delete sl.cell.edges;
  }
}

/** Межа між двома сусідніми (по горизонталі/вертикалі) клітинками одного поверху. */
export function edgeBetween(map: MapState, a: Cell, b: Cell): { obj: EdgeObject; cell: Cell; side: EdgeSide } | null {
  if (a.z !== b.z) return null;
  let side: EdgeSide | null = null;
  if (b.x === a.x && b.y === a.y - 1) side = 'n';
  else if (b.x === a.x && b.y === a.y + 1) side = 's';
  else if (b.y === a.y && b.x === a.x - 1) side = 'w';
  else if (b.y === a.y && b.x === a.x + 1) side = 'e';
  if (!side) return null;
  const obj = getEdge(map, a, side);
  return obj ? { obj, cell: a, side } : null;
}

export function edgeBlocksMove(map: MapState, a: Cell, b: Cell): boolean {
  const e = edgeBetween(map, a, b);
  return !!e && objectDef(e.obj.defId).blocksMove;
}

/** Обхід усіх меж карти: (клітинка, бік, об'єкт). */
export function forEachEdge(map: MapState, fn: (c: Cell, side: EdgeSide, obj: EdgeObject) => void): void {
  map.cells.forEach((lvl, z) =>
    lvl.forEach((row, y) =>
      row.forEach((cell, x) => {
        if (!cell.edges) return;
        for (const k of Object.keys(cell.edges) as EdgeSide[]) fn({ x, y, z }, k, cell.edges[k]!);
      }),
    ),
  );
}
