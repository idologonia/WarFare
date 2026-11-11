import '@/ui/styles.css';
import { BUILTIN_IDS, content } from '@/content';
import { deleteFromLibrary, loadLibrary } from '@/persistence/library';
import { MapEditor } from '@/tools/mapEditor';
import { fromDefinition, type EditMap } from '@/tools/mapModel';
import { ScenarioEditor } from '@/tools/scenarioEditor';
import { GAME_VERSION } from '@/core/version';
import { createMission, Mission } from '@/game/simulation/mission';
import { computeResult } from '@/game/scenarios/result';
import type { Difficulty, Scenario, SideId } from '@/game/types';
import { deleteSave, exportToFile, importFromFile, listSaves, loadGame, saveGame, SLOTS } from '@/persistence/saves';
import { Renderer } from '@/rendering/renderer';
import { Music } from '@/ui/audio';
import { Battle, type BattleMode } from '@/ui/battle';
import { openOnlineMenu } from '@/ui/onlineMenu';
import { openHgsMenu } from '@/ui/hgsMenu';
import { hgsLink } from '@/net/hgsClient';
import type { OnlineLink } from '@/net/link';
import type { NetClient } from '@/net/client';
import { loadoutSummary } from '@/ui/loadout';
import { openLoadout } from '@/ui/gunsmith';
import type { MissionState } from '@/game/simulation/state';
import { btn, h, modal } from '@/ui/dom';
import { resultsBody, statusName } from '@/ui/panels';
import { applySettings, loadSettings, saveSettings, type Settings } from '@/ui/settings';

/** Життєвий цикл застосунку: меню → підготовка → бій → результати. */
class App {
  settings: Settings = loadSettings();
  music = new Music();
  renderer!: Renderer;
  battle: Battle | null = null;
  battleMode: BattleMode = 'ai';
  app = document.getElementById('app')!;
  ui = h('div', { class: 'layer' });

  async start(): Promise<void> {
    applySettings(this.settings);
    loadLibrary();
    this.music.volume = this.settings.music;
    const canvas = h('canvas', { id: 'view' });
    this.app.append(canvas, this.ui);
    this.renderer = new Renderer(canvas, { shadows: this.settings.shadows, renderScale: this.settings.renderScale, engine: this.settings.engine, animSpeed: this.settings.animSpeed, postfx: this.settings.postfx });
    await this.renderer.init();
    window.addEventListener('pointerdown', () => this.music.unlock(), { once: true });
    this.mainMenu();
  }

  private editor: { dispose(): void } | null = null;
  private net: NetClient | null = null;

  /** Гра по мережі через HOME GAME SERVER (основний варіант). */
  private hgsMenu(): void {
    this.clear();
    const dispose = openHgsMenu(this.ui, {
      back: () => void this.mainMenu(),
      reserve: () => this.onlineMenu(),
      start: (c, side, state) => this.startOnlineLink(hgsLink(c, side), state),
    });
    this.editor = { dispose };
  }

  /** Бій по мережі (будь-який зв'язок: HGS або резервний сервер). */
  private link: OnlineLink | null = null;
  private startOnlineLink(link: OnlineLink, state: MissionState): void {
    this.editor = null;
    this.clear();
    this.link = link;
    this.battleMode = 'online';
    this.music.play('battle');
    const battle = new Battle(this.ui, this.renderer, new Mission(state), 'online', {
      onEnd: (mm) => this.results(mm),
      onMenu: () => this.battleMenu(),
      autosave: () => {},
      net: { side: link.side, send: (cmd) => link.send(cmd) },
    });
    this.battle = battle;
    link.attach({
      remote: (cmd) => this.battle === battle && battle.applyRemote(cmd),
      state: (st, err) => this.battle === battle && battle.syncState(st, err),
      notice: (t) => this.battle === battle && battle.netNotice(t),
    });
  }

