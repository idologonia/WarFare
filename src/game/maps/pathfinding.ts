import { cellKey, type Cell } from '@/core/grid';
import { moveNeighbors } from './map';
import type { MapState } from '@/game/types';

export interface PathNode {
  cell: Cell;
  /** Накопичена вартість у десятих AP. */
  cost: number;
  prev: string | null;
}

export interface StepCostFn {
  (diagonal: boolean, stairs: boolean): number;
}

/**
 * Дейкстра від `start` з обмеженням бюджету (у десятих AP).
 * `blocked` — ключі клітинок, зайнятих іншими бійцями.
 */
export function reachable(
  map: MapState,
  start: Cell,
  budget: number,
  stepCost: StepCostFn,
  blocked: Set<string>,
): Map<string, PathNode> {
  const nodes = new Map<string, PathNode>();
  const startKey = cellKey(start);
  nodes.set(startKey, { cell: start, cost: 0, prev: null });
  // Проста бінарна купа.
  const heap: [number, string][] = [[0, startKey]];
  const push = (item: [number, string]) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = (): [number, string] | undefined => {
    if (!heap.length) return undefined;
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };

  for (let item = pop(); item; item = pop()) {
    const [cost, key] = item;
    const node = nodes.get(key)!;
    if (cost > node.cost) continue;
    for (const step of moveNeighbors(map, node.cell)) {
      const k = cellKey(step.to);
      if (blocked.has(k)) continue;
      const c = cost + stepCost(step.diagonal, step.stairs);
      if (c > budget) continue;
      const existing = nodes.get(k);
      if (!existing || c < existing.cost) {
        nodes.set(k, { cell: step.to, cost: c, prev: key });
        push([c, k]);
      }
    }
  }
  return nodes;
}

export function buildPath(nodes: Map<string, PathNode>, target: Cell): Cell[] | null {
  let k: string | null = cellKey(target);
  if (!nodes.has(k)) return null;
  const path: Cell[] = [];
  while (k) {
    const n: PathNode = nodes.get(k)!;
    path.push(n.cell);
    k = n.prev;
  }
  return path.reverse();
}
