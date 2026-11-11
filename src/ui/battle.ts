import { content, itemDef, vehicleDef } from '@/content';
import { dist2d, fmtAp, sameCell, type Cell } from '@/core/grid';
import { AiPlanner } from '@/game/ai/ai';
import { blindOrigin, canThrowTo, grenadeRange } from '@/game/combat/fire';
import { canLobTo, countDisposable, hasUnderbarrel, launcherOf, loadedAmmo, rocketStock, rpgScatter, uglAmmo, uglScatter } from '@/game/combat/launcher';
import { estimateHit, fireApCost } from '@/game/combat/hit';
import { adjacent, canUseMode, planPath, unitReachable } from '@/game/combat/movement';
import { ammoSummary, countItems, helmetMount, primaryDef } from '@/game/inventory/inventory';
import { modEffects, modNames } from '@/game/equipment/mods';
import { INJURY_NAMES, PART_NAMES, bleedingRate } from '@/game/injuries/injuries';
import { cellAt, cellsInZone, inZone, isIndoor } from '@/game/maps/map';
import { computeApMax } from '@/game/units/derived';
import { Mission } from '@/game/simulation/mission';
import type { Command } from '@/game/simulation/commands';
import { isActive, type SimEvent } from '@/game/simulation/state';
import type { FireMode, MoveMode, SideId, Stance, Unit, VehicleState, WeaponDefinition, WeaponState } from '@/game/types';
import type { Renderer } from '@/rendering/renderer';
import { bar, btn, h, keyName, modal } from './dom';
import { inventoryBody, medicalBody, statusName } from './panels';
import { SandboxPanel } from './sandboxPanel';
import { adjacentToVehicle, canMove, COMPONENT_NAMES, crew, crewProxy, exitCells, footprint, footprintAt, freeSeats, vehicleById, vehicleReachable, vehicles } from '@/game/vehicles';
import { losIgnore } from '@/game/visibility/los';

export type BattleMode = 'ai' | 'hotseat' | 'test';

type Pending =
  | { kind: 'move'; cell: Cell; path: Cell[]; cost: number }
  | { kind: 'fire'; targetId?: string; cell?: Cell }
  | { kind: 'throw'; cell: Cell }
  | { kind: 'launch'; cell: Cell; mode: 'rpg' | 'ugl' | 'disposable' }
  | { kind: 'vmove'; x: number; y: number; cost: number }
  | { kind: 'vfire'; targetId?: string; cell?: Cell }
  | { kind: 'disembark'; unitId: string; cell: Cell }
  | null;

const STANCE: Record<Stance, string> = { standing: 'Стоячи', crouched: 'Сидячи', prone: 'Лежачи' };
const WSTATE: Record<WeaponState, string> = { high: 'High ready', low: 'Low ready', carry: 'Вільне носіння' };
const MOVE: Record<MoveMode, string> = { fast: 'Швидко', standard: 'Стандартно', careful: 'Акуратно' };
const FIRE: Record<FireMode, string> = { snap: 'Навскид', burst: 'Черга', aimed: 'Прицільно', blind: 'Наосліп' };
const CLASS = () => content().classes;

export interface BattleHooks {
  onEnd: (m: Mission) => void;
  onMenu: () => void;
  autosave: (m: Mission) => void;
}

export class Battle {
  private hud: HTMLElement;
  private floats: HTMLElement;
  private sel: string | null = null;
  private moveMode: MoveMode = 'standard';
  private fireMode: FireMode | null = null;
  private throwGrenade: string | null = null;
  private openMenu: string | null = null;
  private launchMode: 'rpg' | 'ugl' | 'disposable' | null = null;
  private pending: Pending = null;
  private busy = false;
  private ai = new AiPlanner(Date.now() & 0xffff);
  private viewer: SideId;
  private ctxMenu: HTMLElement | null = null;
  private keyHandler: (e: KeyboardEvent) => void;
  private blurHandler = () => {
    this.keysDown.clear();
    this.updateKeyMove();
  };
  private disposed = false;
  private handover = false;
  private sandbox: SandboxPanel | null = null;
  private rain: HTMLElement | null = null;
  /** Вибрана техніка (замість бійця). */
  private selVehicle: string | null = null;
  private vFireMode: FireMode | null = null;
  private disembarkUnit: string | null = null;

  constructor(
    public root: HTMLElement,
    private r: Renderer,
    public m: Mission,
    private mode: BattleMode,
    private hooks: BattleHooks,
  ) {
    this.viewer = mode === 'ai' ? (m.s.controllers.blue === 'human' ? 'blue' : 'red') : m.s.turn.side;
    this.hud = h('div', { class: 'layer hud' });
    this.floats = h('div', { class: 'layer', style: 'pointer-events:none' });
    root.append(this.hud, this.floats);
    if (m.s.scenario.weather === 'rain') root.append((this.rain = h('div', { class: 'layer rain' })));
    r.load(m.s, this.viewer);
    r.setViewLevel(m.s.map.levels - 1);
    this.bindInput();
    this.keyHandler = (e) => this.onKey(e);
    window.addEventListener('keydown', this.keyHandler);
    window.addEventListener('keyup', this.keyHandler);
    window.addEventListener('blur', this.blurHandler);
    const first = this.myUnits().find((u) => u.pos) ?? this.myUnits()[0];
    if (first?.pos) r.focus(first.pos, false);
    if (m.s.turn.phase === 'deploy') this.sel = this.myUnits().find((u) => !u.pos)?.id ?? null;
    else this.sel = first?.id ?? null;
    this.refresh();
    if (m.s.turn.phase === 'battle' && this.isAiTurn()) void this.runAi();
  }

  dispose(): void {
    this.disposed = true;
    window.removeEventListener('keydown', this.keyHandler);
    window.removeEventListener('keyup', this.keyHandler);
    window.removeEventListener('blur', this.blurHandler);
    this.r.keyMove.x = this.r.keyMove.y = this.r.keyMove.rot = 0;
    this.hud.remove();
    this.floats.remove();
    this.rain?.remove();
    this.ctxMenu?.remove();
  }

  // ---------- Допоміжне ----------

  private get s() {
    return this.m.s;
  }

  private myUnits(): Unit[] {
    return this.s.units.filter((u) => u.side === this.viewer && u.status !== 'reserve');
  }

  private selected(): Unit | null {
    return this.sel ? this.s.units.find((u) => u.id === this.sel) ?? null : null;
  }

  private isHumanTurn(): boolean {
    return this.s.turn.phase !== 'ended' && this.s.controllers[this.s.turn.side] === 'human' && this.s.turn.side === this.viewer && !this.handover;
  }

  private isAiTurn(): boolean {
    return this.s.turn.phase === 'battle' && this.s.controllers[this.s.turn.side] === 'ai';
  }

  private toast(text: string): void {
    const t = h('div', { class: 'toast' }, text);
    this.hud.append(t);
    setTimeout(() => t.remove(), 2200);
  }

  private float = (e: Extract<SimEvent, { t: 'float' }>): void => {
    const u = this.s.units.find((x) => x.id === e.unitId);
    if (!u?.pos) return;
    if (u.side !== this.viewer && !this.s.contacts[this.viewer][u.id]?.visible && !this.s.revealAll) return;
    const p = this.r.unitScreenPos(u.id);
    if (!p) return;
    const el = h('div', { class: `floater ${e.kind}`, style: `left:${p.x}px;top:${p.y}px` }, e.text);
    this.floats.append(el);
    setTimeout(() => el.remove(), 1400);
  };

  // ---------- Команди ----------

  /** Надіслати команду в симуляцію і програти анімації. */
  private async exec(cmd: Command): Promise<boolean> {
    const res = this.m.dispatch(cmd);
    if (!res.ok) {
      this.toast(res.error);
      return false;
    }
    this.pending = null;
    this.busy = true;
    this.r.setPath([], [1, 1, 1]);
    this.refresh();
    await this.r.play(res.events, this.float);
    this.busy = false;
    if (this.disposed) return true;
    const end = res.events.find((e) => e.t === 'missionEnd');
    if (end) {
      this.refresh();
      setTimeout(() => this.hooks.onEnd(this.m), 900);
      return true;
    }
    this.autoView();
    this.refresh();
    return true;
  }

