import type { Cell } from '@/core/grid';
import { objectDef } from '@/content';
import type { MapState } from '@/game/types';

/** Точка у світі: x, y — у клітинках (центр клітинки = +0.5), h — висота в одиницях поверху. */
export interface Point {
  x: number;
  y: number;
  h: number;
}

export const cellCenter = (c: Cell, h: number): Point => ({ x: c.x + 0.5, y: c.y + 0.5, h });

export interface TraceResult {
  blocked: boolean;
  /** Клітинка, що зупинила лінію (об'єкт, перекриття або ґрунт). */
  blockCell: Cell | null;
  blockKind: 'object' | 'floor' | 'ground' | 'bounds' | null;
  /** Точка зупинки (або кінцева точка). */
  end: Point;
  /** Сума маскування рослинністю на шляху. */
  concealment: number;
  /** Пройдені клітинки (без повторів). */
  cells: Cell[];
}

export interface TraceOptions {
  /** Ігнорувати клітинки на початку/в кінці (стрілець і ціль). */
  skipStart?: Cell;
  skipEnd?: Cell;
  /** Ігнорувати низькі об'єкти (для кидка гранати по дузі). */
  ignoreBelow?: number;
  /** Подовжити лінію за кінцеву точку на стільки клітинок (для промахів). */
  extend?: number;
}

const STEP = 0.1;

/**
 * Трасування прямої у 3D сітці. Блокують: стіни й об'єкти нижче своєї висоти,
 * підвіконня/перемичка вікон, перекриття між поверхами, схил пагорба.
 */
export function trace(map: MapState, from: Point, to: Point, opt: TraceOptions = {}): TraceResult {
  let dx = to.x - from.x;
  let dy = to.y - from.y;
  let dh = to.h - from.h;
  let len = Math.hypot(dx, dy);
  if (opt.extend) {
    const k = len > 0 ? (len + opt.extend) / len : 1;
    dx *= k;
    dy *= k;
    dh *= k;
    len *= k;
  }
  const steps = Math.max(1, Math.ceil(len / STEP));
  const cells: Cell[] = [];
  let concealment = 0;
  let lastKey = '';
  let prevZ = Math.floor(from.h);
  const sameCell = (c: Cell, s?: Cell) => !!s && s.x === c.x && s.y === c.y;

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const p: Point = { x: from.x + dx * t, y: from.y + dy * t, h: from.h + dh * t };
    const cx = Math.floor(p.x);
    const cy = Math.floor(p.y);
    if (cx < 0 || cy < 0 || cx >= map.width || cy >= map.height || p.h < -0.01) {
      return { blocked: true, blockCell: null, blockKind: 'bounds', end: p, concealment, cells };
    }
    const z = Math.max(0, Math.min(map.levels - 1, Math.floor(p.h)));
    const local = p.h - z;
    const c: Cell = { x: cx, y: cy, z };
    const key = `${cx},${cy},${z}`;
    const isStart = sameCell(c, opt.skipStart) && Math.floor(from.h) === z;
    const isEnd = sameCell(c, opt.skipEnd) && Math.floor(to.h) === z && !opt.extend;

    // Перетин перекриття між поверхами.
    if (z !== prevZ) {
      const upper = Math.max(z, prevZ);
      if (upper > 0 && upper < map.levels && map.cells[upper][cy][cx].floor && !isStart && !isEnd) {
        return { blocked: true, blockCell: { x: cx, y: cy, z: upper }, blockKind: 'floor', end: p, concealment, cells };
      }
      prevZ = z;
    }
    if (key !== lastKey) {
      lastKey = key;
      cells.push(c);
    }
    if (isStart || isEnd) continue;

    const cell = map.cells[z][cy][cx];
    if (z === 0 && local < cell.elevation - 0.02) {
      return { blocked: true, blockCell: c, blockKind: 'ground', end: p, concealment, cells };
    }
    if (cell.object) {
      const o = objectDef(cell.object.defId);
      if (o.door) continue;
      if (o.window) {
        if (local < (o.sill ?? 0.4) || local > 0.95) return { blocked: true, blockCell: c, blockKind: 'object', end: p, concealment, cells };
        continue;
      }
      if (o.cover === 0 && (o.concealment ?? 0) > 0) {
        // Рослинність не зупиняє, а маскує (рахується один раз на клітинку).
        if (cells[cells.length - 1] === c) concealment += o.concealment ?? 0;
        continue;
      }
      const base = z === 0 ? cell.elevation : 0;
      if (local < base + o.height && !(opt.ignoreBelow !== undefined && o.height < opt.ignoreBelow)) {
        return { blocked: true, blockCell: c, blockKind: 'object', end: p, concealment, cells };
      }
    }
  }
  return { blocked: false, blockCell: null, blockKind: null, end: { x: from.x + dx, y: from.y + dy, h: from.h + dh }, concealment, cells };
}
