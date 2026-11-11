import { Rng } from '@/core/rng';
import { cellKey, sameCell, toTenths, type Cell } from '@/core/grid';
import { GAME_VERSION, SCHEMA_VERSION } from '@/core/version';
import { content, itemDef, vehicleDef } from '@/content';
import { buildMap, cellAt, cellsInZone, inZone, isSlowTerrain, isStandable } from '@/game/maps/map';
import { adjacentToVehicle, canPlace, crewProxy, embark, exitCells, leaveSeat, moveVehicle, spawnVehicle, vehicleById, vehiclePath, vehicleReachable } from '@/game/vehicles';
import { losIgnore } from '@/game/visibility/los';
import { canLobTo, findDisposable, findRocket, hasUnderbarrel, launcherOf, loadedAmmo, reloadLauncher, resolveRocket, resolveUgl, takeUglAmmo, uglAmmo, warheadOf } from '@/game/combat/launcher';
import { buildPath } from '@/game/maps/pathfinding';
import { generateUnit } from '@/game/units/generator';
import { computeApMax } from '@/game/units/derived';
import { consume, createItem, findItem, findMedical, findReloadMagazine, helmetMount, placeInBackpack, pouchCapacity, primaryDef, swapMagazine } from '@/game/inventory/inventory';
import { applyTreatment, canSelfApply, tickInjuries } from '@/game/injuries/injuries';
import { canThrowTo, decaySmoke, resolveFire, resolveGrenade } from '@/game/combat/fire';
import { fireApCost } from '@/game/combat/hit';
import { adjacent, canUseMode, stepCost, unitReachable } from '@/game/combat/movement';
import { canSee, updateContacts } from '@/game/visibility/visibility';
import { computeResult } from '@/game/scenarios/result';
import { EXTRA_ARMOR } from '@/game/equipment/loadout';
import type { ArmorDefinition, ControllerKind, MagazineInstance, MedicalDefinition, MoveMode, SideId, StackItem, Unit } from '@/game/types';
import type { Command, CommandResult } from './commands';
import {
  activeUnitAt,
  float,
  isActive,
  isAlive,
  newId,
  other,
  sideUnits,
  unitById,
  type Ctx,
  type MissionState,
  type SimEvent,
} from './state';

export interface MissionOptions {
  seed?: number;
  controllers?: Partial<Record<SideId, ControllerKind>>;
  revealAll?: boolean;
  difficulty?: 'easy' | 'medium' | 'hard';
}

const DIFF_BONUS = { easy: -8, medium: 0, hard: 8 } as const;

/** Створює нову місію за сценарієм. Противник із автоматичним розгортанням ставиться одразу. */
export function createMission(scenarioId: string, opts: MissionOptions = {}): MissionState {
  const db = content();
  const sc = db.scenarios.get(scenarioId);
  if (!sc) throw new Error(`Невідомий сценарій: ${scenarioId}`);
  const scenario = structuredClone(sc);
  if (opts.difficulty) scenario.difficulty = opts.difficulty;
  const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31);
  const rng = Rng.fromSeed(seed);
  const mapDef = db.maps.get(scenario.mapId);
  if (!mapDef) throw new Error(`Невідома карта: ${scenario.mapId}`);
  const s: MissionState = {
    schemaVersion: SCHEMA_VERSION,
    gameVersion: GAME_VERSION,
    seed,
    scenario,
    map: buildMap(mapDef, rng),
    units: [],
    turn: { turn: 0, side: 'blue', phase: 'deploy' },
    rng: 0,
    contacts: { blue: {}, red: {} },
    controllers: {
      blue: opts.controllers?.blue ?? scenario.sides.blue.controller,
      red: opts.controllers?.red ?? scenario.sides.red.controller,
    },
    revealAll: !!opts.revealAll,
    nextId: 1,
    result: null,
  };
  const idGen = (p: string) => newId(s, p);
  for (const side of ['blue', 'red'] as SideId[]) {
    const setup = scenario.sides[side];
    const bonus = s.controllers[side] === 'ai' ? DIFF_BONUS[scenario.difficulty] : 0;
    for (const { classId, count } of setup.squad)
      for (let i = 0; i < count; i++) {
        const u = generateUnit(side, classId, rng, idGen, { statBonus: bonus, aiStyle: setup.aiStyle });
        if (setup.loadout) applyLoadout(u, setup.loadout, idGen);
        s.units.push(u);
      }
  }
  const ctx: Ctx = { s, rng, ev: [] };
  for (const side of ['blue', 'red'] as SideId[]) spawnScenarioVehicles(ctx, side, idGen);
  for (const side of ['blue', 'red'] as SideId[]) {
    if (!scenario.sides[side].manualDeploy || s.controllers[side] === 'ai') autoDeploy(ctx, side);
  }
  s.rng = rng.state;
  return s;
}

