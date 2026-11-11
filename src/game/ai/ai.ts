import { Rng } from '@/core/rng';
import { dist2d, sameCell, toTenths, type Cell } from '@/core/grid';
import { content, droneDef, hasSkill, itemDef } from '@/content';
import { cellsInZone, groundHeight, isIndoor } from '@/game/maps/map';
import { findItem, findMedical, findReloadMagazine, primaryDef } from '@/game/inventory/inventory';
import { canSelfApply, treatmentOptions } from '@/game/injuries/injuries';
import { canThrowTo } from '@/game/combat/fire';
import { canLobTo, findDisposable, findRocket, hasUnderbarrel, launcherOf, uglAmmo } from '@/game/combat/launcher';
import { coverAgainst, effectiveCover, estimateHit, fireApCost } from '@/game/combat/hit';
import { adjacent, unitReachable } from '@/game/combat/movement';
import { crewProxy, vehicles } from '@/game/vehicles';
import { droneItems, drones, moveCost } from '@/game/drones';
import { losIgnore } from '@/game/visibility/los';
import { canSeeFrom } from '@/game/visibility/visibility';
import { isActive, other, sideUnits, type MissionState } from '@/game/simulation/state';
import type { Command } from '@/game/simulation/commands';
import type { AiStyle, DroneState, FireMode, GrenadeDefinition, MedicalDefinition, Unit, VehicleState } from '@/game/types';

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
    // Дрони сторони.
    for (const d of drones(s)) {
      if (d.side !== s.turn.side || this.done.has(d.id)) continue;
      const n = (this.steps.get(d.id) ?? 0) + 1;
      this.steps.set(d.id, n);
      const cmd = n > 6 ? null : this.droneDecide(s, d);
      if (!cmd) {
        this.done.add(d.id);
        continue;
      }
      return cmd;
    }
    // Техніка: навідник стріляє з бортової зброї.
    for (const v of vehicles(s)) {
      if (v.side !== s.turn.side || v.destroyed || this.done.has(v.id)) continue;
      const cmd = this.vehicleDecide(s, v);
      if (!cmd) {
        this.done.add(v.id);
        continue;
      }
      return cmd;
    }
    return { type: 'endTurn' };
  }

  private droneDecide(s: MissionState, d: DroneState): Command | null {
    const def = droneDef(d.defId);
    const enemies = Object.values(s.contacts[d.side])
      .filter((c) => c.visible)
      .map((c) => s.units.find((u) => u.id === c.unitId)!)
      .filter((u) => u && isActive(u));
    const reach = (x: number, y: number) => moveCost(d, x, y) <= d.ap;
    if (def.kind === 'fpv') {
      // Техніка — пріоритет для кумулятивного дрона.
      const veh = vehicles(s).filter((v) => v.side !== d.side && !v.destroyed && reach(v.x, v.y));
      if (def.warhead?.type === 'heat' && veh.length) return { type: 'droneAttack', droneId: d.id, cell: { x: veh[0].x, y: veh[0].y, z: 0 } };
      const t = enemies.filter((e) => reach(e.pos!.x, e.pos!.y)).sort((a, b) => b.health - a.health)[0];
      if (t) return { type: 'droneAttack', droneId: d.id, cell: { ...t.pos! } };
    }
    if (def.kind === 'dropper' && d.drops > 0) {
      const t = enemies.find((e) => e.pos!.x === d.x && e.pos!.y === d.y);
      if (t && d.ap >= 20) return { type: 'droneDrop', droneId: d.id };
      const near = enemies.filter((e) => moveCost(d, e.pos!.x, e.pos!.y) + 20 <= d.ap)[0];
      if (near) return { type: 'droneMove', droneId: d.id, x: near.pos!.x, y: near.pos!.y };
    }
    // Розвідка: до останньої відомої позиції або в бік противника, не витрачаючи все.
    const known = Object.values(s.contacts[d.side]).map((c) => c.pos);
    const zone = s.scenario.sides[other(d.side)].deployZone;
    const goal = known[0] ?? { x: (zone[0] + zone[2]) >> 1, y: (zone[1] + zone[3]) >> 1, z: 0 };
    const step = toTenths(def.moveCost);
    const maxCells = Math.floor((d.ap * 0.6) / step);
    if (maxCells < 1 || (d.x === goal.x && d.y === goal.y)) return null;
    const dx = Math.sign(goal.x - d.x) * Math.min(maxCells, Math.abs(goal.x - d.x));
    const dy = Math.sign(goal.y - d.y) * Math.min(maxCells, Math.abs(goal.y - d.y));
    if (!dx && !dy) return null;
    return { type: 'droneMove', droneId: d.id, x: d.x + dx, y: d.y + dy };
  }

  private vehicleDecide(s: MissionState, v: VehicleState): Command | null {
    const g = v.gunner ? s.units.find((u) => u.id === v.gunner) : undefined;
    if (!g || g.status !== 'active' || g.panicked || !v.weapon || v.hp.weapon <= 0) return null;
    const R = content().rules;
    if ((v.weapon.magazine?.rounds ?? 0) <= 0) return v.ammoStock > 0 && g.ap >= toTenths(R.actions.vehicleReload) ? { type: 'vehicleReload', vehicleId: v.id } : null;
    const proxy = crewProxy(s, v, g);
    proxy.inventory = { ...g.inventory, primary: v.weapon };
    let best: { cmd: Command; score: number } | null = null;
    losIgnore.ids.add(v.id);
    try {
      for (const c of Object.values(s.contacts[v.side])) {
        const t = s.units.find((u) => u.id === c.unitId);
        if (!t || !c.visible || !isActive(t)) continue;
        for (const mode of ['burst', 'snap'] as FireMode[]) {
          const cost = fireApCost(proxy, mode);
          if (cost > g.ap) continue;
          const est = estimateHit(s, proxy, t, mode);
          if (!est.lineOfFire) continue;
          const score = est.chance * (mode === 'burst' ? 1.6 : 1);
          if (!best || score > best.score) best = { cmd: { type: 'vehicleFire', vehicleId: v.id, target: { unitId: t.id }, mode }, score };
        }
      }
    } finally {
      losIgnore.ids.delete(v.id);
    }
    return best && best.score >= 15 ? best.cmd : null;
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

    // 0. Оператор дрона: запуск ударного дрона по видимій цілі, інакше — розвідника.
    if (!u.piloting && u.ap >= toTenths(R.drones.launch)) {
      const items = droneItems(u);
      if (items.length && known.length) {
        const pick =
          (visible.length && vehicles(s).some((v) => v.side !== u.side && !v.destroyed) && items.find((i) => i.defId === 'drone_fpv10')) ||
          (visible.length && items.find((i) => i.defId.startsWith('drone_fpv'))) ||
          items.find((i) => i.defId === 'drone_mavic3t' || i.defId === 'drone_avata');
        if (pick) return { type: 'droneLaunch', unitId: u.id, index: pick.index };
      }
    }

    // 1. Перезаряджання.
    if (w && (!mag || mag.rounds < Math.max(1, w.burst)) && findReloadMagazine(u)) {
      const f = findReloadMagazine(u)!;
      if (u.ap >= toTenths(f.where === 'pouch' ? R.actions.reloadPouch : R.actions.reloadBackpack)) return { type: 'reload', unitId: u.id };
    }

    // 2. Допомога за MARCH: собі — лише дозволене самому, товаришу поруч — наліпка, голка та інше.
    const patients = [u, ...sideUnits(s, u.side).filter((p) => p !== u && p.pos && u.pos && adjacent(p.pos, u.pos) && (p.status === 'active' || p.status === 'down'))];
    for (const p of patients) {
      for (const opt of treatmentOptions(p, hasSkill(u.classId, 'medic'))) {
        if (opt.effect === 'pills') continue;
        if (p === u && !canSelfApply(opt.effect)) continue;
        if (p !== u && opt.march === 'C' && visible.length > 0) continue; // під вогнем бинтувати товариша не зупиняємось
        const loc = findMedical(u, opt.effect);
        if (!loc) continue;
        const cost = Math.max(1, itemDef<MedicalDefinition>(loc.item.defId).ap + (loc.where === 'backpack' ? 2 : 0) - (hasSkill(u.classId, 'medic') ? 1 : 0));
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

    // 3б. Гранатомети: РПГ — по цілі в укритті/будівлі; підствольник — навісом по укриттю.
    const L = R.launcher;
    const lau = launcherOf(u);
    if (lau && !lau.loaded && findRocket(u) && u.ap >= toTenths(L.rpgReload) && (visible.length === 0 || u.ap >= toTenths(L.rpgReload + L.rpgAp)))
      // Кумулятивний — для цілей у будівлях (пробиває стіни), осколковий — для відкритих.
      return { type: 'reloadLauncher', unitId: u.id, ammo: findRocket(u, known.some((k) => isIndoor(s.map, k.pos)) ? 'pg7' : 'og7') ? (known.some((k) => isIndoor(s.map, k.pos)) ? 'pg7' : 'og7') : undefined };
    for (const k of visible) {
      const d = dist2d(u.pos!, k.pos);
      const cover = coverAgainst(s, k.pos, u.pos!);
      const allyNear = sideUnits(s, u.side).some((a) => a.pos && isActive(a) && a !== u && a.pos.z === k.pos.z && dist2d(a.pos, k.pos) <= 3);
      if (allyNear || d < 4) continue;
      const roll = this.rng.chance(s.scenario.difficulty === 'easy' ? 25 : 55);
      if (lau?.loaded && u.stance !== 'prone' && d <= 18 && (cover >= 1 || isIndoor(s.map, k.pos)) && u.ap >= toTenths(L.rpgAp) && roll)
        return { type: 'launch', unitId: u.id, kind: 'rpg', cell: k.pos };
      if (!lau?.loaded && findDisposable(u) && u.stance !== 'prone' && d <= 15 && (cover >= 1 || isIndoor(s.map, k.pos)) && u.ap >= toTenths(L.rpgAp + 1) && roll)
        return { type: 'launch', unitId: u.id, kind: 'disposable', cell: k.pos };
      if (hasUnderbarrel(u) && uglAmmo(u) && cover >= 1 && canLobTo(s, u, k.pos) && u.ap >= toTenths(L.uglAp + 2) && roll)
        return { type: 'launch', unitId: u.id, kind: 'ugl', cell: k.pos };
    }

    // 4. Граната по цілі в укритті.
    const frag = findItem(u, (d) => d.kind === 'grenade' && !(d as GrenadeDefinition).smoke && !(d as GrenadeDefinition).objectDamage);
    const smoke = findItem(u, (d) => d.kind === 'grenade' && !!(d as GrenadeDefinition).smoke);
    if (visible.length && u.ap >= toTenths(R.actions.throw) && frag) {
      for (const k of visible) {
        const cover = coverAgainst(s, k.pos, u.pos!);
        const allyNear = sideUnits(s, u.side).some((a) => a.pos && isActive(a) && a.pos.z === k.pos.z && dist2d(a.pos, k.pos) <= 3);
        if (cover >= 1 && !allyNear && dist2d(u.pos!, k.pos) >= 4 && canThrowTo({ s }, u, k.pos, frag.item.defId) && this.rng.chance(s.scenario.difficulty === 'easy' ? 15 : 35))
          return { type: 'throw', unitId: u.id, cell: k.pos, grenade: frag.item.defId };
      }
    }
    // Димова завіса для відходу або коли боєць відкритий під вогнем.
    if (smoke && visible.length && u.ap >= toTenths(R.actions.throw) && (retreating || u.suppression >= 50) && !s.map.cells[u.pos!.z][u.pos!.y][u.pos!.x].smoke) {
      const k = visible.reduce((a, b) => (dist2d(u.pos!, a.pos) < dist2d(u.pos!, b.pos) ? a : b));
      const mid = { x: Math.round((u.pos!.x * 2 + k.pos.x) / 3), y: Math.round((u.pos!.y * 2 + k.pos.y) / 3), z: u.pos!.z };
      if (canThrowTo({ s }, u, mid, smoke.item.defId)) return { type: 'throw', unitId: u.id, cell: mid, grenade: smoke.item.defId };
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
