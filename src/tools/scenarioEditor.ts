import { BUILTIN_IDS, content, objectDef, terrainDef } from '@/content';
import { Rng } from '@/core/rng';
import { buildMap, cellsInZone, forEachEdge } from '@/game/maps/map';
import type { AiStyle, ControllerKind, MapDefinition, Scenario, SideId, SideSetup } from '@/game/types';
import { downloadJson, packScenario, pickJsonFile, saveMap, saveScenario, unpackShared } from '@/persistence/library';
import { btn, h } from '@/ui/dom';

type ZoneKey = 'blue' | 'red' | 'evac';
type Rect = [number, number, number, number];

const TYPES: [Scenario['type'], string][] = [
  ['clear', 'Зачистка'],
  ['defense', 'Оборона'],
  ['assault', 'Штурм'],
  ['recon', 'Розвідка'],
  ['hold', 'Утримання об’єктів'],
  ['free', 'Вільний сценарій'],
];

function blankSide(name: string, zone: Rect, controller: ControllerKind): SideSetup {
  return {
    name,
    factionId: 'test',
    controller,
    squad: [{ classId: 'rifleman', count: 2 }, { classId: 'mg1', count: 1 }, { classId: 'marksman', count: 1 }],
    deployZone: zone,
    manualDeploy: controller === 'human',
    aiStyle: controller === 'ai' ? 'cautious' : undefined,
    loadout: { extraMags: 0, extraGrenades: 0, noArmor: false },
  };
}

export function newScenario(mapId: string): Scenario {
  const m = content().maps.get(mapId)!;
  return {
    id: `sc_${Date.now().toString(36)}`,
    name: 'Новий сценарій',
    description: '',
    type: 'clear',
    mapId,
    timeOfDay: 'day',
    weather: 'clear',
    difficulty: 'medium',
    sides: {
      blue: blankSide('Синя сторона', [0, m.height - 4, m.width - 1, m.height - 1], 'human'),
      red: blankSide('Червона сторона', [0, 0, m.width - 1, 3], 'ai'),
    },
    evacZone: [0, m.height - 2, 3, m.height - 1],
    reinforcementDelay: 3,
    victory: { type: 'eliminate' },
    randomEvents: false,
    mapPreview: true,
    maxTurns: 40,
  };
}

/** Перевірка сценарію: зони в межах карти, достатньо місця для розгортання. */
export function validateScenario(sc: Scenario): string[] {
  const errors: string[] = [];
  const def = content().maps.get(sc.mapId);
  if (!def) return ['Карту сценарію не знайдено'];
  if (!sc.name.trim()) errors.push('Вкажіть назву');
  const map = buildMap(def, new Rng(1));
  for (const side of ['blue', 'red'] as SideId[]) {
    const st = sc.sides[side];
    const n = st.squad.reduce((a, q) => a + q.count, 0);
    if (n < 1) errors.push(`${st.name}: немає жодного бійця`);
    const free = cellsInZone(map, st.deployZone).length;
    if (free < n) errors.push(`${st.name}: у зоні розгортання ${free} вільних клітинок на ${n} бійців`);
  }
  if (sc.sides.blue.controller === 'ai' && sc.sides.red.controller === 'ai') errors.push('Хоча б одна сторона має бути під керуванням гравця');
  return errors;
}

/** Редактор сценаріїв: параметри, сили сторін, спорядження, зони на міні-карті. */
export class ScenarioEditor {
  private ui = h('div', { class: 'menu', style: 'align-items:flex-start' });
  private zone: ZoneKey = 'blue';
  private sc: Scenario;

  constructor(private root: HTMLElement, scenario: Scenario | null, private onExit: () => void, private onPlay: (sc: Scenario) => void) {
    this.sc = scenario ? structuredClone(scenario) : newScenario('village');
    if (BUILTIN_IDS.has(this.sc.id)) {
      this.sc.id = `sc_${Date.now().toString(36)}`;
      this.sc.name += ' (копія)';
    }
    for (const side of ['blue', 'red'] as SideId[]) this.sc.sides[side].loadout ??= { extraMags: 0, extraGrenades: 0, noArmor: false };
    root.append(this.ui);
    this.render();
  }

  dispose(): void {
    this.ui.remove();
  }

  private toast(text: string, good = false): void {
    const t = h('div', { class: 'toast', style: good ? 'background:#2b3b22;border-color:#6d8a47' : '' }, text);
    this.root.append(t);
    setTimeout(() => t.remove(), 3000);
  }

