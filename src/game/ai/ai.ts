import { Rng } from '@/core/rng';
import { dist2d, sameCell, toTenths, type Cell } from '@/core/grid';
import { content, itemDef } from '@/content';
import { cellsInZone, groundHeight } from '@/game/maps/map';
import { findItem, findMedical, findReloadMagazine, primaryDef } from '@/game/inventory/inventory';
import { canSelfApply, treatmentOptions } from '@/game/injuries/injuries';
import { canThrowTo } from '@/game/combat/fire';
import { coverAgainst, effectiveCover, estimateHit, fireApCost } from '@/game/combat/hit';
import { adjacent, unitReachable } from '@/game/combat/movement';
import { canSeeFrom } from '@/game/visibility/visibility';
import { isActive, other, sideUnits, type MissionState } from '@/game/simulation/state';
import type { Command } from '@/game/simulation/commands';
import type { AiStyle, FireMode, MedicalDefinition, Unit } from '@/game/types';

interface Known {
  unit: Unit;
  pos: Cell;
  visible: boolean;
}

const NOISE = { easy: 25, medium: 10, hard: 3 } as const;

/**
 * Тактичний AI: використовує укриття, фланги, придушення (кулемет), зміну позицій,
 * стилі (агресивний/обережний/оборонний), відступ при втратах і низькій моралі.
 * Видає ті самі команди, що й гравець, — правила для AI і людини однакові.
 */
export class AiPlanner {
  private turnKey = '';
  private done = new Set<string>();
  private moved = new Set<string>();
  private steps = new Map<string, number>();
  private rng: Rng;

  constructor(seed = 1) {
    this.rng = new Rng(seed);
  }

  /** Повідомити, що команда бійця відхилена (щоб не зациклитись). */
  reject(unitId: string): void {
    this.done.add(unitId);
  }

  next(s: MissionState): Command | null {
    if (s.turn.phase !== 'battle') return null;
    const key = `${s.turn.turn}:${s.turn.side}`;
    if (key !== this.turnKey) {
      this.turnKey = key;
      this.done.clear();
      this.moved.clear();
      this.steps.clear();
    }
    for (const u of sideUnits(s, s.turn.side)) {
      if (!isActive(u) || u.panicked || this.done.has(u.id)) continue;
      const n = (this.steps.get(u.id) ?? 0) + 1;
      this.steps.set(u.id, n);
      const cmd = n > 10 ? null : this.decide(s, u);
      if (!cmd) {
        this.done.add(u.id);
        continue;
      }
      if (cmd.type === 'move') this.moved.add(u.id);
      if (cmd.type === 'overwatch') this.done.add(u.id);
      return cmd;
    }
    return { type: 'endTurn' };
  }

  private known(s: MissionState, u: Unit): Known[] {
    const out: Known[] = [];
    for (const c of Object.values(s.contacts[u.side])) {
      const e = s.units.find((x) => x.id === c.unitId);
      if (!e || !isActive(e)) continue;
      out.push({ unit: e, pos: c.visible ? e.pos! : c.pos, visible: c.visible || s.revealAll });
    }
    return out;
  }

  private styleOverride: AiStyle | null = null;

  private style(u: Unit): AiStyle {
    return this.styleOverride ?? u.aiStyle ?? 'aggressive';
  }

  /** Перевага в людях робить обережних і оборонців агресивнішими. */
  private updateStyle(s: MissionState, u: Unit, known: Known[]): void {
    const mine = sideUnits(s, u.side).filter(isActive).length;
    const theirs = Math.max(1, known.length);
    this.styleOverride = null;
    if (u.aiStyle !== 'aggressive' && mine >= theirs * 2) this.styleOverride = 'aggressive';
  }

