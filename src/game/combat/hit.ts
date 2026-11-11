import { dist2d, type Cell } from '@/core/grid';
import { content, itemDef, objectDef } from '@/content';
import { edgeBetween, groundHeight, objAt } from '@/game/maps/map';
import { activeNvg, primaryDef } from '@/game/inventory/inventory';
import { litByFire } from './burn';
import { modEffects } from '@/game/equipment/mods';
import { eyePoint, targetPoints } from '@/game/visibility/visibility';
import { trace } from '@/game/visibility/los';
import type { MissionState } from '@/game/simulation/state';
import type { FireMode, Stance, Unit, WeaponDefinition } from '@/game/types';

/**
 * Укриття цілі відносно напрямку на стрільця: 0 — відкрито, 1 — половинне, 2 — повне.
 * Перевіряються сусідні клітинки цілі з боку стрільця.
 */
export function coverAgainst(s: MissionState, target: Cell, from: Cell): 0 | 1 | 2 {
  const dx = from.x - target.x;
  const dy = from.y - target.y;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax + ay === 0) return 0;
  const cand: Cell[] = [];
  if (ax >= ay * 0.5 && ax > 0) cand.push({ x: target.x + Math.sign(dx), y: target.y, z: target.z });
  if (ay >= ax * 0.5 && ay > 0) cand.push({ x: target.x, y: target.y + Math.sign(dy), z: target.z });
  if (ax > 0 && ay > 0) cand.push({ x: target.x + Math.sign(dx), y: target.y + Math.sign(dy), z: target.z });
  let best: 0 | 1 | 2 = 0;
  // Тонкі об'єкти на межі клітинки цілі з боку стрільця (стіна, вікно, мішки, паркан).
  for (const c of cand) {
    if (c.x !== target.x && c.y !== target.y) continue;
    const e = edgeBetween(s.map, target, c);
    if (!e) continue;
    const o = objectDef(e.obj.defId);
    if (!o.door && o.cover > best) best = o.cover as 0 | 1 | 2;
  }
  for (const c of cand) {
    // Стрілець упритул з того ж боку, що й укриття, — укриття не діє.
    if (c.x === from.x && c.y === from.y && c.z === from.z) continue;
    // Техніка поруч — повне укриття.
    const vc = s.map.cells[c.z]?.[c.y]?.[c.x];
    if (vc?.vehicle && (vc.vehicleHeight ?? 0) >= 0.5) best = c.x !== target.x && c.y !== target.y ? (Math.max(best, 1) as 0 | 1 | 2) : 2;
    const o = objAt(s.map, c);
    if (o && o.cover > best) {
      // Діагональна клітинка дає щонайбільше половинне укриття.
      const diag = c.x !== target.x && c.y !== target.y;
      best = (diag ? Math.min(1, o.cover) : o.cover) as 0 | 1 | 2;
    }
  }
  return best;
}

/** Половинне укриття + сидячи/лежачи = повне. */
export function effectiveCover(cover: 0 | 1 | 2, stance: Stance): 0 | 1 | 2 {
  return cover === 1 && stance !== 'standing' ? 2 : cover;
}

export interface HitFactor {
  label: string;
  value: number;
}

export interface HitEstimate {
  chance: number;
  factors: HitFactor[];
  /** Чи є пряма лінія вогню хоча б до однієї точки цілі. */
  lineOfFire: boolean;
  cover: 0 | 1 | 2;
  distance: number;
}

export function fireApCost(u: Unit, mode: FireMode): number {
  const r = content().rules.fire;
  const w = primaryDef(u);
  let c = r.apCost[mode] + (w?.apMod?.[mode] ?? 0);
  if (mode === 'snap' && u.weaponState === 'high') c -= r.highReadySnapDiscount;
  if (u.weaponState === 'carry') c += 1;
  return Math.round(c * 10);
}

/**
 * Шанс влучання першої кулі з поясненням чинників.
 * `from`/`stance` дозволяють оцінити гіпотетичну позицію (для AI і підказки під час руху).
 */