/** Спорядження сторони за сценарієм: запасні магазини, гранати, броня. */
function applyLoadout(u: Unit, l: NonNullable<MissionState['scenario']['sides']['blue']['loadout']>, id: (p: string) => string): void {
  const inv = u.inventory;
  if (l.extraArmor && !l.noArmor)
    inv.extraArmor = EXTRA_ARMOR.map((x) => ({ id: id('a'), defId: x, durability: itemDef<ArmorDefinition>(x).durability }));
  if (l.noArmor) {
    inv.armor = null;
    inv.helmet = null;
    inv.extraArmor = [];
    inv.pouches = inv.pouches.slice(0, pouchCapacity(inv));
  }
  const w = primaryDef(u);
  if (w && l.extraMags > 0)
    for (let i = 0; i < l.extraMags; i++) {
      const m = createItem(w.magazines[0], id);
      if (inv.pouches.length < pouchCapacity(inv)) inv.pouches.push(m as MagazineInstance);
      else placeInBackpack(inv, m);
    }
  if (l.extraMags < 0) {
    let drop = -l.extraMags;
    while (drop > 0 && inv.backpackItems.some((e) => itemDef(e.item.defId).kind === 'magazine')) {
      inv.backpackItems.splice(inv.backpackItems.findIndex((e) => itemDef(e.item.defId).kind === 'magazine'), 1);
      drop--;
    }
    while (drop > 0 && inv.pouches.length) {
      inv.pouches.pop();
      drop--;
    }
  }
  for (let i = 0; i < l.extraGrenades; i++) inv.belt.push(createItem('rgd5', id) as StackItem);
  if (l.helmetMount && inv.helmet) {
    inv.helmetMounts = l.helmetMount === 'none' ? [] : l.helmetMount === 'flashlight' ? [{ id: id('i'), defId: 'flashlight' }] : [{ id: id('i'), defId: l.helmetMount }, { id: id('i'), defId: 'flashlight' }];
  }
}

/** Техніка сценарію: ставиться в зоні розгортання, екіпаж (водій і навідник) створюється й сідає. */
function spawnScenarioVehicles(ctx: Ctx, side: SideId, idGen: (p: string) => string): void {
  const s = ctx.s;
  const setup = s.scenario.sides[side];
  for (const defId of setup.vehicles ?? []) {
    const [x0, y0, x1, y1] = setup.deployZone;
    const spots: [number, number][] = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (canPlace(s, defId, x, y)) spots.push([x, y]);
    if (!spots.length) continue;
    const [x, y] = ctx.rng.pick(spots);
    const v = spawnVehicle(s, side, defId, x, y, idGen);
    const bonus = s.controllers[side] === 'ai' ? DIFF_BONUS[s.scenario.difficulty] : 0;
    const driver = generateUnit(side, 'driver', ctx.rng, idGen, { statBonus: bonus, aiStyle: setup.aiStyle });
    s.units.push(driver);
    embark(v, driver, 'driver');
    if (v.weapon) {
      const gunner = generateUnit(side, 'rifleman', ctx.rng, idGen, { statBonus: bonus, aiStyle: setup.aiStyle });
      s.units.push(gunner);
      embark(v, gunner, 'gunner');
    }
  }
}

function autoDeploy(ctx: Ctx, side: SideId): void {
  const { s, rng } = ctx;
  const zone = cellsInZone(s.map, s.scenario.sides[side].deployZone);
  for (const u of sideUnits(s, side)) {
    if (u.pos || u.inVehicle || u.status !== 'active') continue;
    const free = zone.filter((c) => !activeUnitAt(s, c) && isStandable(s.map, c));
    if (!free.length) throw new Error('Зона розгортання переповнена');
    u.pos = { ...rng.pick(free) };
    ctx.ev.push({ t: 'deployed', unitId: u.id, cell: u.pos });
  }
}

/** Обгортка над станом: валідує команди, застосовує, збирає події. */
export class Mission {
  constructor(public state: MissionState) {}