  /** Резервний власний сервер (start-server.bat). */
  private onlineMenu(): void {
    this.clear();
    const dispose = openOnlineMenu(this.ui, {
      back: () => void this.mainMenu(),
      start: (net, side, state) => this.startOnline(net, side, state),
    });
    this.editor = { dispose };
  }

  private startOnline(net: NetClient, side: SideId, state: MissionState): void {
    this.editor = null;
    this.clear();
    this.net = net;
    this.battleMode = 'online';
    this.music.play('battle');
    const battle = new Battle(this.ui, this.renderer, new Mission(state), 'online', {
      onEnd: (mm) => this.results(mm),
      onMenu: () => this.battleMenu(),
      autosave: () => {},
      net: { side, send: (cmd) => net.send({ t: 'cmd', seq: 0, cmd }) },
    });
    this.battle = battle;
    net.onMessage = (m) => {
      if (this.battle !== battle) return;
      if (m.t === 'cmd') battle.applyRemote(m.cmd);
      else if (m.t === 'sync') battle.syncState(m.state, m.error);
      else if (m.t === 'peer') battle.netNotice(m.connected ? 'Суперник на зв’язку' : 'Суперник від’єднався — чекаємо повернення');
      else if (m.t === 'error') battle.netNotice(m.error);
    };
    net.onClose = () => this.battle === battle && battle.netNotice('Зв’язок із сервером втрачено');
  }

  private clear(): void {
    if (this.link && this.battle) {
      this.link.close();
      this.link = null;
    }
    if (this.net && this.battleMode === 'online' && this.battle) {
      this.net.close();
      this.net = null;
    }
    this.battle?.dispose();
    this.battle = null;
    this.editor?.dispose();
    this.editor = null;
    this.ui.innerHTML = '';
  }

  // ---------- Головне меню ----------

  async mainMenu(): Promise<void> {
    this.clear();
    this.music.play('menu');
    const saves = await listSaves();
    const auto = saves.find((s) => s.slot === 'auto');
    const box = h(
      'div',
      { class: 'menu-box' },
      h('div', { class: 'title-logo', style: 'text-align:center' }, 'WARFARE'),
      h('div', { class: 'muted', style: 'text-align:center;margin-bottom:12px' }, 'Тактична покрокова гра'),
      btn('Нова місія', () => this.newMission(), { cls: 'primary' }),
      btn('Гра по мережі', () => this.hgsMenu()),
      auto ? btn(`Продовжити (${auto.name})`, () => void this.loadSlot('auto')) : null,
      btn('Завантажити', () => this.loadMenu()),
      btn('Імпорт збереження з файлу', () => this.importSave()),
      btn('Редактор карт', () => this.mapEditorMenu()),
      btn('Редактор сценаріїв', () => this.scenarioEditorMenu()),
      btn('Налаштування', () => this.settingsModal()),
      h('div', { class: 'muted', style: 'text-align:center;margin-top:16px;font-size:0.85em' }, `Версія ${GAME_VERSION} · одиночна гра працює офлайн`),
    );
    this.ui.append(h('div', { class: 'menu' }, box));
  }

