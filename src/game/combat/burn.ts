import { dist2d, DIRS4, type Cell } from '@/core/grid';
import { content } from '@/content';
import { cellAt } from '@/game/maps/map';
import { applyHit } from '@/game/injuries/injuries';
import { onField, type Ctx, type MissionState } from '@/game/simulation/state';
import type { Unit } from '@/game/types';

/**
 * Пожежі (умовна ігрова система). Клітинка горить кілька ходів: обпікає бійців, руйнує дерев'яні
 * об'єкти й рослинність, дає дим, поширюється на траву/дерево поруч, уночі освітлює округу.
 */
const RF = () => content().rules.fire_;

const FLAMMABLE_MAT = new Set(['wood', 'foliage']);

/** Чи є чому горіти в клітинці (трава, кущі, дерево, дерев'яні межі). */
export function flammable(s: MissionState, c: Cell): boolean {
  const cl = cellAt(s.map, c);
  if (!cl) return false;
  if (cl.terrain === 'grass') return true;
  const o = cl.object ? content().objects.get(cl.object.defId) : null;
  if (o && FLAMMABLE_MAT.has(o.material)) return true;
  return Object.values(cl.edges ?? {}).some((e) => FLAMMABLE_MAT.has(content().objects.get(e!.defId)?.material ?? ''));
}

/** Підпал області (напалм, запальний заряд). Горить навіть на голій землі — паливо принесене. */
export function ignite(ctx: Ctx, center: Cell, radius: number, turns: number, attacker: Unit | null): void {
  const s = ctx.s;
  const r = Math.ceil(radius);
  const cells: Cell[] = [];
  for (let y = center.y - r; y <= center.y + r; y++)
    for (let x = center.x - r; x <= center.x + r; x++) {
      const c = { x, y, z: center.z };
      const cl = cellAt(s.map, c);
      if (!cl || dist2d(c, center) > radius || (center.z > 0 && !cl.floor)) continue;
      cl.fire = Math.max(cl.fire ?? 0, turns);
      cells.push(c);
    }
  ctx.ev.push({ t: 'fire', cells });
  ctx.ev.push({ t: 'sound', kind: 'fire' });
  for (const c of cells) burnUnitsAt(ctx, c, attacker);
}

/** Опік бійців у клітинці (броня не захищає). */
export function burnUnitsAt(ctx: Ctx, c: Cell, attacker: Unit | null = null): void {
  for (const u of ctx.s.units) {
    if (!onField(u) || u.status === 'dead' || !u.pos || u.pos.x !== c.x || u.pos.y !== c.y || u.pos.z !== c.z) continue;
    const d = RF().burnDamage;
    applyHit(ctx, u, d + ctx.rng.int(0, Math.round(d / 2)), 99, 'burn', { attacker: attacker && attacker.side !== u.side ? attacker : undefined });
    if (u.status === 'active') u.suppression = Math.min(100, u.suppression + 30);
  }
}

export const isBurning = (s: MissionState, c: Cell) => (cellAt(s.map, c)?.fire ?? 0) > 0;

/** Кінець раунду: горіння, руйнування, дим, поширення, згасання. */
export function tickFire(ctx: Ctx): void {
  const s = ctx.s;
  const R = RF();
  const burning: Cell[] = [];
  s.map.cells.forEach((lvl, z) => lvl.forEach((row, y) => row.forEach((c, x) => c.fire && burning.push({ x, y, z }))));
  if (!burning.length) return;
  const changed: Cell[] = [];
  for (const c of burning) {
    const cl = cellAt(s.map, c)!;
    burnUnitsAt(ctx, c);
    // Дерев'яні й рослинні об'єкти згорають.
    const o = cl.object ? content().objects.get(cl.object.defId) : null;
    if (o && FLAMMABLE_MAT.has(o.material)) {
      cl.object!.hp -= R.objectDamage;
      if (cl.object!.hp <= 0) {
        cl.object = o.id === 'tree' || o.id === 'tree_damaged' ? { defId: 'stump', hp: content().objects.get('stump')?.hp ?? 50 } : null;
        ctx.ev.push({ t: 'object', cell: c, defId: cl.object?.defId ?? null });
      }
    }
    for (const side of Object.keys(cl.edges ?? {}) as ('n' | 'w' | 's' | 'e')[]) {
      const e = cl.edges![side]!;
      const eo = content().objects.get(e.defId);
      if (eo && FLAMMABLE_MAT.has(eo.material)) {
        e.hp -= R.objectDamage;
        if (e.hp <= 0) {
          delete cl.edges![side];
          ctx.ev.push({ t: 'object', cell: c, defId: null });
        }
      }
    }
    cl.smoke = Math.max(cl.smoke ?? 0, 1);
    if (cl.terrain === 'grass') cl.terrain = 'dirt'; // вигоріла трава
    // Поширення на сусідні горючі клітинки.
    for (const [dx, dy] of DIRS4) {
      const n = { x: c.x + dx, y: c.y + dy, z: c.z };
      const nc = cellAt(s.map, n);
      if (!nc || nc.fire || !flammable(s, n)) continue;
      if (ctx.rng.chance(R.spreadChance)) {
        nc.fire = R.spreadTurns;
        changed.push(n);
      }
    }
    cl.fire! -= 1;
    if (cl.fire! <= 0) delete cl.fire;
    changed.push(c);
  }
  ctx.ev.push({ t: 'fire', cells: changed });
  ctx.ev.push({ t: 'smoke', cells: [] });
}

/** Чи освітлена клітинка вогнем (уночі видно без ПНБ; опущений ПНБ засвічується). */
export function litByFire(s: MissionState, c: Cell): boolean {
  if (s.scenario.timeOfDay !== 'night') return false;
  const r = RF().lightRadius;
  const ri = Math.ceil(r);
  for (let y = c.y - ri; y <= c.y + ri; y++)
    for (let x = c.x - ri; x <= c.x + ri; x++) {
      const cl = s.map.cells[c.z]?.[y]?.[x];
      if (cl?.fire && dist2d({ x, y, z: c.z }, c) <= r) return true;
    }
  return false;
}