  get s(): MissionState {
    return this.state;
  }

  dispatch(cmd: Command): CommandResult & { events: SimEvent[] } {
    const rng = new Rng(this.state.rng);
    const ctx: Ctx = { s: this.state, rng, ev: [] };
    let err: string | null;
    try {
      err = this.apply(ctx, cmd);
    } finally {
      this.state.rng = rng.state;
    }
    if (err) return { ok: false, error: err, events: [] };
    if (this.state.turn.phase === 'battle') {
      updateContacts(ctx);
      this.checkVictory(ctx);
    }
    return { ok: true, events: ctx.ev };
  }

  private apply(ctx: Ctx, cmd: Command): string | null {
    const s = this.state;
    if (s.turn.phase === 'ended') return 'Місію завершено';
    if (cmd.type === 'withdraw') {
      this.finish(ctx, other(cmd.side), 'withdrawal');
      return null;
    }

    if (s.turn.phase === 'deploy') {
      switch (cmd.type) {
        case 'deploy': {
          const u = unitById(s, cmd.unitId);
          if (u.side !== 'blue' && u.side !== 'red') return 'Невідома сторона';
          if (!cellsInZone(s.map, s.scenario.sides[u.side].deployZone).some((c) => sameCell(c, cmd.cell)))
            return 'Клітинка поза зоною розгортання';
          if (!isStandable(s.map, cmd.cell)) return 'Тут не можна стояти';
          const occ = activeUnitAt(s, cmd.cell);
          if (occ && occ.id !== u.id) return 'Клітинка зайнята';
          u.pos = { ...cmd.cell };
          ctx.ev.push({ t: 'deployed', unitId: u.id, cell: u.pos });
          return null;
        }
        case 'autoDeploy':
          autoDeploy(ctx, cmd.side);
          return null;
        case 'startBattle':
          for (const side of ['blue', 'red'] as SideId[]) autoDeploy(ctx, side);
          s.turn = { turn: 1, side: 'blue', phase: 'battle' };
          // Уночі бійці AI без ПНБ вмикають ліхтарі.
          if (s.scenario.timeOfDay === 'night')
            for (const x of s.units) if (s.controllers[x.side] === 'ai' && helmetMount(x, 'light') && !helmetMount(x, 'nvg')) x.lightOn = true;
          updateContacts(ctx);
          this.beginSideTurn(ctx, 'blue');
          return null;
        default:
          return 'Спочатку завершіть розгортання';
      }
    }

    if (cmd.type === 'endTurn') {
      this.endTurn(ctx);
      return null;
    }
    if (cmd.type === 'deploy' || cmd.type === 'autoDeploy' || cmd.type === 'startBattle') return 'Бій уже триває';

    const R0 = content().rules;
    if (cmd.type === 'vehicleMove' || cmd.type === 'vehicleFire' || cmd.type === 'vehicleReload') return this.vehicleCommand(ctx, cmd);
    if (cmd.type === 'disembark') {
      const u0 = unitById(s, cmd.unitId);
      if (u0.side !== s.turn.side) return 'Зараз хід іншої сторони';
      const v = u0.inVehicle ? vehicleById(s, u0.inVehicle) : undefined;
      if (!v || u0.status !== 'active') return 'Боєць не в техніці';
      if (!exitCells(s, v).some((c) => sameCell(c, cmd.cell))) return 'Висадка можлива лише в сусідню вільну клітинку';
      if (u0.ap < toTenths(R0.actions.disembark)) return 'Недостатньо AP';
      u0.ap -= toTenths(R0.actions.disembark);
      leaveSeat(v, u0);
      u0.pos = { ...cmd.cell };
      ctx.ev.push({ t: 'deployed', unitId: u0.id, cell: u0.pos });
      ctx.ev.push({ t: 'vehicle', vehicleId: v.id });
      return null;
    }
    const u = unitById(s, cmd.unitId);
    if (u.side !== s.turn.side) return 'Зараз хід іншої сторони';
    if (!isActive(u)) return 'Боєць не може діяти';
    if (u.panicked) return 'Боєць у паніці';
    const R = content().rules;
    const spend = (ap: number): string | null => {
      const t = toTenths(ap);
      if (u.ap < t) return 'Недостатньо AP';
      u.ap -= t;
      return null;
    };

    switch (cmd.type) {
      case 'embark': {
        const v = vehicleById(s, cmd.vehicleId);
        if (!v || v.destroyed) return 'Техніку не знайдено';
        if (v.side !== u.side) return 'Це техніка противника';
        if (u.carrying) return 'Спершу покладіть пораненого';
        if (!adjacentToVehicle(v, u.pos!)) return 'Підійдіть упритул до техніки';
        if (u.ap < toTenths(R.actions.embark)) return 'Недостатньо AP';
        const err = embark(v, u, cmd.seat);
        if (err) return err;
        u.ap -= toTenths(R.actions.embark);
        ctx.ev.push({ t: 'evacuated', unitId: u.id });
        ctx.ev.push({ t: 'vehicle', vehicleId: v.id });
        return null;
      }
      case 'move':
        return this.move(ctx, u, cmd.to, cmd.mode);

      case 'stance': {
        if (u.stance === cmd.stance) return null;
        if (u.carrying && cmd.stance === 'prone') return 'Не можна лягти з пораненим на руках';
        const cost = u.stance !== 'standing' && cmd.stance !== 'standing' ? R.actions.stance : cmd.stance === 'prone' || u.stance === 'prone' ? R.actions.stance * 1.5 : R.actions.stance;
        const e = spend(cost);
        if (e) return e;
        u.stance = cmd.stance;
        ctx.ev.push({ t: 'pose', unitId: u.id });
        return null;
      }

      case 'weaponState': {
        if (u.weaponState === cmd.state) return null;
        const e = spend(R.actions.weaponState);
        if (e) return e;
        u.weaponState = cmd.state;
        ctx.ev.push({ t: 'pose', unitId: u.id });
        return null;
      }

      case 'fire': {
        const w = u.inventory.primary;
        const wd = primaryDef(u);
        if (!w || !wd) return 'Немає зброї';
        if (u.carrying) return 'Руки зайняті пораненим';
        if (!wd.modes.includes(cmd.mode)) return 'Цей режим недоступний для зброї';
        if (!w.magazine || w.magazine.rounds <= 0) return 'Магазин порожній — перезарядіть';
        const t = cmd.target.unitId ? unitById(s, cmd.target.unitId) : null;
        if (t) {
          if (!t.pos) return 'Ціль недоступна';
          const contact = s.contacts[u.side][t.id];
          if (t.side !== u.side && !s.revealAll && !contact?.visible && cmd.mode !== 'blind') return 'Ціль не видно';
        } else if (!cmd.target.cell) return 'Не вказано ціль';
        const cost = fireApCost(u, cmd.mode);
        if (u.ap < cost) return 'Недостатньо AP';
        u.ap -= cost;
        resolveFire(ctx, u, cmd.target, cmd.mode);
        return null;
      }

      case 'reload': {
        const found = findReloadMagazine(u);
        if (!found) return 'Немає сумісних спорядженних магазинів';
        const e = spend(found.where === 'pouch' ? R.actions.reloadPouch : R.actions.reloadBackpack);
        if (e) return e;
        swapMagazine(u);
        ctx.ev.push({ t: 'reload', unitId: u.id });
        float(ctx, u.id, 'Перезаряджання', 'info');
        return null;
      }

      case 'throw': {
        const g = findItem(u, (d) => d.kind === 'grenade' && (!cmd.grenade || d.id === cmd.grenade));
        if (!g) return 'Немає таких гранат';
        if (u.carrying) return 'Руки зайняті пораненим';
        if (!canThrowTo(ctx, u, cmd.cell, g.item.defId)) return 'Не докинути сюди';
        const e = spend(R.actions.throw + (g.where === 'backpack' ? 2 : 0));
        if (e) return e;
        const defId = g.item.defId;
        consume(u, g);
        resolveGrenade(ctx, u, defId, cmd.cell);
        return null;
      }

      case 'launch': {
        if (u.carrying) return 'Руки зайняті пораненим';
        if (cmd.kind === 'rpg') {
          const l = launcherOf(u);
          if (!l) return 'Немає гранатомета';
          if (!l.loaded) return 'Гранатомет не заряджено';
          if (u.stance === 'prone') return 'З РПГ не стріляють лежачи — сядьте або встаньте';
          if (!cellAt(s.map, cmd.cell)) return 'Ціль поза картою';
          const e = spend(R.launcher.rpgAp);
          if (e) return e;
          const ammo = loadedAmmo(u);
          u.inventory.secondary!.magazine = null;
          resolveRocket(ctx, u, cmd.cell, l.def, warheadOf(l.def, ammo));
        } else if (cmd.kind === 'disposable') {
          const f = findDisposable(u);
          if (!f) return 'Немає одноразового гранатомета';
          if (u.stance === 'prone') return 'З гранатомета не стріляють лежачи — сядьте або встаньте';
          if (!cellAt(s.map, cmd.cell)) return 'Ціль поза картою';
          // Дістати з рюкзака й розкласти — +1 AP.
          const e = spend(R.launcher.rpgAp + (f.where === 'backpack' ? 1 : 0));
          if (e) return e;
          if (f.where === 'backpack') u.inventory.backpackItems.splice(f.index, 1);
          else u.inventory.secondary = null;
          resolveRocket(ctx, u, cmd.cell, f.def);
        } else {
          if (!hasUnderbarrel(u)) return 'Немає підствольного модуля';
          const ammo = uglAmmo(u);
          if (!ammo) return 'Немає пострілів до підствольника';
          if (!canLobTo(s, u, cmd.cell)) return 'Не дістати сюди';
          const e = spend(R.launcher.uglAp + (ammo.where === 'backpack' ? 2 : 0));
          if (e) return e;
          takeUglAmmo(u, ammo);
          resolveUgl(ctx, u, cmd.cell);
        }
        return null;
      }

      case 'toggleLight': {
        if (!helmetMount(u, 'light')) return 'Немає ліхтаря';
        u.lightOn = !u.lightOn;
        ctx.ev.push({ t: 'pose', unitId: u.id });
        float(ctx, u.id, u.lightOn ? 'Ліхтар увімкнено' : 'Ліхтар вимкнено', 'info');
        return null;
      }

      case 'reloadLauncher': {
        const l = launcherOf(u);
        if (!l) return 'Немає гранатомета';
        if (l.loaded) return 'Вже заряджено';
        if (!findRocket(u, cmd.ammo)) return 'Немає пострілів цього типу';
        const e = spend(R.launcher.rpgReload);
        if (e) return e;
        reloadLauncher(u, cmd.ammo);
        ctx.ev.push({ t: 'reload', unitId: u.id });
        float(ctx, u.id, 'Гранатомет заряджено', 'info');
        return null;
      }

      case 'overwatch': {
        if (u.ap < toTenths(R.actions.overwatchMin)) return `Потрібно щонайменше ${R.actions.overwatchMin} AP`;
        if (!u.inventory.primary?.magazine?.rounds) return 'Магазин порожній';
        if (u.carrying) return 'Руки зайняті пораненим';
        u.overwatch = u.ap;
        u.ap = 0;
        ctx.ev.push({ t: 'overwatch', unitId: u.id });
        float(ctx, u.id, 'Спостереження', 'info');
        return null;
      }

      case 'treat': {
        const p = unitById(s, cmd.patientId);
        if (!p.pos && p.carriedBy !== u.id) return 'Пацієнт недоступний';
        if (p.id !== u.id && p.carriedBy !== u.id && !adjacent(u.pos!, p.pos!)) return 'Пацієнт має бути поруч';
        if (p.side !== u.side) return 'Можна лікувати лише своїх';
        if (p.id === u.id && !canSelfApply(cmd.effect)) return 'Цей засіб не можна застосувати самому собі — потрібен інший боєць';
        const loc = findMedical(u, cmd.effect);
        if (!loc) return 'Немає потрібного засобу';
        const md = itemDef<MedicalDefinition>(loc.item.defId);
        const cost = md.ap + (loc.where === 'backpack' ? 2 : 0);
        if (u.ap < toTenths(cost)) return 'Недостатньо AP';
        const e = applyTreatment(ctx, p, cmd.effect, cmd.injuryId);
        if (e) return e;
        u.ap -= toTenths(cost);
        consume(u, loc);
        u.stats_mission.medsUsed++;
        u.xp += R.xp.treat;
        ctx.ev.push({ t: 'treated', unitId: u.id, targetId: p.id, effect: cmd.effect });
        float(ctx, p.id, md.name, 'good');
        return null;
      }

      case 'pickUp': {
        if (u.carrying) return 'Вже несе пораненого';
        const t = unitById(s, cmd.targetId);
        if (t.side !== u.side) return 'Можна нести лише своїх';
        if (t.status !== 'down' && t.status !== 'dead') return 'Боєць може йти сам';
        if (!t.pos || !adjacent(u.pos!, t.pos) && !sameCell(u.pos!, t.pos)) return 'Потрібно підійти впритул';
        if (u.stance === 'prone') return 'Спершу підведіться';
        const e = spend(R.actions.pickUp);
        if (e) return e;
        u.carrying = t.id;
        t.carriedBy = u.id;
        t.pos = null;
        if (u.weaponState === 'high') u.weaponState = 'carry';
        ctx.ev.push({ t: 'carry', unitId: u.id, targetId: t.id });
        return null;
      }

      case 'drop': {
        if (!u.carrying) return 'Нічого не несе';
        const e = spend(R.actions.drop);
        if (e) return e;
        const t = unitById(s, u.carrying);
        t.carriedBy = null;
        t.pos = { ...u.pos! };
        u.carrying = null;
        ctx.ev.push({ t: 'carry', unitId: u.id, targetId: null });
        return null;
      }

      case 'evacuate': {
        if (!inZone(u.pos!, s.scenario.evacZone)) return 'Потрібно бути в зоні евакуації';
        const e = spend(R.actions.evacuate);
        if (e) return e;
        if (u.carrying) {
          const t = unitById(s, u.carrying);
          u.carrying = null;
          t.carriedBy = null;
          this.evacuateUnit(ctx, t);
        } else {
          this.evacuateUnit(ctx, u);
        }
        return null;
      }
    }
    return 'Невідома команда';
  }