  private newMission(): void {
    this.clear();
    const sc = [...content().scenarios.values()];
    let scenarioId = sc[0].id;
    let difficulty: Difficulty = 'medium';
    let mode: BattleMode = 'ai';
    const seg = <T extends string>(opts: [T, string][], get: () => T, set: (v: T) => void) => {
      const wrap = h('div', { class: 'seg' });
      const draw = () => {
        wrap.innerHTML = '';
        for (const [v, l] of opts) wrap.append(btn(l, () => (set(v), draw()), { on: get() === v }));
      };
      draw();
      return wrap;
    };
    const desc = h('p', { class: 'muted' }, sc[0].description);
    const describe = (id: string) => {
      const x = content().scenarios.get(id)!;
      const m = content().maps.get(x.mapId);
      desc.textContent = `${x.description || 'Без опису.'} Карта: ${m?.name ?? '?'}.${BUILTIN_IDS.has(x.id) ? '' : ' (користувацький)'}`;
    };
    describe(scenarioId);
    const box = h(
      'div',
      { class: 'menu-box panel', style: 'padding:16px' },
      h('h2', {}, 'Нова місія'),
      h('div', { class: 'field' }, h('label', {}, 'Сценарій'), seg(sc.map((s) => [s.id, s.name] as [string, string]), () => scenarioId, (v) => ((scenarioId = v), describe(v)))),
      desc,
      h('div', { class: 'field' }, h('label', {}, 'Рівень AI'), seg<Difficulty>([['easy', 'Легкий'], ['medium', 'Середній'], ['hard', 'Важкий']], () => difficulty, (v) => (difficulty = v))),
      h(
        'div',
        { class: 'field' },
        h('label', {}, 'Режим'),
        seg<BattleMode>([['ai', 'Проти AI'], ['hotseat', 'Двоє на одному пристрої'], ['test', 'Тест: обидві сторони']], () => mode, (v) => (mode = v)),
      ),
      h('div', { class: 'muted', style: 'font-size:0.85em' }, 'PvP і кооператив через інтернет — на етапі мережевої гри.'),
      h('div', { class: 'row', style: 'margin-top:8px' }, btn('Назад', () => this.mainMenu()), btn('До підготовки', () => this.prep(scenarioId, difficulty, mode), { cls: 'primary' })),
    );
    this.ui.append(h('div', { class: 'menu' }, box));
  }

  /** Підготовка: згенерований склад, характеристики й спорядження. */
  private prep(scenarioId: string, difficulty: Difficulty, mode: BattleMode, seed?: number): void {
    this.clear();
    const scDef = content().scenarios.get(scenarioId)!;
    // Проти AI: керування сторонами як у сценарії (хоча б одна — гравець).
    let controllers: Record<SideId, 'human' | 'ai'> = { blue: 'human', red: 'human' };
    if (mode === 'ai') {
      controllers = { blue: scDef.sides.blue.controller, red: scDef.sides.red.controller };
      if (controllers.blue === 'ai' && controllers.red === 'ai') controllers.blue = 'human';
      if (controllers.blue === 'human' && controllers.red === 'human') controllers.red = 'ai';
    }
    const state = createMission(scenarioId, { seed, difficulty, controllers, revealAll: mode === 'test' });
    this.renderPrep(state, scenarioId, difficulty, mode);
  }

  /** Підготовка й управління підрозділом: характеристики, зброя, модифікації (лише до місії). */
  private renderPrep(state: MissionState, scenarioId: string, difficulty: Difficulty, mode: BattleMode): void {
    this.clear();
    const mine = state.units.filter((u) => state.controllers[u.side] === 'human');
    const cls = (id: string) => content().classes.get(id)?.name ?? id;
    const rerender = () => this.renderPrep(state, scenarioId, difficulty, mode);
    const rows = mine.map((u) =>
      h(
        'tr',
        { style: `border-left:3px solid var(--${u.side})` },
        h('td', {}, h('b', {}, u.callsign), h('div', { class: 'muted' }, u.name)),
        h('td', {}, cls(u.classId)),
        h('td', {}, `${u.stats.health}`),
        h('td', {}, `${u.stats.training}`),
        h('td', {}, `${u.stats.reaction}`),
        h('td', {}, `${u.stats.perception}`),
        h('td', {}, `${u.stats.strength}`),
        h('td', {}, loadoutSummary(u)),
        h('td', {}, btn('Спорядження', () => this.ui.append(openLoadout(state, u, rerender)))),
      ),
    );
    const box = h(
      'div',
      { class: 'panel', style: 'width:min(1100px,100%);padding:16px;overflow-x:auto' },
      h('h2', {}, `Підготовка: ${state.scenario.name}`),
      h('p', { class: 'muted' }, state.scenario.description),
      h('table', {}, h('tr', {}, ...['Боєць', 'Клас', 'Здоров’я', 'Навчен.', 'Реакція', 'Сприйн.', 'Сила', 'Зброя і вага', ''].map((t) => h('th', {}, t))), ...rows),
      h('p', { class: 'muted' }, `Противник: ${state.units.filter((u) => state.controllers[u.side] === 'ai').length || '—'} бійців. Зброю, модифікації й магазини можна змінити лише зараз, до місії.`),
      h(
        'div',
        { class: 'row' },
        btn('Назад', () => this.newMission()),
        btn('Інший склад', () => this.prep(scenarioId, difficulty, mode)),
        btn('До розгортання', () => this.startBattle(new Mission(state), mode), { cls: 'primary' }),
      ),
    );
    this.ui.append(h('div', { class: 'menu' }, box));
  }

