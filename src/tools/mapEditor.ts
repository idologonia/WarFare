import { content, objectDef, BUILTIN_IDS } from '@/content';
import { cellKey, type Cell } from '@/core/grid';
import type { MissionState } from '@/game/simulation/state';
import type { EdgeSide, MapState } from '@/game/types';
import { getEdge, setEdge } from '@/game/maps/map';
import { downloadJson, pickJsonFile, saveMap, unpackShared } from '@/persistence/library';
import type { Renderer } from '@/rendering/renderer';
import { btn, h, modal } from '@/ui/dom';
import { assignBuildings, DEFAULT_VARIATION, fromDefinition, newMap, resizeMap, toDefinition, validateMap, type EditMap } from './mapModel';

type Tool =
  | { kind: 'terrain'; id: string }
  | { kind: 'object'; id: string }
  | { kind: 'erase' }
  | { kind: 'floor' }
  | { kind: 'nofloor' }
  | { kind: 'stairs' }
  | { kind: 'hill'; value: number }
  | { kind: 'variation' };

const OBJ_GROUPS: [string, string[]][] = [
  ['Стіни й будівлі', ['brick_wall', 'brick_window', 'door', 'concrete_wall', 'parapet', 'brick_rubble', 'concrete_rubble']],
  ['Укриття', ['sandbags', 'earth_berm', 'fence', 'crates', 'container', 'scrap']],
  ['Рослинність', ['tree', 'bush', 'stump']],
];

/** Редактор карт: ручна основа + клітинки з процедурною варіацією. */
export class MapEditor {
  private ui = h('div', { class: 'layer hud' });
  private map: EditMap;
  private tool: Tool = { kind: 'terrain', id: 'grass' };
  private brush = 1;
  private rectMode = false;
  private paintMode = true;
  private undo: string[] = [];
  private status = h('div', { class: 'panel', style: 'position:absolute;left:50%;bottom:8px;transform:translateX(-50%);font-size:0.9em' }, '');
  private disposed = false;
  private keyHandler = (e: KeyboardEvent) => this.onKey(e);
  private keys = new Set<string>();
  private loadedOnce = false;

  constructor(public root: HTMLElement, private r: Renderer, map: EditMap | null, private onExit: () => void) {
    this.map = map ?? newMap(`map_${Date.now().toString(36)}`, 'Нова карта', 24, 24, 2);
    assignBuildings(this.map);
    root.append(this.ui);
    this.reload();
    this.r.setViewLevel(0);
    this.bindInput();
    window.addEventListener('keydown', this.keyHandler);
    window.addEventListener('keyup', this.keyHandler);
    this.render();
  }

  dispose(): void {
    this.disposed = true;
    window.removeEventListener('keydown', this.keyHandler);
    window.removeEventListener('keyup', this.keyHandler);
    this.r.keyMove.x = this.r.keyMove.y = this.r.keyMove.rot = 0;
    this.ui.remove();
  }

  /** Мінімальний «стан місії» лише з картою — для рендерера. */
  private fakeState(): MissionState {
    return {
      map: this.map as unknown as MapState,
      units: [],
      contacts: { blue: {}, red: {} },
      revealAll: true,
      scenario: { evacZone: null },
    } as unknown as MissionState;
  }

  private reload(): void {
    const level = this.r.viewLevel;
    this.r.load(this.fakeState(), 'blue', this.loadedOnce);
    this.loadedOnce = true;
    this.r.setViewLevel(Math.min(level, this.map.levels - 1));
    this.markers();
  }

  /** Маркери процедурних варіацій і сходів. */
  private markers(): void {
    const v: { cell: Cell; color: [number, number, number] }[] = [];
    this.map.cells.forEach((lvl, z) =>
      lvl.forEach((row, y) =>
        row.forEach((c, x) => {
          if (c.variation) v.push({ cell: { x, y, z }, color: [0.9, 0.4, 0.95] });
        }),
      ),
    );
    this.r.setOverlay('variation', v, { alpha: 0.55, size: 0.5, height: 0.06 });
  }

  // ---------- Малювання ----------

  private snapshot(): void {
    this.undo.push(JSON.stringify(this.map.cells));
    if (this.undo.length > 40) this.undo.shift();
  }

  private doUndo(): void {
    const prev = this.undo.pop();
    if (!prev) return;
    this.map.cells = JSON.parse(prev);
    assignBuildings(this.map);
    this.reload();
  }