  /** Команди техніки: рух (AP водія), вогонь і перезаряджання (AP навідника). */
  private vehicleCommand(ctx: Ctx, cmd: Extract<Command, { type: 'vehicleMove' | 'vehicleFire' | 'vehicleReload' }>): string | null {
    const s = this.state;
    const R = content().rules;
    const v = vehicleById(s, cmd.vehicleId);
    if (!v || v.destroyed) return 'Техніку не знайдено або знищено';
    if (v.side !== s.turn.side) return 'Зараз хід іншої сторони';
    if (cmd.type === 'vehicleMove') {
      const d = v.driver ? unitById(s, v.driver) : null;
      if (!d || d.status !== 'active') return 'Немає водія';
      if (d.panicked) return 'Водій у паніці';
      if (v.hp.engine <= 0) return 'Двигун уражено — техніка не рухається';
      if (v.hp.mobility <= 0) return 'Ходову уражено — техніка не рухається';
      const nodes = vehicleReachable(s, v, d.ap);
      const path = vehiclePath(nodes, cmd.x, cmd.y);
      if (!path) return 'Недосяжно з поточними AP водія';
      d.ap -= nodes.get(`${cmd.x},${cmd.y}`)!.cost;
      moveVehicle(ctx, v, path);
      return null;
    }
    const g = v.gunner ? unitById(s, v.gunner) : null;
    if (!g || g.status !== 'active') return 'Немає навідника';
    if (g.panicked) return 'Навідник у паніці';
    if (!v.weapon || v.hp.weapon <= 0) return 'Бортова зброя виведена з ладу';
    if (cmd.type === 'vehicleReload') {
      if (v.ammoStock <= 0) return 'Боєкомплект вичерпано';
      if (g.ap < toTenths(R.actions.vehicleReload)) return 'Недостатньо AP';
      g.ap -= toTenths(R.actions.vehicleReload);
      v.ammoStock--;
      v.weapon.magazine = createItem(vehicleDef(v.defId).weaponAmmo!, (p) => newId(s, p)) as MagazineInstance;
      ctx.ev.push({ t: 'vehicle', vehicleId: v.id });
      return null;
    }
    if (!v.weapon.magazine || v.weapon.magazine.rounds <= 0) return 'Стрічка порожня — перезарядіть';
    const proxy = crewProxy(s, v, g);
    proxy.inventory = { ...g.inventory, primary: v.weapon };
    const wd = primaryDef(proxy)!;
    if (!wd.modes.includes(cmd.mode)) return 'Цей режим недоступний';
    const t = cmd.target.unitId ? unitById(s, cmd.target.unitId) : null;
    if (t && t.side !== v.side && !s.revealAll && !s.contacts[v.side][t.id]?.visible) return 'Ціль не видно';
    const cost = fireApCost(proxy, cmd.mode);
    if (g.ap < cost) return 'Недостатньо AP навідника';
    g.ap -= cost;
    losIgnore.ids.add(v.id);
    try {
      resolveFire(ctx, proxy, cmd.target, cmd.mode);
    } finally {
      losIgnore.ids.delete(v.id);
    }
    g.xp = proxy.xp;
    // Подія пострілу — від імені навідника; рендерер покаже її з техніки.
    return null;
  }