  private startBattle(m: Mission, mode: BattleMode): void {
    this.clear();
    this.battleMode = mode;
    this.music.play('battle');
    this.battle = new Battle(this.ui, this.renderer, m, mode, {
      onEnd: (mm) => this.results(mm),
      onMenu: () => this.battleMenu(),
      autosave: (mm) => void saveGame('auto', mm.state).catch(() => {}),
    });
  }

  // ---------- Редактори ----------

  private pickList(title: string, items: { label: string; sub: string; open: () => void; remove?: () => void }[], extra: HTMLElement[]): void {
    this.clear();
    const box = h('div', { class: 'menu-box panel', style: 'padding:16px;width:min(560px,100%)' }, h('h2', {}, title), ...extra);
    for (const it of items)
      box.append(
        h(
          'div',
          { class: 'row', style: 'border-top:1px solid var(--line);padding-top:6px' },
          h('div', { style: 'flex:1' }, h('b', {}, it.label), h('div', { class: 'muted', style: 'font-size:0.85em' }, it.sub)),
          btn('Відкрити', it.open),
          it.remove ? btn('Видалити', it.remove, { cls: 'danger' }) : null,
        ),
      );
    box.append(btn('Назад', () => void this.mainMenu()));
    this.ui.append(h('div', { class: 'menu' }, box));
  }

  private mapEditorMenu(): void {
    const maps = [...content().maps.values()];
    this.pickList(
      'Редактор карт',
      maps.map((m) => ({
        label: m.name,
        sub: `${m.width}×${m.height}, поверхів: ${m.layers.length}${BUILTIN_IDS.has(m.id) ? ' · вбудована (збережеться копією)' : ''}`,
        open: () => this.openMapEditor(fromDefinition(m)),
        remove: BUILTIN_IDS.has(m.id) ? undefined : () => (deleteFromLibrary('map', m.id), this.mapEditorMenu()),
      })),
      [h('div', { class: 'row' }, btn('Нова карта', () => this.openMapEditor(null), { cls: 'primary' }))],
    );
  }

  private openMapEditor(map: EditMap | null): void {
    this.clear();
    this.music.play('menu');
    this.editor = new MapEditor(this.ui, this.renderer, map, () => this.mapEditorMenu());
  }

  private scenarioEditorMenu(): void {
    const list = [...content().scenarios.values()];
    this.pickList(
      'Редактор сценаріїв',
      list.map((sc) => ({
        label: sc.name,
        sub: `${content().maps.get(sc.mapId)?.name ?? 'карта відсутня'}${BUILTIN_IDS.has(sc.id) ? ' · вбудований (збережеться копією)' : ''}`,
        open: () => this.openScenarioEditor(sc),
        remove: BUILTIN_IDS.has(sc.id) ? undefined : () => (deleteFromLibrary('scenario', sc.id), this.scenarioEditorMenu()),
      })),
      [h('div', { class: 'row' }, btn('Новий сценарій', () => this.openScenarioEditor(null), { cls: 'primary' }))],
    );
  }

  private openScenarioEditor(sc: Scenario | null): void {
    this.clear();
    this.editor = new ScenarioEditor(this.ui, sc, () => this.scenarioEditorMenu(), (s) => this.prep(s.id, s.difficulty, 'ai'));
  }