  private decide(s: MissionState, u: Unit): Command | null {
    const R = content().rules;
    const w = primaryDef(u);
    const mag = u.inventory.primary?.magazine;
    const known = this.known(s, u);
    const visible = known.filter((k) => k.visible);
    this.updateStyle(s, u, known);

    // 1. Перезаряджання.
    if (w && (!mag || mag.rounds < Math.max(1, w.burst)) && findReloadMagazine(u)) {
      const f = findReloadMagazine(u)!;
      if (u.ap >= toTenths(f.where === 'pouch' ? R.actions.reloadPouch : R.actions.reloadBackpack)) return { type: 'reload', unitId: u.id };
    }

    // 2. Допомога за MARCH: собі — лише дозволене самому, товаришу поруч — наліпка, голка та інше.
    const patients = [u, ...sideUnits(s, u.side).filter((p) => p !== u && p.pos && u.pos && adjacent(p.pos, u.pos) && (p.status === 'active' || p.status === 'down'))];
    for (const p of patients) {
      for (const opt of treatmentOptions(p)) {
        if (opt.effect === 'pills') continue;
        if (p === u && !canSelfApply(opt.effect)) continue;
        if (p !== u && opt.march === 'C' && visible.length > 0) continue; // під вогнем бинтувати товариша не зупиняємось
        const loc = findMedical(u, opt.effect);
        if (!loc) continue;
        const cost = itemDef<MedicalDefinition>(loc.item.defId).ap + (loc.where === 'backpack' ? 2 : 0);
        if (u.ap >= toTenths(cost) && (opt.effect !== 'bandage' || visible.length === 0 || p.health < p.stats.health * 0.6))
          return { type: 'treat', unitId: u.id, patientId: p.id, effect: opt.effect, injuryId: opt.injuryId };
      }
    }

    const snapCost = fireApCost(u, 'snap');
    const lost = sideUnits(s, u.side).filter((x) => x.status === 'dead' || x.status === 'down').length / sideUnits(s, u.side).length;
    const retreating =
      known.length > 0 && (u.morale < 25 || (this.style(u) !== 'aggressive' && (lost >= 0.5 && u.morale < 45))) && !this.moved.has(u.id);

    // 3. Відступ.
    if (retreating) {
      const cell = this.bestCell(s, u, known, u.ap, 'retreat');
      if (cell && !sameCell(cell, u.pos!)) return { type: 'move', unitId: u.id, to: cell, mode: 'standard' };
    }

    // 4. Граната по цілі в укритті.
    if (visible.length && u.ap >= toTenths(R.actions.throw) && findItem(u, (d) => d.kind === 'grenade')) {
      for (const k of visible) {
        const cover = coverAgainst(s, k.pos, u.pos!);
        const allyNear = sideUnits(s, u.side).some((a) => a.pos && isActive(a) && a.pos.z === k.pos.z && dist2d(a.pos, k.pos) <= 3);
        if (cover >= 1 && !allyNear && dist2d(u.pos!, k.pos) >= 4 && canThrowTo({ s }, u, k.pos) && this.rng.chance(s.scenario.difficulty === 'easy' ? 15 : 35))
          return { type: 'throw', unitId: u.id, cell: k.pos };
      }
    }

    // 5. Зміна позиції (один раз за хід).
    if (!this.moved.has(u.id) && !retreating) {
      const budget = visible.length ? u.ap - snapCost : u.ap - toTenths(R.actions.overwatchMin);
      if (budget >= 10) {
        const mode = visible.length ? 'retain' : 'advance';
        const cell = this.bestCell(s, u, known, budget, mode);
        if (cell && !sameCell(cell, u.pos!)) return { type: 'move', unitId: u.id, to: cell, mode: 'standard' };
      }
      this.moved.add(u.id);
    }

    // 6. Вогонь.
    if (visible.length && w && mag && mag.rounds > 0 && !u.carrying) {
      let best: { cmd: Command; score: number } | null = null;
      for (const k of visible) {
        for (const mode of w.modes as FireMode[]) {
          if (mode === 'blind') continue;
          const cost = fireApCost(u, mode);
          if (cost > u.ap) continue;
          const est = estimateHit(s, u, k.unit, mode, { identified: s.contacts[u.side][k.unit.id]?.identified ?? true });
          if (!est.lineOfFire) continue;
          const shots = mode === 'burst' ? Math.min(w.burst, mag.rounds) : 1;
          let value = (est.chance / 100) * shots * (mode === 'burst' ? 0.75 : 1);
          if (w.category === 'lmg' && mode === 'burst') value += 0.4; // придушення
          if (k.unit.status === 'active' && k.unit.health < k.unit.stats.health * 0.5) value *= 1.2;
          const score = value / (cost / 10);
          if (est.chance >= 12 || w.category === 'lmg') if (!best || score > best.score) best = { cmd: { type: 'fire', unitId: u.id, target: { unitId: k.unit.id }, mode }, score };
        }
      }
      if (best) return best.cmd;
    }

    // 7. Позиція і спостереження.
    if (u.stance === 'standing' && known.length && u.ap >= toTenths(R.actions.stance) + toTenths(R.actions.overwatchMin)) {
      const covered = known.some((k) => coverAgainst(s, u.pos!, k.pos) === 1);
      if (covered) return { type: 'stance', unitId: u.id, stance: 'crouched' };
    }
    if (u.ap >= toTenths(R.actions.overwatchMin) && mag && mag.rounds > 0) return { type: 'overwatch', unitId: u.id };
    return null;
  }