  private evacuateUnit(ctx: Ctx, t: Unit): void {
    const s = this.state;
    const wasDead = t.status === 'dead';
    t.status = 'evacuated';
    t.pos = null;
    ctx.ev.push({ t: 'evacuated', unitId: t.id });
    if (wasDead) {
      // Евакуйований загиблий дає нового бійця через кілька ходів.
      const r = generateUnit(t.side, t.classId, ctx.rng, (p) => newId(s, p));
      r.status = 'reserve';
      r.reserveTurn = s.turn.turn + s.scenario.reinforcementDelay;
      s.units.push(r);
    }
  }

  private move(ctx: Ctx, u: Unit, to: Cell, mode: MoveMode): string | null {
    const s = this.state;
    const M = content().rules.move;
    if (!canUseMode(u, mode)) return 'Швидкий рух — лише стоячи і без ноші';
    if (sameCell(u.pos!, to)) return null;
    const nodes = unitReachable(s, u, mode);
    const path = buildPath(nodes, to);
    if (!path) return 'Недосяжно з поточними AP';

    let segment: Cell[] = [u.pos!];
    const flush = () => {
      if (segment.length > 1) ctx.ev.push({ t: 'moved', unitId: u.id, path: segment, mode });
      segment = [u.pos!];
    };
    const knownBefore = new Set(Object.values(s.contacts[u.side]).filter((c) => c.visible).map((c) => c.unitId));

    for (let i = 1; i < path.length; i++) {
      const prev = path[i - 1];
      const next = path[i];
      const diag = prev.x !== next.x && prev.y !== next.y;
      const stairs = prev.z !== next.z;
      const cost = stepCost(mode, u.stance, diag, stairs);
      if (u.ap < cost || activeUnitAt(s, next)) break;
      u.ap -= cost;
      u.pos = { ...next };
      segment.push(u.pos);
      const slow = isSlowTerrain(s.map, next);
      u.stamina = Math.max(0, u.stamina - M.staminaPerCell[mode] - (slow ? M.slowTerrainStamina : 0) * (u.carrying ? 2 : 1));

      // Реакції противника (overwatch).
      const reacted = this.reactions(ctx, u, mode, slow, flush);
      if (!isActive(u)) break;
      updateContacts(ctx);
      const newContact = Object.values(s.contacts[u.side]).some((c) => c.visible && !knownBefore.has(c.unitId));
      if (newContact && i < path.length - 1) {
        float(ctx, u.id, 'Контакт!', 'bad');
        break;
      }
      if (reacted && u.suppression >= 60) break;
    }
    flush();
    return null;
  }

