import type { Rng } from '@/core/rng';
import { DIRS8, type Cell } from '@/core/grid';
import { objectDef, terrainDef } from '@/content';
import type { MapCell, MapDefinition, MapObjectDefinition, MapState } from '@/game/types';

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
      if (!isStandable(map, { x: c.x + dx, y: c.y, z: c.z }) || !isStandable(map, { x: c.x, y: c.y + dy, z: c.z })) continue;
    }
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
