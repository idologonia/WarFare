import type { Cell } from '@/core/grid';
import type { SideId, Unit } from '@/game/types';

/**
 * Напрямок погляду бійця: 8 напрямків. 0 — північ (y−1), далі за годинниковою стрілкою:
 * 1 — пн-сх, 2 — схід, 3 — пд-сх, 4 — південь, 5 — пд-зх, 6 — захід, 7 — пн-зх.
 */
export const DIR8: [number, number][] = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
export const DIR8_NAMES = ['Північ', 'Північний схід', 'Схід', 'Південний схід', 'Південь', 'Південний захід', 'Захід', 'Північний захід'];

/** Типовий напрямок (старі збереження): сині дивляться на північ, червоні — на південь. */
export const facingOf = (u: Unit): number => u.facing ?? (u.side === ('red' as SideId) ? 4 : 0);

/** Найближчий з 8 напрямків до вектора. */
export function dirTo(dx: number, dy: number): number {
  if (!dx && !dy) return 0;
  const a = Math.atan2(dx, -dy); // 0 — північ, за годинниковою
  return ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
}

export const faceToward = (u: Unit, from: Cell, to: { x: number; y: number }) => {
  if (to.x === from.x && to.y === from.y) return;
  u.facing = dirTo(to.x - from.x, to.y - from.y);
};

/** Кут між напрямком погляду й напрямком на точку, у градусах (0..180). */
export function offAxis(u: Unit, from: Cell, to: { x: number; y: number }): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (!dx && !dy) return 0;
  const a = Math.atan2(dx, -dy);
  const f = (facingOf(u) * Math.PI) / 4;
  let d = Math.abs(a - f) % (2 * Math.PI);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return (d * 180) / Math.PI;
}

/** Кут повороту моделі у світі (x → x, y → −z). */
export const facingRotation = (f: number) => Math.atan2(DIR8[f][0], -DIR8[f][1]);
