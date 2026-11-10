import { content } from '@/content';
import { dist2d, fmtAp, sameCell, type Cell } from '@/core/grid';
import { AiPlanner } from '@/game/ai/ai';
import { blindOrigin, canThrowTo, grenadeRange } from '@/game/combat/fire';
import { estimateHit, fireApCost } from '@/game/combat/hit';
import { adjacent, canUseMode, planPath, unitReachable } from '@/game/combat/movement';
import { ammoSummary, countItems, primaryDef } from '@/game/inventory/inventory';
import { INJURY_NAMES, PART_NAMES, bleedingRate } from '@/game/injuries/injuries';
import { cellAt, cellsInZone, inZone, isIndoor } from '@/game/maps/map';
import { computeApMax } from '@/game/units/derived';
import { Mission } from '@/game/simulation/mission';
import type { Command } from '@/game/simulation/commands';
import { isActive, type SimEvent } from '@/game/simulation/state';
import type { FireMode, MoveMode, SideId, Stance, Unit, WeaponState } from '@/game/types';
import type { Renderer } from '@/rendering/renderer';
import { bar, btn, h, modal } from './dom';
import { inventoryBody, medicalBody, statusName } from './panels';

export type BattleMode = 'ai' | 'hotseat' | 'test';

type Pending =
  | { kind: 'move'; cell: Cell; path: Cell[]; cost: number }
  | { kind: 'fire'; targetId?: string; cell?: Cell }
  | { kind: 'throw'; cell: Cell }
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
  private throwMode = false;
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
    this.throwMode = false;
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
    const k = e.key.toLowerCase();
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
    this.sel = u.id;
    this.pending = null;
    this.fireMode = null;
    this.throwMode = false;
    if (u.pos) this.r.focus(u.pos);
    this.autoView();
    this.refresh();
  }

  private hover(x: number, y: number): void {
    if (this.busy || this.pending) return;
    const cell = this.r.pickCell(x, y);
    const u = this.selected();
    this.r.setCursor(cell);
    if (!cell || !u?.pos || !this.isHumanTurn() || this.s.turn.phase !== 'battle' || this.fireMode || this.throwMode) {
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
    const s = this.s;
    let clickedUnit = unitId ? s.units.find((u) => u.id === unitId) ?? null : null;
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
    if (this.throwMode) {
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
    if (this.pending) this.pending = null;
    else {
      this.fireMode = null;
      this.throwMode = false;
    }
    this.r.setPath([], [1, 1, 1]);
    this.r.setCursor(null);
    this.refresh();
  }

  private async confirm(): Promise<void> {
    const u = this.selected();
    const p = this.pending;
    if (!u || !p || this.busy) return;
    if (p.kind === 'move') await this.exec({ type: 'move', unitId: u.id, to: p.cell, mode: this.moveMode });
    else if (p.kind === 'fire') await this.exec({ type: 'fire', unitId: u.id, target: p.targetId ? { unitId: p.targetId } : { cell: p.cell }, mode: this.fireMode ?? 'snap' });
    else if (p.kind === 'throw') {
      if (await this.exec({ type: 'throw', unitId: u.id, cell: p.cell })) this.throwMode = false;
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
    if (this.throwMode) {
      const cells: Cell[] = [];
      const rng = Math.ceil(grenadeRange(u));
      for (let y = u.pos.y - rng; y <= u.pos.y + rng; y++)
        for (let x = u.pos.x - rng; x <= u.pos.x + rng; x++) {
          const c = { x, y, z: u.pos.z };
          if (dist2d(c, u.pos) <= grenadeRange(u) && canThrowTo({ s }, u, c)) cells.push(c);
        }
      r.setOverlay('reach', cells.map((cell) => ({ cell, color: [1, 0.55, 0.2] })), { alpha: 0.3 });
      return;
    }
    if (this.fireMode) {
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
          : `Хід ${s.turn.turn} · ${s.scenario.sides[side].name}${s.controllers[side] === 'ai' ? ' (AI)' : ''}`;
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
        btn('☰', () => this.hooks.onMenu(), { title: 'Меню' }),
      ),
    );
    this.hud.append(top);
  }

  private renderList(): void {
    const list = h('div', { class: 'unitlist', 'data-part': 'list' });
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
        ...row('Зброя', wd ? wd.name : '—'),
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
          mode === 'burst' ? h('div', { class: 'muted' }, `Кожна наступна куля черги: −${content().rules.fire.burstShotPenalty}%`) : null,
        );
      } else if (p.cell) {
        content2 = h('div', {}, h('div', { class: 'muted' }, `${FIRE[mode]} · ${fmtAp(cost)} AP`), h('div', { class: 'big' }, 'Вільний вогонь'), h('div', { class: 'muted' }, 'Куля летить у точку й уражає все на шляху.'));
      }
    } else if (p.kind === 'move') {
      content2 = h('div', {}, h('div', { class: 'muted' }, MOVE[this.moveMode]), h('div', { class: 'big' }, `${fmtAp(p.cost)} AP`), h('div', { class: 'muted' }, `Залишиться ${fmtAp(u.ap - p.cost)} AP · ${p.path.length - 1} кл.`));
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
    const run = (c: Command) => () => void this.exec(c);
    const group = (label: string, ...b: (HTMLElement | null)[]) => h('div', { class: 'group' }, h('span', { class: 'lbl' }, label), ...b);
    const wd = u ? primaryDef(u) : null;
    const acts = h('div', { class: 'actions' });
    if (u) {
      acts.append(
        group(
          'Рух',
          ...(['fast', 'standard', 'careful'] as MoveMode[]).map((m) =>
            btn(MOVE[m], () => {
              this.moveMode = m;
              this.fireMode = null;
              this.throwMode = false;
              this.pending = null;
              this.r.setPath([], [1, 1, 1]);
              this.refresh();
            }, { on: this.moveMode === m && !this.fireMode && !this.throwMode, disabled: !can || !canUseMode(u, m) }),
          ),
        ),
        group(
          'Позиція',
          ...(['standing', 'crouched', 'prone'] as Stance[]).map((st) => btn(STANCE[st], run({ type: 'stance', unitId: u.id, stance: st }), { on: u.stance === st, disabled: !can })),
        ),
        group(
          'Зброя',
          ...(['high', 'low', 'carry'] as WeaponState[]).map((ws) => btn(ws === 'high' ? 'High' : ws === 'low' ? 'Low' : 'Вільно', run({ type: 'weaponState', unitId: u.id, state: ws }), { on: u.weaponState === ws, disabled: !can, title: WSTATE[ws] })),
        ),
        group(
          'Вогонь',
          ...(wd?.modes ?? []).map((fm) =>
            btn(`${FIRE[fm]} ${fmtAp(fireApCost(u, fm))}`, () => {
              this.fireMode = this.fireMode === fm ? null : fm;
              this.throwMode = false;
              if (this.pending?.kind !== 'fire') this.pending = null;
              this.r.setPath([], [1, 1, 1]);
              this.refresh();
            }, { on: this.fireMode === fm, disabled: !can }),
          ),
        ),
        group(
          'Дії',
          btn('Перезарядити', run({ type: 'reload', unitId: u.id }), { disabled: !can }),
          btn('Граната', () => {
            this.throwMode = !this.throwMode;
            this.fireMode = null;
            this.pending = null;
            this.refresh();
          }, { on: this.throwMode, disabled: !can || !countItems(u, (d) => d.kind === 'grenade') }),
          btn('Спостереження', run({ type: 'overwatch', unitId: u.id }), { disabled: !can, title: 'Overwatch: резерв усіх AP для реакції' }),
          btn('Медицина', () => this.openMedical(), { disabled: !u.pos }),
          btn('Інвентар', () => this.openInventory()),
          u.carrying ? btn('Покласти', run({ type: 'drop', unitId: u.id }), { disabled: !can }) : this.pickUpButton(u, can),
          inZone(u.pos ?? { x: -1, y: -1, z: 0 }, s.scenario.evacZone) ? btn('Евакуація', run({ type: 'evacuate', unitId: u.id }), { disabled: !can }) : null,
        ) as HTMLElement,
      );
    }
    acts.append(group('Хід', btn('Кінець ходу', () => void this.endTurn(), { cls: 'primary', disabled: !this.isHumanTurn() || this.busy })));
    bar2.append(acts);
    this.hud.append(bar2);
  }

  private pickUpButton(u: Unit, can: boolean): HTMLElement | null {
    if (!u.pos) return null;
    const c = this.s.units.find((t) => t.side === u.side && t.pos && (t.status === 'down' || t.status === 'dead') && (adjacent(t.pos, u.pos!) || sameCell(t.pos, u.pos!)));
    if (!c) return null;
    return btn(`Підняти ${c.callsign}`, () => void this.exec({ type: 'pickUp', unitId: u.id, targetId: c.id }), { disabled: !can });
  }
}