  // ---------- Меню в бою ----------

  private battleMenu(): void {
    const b = this.battle;
    if (!b) return;
    const body = h('div', { class: 'col' });
    const back = modal('Меню', body, () => {});
    const close = () => back.remove();
    for (const slot of SLOTS.filter((s) => s !== 'auto'))
      body.append(btn(`Зберегти в ${slot.replace('slot', 'слот ')}`, () => void saveGame(slot, b.m.state).then(() => (close(), this.note('Збережено')))));
    body.append(
      btn('Експорт у файл', () => exportToFile(b.m.state)),
      btn('Налаштування', () => (close(), this.settingsModal())),
      btn('Завершити бій достроково (відхід)', () => {
        close();
        const res = b.m.dispatch({ type: 'withdraw', side: b.m.state.turn.side });
        if (res.ok) this.results(b.m);
      }, { cls: 'danger' }),
      btn('Головне меню', () => (close(), void this.mainMenu())),
    );
    this.ui.append(back);
  }

  private note(text: string): void {
    const t = h('div', { class: 'toast', style: 'background:#2b3b22;border-color:#6d8a47' }, text);
    this.ui.append(t);
    setTimeout(() => t.remove(), 1800);
  }

  private results(m: Mission): void {
    const r = m.state.result ?? computeResult(m.state, null, 'withdrawal');
    const viewer: SideId = this.battleMode === 'online' && this.battle ? this.battle.viewerSide : this.battleMode === 'ai' ? (m.state.controllers.blue === 'human' ? 'blue' : 'red') : 'blue';
    this.clear();
    this.music.play('menu');
    void deleteSave('auto').catch(() => {});
    const box = h(
      'div',
      { class: 'panel', style: 'width:min(980px,100%);padding:16px' },
      resultsBody(r, viewer),
      h('p', { class: 'muted' }, `Наслідки: поранені, яких евакуювали, повертаються відновленими. Неевакуйовані втрати: ${m.state.units.filter((u) => u.side === viewer && (u.status === 'dead' || u.status === 'down')).map((u) => `${u.callsign} (${statusName(u.status)})`).join(', ') || 'немає'}.`),
      h('div', { class: 'row' }, btn('Нова місія', () => this.newMission(), { cls: 'primary' }), btn('Головне меню', () => void this.mainMenu())),
    );
    this.ui.append(h('div', { class: 'menu' }, box));
  }

  // ---------- Збереження ----------

  private async loadSlot(slot: string): Promise<void> {
    try {
      const s = await loadGame(slot);
      if (!s) return this.note('Порожній слот');
      const mode: BattleMode = s.revealAll ? 'test' : s.controllers.red === 'ai' || s.controllers.blue === 'ai' ? 'ai' : 'hotseat';
      this.startBattle(new Mission(s), mode);
    } catch (e) {
      this.note((e as Error).message);
    }
  }

  private async loadMenu(): Promise<void> {
    const saves = await listSaves();
    const body = h('div', { class: 'col' });
    const back = modal('Завантажити', body, () => {});
    for (const slot of SLOTS) {
      const rec = saves.find((s) => s.slot === slot);
      const label = slot === 'auto' ? 'Автозбереження' : slot.replace('slot', 'Слот ');
      body.append(
        h(
          'div',
          { class: 'row' },
          h('div', { style: 'flex:1' }, h('b', {}, label), h('div', { class: 'muted' }, rec ? `${rec.name} · ${new Date(rec.savedAt).toLocaleString('uk-UA')} · v${rec.gameVersion}` : 'порожньо')),
          btn('Завантажити', () => (back.remove(), void this.loadSlot(slot)), { disabled: !rec }),
          btn('Видалити', () => void deleteSave(slot).then(() => (back.remove(), this.loadMenu())), { disabled: !rec, cls: 'danger' }),
        ),
      );
    }
    this.ui.append(back);
  }