  private async endTurn(): Promise<void> {
    if (!this.isHumanTurn() || this.busy) return;
    this.fireMode = null;
    this.throwGrenade = null;
    this.launchMode = null;
    await this.exec({ type: 'endTurn' });
    if (this.s.turn.phase !== 'battle') return;
    if (this.isAiTurn()) await this.runAi();
    else if (this.mode !== 'ai') this.startHandover();
  }

  private async runAi(): Promise<void> {
    const side = this.s.turn.side;
    const banner = h('div', { class: `banner ${side}` }, 'Хід противника…');
    this.hud.append(banner);
    this.busy = true;
    this.refresh();
    let guard = 0;
    while (!this.disposed && this.s.turn.phase === 'battle' && this.s.turn.side === side && guard++ < 400) {
      const cmd = this.ai.next(this.s);
      if (!cmd) break;
      const res = this.m.dispatch(cmd);
      if (!res.ok) {
        if ('unitId' in cmd) this.ai.reject(cmd.unitId);
        else if ('vehicleId' in cmd) this.ai.reject(cmd.vehicleId);
        else break;
        continue;
      }
      await this.r.play(res.events, this.float);
      this.refreshLight();
      if (res.events.some((e) => e.t === 'missionEnd')) {
        banner.remove();
        this.busy = false;
        setTimeout(() => this.hooks.onEnd(this.m), 900);
        return;
      }
    }
    banner.remove();
    this.busy = false;
    if (this.disposed) return;
    const mine = this.myUnits().find((u) => isActive(u));
    if (mine) this.sel = mine.id;
    this.hooks.autosave(this.m);
    this.autoView();
    this.refresh();
    if (this.isAiTurn()) void this.runAi();
  }

  private startHandover(): void {
    const side = this.s.turn.side;
    this.handover = true;
    this.viewer = side;
    if (this.mode === 'hotseat') this.r.load(this.s, side);
    else {
      this.r.viewSide = side;
      this.r.sync();
    }
    this.sel = this.myUnits().find((u) => isActive(u))?.id ?? null;
    this.refresh();
    if (this.mode === 'test') {
      this.handover = false;
      this.refresh();
      return;
    }
    const name = this.s.scenario.sides[side].name;
    const back = h('div', { class: 'modal-back', style: 'background:#0b0d10' });
    back.append(
      h('div', { class: 'panel col', style: 'text-align:center;padding:24px' }, h('h2', {}, `Передайте пристрій: ${name}`), btn('Почати хід', () => {
        back.remove();
        this.handover = false;
        this.refresh();
      }, { cls: 'primary' })),
    );
    this.hud.append(back);
  }

  // ---------- Введення ----------