  /** Вибір клітинки за оцінкою: укриття, відкритість, шанс влучання, фланг, дистанція, висота. */
  private bestCell(s: MissionState, u: Unit, known: Known[], budget: number, mode: 'retain' | 'advance' | 'retreat'): Cell | null {
    const nodes = unitReachable(s, u, 'standard', budget);
    const w = primaryDef(u);
    const range = w?.range ?? 14;
    const style = this.style(u);
    const noise = NOISE[s.scenario.difficulty];
    const enemyZone = s.scenario.sides[other(u.side)].deployZone;
    const goal: Cell = known.length && mode !== 'advance'
      ? known.reduce((a, b) => (dist2d(u.pos!, a.pos) < dist2d(u.pos!, b.pos) ? a : b)).pos
      : known.length
      ? known.reduce((a, b) => (dist2d(u.pos!, a.pos) < dist2d(u.pos!, b.pos) ? a : b)).pos
      : { x: (enemyZone[0] + enemyZone[2]) >> 1, y: (enemyZone[1] + enemyZone[3]) >> 1, z: 0 };
    const pref = style === 'aggressive' ? range * 0.35 : style === 'cautious' ? range * 0.6 : range * 0.8;
    const anchor = cellsInZone(s.map, s.scenario.sides[u.side].deployZone)[0];

    let cand = [...nodes.values()];
    if (cand.length > 140) cand = cand.filter((_, i) => i % Math.ceil(cand.length / 140) === 0 || sameCell(cand[i].cell, u.pos!));
    let best: { cell: Cell; score: number } | null = null;
    for (const node of cand) {
      const c = node.cell;
      const fake = { ...u, pos: c } as Unit;
      let score = 0;
      if (mode === 'advance') {
        // Немає видимого противника: просування до останньої відомої позиції або зони противника, з укриттям поруч.
        score -= dist2d(c, goal) * (style === 'defensive' ? 0.5 : style === 'cautious' ? 2 : 3);
        if (style === 'defensive' && anchor) score -= dist2d(c, u.pos!) * 2;
        // Обережний не підставляється під відомі позиції противника.
        for (const k of known) {
          const eu = { ...k.unit, pos: k.pos } as Unit;
          if (canSeeFrom(s, eu, k.pos, eu.stance, fake).seen) score -= effectiveCover(coverAgainst(s, c, k.pos), 'crouched') >= 2 ? 2 : style === 'cautious' ? 14 : 6;
        }
        score += this.anyCoverAround(s, c) * 6;
      } else {
        for (const k of known) {
          const eu = { ...k.unit, pos: k.pos } as Unit;
          const cover = effectiveCover(coverAgainst(s, c, k.pos), 'crouched');
          score += cover * 14;
          const seen = canSeeFrom(s, eu, k.pos, eu.stance, fake).seen;
          if (seen && cover === 0) score -= 28;
          else if (seen && cover === 1) score -= 8;
          const d = dist2d(c, k.pos);
          if (mode === 'retreat') score += d * 4;
          else score -= Math.abs(d - pref) * 1.5;
        }
        if (mode !== 'retreat') {
          let bestHit = 0;
          for (const k of known) {
            if (!k.visible && !s.revealAll) continue;
            const est = estimateHit(s, fake, k.unit, 'snap', { from: c, stance: u.stance });
            if (!est.lineOfFire) continue;
            let v = est.chance;
            if (est.cover === 0 && coverAgainst(s, k.pos, u.pos!) > 0) v += 15; // фланг
            bestHit = Math.max(bestHit, v);
          }
          score += bestHit * (style === 'aggressive' ? 0.8 : 0.5);
          if (style === 'defensive') score -= dist2d(c, u.pos!) * 2;
        }
      }
      if (groundHeight(s.map, c) - groundHeight(s.map, u.pos!) >= 0.3) score += 8;
      score -= node.cost / 10 * 0.3;
      score += this.rng.gaussian(0, noise);
      if (sameCell(c, u.pos!)) score += 4; // невелика інерція
      if (!best || score > best.score) best = { cell: c, score };
    }
    return best?.cell ?? null;
  }

  private anyCoverAround(s: MissionState, c: Cell): number {
    let best = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      best = Math.max(best, coverAgainst(s, c, { x: c.x + dx * 3, y: c.y + dy * 3, z: c.z }));
    }
    return best;
  }
}