  /** Overwatch: противник з резервом AP може перервати рух. */
  private reactions(ctx: Ctx, mover: Unit, mode: MoveMode, slow: boolean, flush: () => void): boolean {
    const s = this.state;
    const O = content().rules.overwatch;
    let any = false;
    for (const o of s.units) {
      if (o.side === mover.side || !isActive(o) || o.overwatch <= 0 || o.panicked || !isActive(mover)) continue;
      const cost = fireApCost(o, 'snap');
      if (o.overwatch < cost || !o.inventory.primary?.magazine?.rounds) continue;
      const sight = canSee(s, o, mover);
      if (!sight.seen) continue;
      const wd = primaryDef(o)!;
      if (sight.distance > wd.range * 1.3) continue;
      let chance = O.baseChance + o.stats.reaction * O.reactionFactor;
      if (o.weaponState === 'high') chance += O.highReadyBonus;
      if (slow) chance += O.slowTerrainBonus;
      if (mode === 'fast') chance += O.fastTargetBonus;
      if (mode === 'careful') chance -= O.carefulTargetPenalty;
      chance = Math.max(5, Math.min(95, chance)) - o.suppression * 0.3;
      if (!ctx.rng.chance(chance)) continue;
      flush();
      o.overwatch -= cost;
      ctx.ev.push({ t: 'reaction', unitId: o.id, targetId: mover.id });
      float(ctx, o.id, 'Реакція!', 'bad');
      // Знання про ціль для реакції — пряма видимість.
      s.contacts[o.side][mover.id] = { unitId: mover.id, pos: { ...mover.pos! }, visible: true, identified: sight.identified, lastSeenTurn: s.turn.turn };
      resolveFire(ctx, o, { unitId: mover.id }, 'snap', { label: 'Реакція (overwatch)', value: -O.accuracyPenalty });
      any = true;
    }
    return any;
  }

