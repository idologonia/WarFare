/** Координата клітинки: x, y — площина, z — поверх (0 — земля). */
export interface Cell {
  x: number;
  y: number;
  z: number;
}

export const cellKey = (c: Cell): string => `${c.x},${c.y},${c.z}`;
export const sameCell = (a: Cell, b: Cell): boolean => a.x === b.x && a.y === b.y && a.z === b.z;

export function parseKey(k: string): Cell {
  const [x, y, z] = k.split(',').map(Number);
  return { x, y, z };
}

/** Відстань у клітинках у площині (евклідова). */
export function dist2d(a: Cell, b: Cell): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** 8 напрямків руху. */
export const DIRS8: readonly [number, number][] = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

export const DIRS4: readonly [number, number][] = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

/** AP зберігаються в десятих частках, щоб уникнути помилок округлення. */
export const toTenths = (ap: number): number => Math.round(ap * 10);
export const fromTenths = (t: number): number => t / 10;
export const fmtAp = (t: number): string => (t % 10 === 0 ? String(t / 10) : (t / 10).toFixed(1));