  private importSave(): void {
    const input = h('input', { type: 'file', accept: '.json,application/json' });
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        const s = await importFromFile(f);
        const mode: BattleMode = s.revealAll ? 'test' : s.controllers.red === 'ai' || s.controllers.blue === 'ai' ? 'ai' : 'hotseat';
        this.startBattle(new Mission(s), mode);
      } catch (e) {
        this.note(`Не вдалося імпортувати: ${(e as Error).message}`);
      }
    });
    input.click();
  }

  // ---------- Налаштування ----------

  private settingsModal(): void {
    const s = this.settings;
    const apply = () => {
      saveSettings(s);
      applySettings(s);
      this.renderer.setShadows(s.shadows);
      this.renderer.setRenderScale(s.renderScale);
      this.renderer.anim.speed = s.animSpeed;
      this.music.setVolume(s.music);
      this.battle?.refresh();
    };
    const range = (label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void) => {
      const out = h('span', { class: 'muted' }, String(get()));
      const inp = h('input', { type: 'range', min, max, step, value: get() });
      inp.addEventListener('input', () => {
        set(Number(inp.value));
        out.textContent = inp.value;
        apply();
      });
      return h('div', { class: 'field' }, h('label', {}, label, ' ', out), inp);
    };
    const toggle = (label: string, opts: [string, string][], get: () => string, set: (v: string) => void) => {
      const wrap = h('div', { class: 'seg' });
      const draw = () => {
        wrap.innerHTML = '';
        for (const [v, l] of opts) wrap.append(btn(l, () => (set(v), apply(), draw()), { on: get() === v }));
      };
      draw();
      return h('div', { class: 'field' }, h('label', {}, label), wrap);
    };
    const body = h(
      'div',
      { class: 'col' },
      h('h3', {}, 'Інтерфейс'),
      range('Масштаб інтерфейсу', 0.7, 1.6, 0.05, () => s.uiScale, (v) => (s.uiScale = v)),
      range('Розмір тексту', 0.8, 1.6, 0.05, () => s.fontScale, (v) => (s.fontScale = v)),
      range('Розмір кнопок (px)', 30, 64, 2, () => s.buttonSize, (v) => (s.buttonSize = v)),
      toggle('Розташування панелей', [['left', 'Список ліворуч'], ['right', 'Список праворуч']], () => s.panelSide, (v) => (s.panelSide = v as Settings['panelSide'])),
      h('h3', {}, 'Графіка'),
      toggle('Пост-обробка (світіння, згладжування)', [['1', 'Увімк.'], ['0', 'Вимк.']], () => (s.postfx ? '1' : '0'), (v) => (s.postfx = v === '1')),
      toggle('Тіні', [['1', 'Увімк.'], ['0', 'Вимк.']], () => (s.shadows ? '1' : '0'), (v) => (s.shadows = v === '1')),
      toggle('Роздільність рендерингу', [['1', 'Повна'], ['1.5', 'Середня'], ['2', 'Низька']], () => String(s.renderScale), (v) => (s.renderScale = Number(v))),
      toggle('Графічний API (після перезапуску)', [['webgl', 'WebGL2 (стабільно)'], ['webgpu', 'WebGPU (експериментально)']], () => s.engine, (v) => (s.engine = v as Settings['engine'])),
      range('Швидкість анімацій', 0.5, 3, 0.25, () => s.animSpeed, (v) => (s.animSpeed = v)),
      h('h3', {}, 'Звук'),
      range('Гучність музики', 0, 1, 0.05, () => s.music, (v) => (s.music = v)),
    );
    this.ui.append(modal('Налаштування', body, () => {}));
  }
}

const app = new App();
// Доступ для автоматичних браузерних перевірок.
(window as unknown as { __wf: App }).__wf = app;
void app.start().catch((e) => {
  document.body.innerHTML = `<pre style="color:#f88;padding:16px;white-space:pre-wrap">Помилка запуску: ${(e as Error).message}</pre>`;
  console.error(e);
});

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