  private render(): void {
    const sc = this.sc;
    const db = content();
    this.ui.innerHTML = '';
    const text = (label: string, get: () => string, set: (v: string) => void, area = false) => {
      const el = area ? h('textarea', { rows: 3, style: 'font:inherit;color:var(--text);background:var(--panel-2);border:1px solid var(--line);border-radius:6px;padding:6px' }) : h('input', { type: 'text' });
      el.value = get();
      el.addEventListener('input', () => set(el.value));
      return h('div', { class: 'field' }, h('label', {}, label), el);
    };
    const select = <T extends string>(label: string, opts: [T, string][], get: () => T, set: (v: T) => void, rerender = false) => {
      const el = h('select', {});
      for (const [v, l] of opts) el.append(h('option', { value: v, selected: get() === v }, l));
      el.addEventListener('change', () => {
        set(el.value as T);
        if (rerender) this.render();
      });
      return h('div', { class: 'field' }, h('label', {}, label), el);
    };
    const number = (label: string, get: () => number, set: (v: number) => void, min: number, max: number) => {
      const el = h('input', { type: 'number', value: get(), min, max, style: 'width:80px' });
      el.addEventListener('change', () => set(Math.max(min, Math.min(max, Math.round(+el.value) || 0))));
      return h('div', { class: 'field' }, h('label', {}, label), el);
    };
    const check = (label: string, get: () => boolean, set: (v: boolean) => void) => {
      const el = h('input', { type: 'checkbox', checked: get() });
      el.addEventListener('change', () => set(el.checked));
      return h('label', { class: 'row', style: 'gap:6px' }, el, label);
    };

    const general = h(
      'div',
      { class: 'panel col', style: 'flex:1;min-width:280px' },
      h('h3', {}, 'Загальне'),
      text('Назва', () => sc.name, (v) => (sc.name = v)),
      text('Опис / брифінг', () => sc.description, (v) => (sc.description = v), true),
      select('Тип', TYPES, () => sc.type, (v) => (sc.type = v)),
      select(
        'Карта',
        [...db.maps.values()].map((m) => [m.id, `${m.name} (${m.width}×${m.height})`] as [string, string]),
        () => sc.mapId,
        (v) => {
          const fresh = newScenario(v);
          sc.mapId = v;
          sc.sides.blue.deployZone = fresh.sides.blue.deployZone;
          sc.sides.red.deployZone = fresh.sides.red.deployZone;
          sc.evacZone = fresh.evacZone;
        },
        true,
      ),
      h(
        'div',
        { class: 'row' },
        select('Час доби', [['day', 'День'], ['night', 'Ніч']], () => sc.timeOfDay, (v) => (sc.timeOfDay = v)),
        select('Погода', [['clear', 'Ясно'], ['fog', 'Туман'], ['rain', 'Дощ']], () => sc.weather, (v) => (sc.weather = v)),
        select('Рівень AI', [['easy', 'Легкий'], ['medium', 'Середній'], ['hard', 'Важкий']], () => sc.difficulty, (v) => (sc.difficulty = v)),
      ),
      h(
        'div',
        { class: 'row' },
        number('Ліміт ходів', () => sc.maxTurns ?? 40, (v) => (sc.maxTurns = v), 5, 200),
        number('Підкріплення через (ходів)', () => sc.reinforcementDelay, (v) => (sc.reinforcementDelay = v), 1, 20),
      ),
      h('div', { class: 'field' }, h('label', {}, 'Умова перемоги'), h('div', { class: 'muted' }, 'Знищення або виведення з бою всіх противників (інші умови — разом із механікою об’єктів).')),
      check('Випадкові події (рішення автора сценарію)', () => sc.randomEvents, (v) => (sc.randomEvents = v)),
      check('Карту видно перед місією', () => sc.mapPreview, (v) => (sc.mapPreview = v)),
    );

    const sidePanel = (side: SideId) => {
      const st = sc.sides[side];
      const classes = [...db.classes.values()].filter((c) => c.kit);
      const lo = st.loadout!;
      return h(
        'div',
        { class: 'panel col', style: `flex:1;min-width:260px;border-color:var(--${side})` },
        h('h3', {}, side === 'blue' ? 'Сторона 1 (синя)' : 'Сторона 2 (червона)'),
        text('Назва', () => st.name, (v) => (st.name = v)),
        h(
          'div',
          { class: 'row' },
          select<ControllerKind>('Керування', [['human', 'Гравець'], ['ai', 'AI']], () => st.controller, (v) => ((st.controller = v), (st.manualDeploy = v === 'human')), true),
          st.controller === 'ai'
            ? select<AiStyle>('Стиль AI', [['aggressive', 'Агресивний'], ['cautious', 'Обережний'], ['defensive', 'Оборонний']], () => st.aiStyle ?? 'cautious', (v) => (st.aiStyle = v))
            : check('Ручне розгортання', () => st.manualDeploy, (v) => (st.manualDeploy = v)),
        ),
        h('b', {}, 'Склад'),
        ...classes.map((c) =>
          number(c.name, () => st.squad.find((q) => q.classId === c.id)?.count ?? 0, (v) => {
            st.squad = st.squad.filter((q) => q.classId !== c.id);
            if (v > 0) st.squad.push({ classId: c.id, count: v });
          }, 0, 12),
        ),
        h('b', {}, 'Спорядження'),
        h(
          'div',
          { class: 'row' },
          number('Запасні магазини ±', () => lo.extraMags, (v) => (lo.extraMags = v), -6, 6),
          number('Додаткові гранати', () => lo.extraGrenades, (v) => (lo.extraGrenades = v), 0, 4),
        ),
        check('Без бронежилетів і касок', () => lo.noArmor, (v) => (lo.noArmor = v)),
        select<NonNullable<typeof lo.helmetMount>>('На каску', [['none', 'Нічого'], ['flashlight', 'Ліхтар'], ['nvg_mono', 'ПНБ моно + ліхтар'], ['nvg_bino', 'ПНБ біно + ліхтар']], () => lo.helmetMount ?? 'flashlight', (v) => (lo.helmetMount = v)),
      );
    };

    const head = h(
      'div',
      { class: 'row', style: 'justify-content:space-between;width:100%' },
      h('h2', { style: 'margin:0' }, 'Редактор сценаріїв'),
      h(
        'div',
        { class: 'row' },
        btn('Зберегти', () => this.save(), { cls: 'primary' }),
        btn('Грати', () => this.play()),
        btn('Експорт', () => this.export()),
        btn('Імпорт', () => void this.import()),
        btn('Вийти', () => this.onExit()),
      ),
    );
    this.ui.append(
      h(
        'div',
        { class: 'col', style: 'width:min(1180px,100%);gap:10px' },
        head,
        h('div', { class: 'row', style: 'align-items:flex-start;gap:10px' }, general, this.zonePanel()),
        h('div', { class: 'row', style: 'align-items:flex-start;gap:10px' }, sidePanel('blue'), sidePanel('red')),
      ),
    );
  }