  private beginSideTurn(ctx: Ctx, side: SideId): void {
    const s = this.state;
    const R = content().rules;
    s.turn.side = side;
    if (side === 'blue') decaySmoke(ctx);
    // Підкріплення.
    for (const r of sideUnits(s, side)) {
      if (r.status !== 'reserve' || (r.reserveTurn ?? 0) > s.turn.turn) continue;
      const zone = s.scenario.evacZone ?? s.scenario.sides[side].deployZone;
      const free = cellsInZone(s.map, zone).filter((c) => !activeUnitAt(s, c));
      if (!free.length) continue;
      r.status = 'active';
      r.pos = { ...ctx.rng.pick(free) };
      ctx.ev.push({ t: 'reinforcement', unitId: r.id });
      float(ctx, r.id, 'Підкріплення', 'good');
    }
    const casualtiesOnField = sideUnits(s, side).filter((x) => (x.status === 'dead' || x.status === 'down') && (x.pos || x.carriedBy)).length;
    for (const u of sideUnits(s, side)) {
      tickInjuries(ctx, u);
      if (!isAlive(u)) {
        u.ap = 0;
        continue;
      }
      u.overwatch = 0;
      u.stamina = Math.min(u.stats.stamina, u.stamina + R.stamina.recoverPerTurn - (u.weaponState === 'high' ? R.stamina.highReadyDrain : 0));
      let m = u.morale + R.morale.recoverPerTurn;
      if (u.suppression >= 50) m += R.morale.suppressedPerTurn;
      // Неевакуйовані втрати тиснуть на мораль, але не нижче порогу.
      if (m > R.morale.leftOnFieldFloor) m = Math.max(R.morale.leftOnFieldFloor, m + casualtiesOnField * R.morale.leftOnFieldPerTurn);
      u.morale = Math.max(0, Math.min(u.stats.morale, m));
      const ap = computeApMax(u);
      u.apMax = ap.total;
      u.ap = ap.total;
      u.suppression = Math.max(0, u.suppression - R.suppression.decayPerTurn);
      u.panicked = false;
      if (u.morale < R.morale.panicThreshold && ctx.rng.chance((R.morale.panicThreshold - u.morale) * R.morale.panicChancePerPoint)) {
        u.panicked = true;
        u.ap = 0;
        u.morale = Math.min(u.stats.morale, u.morale + R.morale.panicRecovery);
        if (!u.carrying && u.pos) u.stance = 'prone';
        ctx.ev.push({ t: 'panic', unitId: u.id });
        ctx.ev.push({ t: 'pose', unitId: u.id });
        float(ctx, u.id, 'Паніка!', 'bad');
      }
    }
    ctx.ev.push({ t: 'turn', turn: s.turn.turn, side });
  }