  private applyTool(c: Cell & { side?: EdgeSide }, touched: { levels: Set<number>; objects: Set<string> }): void {
    const cell = this.map.cells[c.z]?.[c.y]?.[c.x];
    if (!cell) return;
    const t = this.tool;
    const objChanged = () => touched.objects.add(cellKey(c));
    const lvlChanged = () => touched.levels.add(c.z);
    switch (t.kind) {
      case 'terrain':
        cell.terrain = t.id;
        if (c.z > 0) cell.floor = true;
        lvlChanged();
        break;
      case 'object':
        if (objectDef(t.id).thin) {
          const side = c.side ?? this.side;
          setEdge(this.map as unknown as MapState, c, side, { defId: t.id, hp: objectDef(t.id).hp });
          if (c.z > 0) cell.floor = true;
          touched.objects.add(cellKey(this.edgeOwner(c, side)));
          objChanged();
          break;
        }
        cell.object = { defId: t.id, hp: objectDef(t.id).hp };
        delete cell.variation;
        if (c.z > 0) cell.floor = true;
        if (objectDef(t.id).wall && cell.terrain !== 'floor') {
          cell.terrain = 'floor';
          lvlChanged();
        }
        objChanged();
        break;
      case 'erase': {
        // Біля межі — прибрати тонкий об'єкт, інакше — об'єкт у клітинці.
        const side = c.side ?? this.side;
        if ((c.side || this.sideDist < 0.25) && getEdge(this.map as unknown as MapState, c, side)) {
          setEdge(this.map as unknown as MapState, c, side, null);
          touched.objects.add(cellKey(this.edgeOwner(c, side)));
        } else {
          cell.object = null;
          delete cell.variation;
        }
        objChanged();
        break;
      }
      case 'floor':
        if (c.z === 0) return;
        cell.floor = true;
        if (cell.terrain === 'roof' && this.map.cells[c.z - 1][c.y][c.x].buildingId !== undefined) cell.terrain = 'floor';
        lvlChanged();
        break;
      case 'nofloor':
        if (c.z === 0) return;
        cell.floor = false;
        cell.object = null;
        cell.stairsUp = false;
        lvlChanged();
        objChanged();
        break;
      case 'stairs':
        cell.stairsUp = !cell.stairsUp;
        if (!cell.stairsUp) delete cell.stairsUp;
        lvlChanged();
        break;
      case 'hill':
        if (c.z !== 0) return;
        cell.elevation = t.value;
        lvlChanged();
        objChanged();
        break;
      case 'variation':
        cell.object = null;
        cell.variation = DEFAULT_VARIATION;
        objChanged();
        break;
    }
  }

  private paint(cells: (Cell & { side?: EdgeSide })[]): void {
    const touched = { levels: new Set<number>(), objects: new Set<string>() };
    for (const c of cells) this.applyTool(c, touched);
    assignBuildings(this.map);
    for (const z of touched.levels) this.r.map.rebuildLevel(z);
    for (const k of touched.objects) {
      const [x, y, z] = k.split(',').map(Number);
      this.r.map.rebuildObject({ x, y, z });
    }
    this.r.refreshVisibility();
    this.markers();
  }

  private brushCells(c: Cell): Cell[] {
    const out: Cell[] = [];
    const r = this.brush - 1;
    for (let y = c.y - r; y <= c.y + r; y++)
      for (let x = c.x - r; x <= c.x + r; x++) if (x >= 0 && y >= 0 && x < this.map.width && y < this.map.height) out.push({ x, y, z: c.z });
    return out;
  }

  /** Клітинка під курсором на поточному поверсі (навіть без підлоги — щоб можна було її постелити). */
  private pick(x: number, y: number): Cell | null {
    const ray = this.r.scene.createPickingRay(x, y, null, this.r.camera);
    const z = this.r.viewLevel;
    const planeY = z * content().rules.map.levelHeight;
    if (Math.abs(ray.direction.y) < 1e-6) return null;
    const t = (planeY - ray.origin.y) / ray.direction.y;
    const p = ray.origin.add(ray.direction.scale(t));
    const c = { x: Math.floor(p.x), y: Math.floor(-p.z), z };
    // Найближча межа клітинки до курсора — туди ставляться тонкі об'єкти.
    const fx = p.x - c.x;
    const fy = -p.z - c.y;
    const d: [EdgeSide, number][] = [['n', fy], ['s', 1 - fy], ['w', fx], ['e', 1 - fx]];
    d.sort((a, b) => a[1] - b[1]);
    this.side = d[0][0];
    this.sideDist = d[0][1];
    return c.x >= 0 && c.y >= 0 && c.x < this.map.width && c.y < this.map.height ? c : null;
  }

  private side: EdgeSide = 'n';
  private sideDist = 0.5;

