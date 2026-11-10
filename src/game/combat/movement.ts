import { cellKey, dist2d, type Cell } from '@/core/grid';
import { content } from '@/content';
import { buildPath, reachable, type PathNode } from '@/game/maps/pathfinding';
import { occupiedKeys, type MissionState } from '@/game/simulation/state';
import type { MoveMode, Stance, Unit } from '@/game/types';

/** Вартість кроку в десятих AP. Місцевість на AP не впливає (за GDD). */
export function stepCost(mode: MoveMode, stance: Stance, diagonal: boolean, stairs: boolean): number {
  const M = content().rules.move;
  const c = M.modeCost[mode] * M.stanceMul[stance] * (diagonal ? M.diagonalMul : 1) * (stairs ? 1.2 : 1);
  return Math.max(1, Math.round(c * 10));
}

export function canUseMode(u: Unit, mode: MoveMode): boolean {
  if (mode === 'fast') return content().rules.move.fastAllowedStances.includes(u.stance) && !u.carrying;
  return true;
}

export function unitReachable(s: MissionState, u: Unit, mode: MoveMode, budget = u.ap, from: Cell = u.pos!, stance: Stance = u.stance): Map<string, PathNode> {
  return reachable(s.map, from, budget, (d, st) => stepCost(mode, stance, d, st), occupiedKeys(s, u.id));
}

export function planPath(s: MissionState, u: Unit, to: Cell, mode: MoveMode): { path: Cell[]; cost: number } | null {
  const nodes = unitReachable(s, u, mode);
  const path = buildPath(nodes, to);
  if (!path) return null;
  return { path, cost: nodes.get(cellKey(to))!.cost };
}

export const adjacent = (a: Cell, b: Cell): boolean => a.z === b.z && dist2d(a, b) <= 1.5;