  /** Міні-карта зверху: перетягуванням задаються зони розгортання та евакуації. */
  private zonePanel(): HTMLElement {
    const sc = this.sc;
    const def = content().maps.get(sc.mapId)!;
    const map = buildMap(def, new Rng(1));
    const cell = Math.max(6, Math.min(16, Math.floor(420 / Math.max(map.width, map.height))));
    const canvas = h('canvas', { width: map.width * cell, height: map.height * cell, style: 'touch-action:none;cursor:crosshair;max-width:100%;image-rendering:pixelated;border:1px solid var(--line)' });
    const ctx = canvas.getContext('2d')!;
    const zoneColors: Record<ZoneKey, string> = { blue: 'rgba(61,130,232,0.45)', red: 'rgba(229,70,59,0.45)', evac: 'rgba(80,220,240,0.45)' };
    const draw = (preview?: Rect) => {
      for (let y = 0; y < map.height; y++)
        for (let x = 0; x < map.width; x++) {
          // Показуємо найвищий поверх із підлогою.
          let col = '#000';
          for (let z = map.levels - 1; z >= 0; z--) {
            const c = map.cells[z][y][x];
            if (!c.floor) continue;
            col = c.object ? objectDef(c.object.defId).color : terrainDef(c.terrain).color;
            break;
          }
          ctx.fillStyle = col;
          ctx.fillRect(x * cell, y * cell, cell, cell);
        }
      // Тонкі стіни й паркани — лінії на межах клітинок.
      forEachEdge(map, (c, side, e) => {
        ctx.fillStyle = objectDef(e.defId).color;
        const t = Math.max(2, cell / 5);
        if (side === 'n') ctx.fillRect(c.x * cell, c.y * cell - t / 2, cell, t);
        else if (side === 's') ctx.fillRect(c.x * cell, (c.y + 1) * cell - t / 2, cell, t);
        else if (side === 'w') ctx.fillRect(c.x * cell - t / 2, c.y * cell, t, cell);
        else ctx.fillRect((c.x + 1) * cell - t / 2, c.y * cell, t, cell);
      });
      const zones: [ZoneKey, Rect | null][] = [['blue', sc.sides.blue.deployZone], ['red', sc.sides.red.deployZone], ['evac', sc.evacZone]];
      for (const [k, z] of zones) {
        const r = k === this.zone && preview ? preview : z;
        if (!r) continue;
        ctx.fillStyle = zoneColors[k];
        ctx.fillRect(r[0] * cell, r[1] * cell, (r[2] - r[0] + 1) * cell, (r[3] - r[1] + 1) * cell);
        ctx.strokeStyle = zoneColors[k].replace('0.45', '1');
        ctx.lineWidth = 2;
        ctx.strokeRect(r[0] * cell + 1, r[1] * cell + 1, (r[2] - r[0] + 1) * cell - 2, (r[3] - r[1] + 1) * cell - 2);
      }
    };
    draw();
    let start: [number, number] | null = null;
    const at = (e: PointerEvent): [number, number] => {
      const rect = canvas.getBoundingClientRect();
      const k = canvas.width / rect.width;
      return [
        Math.max(0, Math.min(map.width - 1, Math.floor(((e.clientX - rect.left) * k) / cell))),
        Math.max(0, Math.min(map.height - 1, Math.floor(((e.clientY - rect.top) * k) / cell))),
      ];
    };
    const rectOf = (a: [number, number], b: [number, number]): Rect => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      start = at(e);
      draw(rectOf(start, start));
    });
    canvas.addEventListener('pointermove', (e) => start && draw(rectOf(start, at(e))));
    canvas.addEventListener('pointerup', (e) => {
      if (!start) return;
      const r = rectOf(start, at(e));
      if (this.zone === 'evac') sc.evacZone = r;
      else sc.sides[this.zone].deployZone = r;
      start = null;
      draw();
    });
    const zoneBtn = (k: ZoneKey, label: string) => btn(label, () => ((this.zone = k), this.render()), { on: this.zone === k });
    return h(
      'div',
      { class: 'panel col', style: 'flex:1;min-width:280px' },
      h('h3', {}, 'Стартові позиції та зони'),
      h('div', { class: 'row' }, zoneBtn('blue', 'Розгортання 1'), zoneBtn('red', 'Розгортання 2'), zoneBtn('evac', 'Евакуація'), btn('Без евакуації', () => ((sc.evacZone = null), this.render()), { disabled: !sc.evacZone })),
      h('div', { class: 'muted', style: 'font-size:0.85em' }, 'Оберіть зону й протягніть прямокутник на карті. Розгортання враховує всі поверхи в межах зони.'),
      canvas,
    );
  }

  private save(): boolean {
    const errors = validateScenario(this.sc);
    if (errors.length) {
      this.toast(errors.join('; '));
      return false;
    }
    saveScenario(structuredClone(this.sc));
    this.toast(`Сценарій «${this.sc.name}» збережено`, true);
    return true;
  }

  private play(): void {
    if (this.save()) this.onPlay(structuredClone(this.sc));
  }

  private export(): void {
    const map = content().maps.get(this.sc.mapId) as MapDefinition;
    downloadJson(`warfare-scenario-${this.sc.name.replace(/\s+/g, '_')}.json`, packScenario(this.sc, map));
  }

  private async import(): Promise<void> {
    try {
      const { scenario, map } = unpackShared(await pickJsonFile());
      if (map && !BUILTIN_IDS.has(map.id)) saveMap(map);
      if (!scenario) return this.toast('У файлі немає сценарію');
      this.sc = scenario;
      for (const side of ['blue', 'red'] as SideId[]) this.sc.sides[side].loadout ??= { extraMags: 0, extraGrenades: 0, noArmor: false };
      this.render();
      this.toast('Сценарій імпортовано — збережіть, щоб додати в бібліотеку', true);
    } catch (e) {
      this.toast((e as Error).message);
    }
  }
}
