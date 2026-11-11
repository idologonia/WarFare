import { content } from '@/content';
import { createOnlineMission } from '@/net/onlineMission';
import { hgsCancelOverlay, hgsStart, type HgsClient, type HgsRoom } from '@/net/hgsClient';
import type { MissionState } from '@/game/simulation/state';
import type { Difficulty, SideId } from '@/game/types';
import { btn, h } from './dom';

export interface HgsMenuHooks {
  back: () => void;
  /** Резервний власний сервер (старий онлайн). */
  reserve: () => void;
  start: (c: HgsClient, side: SideId, state: MissionState) => void;
}

const SIDE_NAME: Record<SideId, string> = { blue: 'Синя', red: 'Червона' };

/** Меню мережевої гри через HOME GAME SERVER: вхід, кімнати, очікування суперника. */
export function openHgsMenu(root: HTMLElement, hooks: HgsMenuHooks): () => void {
  let disposed = false;
  let c: HgsClient | null = null;
  let rooms: HgsRoom[] = [];
  let mySide: SideId | null = null;
  let waiting: string | null = null;
  let error = '';
  let timer = 0;
  const offs: (() => void)[] = [];
  const sc = [...content().scenarios.values()];
  const form = { name: 'Кімната', scenarioId: sc[0].id, side: 'blue' as SideId, difficulty: 'medium' as Difficulty };
  const box = h('div', { class: 'menu-box panel', style: 'padding:16px;width:min(640px,100%);position:relative;z-index:2147483001' });
  root.append(h('div', { class: 'menu', style: 'z-index:2147483001' }, box));

  const seg = <T extends string>(opts: [T, string][], get: () => T, set: (v: T) => void) => {
    const wrap = h('div', { class: 'seg' });
    const draw = () => {
      wrap.innerHTML = '';
      for (const [v, l] of opts) wrap.append(btn(l, () => (set(v), draw()), { on: get() === v }));
    };
    draw();
    return wrap;
  };

  const backBtn = () =>
    h('div', { class: 'row', style: 'margin-top:12px' }, btn('Назад', () => (dispose(), hooks.back())), btn('Резервний сервер', () => (dispose(), hooks.reserve()), { title: 'Попередній власний сервер (start-server.bat)' }));

  function draw(): void {
    if (disposed) return;
    box.innerHTML = '';
    box.append(h('h2', {}, 'Гра по мережі'));
    if (!c) {
      box.append(h('p', { class: 'muted' }, 'Підключення до сервера гри… Якщо з’явиться вікно входу — зареєструйтеся (ім’я + пароль) лише першого разу.'), backBtn());
      return;
    }
    box.append(h('div', { class: 'pos', style: 'margin:4px 0 10px;font-weight:600' }, `● Сервер онлайн · ви: ${c.player?.name ?? '?'}`));
    if (error) box.append(h('div', { class: 'neg' }, error));
    if (waiting) {
      box.append(
        h('h3', {}, `Кімната «${waiting}»`),
        h('p', {}, mySide ? `Ваша сторона: ${SIDE_NAME[mySide]}.` : ''),
        h('p', { class: 'muted' }, 'Очікуємо другого гравця… Він побачить кімнату у своєму списку.'),
        btn('Вийти з кімнати', () => {
          waiting = null;
          mySide = null;
          void c!.joinRoom('lobby').catch(() => {});
          draw();
        }),
      );
      return;
    }
    box.append(h('h3', {}, 'Кімнати'));
    const list = h('div', { class: 'col' });
    const battleRooms = rooms.filter((r) => r.id !== 'lobby');
    if (!battleRooms.length) list.append(h('div', { class: 'muted' }, 'Поки немає жодної кімнати.'));
    for (const r of battleRooms) {
      const scn = content().scenarios.get(r.params?.scenarioId ?? '')?.name ?? r.params?.scenarioId ?? '?';
      const full = (r.players ?? 0) >= 2;
      list.append(
        h(
          'div',
          { class: 'row', style: 'border-top:1px solid var(--line);padding-top:6px' },
          h('div', { style: 'flex:1' }, h('b', {}, r.name), h('div', { class: 'muted', style: 'font-size:0.85em' }, `${scn} · господар: ${SIDE_NAME[r.params?.side ?? 'blue']} · гравців ${r.players ?? 0}/2`)),
          btn(full || r.status === 'locked' ? 'Повернутися' : 'Приєднатися', () => void join(r)),
        ),
      );
    }
    box.append(list, btn('Оновити список', () => void refresh()));
    const nameIn = h('input', { type: 'text', value: form.name, maxlength: '40' }) as HTMLInputElement;
    nameIn.addEventListener('input', () => (form.name = nameIn.value));
    box.append(
      h('h3', { style: 'margin-top:14px' }, 'Створити кімнату'),
      h('div', { class: 'field' }, h('label', {}, 'Назва'), nameIn),
      h('div', { class: 'field' }, h('label', {}, 'Сценарій'), seg(sc.map((s) => [s.id, s.name] as [string, string]), () => form.scenarioId, (v) => (form.scenarioId = v))),
      h('div', { class: 'field' }, h('label', {}, 'Ваша сторона'), seg<SideId>([['blue', 'Синя'], ['red', 'Червона']], () => form.side, (v) => (form.side = v))),
      h('div', { class: 'field' }, h('label', {}, 'Складність (характеристики бійців)'), seg<Difficulty>([['easy', 'Легка'], ['medium', 'Середня'], ['hard', 'Важка']], () => form.difficulty, (v) => (form.difficulty = v))),
      btn('Створити', () => void create(), { cls: 'primary' }),
      backBtn(),
    );
  }

  async function refresh(): Promise<void> {
    if (!c || disposed) return;
    try {
      rooms = await c.listRooms();
      error = '';
    } catch (e) {
      error = (e as Error).message;
    }
    draw();
  }

  async function create(): Promise<void> {
    try {
      const r = await c!.createRoom({ name: form.name.trim() || 'Кімната', maxPlayers: 2, params: { scenarioId: form.scenarioId, side: form.side, difficulty: form.difficulty } });
      waiting = r.name;
      draw();
      await c!.joinRoom(r.id);
    } catch (e) {
      waiting = null;
      error = (e as Error).message;
      draw();
    }
  }

  async function join(r: HgsRoom): Promise<void> {
    try {
      waiting = r.name;
      draw();
      await c!.joinRoom(r.id);
    } catch (e) {
      waiting = null;
      error = (e as Error).message;
      draw();
    }
  }

  // Кнопка «Назад» поверх вікна входу / «сервер вимкнено» від SDK (воно перекриває сторінку).
  const floatBack = h('button', { style: 'position:fixed;left:16px;top:16px;z-index:2147483647;padding:9px 14px;border-radius:7px;border:1px solid #2a2f3a;background:#171a21;color:#e6e8ee;font:inherit;cursor:pointer' }, '← Назад до меню');
  floatBack.addEventListener('click', () => (dispose(), hooks.back()));
  document.body.append(floatBack);

  function dispose(cancel = true): void {
    disposed = true;
    floatBack.remove();
    clearInterval(timer);
    offs.forEach((f) => f());
    if (cancel) hgsCancelOverlay();
  }

  draw();
  hgsStart().then(
    (client) => {
      if (disposed) return;
      c = client;
      floatBack.remove();
      offs.push(
        c.on('wf_you', (d: { side: SideId }) => {
          mySide = d.side;
          draw();
        }),
        c.on('wf_start', (d: { scenarioId: string; seed: number; difficulty: Difficulty }) => {
          if (!mySide) return;
          const side = mySide;
          dispose(false);
          hooks.start(client, side, createOnlineMission(d.scenarioId, d.seed, d.difficulty));
        }),
        // Повернення в уже розпочатий бій: сервер одразу надсилає повний стан.
        c.on('wf_state', (d: { state: MissionState }) => {
          if (!mySide || !d.state || disposed) return;
          const side = mySide;
          dispose(false);
          hooks.start(client, side, d.state);
        }),
        c.on('wf_error', (d: { error: string }) => {
          error = d.error;
          waiting = null;
          draw();
        }),
      );
      void refresh();
      timer = window.setInterval(() => !waiting && void refresh(), 5000);
    },
    (e) => {
      error = (e as Error).message;
      draw();
    },
  );
  return () => dispose();
}
