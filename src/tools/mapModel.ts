import { objectDef, terrainDef } from '@/content';
import type { MapCell, MapDefinition, MapState } from '@/game/types';

/** Клітинка в редакторі: як у грі, плюс процедурна варіація (випадковий об'єкт при старті місії). */
export interface EditCell extends MapCell {
  variation?: [string | null, number][];
}

export interface EditMap extends Omit<MapState, 'cells'> {
  cells: EditCell[][][];
}

export const DEFAULT_VARIATION: [string | null, number][] = [
  [null, 4],
  ['bush', 4],
  ['crates', 2],
];

export function newMap(id: string, name: string, width: number, height: number, levels: number): EditMap {
  const cells: EditCell[][][] = [];
  for (let z = 0; z < levels; z++) {
    const level: EditCell[][] = [];
    for (let y = 0; y < height; y++) {
      const row: EditCell[] = [];
      for (let x = 0; x < width; x++) row.push(z === 0 ? { terrain: 'grass', floor: true, elevation: 0, object: null } : { terrain: 'roof', floor: false, elevation: 0, object: null });
      level.push(row);
    }
    cells.push(level);
  }
  const m: EditMap = { id, name, width, height, levels, cells };
  return m;
}

/** Розібрати збережене визначення карти без розіграшу варіацій. */
export function fromDefinition(def: MapDefinition): EditMap {
  const cells: EditCell[][][] = def.layers.map((rows, z) =>
    rows.map((row) =>
      [...row].map((ch) => {
        const l = def.legend[ch];
        const c: EditCell = {
          terrain: l.terrain,
          floor: z === 0 ? true : l.floor !== false,
          elevation: l.elevation ?? 0,
          object: l.object ? { defId: l.object, hp: objectDef(l.object).hp } : null,
        };
        if (l.stairsUp) c.stairsUp = true;
        if (l.variation) c.variation = l.variation;
        return c;
      }),
    ),
  );
  const m: EditMap = { id: def.id, name: def.name, width: def.width, height: def.height, levels: def.layers.length, cells };
  assignBuildings(m);
  return m;
}

const SYMBOLS = [
  ...'.,~h#WD_SCVP^ fsmceTb?',
  ...'ABEFGHIJKLMNOQRUXYZadgijklnopqrtuvwxyz0123456789!$%&*+-/:;<=>@[]{|}',
  ...'абвгдежзийклмнопрстуфхцчшщюяґєії',
];

/** Зібрати визначення для збереження: легенда символів будується автоматично. */
export function toDefinition(m: EditMap): MapDefinition {
  const legend: MapDefinition['legend'] = {};
  const byKey = new Map<string, string>();
  let next = 0;
  const layers = m.cells.map((level, z) =>
    level.map((row) =>
      row
        .map((c) => {
          const entry: MapDefinition['legend'][string] = { terrain: c.terrain };
          if (c.object && !c.variation) entry.object = c.object.defId;
          if (z > 0 && !c.floor) entry.floor = false;
          if (c.elevation) entry.elevation = c.elevation;
          if (c.stairsUp) entry.stairsUp = true;
          if (c.variation) entry.variation = c.variation;
          const key = JSON.stringify(entry);
          let sym = byKey.get(key);
          if (!sym) {
            if (next >= SYMBOLS.length) throw new Error('Забагато різних типів клітинок на карті');
            sym = SYMBOLS[next++];
            byKey.set(key, sym);
            legend[sym] = entry;
          }
          return sym;
        })
        .join(''),
    ),
  );
  return { id: m.id, name: m.name, width: m.width, height: m.height, legend, layers, buildings: detectBuildings(m) };
}

const isBuildingCell = (c: EditCell) => terrainDef(c.terrain).indoor === true || (!!c.object && !!objectDef(c.object.defId).wall);

/** Будівлі = зв'язні області приміщень і стін (на будь-якому поверсі), як прямокутники. */
export function detectBuildings(m: EditMap): [number, number, number, number][] {
  const mask: boolean[][] = Array.from({ length: m.height }, (_, y) => Array.from({ length: m.width }, (_, x) => m.cells.some((lvl) => isBuildingCell(lvl[y][x]))));
  const seen = mask.map((r) => r.map(() => false));
  const out: [number, number, number, number][] = [];
  for (let y = 0; y < m.height; y++)
    for (let x = 0; x < m.width; x++) {
      if (!mask[y][x] || seen[y][x]) continue;
      let [x0, y0, x1, y1] = [x, y, x, y];
      const stack = [[x, y]];
      seen[y][x] = true;
      while (stack.length) {
        const [cx, cy] = stack.pop()!;
        x0 = Math.min(x0, cx);
        y0 = Math.min(y0, cy);
        x1 = Math.max(x1, cx);
        y1 = Math.max(y1, cy);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= m.width || ny >= m.height || seen[ny][nx] || !mask[ny][nx]) continue;
          seen[ny][nx] = true;
          stack.push([nx, ny]);
        }
      }
      if ((x1 - x0 + 1) * (y1 - y0 + 1) >= 4) out.push([x0, y0, x1, y1]);
    }
  return out;
}

export function assignBuildings(m: EditMap): void {
  for (const lvl of m.cells) for (const row of lvl) for (const c of row) delete c.buildingId;
  detectBuildings(m).forEach(([x0, y0, x1, y1], i) => {
    for (const lvl of m.cells) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) lvl[y][x].buildingId = i;
  });
}

/** Перевірка перед збереженням: попередження, які не блокують, і помилки, які блокують. */
export function validateMap(m: EditMap): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!m.name.trim()) errors.push('Вкажіть назву карти');
  if (m.width < 8 || m.height < 8) errors.push('Карта має бути щонайменше 8×8');
  let stairs = 0;
  m.cells.forEach((lvl, z) =>
    lvl.forEach((row, y) =>
      row.forEach((c, x) => {
        if (c.stairsUp) {
          stairs++;
          const up = m.cells[z + 1]?.[y][x];
          if (!up || !up.floor) warnings.push(`Сходи (${x},${y}) на поверсі ${z + 1} ведуть у порожнечу`);
        }
      }),
    ),
  );
  if (m.levels > 1 && !stairs && m.cells.slice(1).some((l) => l.some((r) => r.some((c) => c.floor)))) warnings.push('Верхні поверхи є, але сходів немає — туди не потрапити');
  return { errors, warnings: warnings.slice(0, 6) };
}

/** Змінити розмір карти (обрізання або доповнення травою / порожнечею). */
export function resizeMap(m: EditMap, width: number, height: number, levels: number): EditMap {
  const n = newMap(m.id, m.name, width, height, levels);
  for (let z = 0; z < Math.min(levels, m.levels); z++)
    for (let y = 0; y < Math.min(height, m.height); y++) for (let x = 0; x < Math.min(width, m.width); x++) n.cells[z][y][x] = m.cells[z][y][x];
  assignBuildings(n);
  return n;
}