  private isThinTool(): boolean {
    return this.tool.kind === 'object' && !!objectDef(this.tool.id).thin;
  }

  /** Клітинка, у якій фактично зберігається межа (для перебудови сітки). */
  private edgeOwner(c: Cell, side: EdgeSide): Cell {
    if (side === 's' && c.y + 1 < this.map.height) return { x: c.x, y: c.y + 1, z: c.z };
    if (side === 'e' && c.x + 1 < this.map.width) return { x: c.x + 1, y: c.y, z: c.z };
    return c;
  }

  private bindInput(): void {
    const canvas = this.r.engine.getRenderingCanvas()!;
    let down: { x: number; y: number; button: number; start: Cell | null } | null = null;
    let last: string | null = null;
    let dragged = false;
    const pos = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const onDown = (e: PointerEvent) => {
      if (this.disposed) return;
      canvas.setPointerCapture(e.pointerId);
      const p = pos(e);
      const c = this.pick(p.x, p.y);
      down = { ...p, button: e.button, start: c };
      dragged = false;
      last = null;
      if (this.paintMode && e.button === 0 && c && !this.rectMode) {
        this.snapshot();
        this.paint(this.brushCells(c));
        last = cellKey(c);
      }
    };
    const onMove = (e: PointerEvent) => {
      if (this.disposed) return;
      const p = pos(e);
      const c = this.pick(p.x, p.y);
      this.hover = c;
      this.r.setCursor(c && this.map.cells[c.z][c.y][c.x].floor ? c : null, [1, 0.9, 0.3]);
      this.r.setEdgeHint(c && (this.isThinTool() || (this.tool.kind === 'erase' && this.sideDist < 0.25)) ? c : null, this.side);
      this.showStatus(c);
      if (!down) return;
      const dx = p.x - down.x;
      const dy = p.y - down.y;
      if (Math.hypot(dx, dy) > 4) dragged = true;
      if (this.paintMode && down.button === 0) {
        if (this.rectMode && down.start && c) this.previewRect(down.start, c);
        else if (c && cellKey(c) !== last) {
          this.paint(this.brushCells(c));
          last = cellKey(c);
        }
        return;
      }
      if (e.pointerType === 'mouse' && down.button === 0) this.r.orbit(e.movementX, e.movementY);
      else this.r.pan(e.movementX, e.movementY);
    };
    const onUp = (e: PointerEvent) => {
      if (!down) return;
      const p = pos(e);
      const c = this.pick(p.x, p.y);
      if (this.paintMode && down.button === 0 && this.rectMode && down.start && c) {
        this.snapshot();
        this.paint(this.rectCells(down.start, c));
        this.r.setOverlay('rect', []);
      }
      void dragged;
      down = null;
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('wheel', (e) => {
      if (this.disposed) return;
      e.preventDefault();
      this.r.zoomBy(e.deltaY > 0 ? 1.1 : 0.9);
    }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private rectCells(a: Cell, b: Cell): (Cell & { side?: EdgeSide })[] {
    if (this.isThinTool() || (this.tool.kind === 'erase' && this.sideDist < 0.25)) {
      // Тонкі об'єкти прямокутником — по периметру (кімната).
      const out: (Cell & { side: EdgeSide })[] = [];
      const [x0, x1, y0, y1] = [Math.min(a.x, b.x), Math.max(a.x, b.x), Math.min(a.y, b.y), Math.max(a.y, b.y)];
      for (let x = x0; x <= x1; x++) {
        out.push({ x, y: y0, z: a.z, side: 'n' }, { x, y: y1, z: a.z, side: 's' });
      }
      for (let y = y0; y <= y1; y++) {
        out.push({ x: x0, y, z: a.z, side: 'w' }, { x: x1, y, z: a.z, side: 'e' });
      }
      return out;
    }
    const out: Cell[] = [];
    for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++) for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) out.push({ x, y, z: a.z });
    return out;
  }

  private previewRect(a: Cell, b: Cell): void {
    this.r.setOverlay('rect', this.rectCells(a, b).map((cell) => ({ cell, color: [1, 0.85, 0.3] as [number, number, number] })), { alpha: 0.35 });
  }

  private onKey(e: KeyboardEvent): void {
    if (this.disposed || (e.target as HTMLElement)?.tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    if (e.type === 'keydown' && (e.ctrlKey || e.metaKey) && k === 'z') {
      e.preventDefault();
      this.doUndo();
      return;
    }
    if (e.type === 'keydown' && k === 'r' && this.hover) {
      this.rotateAt(this.hover);
      return;
    }
    if (!['w', 'a', 's', 'd', 'q', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) return;
    e.preventDefault();
    if (e.type === 'keydown') this.keys.add(k);
    else this.keys.delete(k);
    const has = (...n: string[]) => n.some((x) => this.keys.has(x));
    this.r.keyMove.x = (has('d', 'arrowright') ? 1 : 0) - (has('a', 'arrowleft') ? 1 : 0);
    this.r.keyMove.y = (has('w', 'arrowup') ? 1 : 0) - (has('s', 'arrowdown') ? 1 : 0);
    this.r.keyMove.rot = (has('e') ? 1 : 0) - (has('q') ? 1 : 0);
  }

  private hover: Cell | null = null;

  /** Повернути модель об'єкта в клітинці на 90° (R). */
  private rotateAt(c: Cell): void {
    const o = this.map.cells[c.z][c.y][c.x].object;
    if (!o) return;
    this.snapshot();
    o.rot = ((o.rot ?? 0) + 1) % 4;
    this.r.map.rebuildObject(c);
    this.r.refreshVisibility();
  }

  private showStatus(c: Cell | null): void {
    if (!c) {
      this.status.textContent = '';
      return;
    }
    const cell = this.map.cells[c.z][c.y][c.x];
    const parts = [`(${c.x}, ${c.y}) поверх ${c.z + 1}`, content().terrain.get(cell.terrain)?.name ?? cell.terrain];
    if (!cell.floor) parts.push('без підлоги');
    if (cell.object) parts.push(objectDef(cell.object.defId).name + (cell.object.rot ? ` (поворот ${cell.object.rot * 90}°)` : ''));
    for (const sd of ['n', 'w', 's', 'e'] as EdgeSide[]) {
      const e = getEdge(this.map as unknown as MapState, c, sd);
      if (e) parts.push(`${{ n: 'пн', s: 'пд', w: 'зх', e: 'сх' }[sd]}: ${objectDef(e.defId).name}`);
    }
    if (cell.variation) parts.push('випадковий об’єкт');
    if (cell.stairsUp) parts.push('сходи вгору');
    if (cell.elevation) parts.push('пагорб');
    this.status.textContent = parts.join(' · ');
  }

  // ---------- Інтерфейс ----------

  private toast(text: string, good = false): void {
    const t = h('div', { class: 'toast', style: good ? 'background:#2b3b22;border-color:#6d8a47' : '' }, text);
    this.ui.append(t);
    setTimeout(() => t.remove(), 2500);
  }

  private setTool(t: Tool): void {
    this.tool = t;
    this.paintMode = true;
    this.render();
  }

  private isTool(t: Tool): boolean {
    return JSON.stringify(t) === JSON.stringify(this.tool);
  }

  private render(): void {
    this.ui.innerHTML = '';
    const db = content();
    const nameInput = h('input', { type: 'text', value: this.map.name, style: 'width:180px' });
    nameInput.addEventListener('input', () => (this.map.name = nameInput.value));
    const top = h(
      'div',
      { class: 'topbar' },
      h('div', { class: 'row' }, h('span', { class: 'turn-label' }, 'Редактор карт'), h('div', { class: 'field', style: 'flex-direction:row;align-items:center;gap:6px' }, nameInput)),
      h(
        'div',
        { class: 'row' },
        btn('▼', () => (this.r.setViewLevel(this.r.viewLevel - 1), this.render()), { title: 'Поверх нижче' }),
        h('span', { class: 'turn-label' }, `Поверх ${this.r.viewLevel + 1}/${this.map.levels}`),
        btn('▲', () => (this.r.setViewLevel(this.r.viewLevel + 1), this.render()), { title: 'Поверх вище' }),
        btn('⟲', () => this.r.rotate(-1)),
        btn('⟳', () => this.r.rotate(1)),
        btn('↶ Скасувати', () => this.doUndo(), { title: 'Ctrl+Z', disabled: !this.undo.length }),
        btn('Розмір…', () => this.sizeDialog()),
        btn('Зберегти', () => this.save(), { cls: 'primary' }),
        btn('Експорт', () => this.export()),
        btn('Імпорт', () => void this.import()),
        btn('Вийти', () => this.onExit()),
      ),
    );
    const pal = h('div', { class: 'unitlist panel', style: 'width:230px;gap:8px' });
    const section = (title: string, ...items: HTMLElement[]) => h('div', { class: 'col' }, h('b', {}, title), h('div', { class: 'row', style: 'gap:4px' }, ...items));
    const swatch = (color: string) => h('i', { style: `display:inline-block;width:12px;height:12px;border-radius:2px;margin-right:6px;background:${color};vertical-align:-1px` });
    const toolBtn = (label: string, t: Tool, color?: string) => {
      const b = btn('', () => this.setTool(t), { on: this.isTool(t) });
      if (color) b.append(swatch(color));
      b.append(label);
      b.style.minHeight = 'calc(var(--btn) * 0.8)';
      b.style.padding = '0 8px';
      return b;
    };
    pal.append(
      section(
        'Режим',
        btn('Малювати', () => ((this.paintMode = true), this.render()), { on: this.paintMode }),
        btn('Камера', () => ((this.paintMode = false), this.render()), { on: !this.paintMode, title: 'На сенсорному екрані: перетягування рухає карту' }),
      ),
      section('Пензель', ...[1, 2, 3].map((n) => btn(`${n}×${n}`, () => ((this.brush = n), (this.rectMode = false), this.render()), { on: !this.rectMode && this.brush === n })), btn('Прямокутник', () => ((this.rectMode = true), this.render()), { on: this.rectMode })),
      section('Місцевість', ...[...db.terrain.values()].map((t) => toolBtn(t.name, { kind: 'terrain', id: t.id }, t.color))),
      ...OBJ_GROUPS.map(([title, ids]) => section(title, ...ids.map((id) => toolBtn(objectDef(id).name, { kind: 'object', id }, objectDef(id).color)))),
      section(
        'Інше',
        toolBtn('Гумка', { kind: 'erase' }),
        toolBtn('Підлога', { kind: 'floor' }),
        toolBtn('Прибрати підлогу', { kind: 'nofloor' }),
        toolBtn('Сходи вгору', { kind: 'stairs' }),
        toolBtn('Пагорб', { kind: 'hill', value: 0.35 }),
        toolBtn('Рівна земля', { kind: 'hill', value: 0 }),
        toolBtn('Випадковий об’єкт', { kind: 'variation' }, '#d070e0'),
      ),
      h('div', { class: 'muted', style: 'font-size:0.85em' }, 'Ліва кнопка — малювати; права — зсув; WASD — рух; Q/E — обертання камери; Ctrl+Z — скасувати. Стіни, вікна, двері, паркани, мішки й парапети ставляться на найближчу до курсора межу клітинки; «Прямокутник» з ними будує кімнату по периметру. R — повернути об’єкт у клітинці. «Випадковий об’єкт» щоразу інший при старті місії.'),
    );
    this.ui.append(top, pal, this.status);
  }

  private sizeDialog(): void {
    const num = (v: number, min: number, max: number) => h('input', { type: 'number', value: v, min, max, style: 'width:90px' });
    const w = num(this.map.width, 8, 64);
    const hh = num(this.map.height, 8, 64);
    const l = num(this.map.levels, 1, 4);
    const body = h(
      'div',
      { class: 'col' },
      h('div', { class: 'row' }, h('label', {}, 'Ширина'), w, h('label', {}, 'Висота'), hh, h('label', {}, 'Поверхів'), l),
      h('p', { class: 'muted' }, 'При зменшенні край карти обрізається.'),
    );
    const back = modal('Розмір карти', body, () => {}, [
      btn('Застосувати', () => {
        this.snapshot();
        const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, Math.round(v) || a));
        this.map = resizeMap(this.map, clamp(+w.value, 8, 64), clamp(+hh.value, 8, 64), clamp(+l.value, 1, 4));
        this.undo = [];
        this.reload();
        back.remove();
        this.render();
      }, { cls: 'primary' }),
    ]);
    this.ui.append(back);
  }

  private save(): void {
    const v = validateMap(this.map);
    if (v.errors.length) return this.toast(v.errors.join('; '));
    if (BUILTIN_IDS.has(this.map.id)) this.map.id = `map_${Date.now().toString(36)}`; // вбудовану карту зберігаємо як копію
    try {
      saveMap(toDefinition(this.map));
      this.toast(`Карту «${this.map.name}» збережено${v.warnings.length ? `. Увага: ${v.warnings.join('; ')}` : ''}`, true);
    } catch (e) {
      this.toast((e as Error).message);
    }
  }

  private export(): void {
    downloadJson(`warfare-map-${this.map.name.replace(/\s+/g, '_')}.json`, { format: 'warfare-map', version: 1, map: toDefinition(this.map) });
  }

  private async import(): Promise<void> {
    try {
      const { map } = unpackShared(await pickJsonFile());
      if (!map) return this.toast('У файлі немає карти');
      this.map = fromDefinition(map);
      this.undo = [];
      this.reload();
      this.render();
    } catch (e) {
      this.toast((e as Error).message);
    }
  }
}