export function estimateHit(
  s: MissionState,
  shooter: Unit,
  target: Unit,
  mode: FireMode,
  opts: { from?: Cell; stance?: Stance; identified?: boolean; extra?: HitFactor } = {},
): HitEstimate {
  const R = content().rules.hit;
  const from = opts.from ?? shooter.pos!;
  const stance = opts.stance ?? shooter.stance;
  const to = target.pos!;
  const w = primaryDef(shooter) ?? itemDef<WeaponDefinition>('rifle_a1');
  const f: HitFactor[] = [];
  const add = (label: string, value: number) => {
    if (value) f.push({ label, value: Math.round(value) });
  };
  const distance = dist2d(from, to) + Math.abs(from.z - to.z) * 0.5;

  add('База', R.base);
  add('Навченість', shooter.stats.training * R.trainingFactor);
  add('Зброя', w.accuracy);
  add('Режим вогню', content().rules.fire.accuracyMod[mode]);
  const me = modEffects(shooter.inventory.primary);
  const range = w.range + me.range;
  if (distance > range) add('Дальність', -(distance - range) * R.rangePenaltyPerCell);
  if (distance <= R.closeRange) add('Ближній бій (CQB)', w.cqb + me.cqb);
  const optic = (mode === 'snap' ? me.snap : mode === 'burst' ? me.burst : mode === 'aimed' ? me.aimed + (distance > R.farRange ? me.aimedFar : 0) : 0);
  if (optic) add('Приціл і обвіс', optic);

  const cover = mode === 'blind' ? coverAgainst(s, to, from) : effectiveCover(coverAgainst(s, to, from), target.stance);
  if (cover) add(cover === 2 ? 'Повне укриття' : 'Половинне укриття', R.cover[String(cover) as '1' | '2']);
  if (distance > R.farRange) add('Позиція цілі', R.targetStanceFar[target.stance]);
  add('Позиція стрільця', mode === 'blind' ? 0 : R.shooterStance[stance]);
  const hDiff = groundHeight(s.map, from) - groundHeight(s.map, to);
  if (hDiff >= 0.3) add('Висота', R.heightBonus);
  if (shooter.suppression) add('Придушення', -shooter.suppression * R.suppressionFactor);
  if (shooter.morale < R.lowMoraleThreshold) add('Низька мораль', -R.lowMoralePenalty);
  if (shooter.weaponState === 'carry') add('Зброя не готова', -R.carryStatePenalty);
  if (shooter.injuries.some((i) => i.part === 'leftArm' || i.part === 'rightArm')) add('Поранення рук', -R.armWoundPenalty);
  if (shooter.injuries.some((i) => i.part === 'head')) add('Поранення голови', -R.headWoundPenalty);
  if (s.scenario.timeOfDay === 'night') {
    const nvg = activeNvg(shooter);
    const lit = litByFire(s, to);
    if (lit && nvg) add('Засвітка ПНБ (вогонь)', -content().rules.fire_.glareHitPenalty);
    else if (lit) add('Ціль освітлена вогнем', 0);
    else if (nvg) add('Ніч (ПНБ)', -(nvg.nightHitPenalty ?? R.nightPenalty));
    else if (shooter.lightOn && distance <= R.flashlightRange) add('Ніч (ліхтар)', -R.flashlightHitPenalty);
    else if (target.lightOn) add('Ніч (ціль із ліхтарем)', -R.flashlightHitPenalty);
    else add('Ніч', -R.nightPenalty);
  }
  if (s.scenario.weather === 'rain') add('Дощ', -R.rainPenalty);

  const eye = eyePoint(s, from, stance);
  let lineOfFire = false;
  let conceal = Infinity;
  for (const p of targetPoints(s, to, target.stance)) {
    const tr = trace(s.map, eye, p, { skipStart: from, skipEnd: to });
    if (!tr.blocked) {
      lineOfFire = true;
      conceal = Math.min(conceal, tr.concealment);
    }
  }
  if (lineOfFire && conceal > 0) add('Рослинність / дим', -conceal * R.concealmentPerCell / 4);
  if (opts.identified === false) add('Ціль не ідентифікована', -R.notIdentifiedPenalty);
  if (opts.extra) add(opts.extra.label, opts.extra.value);

  const raw = f.reduce((sum, x) => sum + x.value, 0);
  const chance = Math.max(R.min, Math.min(R.max, Math.round(raw)));
  return { chance: lineOfFire || mode === 'blind' ? chance : 0, factors: f, lineOfFire, cover, distance };
}
