import { describe, expect, it } from 'vitest';
import { content } from '@/content';
import { buildMap, getEdge, isStandable, moveNeighbors, objAt } from '@/game/maps/map';
import { objectDef } from '@/content';
import { buildPath, reachable } from '@/game/maps/pathfinding';
import { Rng } from '@/core/rng';
import { trace, cellCenter } from '@/game/visibility/los';

const map = () => buildMap(content().maps.get('village')!, new Rng(1));

describe('карта', () => {
  it('будується з трьома поверхами і будівлями', () => {
    const m = map();
    expect(m.levels).toBe(3);
    expect(objectDef(getEdge(m, { x: 9, y: 4, z: 0 }, 'w')!.defId).wall).toBe(true);
    // Біля тонкої стіни можна стояти: клітинка периметра — підлога.
    expect(isStandable(m, { x: 9, y: 4, z: 0 })).toBe(true);
    expect(objAt(m, { x: 9, y: 4, z: 0 })).toBeNull();
    expect(isStandable(m, { x: 12, y: 6, z: 1 })).toBe(true);
    expect(isStandable(m, { x: 2, y: 2, z: 1 })).toBe(false);
  });
  it('сходи з’єднують поверхи', () => {
    const m = map();
    const n = moveNeighbors(m, { x: 15, y: 5, z: 0 });
    expect(n.some((s) => s.stairs && s.to.z === 1)).toBe(true);
    const up = moveNeighbors(m, { x: 15, y: 5, z: 1 });
    expect(up.some((s) => s.stairs && s.to.z === 0)).toBe(true);
  });
  it('шлях на дах будівлі існує', () => {
    const m = map();
    const nodes = reachable(m, { x: 13, y: 11, z: 0 }, 1000, () => 10, new Set());
    const p = buildPath(nodes, { x: 12, y: 6, z: 2 });
    expect(p).not.toBeNull();
    expect(p!.some((c) => c.z === 1)).toBe(true);
  });
  it('тонка стіна блокує рух між клітинками, двері — ні', () => {
    const m = map();
    // південна стіна будинку між (12,10) і (12,11)
    expect(moveNeighbors(m, { x: 12, y: 11, z: 0 }).some((s) => s.to.x === 12 && s.to.y === 10)).toBe(false);
    // двері в південній стіні (13,10)
    expect(moveNeighbors(m, { x: 13, y: 11, z: 0 }).some((s) => s.to.x === 13 && s.to.y === 10)).toBe(true);
  });

  it('не можна зрізати кут стіни по діагоналі', () => {
    const m = map();
    // (8,4) — дорога, (9,4) — стіна, (8,5) — дорога; діагональ на (9,5) — підлога всередині? ні, (9,5) — стіна.
    const n = moveNeighbors(m, { x: 17, y: 11, z: 0 });
    // з (17,11) на (16,10) — кут будинку: діагональ через тонкі стіни заборонена
    expect(n.some((s) => s.to.x === 16 && s.to.y === 10)).toBe(false);
  });
});

describe('лінія огляду', () => {
  it('стіна блокує, вікно пропускає вище підвіконня', () => {
    const m = map();
    // зовні з півдня до внутрішньої клітинки через стіну (12,10) — цегла
    const blocked = trace(m, cellCenter({ x: 12, y: 12, z: 0 }, 0.78), cellCenter({ x: 12, y: 8, z: 0 }, 0.62));
    expect(blocked.blocked).toBe(true);
    // через вікно (11,10)
    const open = trace(m, cellCenter({ x: 11, y: 12, z: 0 }, 0.78), cellCenter({ x: 11, y: 8, z: 0 }, 0.62));
    expect(open.blocked).toBe(false);
    // лежачи нижче підвіконня — заблоковано
    const low = trace(m, cellCenter({ x: 11, y: 12, z: 0 }, 0.18), cellCenter({ x: 11, y: 9, z: 0 }, 0.14));
    expect(low.blocked).toBe(true);
  });
  it('перекриття блокує огляд між поверхами всередині будинку', () => {
    const m = map();
    const t = trace(m, cellCenter({ x: 12, y: 6, z: 0 }, 0.78), cellCenter({ x: 13, y: 6, z: 1 }, 1.62));
    expect(t.blocked).toBe(true);
  });
});