  /**
   * Керування камерою: миша — ліва кнопка обертає/нахиляє, права або середня зсуває, колесо — масштаб;
   * дотик — один палець зсуває, два пальці — масштаб і обертання; клавіші — WASD/стрілки зсув, Q/E обертання.
   */
  private bindInput(): void {
    const canvas = this.r.engine.getRenderingCanvas()!;
    const pointers = new Map<number, { x: number; y: number }>();
    let downAt: { x: number; y: number; button: number; type: string } | null = null;
    let dragged = false;
    let pinch = 0;
    let twist = 0;
    let longTimer: number | null = null;

    const pos = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const two = () => {
      const [a, b] = [...pointers.values()];
      return { d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x) };
    };
    canvas.addEventListener('pointerdown', (e) => {
      if (this.disposed) return;
      this.closeCtx();
      canvas.setPointerCapture(e.pointerId);
      const p = pos(e);
      pointers.set(e.pointerId, p);
      if (pointers.size === 1) {
        downAt = { ...p, button: e.button, type: e.pointerType };
        dragged = false;
        if (e.pointerType !== 'mouse') {
          longTimer = window.setTimeout(() => {
            if (!dragged && downAt) {
              dragged = true;
              this.openCtx(downAt.x, downAt.y);
            }
          }, 550);
        }
      } else if (pointers.size === 2) {
        const t = two();
        pinch = t.d;
        twist = t.ang;
        dragged = true;
        if (longTimer) clearTimeout(longTimer);
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      const p = pos(e);
      const prev = pointers.get(e.pointerId);
      if (!prev) {
        if (e.pointerType === 'mouse') this.hover(p.x, p.y);
        return;
      }
      pointers.set(e.pointerId, p);
      if (pointers.size === 2) {
        const t = two();
        if (pinch > 0) this.r.zoomBy(pinch / t.d);
        let da = t.ang - twist;
        if (da > Math.PI) da -= Math.PI * 2;
        if (da < -Math.PI) da += Math.PI * 2;
        this.r.camera.alpha -= da;
        pinch = t.d;
        twist = t.ang;
        return;
      }
      if (downAt && Math.hypot(p.x - downAt.x, p.y - downAt.y) > 6) dragged = true;
      if (!dragged) return;
      if (longTimer) clearTimeout(longTimer);
      const dx = p.x - prev.x;
      const dy = p.y - prev.y;
      if (downAt?.type === 'mouse' && downAt.button === 0 && !e.shiftKey) this.r.orbit(dx, dy);
      else this.r.pan(dx, dy);
    });
    const up = (e: PointerEvent) => {
      if (longTimer) clearTimeout(longTimer);
      const had = pointers.delete(e.pointerId);
      if (!had) return;
      if (pointers.size === 0 && downAt) {
        if (!dragged && downAt.button === 2) this.openCtx(downAt.x, downAt.y);
        else if (!dragged) this.click(downAt.x, downAt.y);
        downAt = null;
      }
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', (e) => {
      pointers.delete(e.pointerId);
      if (longTimer) clearTimeout(longTimer);
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.r.zoomBy(e.deltaY > 0 ? 1.1 : 0.9);
    }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private keysDown = new Set<string>();

  private updateKeyMove(): void {
    const k = this.keysDown;
    const has = (...names: string[]) => names.some((n) => k.has(n));
    this.r.keyMove.x = (has('d', 'arrowright') ? 1 : 0) - (has('a', 'arrowleft') ? 1 : 0);
    this.r.keyMove.y = (has('w', 'arrowup') ? 1 : 0) - (has('s', 'arrowdown') ? 1 : 0);
    this.r.keyMove.rot = (has('e') ? 1 : 0) - (has('q') ? 1 : 0);
  }

  private onKey(e: KeyboardEvent): void {
    if (this.disposed || (e.target as HTMLElement)?.tagName === 'INPUT') return;
    const k = keyName(e);
    if (e.type === 'keyup') {
      this.keysDown.delete(k);
      this.updateKeyMove();
      return;
    }
    if (['w', 'a', 's', 'd', 'q', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
      e.preventDefault();
      this.keysDown.add(k);
      this.updateKeyMove();
    } else if (k === 'pageup') this.changeLevel(1);
    else if (k === 'pagedown') this.changeLevel(-1);
    else if (k === 'escape') this.cancel();
    else if (k === 'enter') void this.confirm();
    else if (k === 'tab') {
      e.preventDefault();
      this.cycleUnit();
    }
  }

  private changeLevel(d: number): void {
    this.r.setViewLevel(this.r.viewLevel + d);
    this.r.sync();
    this.refresh();
  }

  /** Автоматичний поверх: якщо вибраний боєць у будівлі — показуємо його поверх (стіни прозорі). */
  private autoView(): void {
    const u = this.selected();
    if (u?.pos && isIndoor(this.s.map, u.pos)) this.r.setViewLevel(u.pos.z);
    else this.r.setViewLevel(this.s.map.levels - 1);
    this.r.sync();
  }

  private cycleUnit(): void {
    const list = this.myUnits().filter((u) => isActive(u));
    if (!list.length) return;
    const i = list.findIndex((u) => u.id === this.sel);
    this.selectUnit(list[(i + 1) % list.length]);
  }

  private selectUnit(u: Unit): void {
    if (u.inVehicle) return this.selectVehicle(u.inVehicle);
    this.selVehicle = null;
    this.sel = u.id;
    this.pending = null;
    this.fireMode = null;
    this.throwGrenade = null;
    this.launchMode = null;
    if (u.pos) this.r.focus(u.pos);
    this.autoView();
    this.refresh();
  }

  private hover(x: number, y: number): void {
    if (this.busy || this.pending) return;
    const cell = this.r.pickCell(x, y);
    const u = this.selected();
    this.r.setCursor(cell);
    if (!cell || !u?.pos || !this.isHumanTurn() || this.s.turn.phase !== 'battle' || this.fireMode || this.throwGrenade || this.launchMode) {
      this.r.setPath([], [1, 1, 1]);
      return;
    }
    const plan = planPath(this.s, u, cell, this.moveMode);
    this.r.setPath(plan?.path ?? [], plan && u.ap - plan.cost >= fireApCost(u, 'snap') ? [0.4, 0.75, 1] : [1, 0.8, 0.3]);
  }

  private click(x: number, y: number): void {
    if (this.busy) return;
    const unitId = this.r.pickUnit(x, y);
    const cell = this.r.pickCell(x, y);
    if (this.sandbox && this.sandbox.click(unitId, cell)) return;
    const s = this.s;
    const vehId = this.r.pickVehicle(x, y);
    const clickedVeh = vehId ? vehicleById(s, vehId) : undefined;
    if (s.turn.phase === 'battle' && this.vehicleClick(clickedVeh, unitId, cell)) return;
    let clickedUnit = unitId ? s.units.find((u) => u.id === unitId) ?? null : null;
    // Тіла («200») і непритомні не перехоплюють клік: клітинка з ними — звичайна ціль руху.
    if (clickedUnit && clickedUnit.status !== 'active') clickedUnit = null;
    // Клік по клітинці, де стоїть свій боєць, теж вибирає його.
    if (!clickedUnit && cell) clickedUnit = s.units.find((u) => u.side === this.viewer && u.status === 'active' && u.pos && sameCell(u.pos, cell)) ?? null;

    if (s.turn.phase === 'deploy') {
      if (clickedUnit && clickedUnit.side === this.viewer) {
        this.sel = clickedUnit.id;
        this.refresh();
        return;
      }
      const u = this.selected();
      if (u && cell) {
        const res = this.m.dispatch({ type: 'deploy', unitId: u.id, cell });
        if (!res.ok) this.toast(res.error);
        else {
          this.r.sync();
          const next = this.myUnits().find((x) => !x.pos);
          if (next) this.sel = next.id;
        }
        this.refresh();
      }
      return;
    }

    if (clickedUnit && clickedUnit.side === this.viewer && clickedUnit.status === 'active') {
      if (this.sel !== clickedUnit.id) this.selectUnit(clickedUnit);
      return;
    }
    if (!this.isHumanTurn()) return;
    const u = this.selected();
    if (!u || !isActive(u)) return;

    // Гранатомет: ціль — клітинка або клітинка бійця.
    if (this.launchMode) {
      const target = clickedUnit?.pos ?? cell;
      if (!target) return;
      if (this.pending?.kind === 'launch' && sameCell(this.pending.cell, target)) void this.confirm();
      else {
        this.pending = { kind: 'launch', cell: target, mode: this.launchMode };
        this.r.setCursor(target, [1, 0.35, 0.15]);
        this.refresh();
      }
      return;
    }
    // Ціль — ворожий боєць.
    if (clickedUnit && clickedUnit.side !== u.side) {
      if (!this.fireMode) this.fireMode = primaryDef(u)?.modes[0] ?? 'snap';
      if (this.pending?.kind === 'fire' && this.pending.targetId === clickedUnit.id) {
        void this.confirm();
        return;
      }
      this.pending = { kind: 'fire', targetId: clickedUnit.id };
      this.refresh();
      return;
    }
    if (!cell) return;
    if (this.throwGrenade) {
      if (this.pending?.kind === 'throw' && sameCell(this.pending.cell, cell)) void this.confirm();
      else {
        this.pending = { kind: 'throw', cell };
        this.r.setCursor(cell, [1, 0.5, 0.2]);
        this.refresh();
      }
      return;
    }
    if (this.fireMode) {
      // Вільне наведення в точку.
      if (this.pending?.kind === 'fire' && this.pending.cell && sameCell(this.pending.cell, cell)) void this.confirm();
      else {
        this.pending = { kind: 'fire', cell };
        this.r.setCursor(cell, [1, 0.3, 0.3]);
        this.refresh();
      }
      return;
    }
    // Рух: перший дотик — план, другий — підтвердження.
    if (this.pending?.kind === 'move' && sameCell(this.pending.cell, cell)) {
      void this.confirm();
      return;
    }
    const plan = planPath(s, u, cell, this.moveMode);
    if (!plan) {
      this.toast(canUseMode(u, this.moveMode) ? 'Недосяжно' : 'Цей режим руху зараз недоступний');
      return;
    }
    this.pending = { kind: 'move', cell, path: plan.path, cost: plan.cost };
    this.r.setPath(plan.path, u.ap - plan.cost >= fireApCost(u, 'snap') ? [0.4, 0.75, 1] : [1, 0.8, 0.3]);
    this.r.setCursor(cell, [1, 1, 0.4]);
    this.refresh();
  }

  private cancel(): void {
    this.closeCtx();
    this.openMenu = null;
    if (this.pending) this.pending = null;
    else {
      this.fireMode = null;
      this.vFireMode = null;
      this.disembarkUnit = null;
      this.throwGrenade = null;
    this.launchMode = null;
    }
    this.r.setPath([], [1, 1, 1]);
    this.r.setCursor(null);
    this.refresh();
  }

  private async confirm(): Promise<void> {
    const p0 = this.pending;
    const v0 = this.selectedVehicle();
    if (v0 && p0 && !this.busy) {
      if (p0.kind === 'vmove') await this.exec({ type: 'vehicleMove', vehicleId: v0.id, x: p0.x, y: p0.y });
      else if (p0.kind === 'vfire') await this.exec({ type: 'vehicleFire', vehicleId: v0.id, target: p0.targetId ? { unitId: p0.targetId } : { cell: p0.cell }, mode: this.vFireMode ?? 'snap' });
      else if (p0.kind === 'disembark') {
        if (await this.exec({ type: 'disembark', unitId: p0.unitId, cell: p0.cell })) this.disembarkUnit = null;
      }
      this.r.setCursor(null);
      this.refresh();
      return;
    }
    const u = this.selected();
    const p = this.pending;
    if (!u || !p || this.busy) return;
    if (p.kind === 'move') await this.exec({ type: 'move', unitId: u.id, to: p.cell, mode: this.moveMode });
    else if (p.kind === 'fire') await this.exec({ type: 'fire', unitId: u.id, target: p.targetId ? { unitId: p.targetId } : { cell: p.cell }, mode: this.fireMode ?? 'snap' });
    else if (p.kind === 'launch') {
      if (await this.exec({ type: 'launch', unitId: u.id, kind: p.mode, cell: p.cell })) this.launchMode = null;
    } else if (p.kind === 'throw') {
      if (await this.exec({ type: 'throw', unitId: u.id, cell: p.cell, grenade: this.throwGrenade ?? undefined })) this.throwGrenade = null;
    }
    this.r.setCursor(null);
    this.refresh();
  }

  // ---------- Контекстне меню ----------

  private closeCtx(): void {
    this.ctxMenu?.remove();
    this.ctxMenu = null;
  }

  private openCtx(x: number, y: number): void {
    this.closeCtx();
    const u = this.selected();
    if (!u || !this.isHumanTurn() || this.s.turn.phase !== 'battle' || !isActive(u)) return;
    const unitId = this.r.pickUnit(x, y);
    const target = unitId ? this.s.units.find((t) => t.id === unitId) : undefined;
    const items: [string, () => void][] = [];
    const run = (c: Command) => () => {
      this.closeCtx();
      void this.exec(c);
    };
    for (const st of ['standing', 'crouched', 'prone'] as Stance[]) if (st !== u.stance) items.push([`Позиція: ${STANCE[st]}`, run({ type: 'stance', unitId: u.id, stance: st })]);
    for (const ws of ['high', 'low', 'carry'] as WeaponState[]) if (ws !== u.weaponState) items.push([`Зброя: ${WSTATE[ws]}`, run({ type: 'weaponState', unitId: u.id, state: ws })]);
    items.push(['Перезарядити', run({ type: 'reload', unitId: u.id })]);
    items.push(['Спостереження (overwatch)', run({ type: 'overwatch', unitId: u.id })]);
    // Пораненого/загиблого шукаємо під курсором або в клітинці.
    const cell = this.r.pickCell(x, y);
    const casualty =
      target && target.side === u.side && target.status !== 'active'
        ? target
        : cell
          ? this.s.units.find((t) => t.side === u.side && t.pos && sameCell(t.pos, cell) && (t.status === 'down' || t.status === 'dead'))
          : undefined;
    if (casualty && !u.carrying) items.push([`Підняти: ${casualty.callsign}`, run({ type: 'pickUp', unitId: u.id, targetId: casualty.id })]);
    if (u.carrying) items.push(['Покласти пораненого', run({ type: 'drop', unitId: u.id })]);
    if (inZone(u.pos!, this.s.scenario.evacZone)) items.push([u.carrying ? 'Евакуювати пораненого' : 'Евакуюватися', run({ type: 'evacuate', unitId: u.id })]);
    items.push(['Медицина…', () => (this.closeCtx(), this.openMedical(casualty?.id ?? (target?.side === u.side ? target.id : undefined)))]);
    items.push(['Інвентар…', () => (this.closeCtx(), this.openInventory())]);
    const menu = h('div', { class: 'ctxmenu panel', style: `left:${Math.min(x, window.innerWidth - 220)}px;top:${Math.min(y, window.innerHeight - 40 * items.length - 20)}px` });
    for (const [label, fn] of items) menu.append(btn(label, fn));
    this.ctxMenu = menu;
    this.hud.append(menu);
  }

  private openMedical(patientId?: string): void {
    const u = this.selected();
    if (!u) return;
    let back: HTMLElement | null = null;
    const render = (pid?: string) => {
      back?.remove();
      const body = medicalBody(this.s, u, (c) => {
        const res = this.m.dispatch(c);
        if (!res.ok) this.toast(res.error);
        else void this.r.play(res.events, this.float);
        this.refresh();
        return res.ok;
      }, render, pid);
      back = modal('Медицина', body, () => this.refresh());
      this.hud.append(back);
    };
    render(patientId);
  }

  private toggleSandbox(): void {
    if (this.sandbox) {
      this.sandbox.el.remove();
      this.sandbox = null;
    } else {
      this.sandbox = new SandboxPanel(this.m, (full) => {
        if (full) this.r.load(this.s, this.viewer, true);
        this.r.sync();
        this.refresh();
      }, (t) => this.toast(t));
    }
    this.refresh();
  }

  private openInventory(): void {
    const u = this.selected();
    if (!u) return;
    this.hud.append(modal(`Інвентар — ${u.name}`, inventoryBody(u), () => {}));
  }

  // ---------- Відображення ----------

  /** Легке оновлення під час ходу AI. */
  private refreshLight(): void {
    this.r.setGhosts(this.ghostCells());
    this.renderTop();
  }

  private ghostCells(): Cell[] {
    if (this.s.revealAll) return [];
    return Object.values(this.s.contacts[this.viewer])
      .filter((c) => !c.visible && this.s.units.find((u) => u.id === c.unitId && isActive(u)))
      .map((c) => c.pos);
  }

  private overlays(): void {
    const s = this.s;
    const r = this.r;
    if (this.selVehicle && s.turn.phase === 'battle') return this.vehicleOverlays();
    const u = this.selected();
    r.select(u && u.pos && u.status === 'active' ? u : null);
    r.setGhosts(this.ghostCells());
    if (s.turn.phase === 'deploy') {
      r.setOverlay('reach', cellsInZone(s.map, s.scenario.sides[this.viewer].deployZone).map((cell) => ({ cell, color: [0.3, 0.9, 0.4] })));
      r.setOverlay('zone', []);
      return;
    }
    if (s.scenario.evacZone) {
      const cells: Cell[] = [];
      const [x0, y0, x1, y1] = s.scenario.evacZone;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (cellAt(s.map, { x, y, z: 0 })?.floor) cells.push({ x, y, z: 0 });
      r.setOverlay('zone', cells.map((cell) => ({ cell, color: [0.3, 0.85, 0.95] })), { height: 0.025, size: 0.96, alpha: 0.25 });
    }
    if (!u?.pos || !isActive(u) || !this.isHumanTurn() || this.busy) {
      r.setOverlay('reach', []);
      return;
    }
    if (this.throwGrenade) {
      const gid = this.throwGrenade;
      const cells: Cell[] = [];
      const rng = Math.ceil(grenadeRange(u, gid));
      for (let y = u.pos.y - rng; y <= u.pos.y + rng; y++)
        for (let x = u.pos.x - rng; x <= u.pos.x + rng; x++) {
          const c = { x, y, z: u.pos.z };
          if (canThrowTo({ s }, u, c, gid)) cells.push(c);
        }
      r.setOverlay('reach', cells.map((cell) => ({ cell, color: [1, 0.55, 0.2] })), { alpha: 0.3 });
      return;
    }
    if (this.launchMode === 'ugl') {
      const cells: Cell[] = [];
      const rng = content().rules.launcher.uglRange;
      for (let y = u.pos.y - rng; y <= u.pos.y + rng; y++)
        for (let x = u.pos.x - rng; x <= u.pos.x + rng; x++) {
          const c = { x, y, z: u.pos.z };
          if (canLobTo(s, u, c)) cells.push(c);
        }
      r.setOverlay('reach', cells.map((cell) => ({ cell, color: [1, 0.4, 0.2] as [number, number, number] })), { alpha: 0.25 });
      return;
    }
    if (this.fireMode || this.launchMode) {
      r.setOverlay('reach', []);
      return;
    }
    const nodes = unitReachable(s, u, this.moveMode);
    const snap = fireApCost(u, 'snap');
    const cells = [...nodes.values()].filter((n) => n.cost > 0).map((n) => ({ cell: n.cell, color: (u.ap - n.cost >= snap ? [0.25, 0.55, 1] : [1, 0.75, 0.2]) as [number, number, number] }));
    r.setOverlay('reach', cells.filter((c) => c.cell.z <= r.viewLevel), { alpha: 0.32 });
  }

  refresh(): void {
    if (this.disposed) return;
    this.overlays();
    this.hud.querySelectorAll('[data-part]').forEach((e) => e.remove());
    this.renderTop();
    this.renderList();
    this.renderStatus();
    this.renderActions();
    this.renderHit();
    if (this.sandbox) this.hud.append(this.sandbox.el);
  }

  private renderTop(): void {
    this.hud.querySelector('[data-part=top]')?.remove();
    const s = this.s;
    const side = s.turn.side;
    const label =
      s.turn.phase === 'deploy'
        ? 'Розгортання'
        : s.turn.phase === 'ended'
          ? 'Бій завершено'
          : `Хід ${s.turn.turn} · ${s.scenario.sides[side].name}${s.controllers[side] === 'ai' ? ' (AI)' : ''}${s.scenario.timeOfDay === 'night' ? ' · ніч' : ''}${s.scenario.weather === 'fog' ? ' · туман' : s.scenario.weather === 'rain' ? ' · дощ' : ''}`;
    const top = h(
      'div',
      { class: 'topbar', 'data-part': 'top' },
      h('div', { class: `turn-label ${side}` }, label),
      h(
        'div',
        { class: 'row' },
        btn('⟲', () => this.r.rotate(-1), { title: 'Повернути камеру (Q, або перетягніть лівою кнопкою миші)' }),
        btn('⟳', () => this.r.rotate(1), { title: 'Повернути камеру (E)' }),
        btn('▼', () => this.changeLevel(-1), { title: 'Поверх нижче (PgDn)' }),
        h('span', { class: 'turn-label' }, `Поверх ${this.r.viewLevel + 1}`),
        btn('▲', () => this.changeLevel(1), { title: 'Поверх вище (PgUp)' }),
        btn('＋', () => this.r.zoomBy(0.85), { title: 'Наблизити' }),
        btn('－', () => this.r.zoomBy(1.15), { title: 'Віддалити' }),
        this.mode === 'test' ? btn('Пісочниця', () => this.toggleSandbox(), { on: !!this.sandbox }) : null,
        btn('☰', () => this.hooks.onMenu(), { title: 'Меню' }),
      ),
    );
    this.hud.append(top);
  }

  private renderList(): void {
    const list = h('div', { class: 'unitlist', 'data-part': 'list' });
    for (const v of vehicles(this.s).filter((x) => x.side === this.viewer && !x.destroyed)) {
      const d = vehicleDef(v.defId);
      list.append(
        h(
          'div',
          { class: `ucard${this.selVehicle === v.id ? ' sel' : ''}`, onclick: () => this.selectVehicle(v.id) },
          h('div', { class: 'nm' }, d.name, ' ', h('span', { class: 'muted' }, `екіпаж ${crew(this.s, v).length}`)),
          bar(v.hp.hull, d.components.hull, v.hp.hull < d.components.hull * 0.4 ? 'var(--bad)' : '#8aa0b0'),
        ),
      );
    }
    for (const u of this.myUnits()) {
      const cls = CLASS().get(u.classId)?.name ?? u.classId;
      const card = h(
        'div',
        { class: `ucard${u.id === this.sel ? ' sel' : ''}${isActive(u) || (this.s.turn.phase === 'deploy') ? '' : ' dim'}`, onclick: () => (this.s.turn.phase === 'deploy' ? ((this.sel = u.id), this.refresh()) : u.pos && this.selectUnit(u)) },
        h('div', { class: 'nm' }, `${u.callsign} `, h('span', { class: 'muted' }, cls)),
        this.s.turn.phase === 'deploy'
          ? h('div', { class: 'muted' }, u.pos ? 'Розгорнуто' : 'Не розгорнуто')
          : h('div', { class: 'muted', style: 'font-size:0.85em' }, u.status === 'active' ? `AP ${fmtAp(u.ap)}${u.overwatch ? ' · спостереження' : ''}${u.panicked ? ' · паніка' : ''}` : statusName(u.status)),
        bar(u.health, u.stats.health, u.health < u.stats.health * 0.4 ? 'var(--bad)' : 'var(--good)'),
        this.s.turn.phase === 'battle' ? bar(u.ap, u.apMax, 'var(--accent)') : null,
      );
      list.append(card);
    }
    this.hud.append(list);
  }

  private renderStatus(): void {
    if (this.selVehicle) return this.renderVehicleStatus();
    const u = this.selected();
    if (!u || this.s.turn.phase === 'deploy' && !u) return;
    const ammo = ammoSummary(u);
    const wd = primaryDef(u);
    const apInfo = computeApMax(u);
    const chips: HTMLElement[] = [];
    for (const i of u.injuries) {
      const bad = i.bleeding === 'massive' || (i.type === 'pneumothorax' && !i.sealed);
      chips.push(h('span', { class: `chip ${bad ? 'bad' : 'warn'}` }, `${PART_NAMES[i.part]}: ${INJURY_NAMES[i.type]}${i.bleeding !== 'none' ? ' 🩸' : ''}`));
    }
    if (u.suppression >= 25) chips.push(h('span', { class: 'chip warn' }, `Придушення ${u.suppression}`));
    if (u.panicked) chips.push(h('span', { class: 'chip bad' }, 'Паніка'));
    if (u.carrying) chips.push(h('span', { class: 'chip' }, 'Несе пораненого'));
    const nvg = helmetMount(u, 'nvg');
    if (nvg) chips.push(h('span', { class: 'chip' }, nvg.name));
    if (u.lightOn) chips.push(h('span', { class: 'chip warn' }, 'Ліхтар увімкнено'));
    const meds = countItems(u, (d) => d.kind === 'medical');
    const nades = countItems(u, (d) => d.kind === 'grenade');
    const row = (k: string, v: Node | string) => [h('span', { class: 'muted' }, k), typeof v === 'string' ? h('span', {}, v) : v];
    const panel = h(
      'div',
      { class: 'status panel', 'data-part': 'status' },
      h('div', { class: 'nm', style: 'font-weight:700' }, `${u.name} «${u.callsign}»`),
      h('div', { class: 'muted', style: 'margin-bottom:6px' }, `${CLASS().get(u.classId)?.name} · ${statusName(u.status)}`),
      h(
        'div',
        { class: 'grid2' },
        ...row('Здоров’я', h('span', {}, `${u.health}/${u.stats.health}`, bar(u.health, u.stats.health, 'var(--good)'))),
        ...row('Витривалість', h('span', {}, `${u.stamina}/${u.stats.stamina}`, bar(u.stamina, u.stats.stamina, '#5aa0d8'))),
        ...row('Мораль', h('span', {}, `${u.morale}/${u.stats.morale}`, bar(u.morale, u.stats.morale, '#b07ad8'))),
        ...row('AP', h('span', { title: apInfo.parts.map((p) => `${p.label}: ${p.value > 0 ? '+' : ''}${p.value}`).join('\n') }, `${fmtAp(u.ap)} / ${fmtAp(u.apMax || apInfo.total)}${u.overwatch ? ` (резерв ${fmtAp(u.overwatch)})` : ''}`)),
        ...row('Зброя', wd ? `${wd.name}${u.inventory.primary?.mods.length ? ` (${modNames(u.inventory.primary)})` : ''}` : '—'),
        ...row('БК', `${ammo.loaded}/${ammo.capacity} · запас ${ammo.spareMags} маг. (${ammo.spareRounds})`),
        ...row('Позиція', `${STANCE[u.stance]} · ${WSTATE[u.weaponState]}`),
        ...row('Медицина / гранати', `${meds} / ${nades}`),
        ...(bleedingRate(u) ? row('Кровотеча', h('span', { class: 'neg' }, `−${bleedingRate(u)} за хід`)) : []),
      ),
      h('div', { class: 'chips' }, ...chips),
    );
    this.hud.append(panel);
  }

  private renderHit(): void {
    if (this.selVehicle) return this.renderVehicleHit();
    const u = this.selected();
    const p = this.pending;
    if (!u?.pos || !p) return;
    let content2: HTMLElement | null = null;
    if (p.kind === 'fire') {
      const mode = this.fireMode ?? 'snap';
      const cost = fireApCost(u, mode);
      if (p.targetId) {
        const t = this.s.units.find((x) => x.id === p.targetId)!;
        if (!t.pos) return;
        const from = mode === 'blind' ? blindOrigin({ s: this.s }, u, t.pos) : u.pos;
        const est = estimateHit(this.s, u, t, mode, { from, stance: mode === 'blind' ? 'standing' : u.stance, identified: this.s.contacts[u.side][t.id]?.identified ?? true });
        const known = t.side === u.side || this.s.contacts[u.side][t.id]?.identified || this.s.revealAll;
        content2 = h(
          'div',
          {},
          h('div', { class: 'muted' }, `${FIRE[mode]} · ${fmtAp(cost)} AP · ${known ? `${t.callsign}` : 'невідома ціль'}${t.side === u.side ? ' (СВІЙ!)' : ''}`),
          h('div', { class: 'big' }, est.lineOfFire || mode === 'blind' ? `${est.chance}%` : 'Немає лінії вогню'),
          h('div', { class: 'factors' }, ...est.factors.flatMap((f) => [h('span', {}, f.label), h('span', { class: f.value >= 0 ? 'pos' : 'neg' }, `${f.value > 0 ? '+' : ''}${f.value}`)])),
          mode === 'burst' ? h('div', { class: 'muted' }, `Кожна наступна куля черги: −${Math.max(2, content().rules.fire.burstShotPenalty + (primaryDef(u)?.recoil ?? 0) + modEffects(u.inventory.primary).recoil)}%`) : null,
        );
      } else if (p.cell) {
        content2 = h('div', {}, h('div', { class: 'muted' }, `${FIRE[mode]} · ${fmtAp(cost)} AP`), h('div', { class: 'big' }, 'Вільний вогонь'), h('div', { class: 'muted' }, 'Куля летить у точку й уражає все на шляху.'));
      }
    } else if (p.kind === 'move') {
      content2 = h('div', {}, h('div', { class: 'muted' }, MOVE[this.moveMode]), h('div', { class: 'big' }, `${fmtAp(p.cost)} AP`), h('div', { class: 'muted' }, `Залишиться ${fmtAp(u.ap - p.cost)} AP · ${p.path.length - 1} кл.`));
    } else if (p.kind === 'launch') {
      const L = content().rules.launcher;
      const sc = p.mode === 'ugl' ? uglScatter(u, p.cell) : rpgScatter(u, p.cell);
      const d = dist2d(u.pos, p.cell);
      content2 = h(
        'div',
        {},
        h('div', { class: 'muted' }, p.mode === 'rpg' ? 'РПГ-7 · прямий постріл' : p.mode === 'disposable' ? 'Bulspike · одноразовий, прямий постріл' : 'Підствольник · навісний постріл'),
        h('div', { class: 'big' }, `${fmtAp((p.mode === 'ugl' ? L.uglAp : L.rpgAp) * 10)} AP`),
        h('div', { class: 'muted' }, `Відстань ${d.toFixed(1)} кл. · відхилення ≈ ${sc.toFixed(1)} кл.`),
        p.mode !== 'ugl' && d < L.armDistance ? h('div', { class: 'neg' }, 'Замало — підривник не встигне звестися') : null,
        h('div', { class: 'muted' }, p.mode !== 'ugl' ? 'Вибухає при першому влучанні: боєць, стіна або земля. Пробиває тонкі стіни.' : 'Осколковий вибух у точці падіння.'),
      );
    } else if (p.kind === 'throw') {
      content2 = h('div', {}, h('div', { class: 'muted' }, 'Граната'), h('div', { class: 'big' }, `${fmtAp(content().rules.actions.throw * 10)} AP`), h('div', { class: 'muted' }, `Відстань ${dist2d(u.pos, p.cell).toFixed(1)} кл.; можливе відхилення`));
    }
    if (!content2) return;
    this.hud.append(
      h('div', { class: 'hitpanel panel', 'data-part': 'hit' }, content2, h('div', { class: 'row', style: 'margin-top:6px' }, btn('Підтвердити', () => void this.confirm(), { cls: 'primary' }), btn('Скасувати', () => this.cancel()))),
    );
  }

  private renderActions(): void {
    const s = this.s;
    const bar2 = h('div', { class: 'actionbar', 'data-part': 'actions' });
    if (s.turn.phase === 'deploy') {
      bar2.append(
        h('div', { class: 'panel deploy-hint', style: 'position:static;transform:none;text-align:center' }, 'Оберіть бійця у списку та клітинку в зеленій зоні.'),
        h(
          'div',
          { class: 'confirmbar' },
          btn('Авторозгортання', () => {
            const res = this.m.dispatch({ type: 'autoDeploy', side: this.viewer });
            if (!res.ok) this.toast(res.error);
            this.r.sync();
            this.refresh();
          }),
          btn('Почати бій', () => {
            void this.exec({ type: 'startBattle' }).then(() => {
              this.sel = this.myUnits().find((u) => isActive(u))?.id ?? null;
              this.refresh();
              if (this.isAiTurn()) void this.runAi();
            });
          }, { cls: 'primary' }),
        ),
      );
      this.hud.append(bar2);
      return;
    }
    const u = this.selected();
    const can = this.isHumanTurn() && !this.busy && !!u && isActive(u) && !u.panicked;
    const acts = h('div', { class: 'actions' });
    const sv = this.selectedVehicle();
    if (sv) for (const menu of this.vehicleMenus(sv)) acts.append(this.menuButton(menu));
    else if (u) for (const menu of this.menus(u, can)) acts.append(this.menuButton(menu));
    acts.append(btn('Кінець ходу', () => void this.endTurn(), { cls: 'primary', disabled: !this.isHumanTurn() || this.busy }));
    bar2.append(acts);
    this.hud.append(bar2);
  }

  // ---------- Техніка ----------

  private selectedVehicle(): VehicleState | null {
    return this.selVehicle ? vehicleById(this.s, this.selVehicle) ?? null : null;
  }

  private selectVehicle(id: string): void {
    const v = vehicleById(this.s, id);
    if (!v || v.side !== this.viewer) return;
    this.selVehicle = id;
    this.sel = null;
    this.pending = null;
    this.fireMode = null;
    this.vFireMode = null;
    this.disembarkUnit = null;
    this.r.focus({ x: v.x + 0.5, y: v.y + 0.5, z: 0 });
    this.r.setViewLevel(this.s.map.levels - 1);
    this.refresh();
  }

  /** Обробка кліку з урахуванням техніки. true — клік оброблено. */
  private vehicleClick(clickedVeh: VehicleState | undefined, unitId: string | null, cell: Cell | null): boolean {
    const s = this.s;
    const v = this.selectedVehicle();
    // Своя техніка — вибір (якщо не цілимося з неї).
    if (clickedVeh && clickedVeh.side === this.viewer && !clickedVeh.destroyed && !(v && v.id === clickedVeh.id && this.pending)) {
      if (this.selVehicle !== clickedVeh.id) {
        this.selectVehicle(clickedVeh.id);
        return true;
      }
    }
    // Ворожа техніка як ціль для бійця: вільний вогонь / гранатомет у найближчу клітинку корпусу.
    if (!v && clickedVeh && clickedVeh.side !== this.viewer) {
      const u = this.selected();
      if (!u?.pos || !this.isHumanTurn()) return false;
      const target = footprint(clickedVeh).reduce((a, b) => (dist2d(a, u.pos!) <= dist2d(b, u.pos!) ? a : b));
      if (this.launchMode) {
        if (this.pending?.kind === 'launch' && sameCell(this.pending.cell, target)) void this.confirm();
        else this.pending = { kind: 'launch', cell: target, mode: this.launchMode };
      } else {
        if (!this.fireMode) this.fireMode = primaryDef(u)?.modes[0] ?? 'snap';
        if (this.pending?.kind === 'fire' && this.pending.cell && sameCell(this.pending.cell, target)) void this.confirm();
        else this.pending = { kind: 'fire', cell: target };
      }
      this.refresh();
      return true;
    }
    if (!v) return false;
    // Клік по своєму бійцю на полі — перейти до нього.
    const own = unitId ? s.units.find((x) => x.id === unitId && x.side === this.viewer && isActive(x)) : undefined;
    if (own && !this.vFireMode) {
      this.selectUnit(own);
      return true;
    }
    if (!this.isHumanTurn()) return true;
    if (this.disembarkUnit && cell) {
      const ok = exitCells(s, v).some((c) => sameCell(c, cell));
      if (!ok) this.toast('Оберіть вільну клітинку поруч із технікою');
      else if (this.pending?.kind === 'disembark' && sameCell(this.pending.cell, cell)) void this.confirm();
      else this.pending = { kind: 'disembark', unitId: this.disembarkUnit, cell };
      this.refresh();
      return true;
    }
    if (this.vFireMode) {
      const t = unitId ? s.units.find((x) => x.id === unitId) : undefined;
      if (t && t.side !== v.side) {
        if (this.pending?.kind === 'vfire' && this.pending.targetId === t.id) void this.confirm();
        else this.pending = { kind: 'vfire', targetId: t.id };
      } else if (cell) {
        if (this.pending?.kind === 'vfire' && this.pending.cell && sameCell(this.pending.cell, cell)) void this.confirm();
        else this.pending = { kind: 'vfire', cell };
      }
      this.refresh();
      return true;
    }
    if (!cell) return true;
    // Рух: обираємо положення, щоб клітинка опинилась у площі техніки, з найменшою ціною.
    const d = v.driver ? s.units.find((x) => x.id === v.driver) : undefined;
    if (!d) {
      this.toast('Немає водія');
      return true;
    }
    const nodes = vehicleReachable(s, v, d.ap);
    let best: { x: number; y: number; cost: number } | null = null;
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const n = nodes.get(`${cell.x - dx},${cell.y - dy}`);
      if (n && n.cost > 0 && (!best || n.cost < best.cost)) best = { x: n.x, y: n.y, cost: n.cost };
    }
    if (!best) {
      this.toast(canMove(v) ? 'Техніка туди не доїде' : 'Техніка не може рухатись');
      return true;
    }
    if (this.pending?.kind === 'vmove' && this.pending.x === best.x && this.pending.y === best.y) void this.confirm();
    else this.pending = { kind: 'vmove', ...best };
    this.refresh();
    return true;
  }

  private vehicleOverlays(): void {
    const s = this.s;
    const r = this.r;
    const v = this.selectedVehicle();
    r.select(null);
    r.setGhosts(this.ghostCells());
    r.setOverlay('reach', []);
    if (!v || !this.isHumanTurn() || this.busy) return;
    if (this.disembarkUnit) {
      r.setOverlay('reach', exitCells(s, v).map((cell) => ({ cell, color: [0.3, 0.9, 0.4] as [number, number, number] })), { alpha: 0.4 });
      return;
    }
    if (this.vFireMode) return;
    const d = v.driver ? s.units.find((x) => x.id === v.driver) : undefined;
    if (!d || !canMove(v)) return;
    const seen = new Map<string, Cell>();
    for (const n of vehicleReachable(s, v, d.ap).values()) for (const c of footprintAt(v.defId, n.x, n.y)) seen.set(`${c.x},${c.y}`, c);
    const cells = [...seen.values()].map((cell) => ({ cell, color: [0.3, 0.6, 1] as [number, number, number] }));
    if (this.pending?.kind === 'vmove') for (const c of footprintAt(v.defId, this.pending.x, this.pending.y)) cells.push({ cell: c, color: [1, 0.85, 0.3] });
    r.setOverlay('reach', cells, { alpha: 0.3 });
  }

  private vehicleMenus(v: VehicleState): ActionMenu[] {
    const s = this.s;
    const d = vehicleDef(v.defId);
    const human = this.isHumanTurn() && !this.busy;
    const driver = v.driver ? s.units.find((x) => x.id === v.driver) : undefined;
    const gunner = v.gunner ? s.units.find((x) => x.id === v.gunner) : undefined;
    const out: ActionMenu[] = [];
    out.push({
      id: 'vmove',
      label: 'Рух техніки',
      title: `Клікніть клітинку — техніка під'їде (${d.moveCost} AP водія за клітинку)`,
      active: !this.vFireMode && !this.disembarkUnit,
      items: [{ label: driver ? `Водій: ${driver.callsign} · AP ${fmtAp(driver.ap)}` : 'Немає водія', disabled: !human || !driver, run: () => ((this.vFireMode = null), (this.disembarkUnit = null), (this.pending = null)) }],
    });
    if (v.weapon) {
      const wd = itemDef<WeaponDefinition>(v.weapon.defId);
      const proxy = gunner ? { ...crewProxy(s, v, gunner), inventory: { ...gunner.inventory, primary: v.weapon } } : null;
      out.push({
        id: 'vfire',
        label: this.vFireMode ? `Вогонь: ${FIRE[this.vFireMode]}` : 'Вогонь навідника',
        title: `${wd.name} · стрічка ${v.weapon.magazine?.rounds ?? 0} · запас ${v.ammoStock}`,
        active: !!this.vFireMode,
        items: [
          ...wd.modes.map((fm) => ({
            label: `${FIRE[fm]} — ${proxy ? fmtAp(fireApCost(proxy, fm)) : '—'} AP`,
            on: this.vFireMode === fm,
            disabled: !human || !gunner || v.hp.weapon <= 0,
            run: () => {
              this.vFireMode = this.vFireMode === fm ? null : fm;
              this.disembarkUnit = null;
              this.pending = null;
            },
          })),
          { label: `Перезарядити стрічку (${v.ammoStock}) — ${content().rules.actions.vehicleReload} AP`, disabled: !human || !gunner || v.ammoStock <= 0, run: () => void this.exec({ type: 'vehicleReload', vehicleId: v.id }) },
        ],
      });
    }
    out.push({
      id: 'crew',
      label: `Екіпаж (${crew(s, v).length})`,
      title: `Висадка — ${content().rules.actions.disembark} AP бійця`,
      items: crew(s, v).map((c) => ({
        label: `Висадити: ${c.callsign} (${v.driver === c.id ? 'водій' : v.gunner === c.id ? 'навідник' : 'десант'}, AP ${fmtAp(c.ap)})`,
        on: this.disembarkUnit === c.id,
        disabled: !human || c.status !== 'active',
        run: () => {
          this.disembarkUnit = c.id;
          this.vFireMode = null;
          this.pending = null;
        },
      })),
    });
    return out;
  }

  private renderVehicleStatus(): void {
    const v = this.selectedVehicle();
    if (!v) return;
    const d = vehicleDef(v.defId);
    const s = this.s;
    const comp = (k: 'hull' | 'engine' | 'mobility' | 'weapon') => [
      h('span', { class: 'muted' }, COMPONENT_NAMES[k]),
      h('span', {}, `${v.hp[k]}/${d.components[k]}`, bar(v.hp[k], d.components[k], v.hp[k] <= 0 ? 'var(--bad)' : '#8aa0b0')),
    ];
    const seat = (label: string, id: string | null) => [h('span', { class: 'muted' }, label), h('span', {}, id ? s.units.find((x) => x.id === id)?.callsign ?? '—' : '—')];
    this.hud.append(
      h(
        'div',
        { class: 'status panel', 'data-part': 'status' },
        h('div', { style: 'font-weight:700' }, d.name),
        h('div', { class: 'muted', style: 'margin-bottom:6px' }, `${d.kind === 'tracked' ? 'Гусенична' : 'Колісна'} · броня ${d.armor}${v.destroyed ? ' · знищено' : ''}`),
        h(
          'div',
          { class: 'grid2' },
          ...comp('hull'),
          ...comp('engine'),
          ...comp('mobility'),
          ...(v.weapon ? comp('weapon') : []),
          ...seat('Водій', v.driver),
          ...(v.weapon ? seat('Навідник', v.gunner) : []),
          h('span', { class: 'muted' }, 'Десант'),
          h('span', {}, `${v.passengers.length}/${d.passengers}`),
          ...(v.weapon ? [h('span', { class: 'muted' }, 'БК'), h('span', {}, `${v.weapon.magazine?.rounds ?? 0} · запас ${v.ammoStock} стр.`)] : []),
        ),
      ),
    );
  }

  private renderVehicleHit(): void {
    const v = this.selectedVehicle();
    const p = this.pending;
    if (!v || !p) return;
    const s = this.s;
    let body: HTMLElement | null = null;
    if (p.kind === 'vmove') body = h('div', {}, h('div', { class: 'muted' }, 'Рух техніки'), h('div', { class: 'big' }, `${fmtAp(p.cost)} AP`), h('div', { class: 'muted' }, 'AP водія. Легкі перешкоди (паркани, кущі, ящики, мішки) буде розчавлено.'));
    else if (p.kind === 'disembark') body = h('div', {}, h('div', { class: 'muted' }, 'Висадка'), h('div', { class: 'big' }, `${content().rules.actions.disembark} AP`));
    else if (p.kind === 'vfire') {
      const g = v.gunner ? s.units.find((x) => x.id === v.gunner) : undefined;
      if (g && v.weapon) {
        const proxy = { ...crewProxy(s, v, g), inventory: { ...g.inventory, primary: v.weapon } };
        const mode = this.vFireMode ?? 'snap';
        const t = p.targetId ? s.units.find((x) => x.id === p.targetId) : undefined;
        losIgnore.ids.add(v.id);
        const est = t?.pos ? estimateHit(s, proxy, t, mode) : null;
        losIgnore.ids.delete(v.id);
        body = h(
          'div',
          {},
          h('div', { class: 'muted' }, `${FIRE[mode]} · ${fmtAp(fireApCost(proxy, mode))} AP навідника`),
          h('div', { class: 'big' }, est ? (est.lineOfFire ? `${est.chance}%` : 'Немає лінії вогню') : 'Вільний вогонь'),
          est ? h('div', { class: 'factors' }, ...est.factors.flatMap((f) => [h('span', {}, f.label), h('span', { class: f.value >= 0 ? 'pos' : 'neg' }, `${f.value > 0 ? '+' : ''}${f.value}`)])) : null,
        );
      }
    }
    if (!body) return;
    this.hud.append(h('div', { class: 'hitpanel panel', 'data-part': 'hit' }, body, h('div', { class: 'row', style: 'margin-top:6px' }, btn('Підтвердити', () => void this.confirm(), { cls: 'primary' }), btn('Скасувати', () => this.cancel()))));
  }

  /** Висувне меню: кнопка з поточним значенням і список пунктів над панеллю. */
  private menuButton(m: ActionMenu): HTMLElement {
    const open = this.openMenu === m.id;
    const wrap = h('div', { class: 'menuwrap' });
    wrap.append(
      btn(`${m.label} ▾`, () => {
        this.openMenu = open ? null : m.id;
        this.refresh();
      }, { on: open || !!m.active }),
    );
    if (open) {
      const pop = h('div', { class: 'menupop panel' }, h('div', { class: 'muted', style: 'font-size:0.8em' }, m.title));
      for (const it of m.items)
        pop.append(
          btn(it.label, () => {
            this.openMenu = null;
            it.run();
            this.refresh();
          }, { on: it.on, disabled: it.disabled, title: it.title }),
        );
      wrap.append(pop);
    }
    return wrap;
  }

  private menus(u: Unit, can: boolean): ActionMenu[] {
    const s = this.s;
    const run = (c: Command) => () => void this.exec(c);
    const clearModes = () => {
      this.fireMode = null;
      this.throwGrenade = null;
      this.launchMode = null;
      this.pending = null;
      this.r.setPath([], [1, 1, 1]);
    };
    const wd = primaryDef(u);
    const out: ActionMenu[] = [];
    out.push({
      id: 'move',
      label: `Рух: ${MOVE[this.moveMode]}`,
      title: 'Режим руху (місцевість не змінює AP)',
      items: (['fast', 'standard', 'careful'] as MoveMode[]).map((m) => ({
        label: MOVE[m],
        on: this.moveMode === m,
        disabled: !can || !canUseMode(u, m),
        run: () => {
          this.moveMode = m;
          clearModes();
        },
      })),
    });
    out.push({
      id: 'stance',
      label: STANCE[u.stance],
      title: 'Позиція',
      items: (['standing', 'crouched', 'prone'] as Stance[]).map((st) => ({ label: STANCE[st], on: u.stance === st, disabled: !can || u.stance === st, run: run({ type: 'stance', unitId: u.id, stance: st }) })),
    });
    out.push({
      id: 'wstate',
      label: u.weaponState === 'high' ? 'High ready' : u.weaponState === 'low' ? 'Low ready' : 'Вільно',
      title: 'Стан зброї',
      items: (['high', 'low', 'carry'] as WeaponState[]).map((ws) => ({ label: WSTATE[ws], on: u.weaponState === ws, disabled: !can || u.weaponState === ws, run: run({ type: 'weaponState', unitId: u.id, state: ws }) })),
    });
    out.push({
      id: 'fire',
      label: this.fireMode ? `Вогонь: ${FIRE[this.fireMode]}` : 'Вогонь',
      title: 'Режим вогню, потім оберіть ціль',
      active: !!this.fireMode,
      items: [
        ...(wd?.modes ?? []).map((fm) => ({
          label: `${FIRE[fm]} — ${fmtAp(fireApCost(u, fm))} AP`,
          on: this.fireMode === fm,
          disabled: !can,
          run: () => {
            const keep = this.fireMode === fm;
            clearModes();
            this.fireMode = keep ? null : fm;
          },
        })),
        { label: 'Перезарядити', disabled: !can, run: run({ type: 'reload', unitId: u.id }) },
        { label: 'Спостереження (overwatch)', disabled: !can, title: 'Резерв усіх AP для реакції', run: run({ type: 'overwatch', unitId: u.id }) },
      ],
    });
    // Гранати за типами.
    const nades = new Map<string, number>();
    for (const it of [...u.inventory.belt, ...u.inventory.backpackItems.map((e) => e.item)])
      if (itemDef(it.defId).kind === 'grenade') nades.set(it.defId, (nades.get(it.defId) ?? 0) + ((it as { uses?: number }).uses ?? 1));
    if (nades.size)
      out.push({
        id: 'nades',
        label: this.throwGrenade ? itemDef(this.throwGrenade).name : `Гранати (${[...nades.values()].reduce((a, b) => a + b, 0)})`,
        title: 'Оберіть гранату, потім клітинку',
        active: !!this.throwGrenade,
        items: [...nades].map(([id, n]) => ({
          label: `${itemDef(id).name} ×${n}`,
          on: this.throwGrenade === id,
          disabled: !can,
          run: () => {
            const keep = this.throwGrenade === id;
            clearModes();
            this.throwGrenade = keep ? null : id;
          },
        })),
      });
    // Гранатомети.
    const lItems: ActionMenuItem[] = [];
    const l = launcherOf(u);
    const toggle = (m: 'rpg' | 'ugl' | 'disposable') => () => {
      const keep = this.launchMode === m;
      clearModes();
      this.launchMode = keep ? null : m;
    };
    if (l) {
      const ammo = loadedAmmo(u);
      lItems.push({ label: `РПГ-7: ${ammo ? itemDef(ammo).name.replace('Постріл ', '') : 'не заряджено'}`, on: this.launchMode === 'rpg', disabled: !can || !l.loaded, run: toggle('rpg') });
      if (!l.loaded)
        for (const st of rocketStock(u))
          lItems.push({ label: `Зарядити ${st.name.replace('Постріл ', '')} ×${st.count} — ${content().rules.launcher.rpgReload} AP`, disabled: !can || st.count === 0, run: run({ type: 'reloadLauncher', unitId: u.id, ammo: st.id }) });
    }
    const nd = countDisposable(u);
    if (nd) lItems.push({ label: `Bulspike (одноразовий) ×${nd}`, on: this.launchMode === 'disposable', disabled: !can, run: toggle('disposable') });
    if (hasUnderbarrel(u)) lItems.push({ label: `Підствольник ×${countItems(u, (d) => d.id === 'vog')}`, on: this.launchMode === 'ugl', disabled: !can || !uglAmmo(u), run: toggle('ugl') });
    if (lItems.length)
      out.push({ id: 'launch', label: this.launchMode ? { rpg: 'РПГ-7', ugl: 'Підствольник', disposable: 'Bulspike' }[this.launchMode] : 'Гранатомет', title: 'Гранатомети', active: !!this.launchMode, items: lItems });
    // Інші дії.
    const other: ActionMenuItem[] = [
      { label: 'Медицина…', run: () => this.openMedical(), disabled: !u.pos },
      { label: 'Інвентар…', run: () => this.openInventory() },
    ];
    if (helmetMount(u, 'light')) other.push({ label: u.lightOn ? 'Вимкнути ліхтар (0 AP)' : 'Увімкнути ліхтар (0 AP)', on: !!u.lightOn, disabled: !can, title: 'Уночі видно далі, але й вас видно здалеку', run: run({ type: 'toggleLight', unitId: u.id }) });
    for (const v of vehicles(s))
      if (v.side === u.side && !v.destroyed && u.pos && adjacentToVehicle(v, u.pos) && freeSeats(v) > 0)
        other.push({ label: `Сісти в ${vehicleDef(v.defId).name} — ${content().rules.actions.embark} AP`, disabled: !can || !!u.carrying, run: () => void this.exec({ type: 'embark', unitId: u.id, vehicleId: v.id }).then((ok) => ok && this.selectVehicle(v.id)) });
    const pick = this.pickUpTarget(u);
    if (u.carrying) other.push({ label: 'Покласти пораненого', disabled: !can, run: run({ type: 'drop', unitId: u.id }) });
    else if (pick) other.push({ label: `Підняти: ${pick.callsign}`, disabled: !can, run: run({ type: 'pickUp', unitId: u.id, targetId: pick.id }) });
    if (inZone(u.pos ?? { x: -1, y: -1, z: 0 }, s.scenario.evacZone))
      other.push({ label: u.carrying ? 'Евакуювати пораненого' : 'Евакуюватися', disabled: !can, run: run({ type: 'evacuate', unitId: u.id }) });
    out.push({ id: 'other', label: 'Дії', title: 'Інші дії', items: other });
    return out;
  }

  private pickUpTarget(u: Unit): Unit | undefined {
    if (!u.pos) return undefined;
    return this.s.units.find((t) => t.side === u.side && t.pos && (t.status === 'down' || t.status === 'dead') && (adjacent(t.pos, u.pos!) || sameCell(t.pos, u.pos!)));
  }

}

interface ActionMenuItem {
  label: string;
  run: () => void;
  on?: boolean;
  disabled?: boolean;
  title?: string;
}

interface ActionMenu {
  id: string;
  label: string;
  title: string;
  active?: boolean;
  items: ActionMenuItem[];
}