  private endTurn(ctx: Ctx): void {
    const s = this.state;
    for (const u of sideUnits(s, s.turn.side)) if (isAlive(u)) u.ap = 0;
    const next = other(s.turn.side);
    if (next === 'blue') s.turn.turn++;
    const max = s.scenario.maxTurns;
    if (max && s.turn.turn > max) {
      this.finish(ctx, null, 'turnLimit');
      return;
    }
    this.beginSideTurn(ctx, next);
  }

  private checkVictory(ctx: Ctx): void {
    const s = this.state;
    if (s.turn.phase !== 'battle') return;
    const alive = (side: SideId) => sideUnits(s, side).some((u) => isAlive(u) || u.status === 'reserve');
    const b = alive('blue');
    const r = alive('red');
    if (b && r) return;
    this.finish(ctx, b ? 'blue' : r ? 'red' : null, 'eliminated');
  }

  private finish(ctx: Ctx, winner: SideId | null, reason: 'eliminated' | 'withdrawal' | 'turnLimit'): void {
    const s = this.state;
    s.turn.phase = 'ended';
    for (const u of s.units) if (isAlive(u) || u.status === 'evacuated') u.xp += content().rules.xp.survive;
    s.result = computeResult(s, winner, reason);
    ctx.ev.push({ t: 'missionEnd', result: s.result });
  }
}

export const unitKey = (u: Unit) => (u.pos ? cellKey(u.pos) : '');
