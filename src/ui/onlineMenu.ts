import { content } from '@/content';
import type { MissionState } from '@/game/simulation/state';
import type { Difficulty, SideId } from '@/game/types';
import { checkServer, NetClient, serverUrl, setServerUrl } from '@/net/client';
import type { RoomInfo, ServerMsg } from '@/net/protocol';
import { btn, h } from './dom';

export interface OnlineHooks {
  back: () => void;
  start: (net: NetClient, side: SideId, state: MissionState, roomId: string) => void;
}

const SIDE_NAME: Record<SideId, string> = { blue: 'Синя', red: 'Червона' };

/** Меню мережевої гри: адреса сервера, перевірка, список кімнат, створення кімнати. */
export function openOnlineMenu(root: HTMLElement, hooks: OnlineHooks): () => void {
  let net: NetClient | null = null;
  let disposed = false;
  let rooms: RoomInfo[] = [];
  let status = 'Перевірка сервера…';
  let online = false;
  let waiting: { room: RoomInfo; side: SideId } | null = null;
  let error = '';
  let timer = 0;

  const sc = [...content().scenarios.values()];
  const form = { name: 'Кімната', scenarioId: sc[0].id, side: 'blue' as SideId, difficulty: 'medium' as Difficulty };
  const urlInput = h('input', { type: 'text', value: serverUrl(), placeholder: 'https://….trycloudflare.com', style: 'flex:1;min-width:0' }) as HTMLInputElement;
  const box = h('div', { class: 'menu-box panel', style: 'padding:16px;width:min(640px,100%)' });
  root.append(h('div', { class: 'menu' }, box));

  const seg = <T extends string>(opts: [T, string][], get: () => T, set: (v: T) => void) => {
    const wrap = h('div', { class: 'seg' });
    const draw = () => {
      wrap.innerHTML = '';
      for (const [v, l] of opts) wrap.append(btn(l, () => (set(v), draw()), { on: get() === v }));
    };
    draw();
    return wrap;
  };

  function draw(): void {
    if (disposed) return;
    box.innerHTML = '';
    box.append(h('h2', {}, 'Гра по мережі'));
    box.append(
      h('div', { class: 'field' }, h('label', {}, 'Адреса сервера'), h('div', { class: 'row' }, urlInput, btn('Підключитися', () => void connect(), { cls: 'primary' }))),
      h('div', { class: online ? 'pos' : 'neg', style: 'margin:4px 0 10px' }, `● ${status}`),
    );
    if (error) box.append(h('div', { class: 'neg' }, error));
    if (waiting) {
      box.append(
        h('h3', {}, `Кімната «${waiting.room.name}»`),
        h('p', {}, `Сценарій: ${waiting.room.scenarioName}. Ваша сторона: ${SIDE_NAME[waiting.side]}.`),
        h('p', { class: 'muted' }, 'Очікуємо другого гравця… Він побачить кімнату у своєму списку.'),
        btn('Скасувати', () => {
          net?.send({ t: 'leave' });
          waiting = null;
          draw();
        }),
      );
      return;
    }
    if (online && net?.open) {
      box.append(h('h3', {}, 'Кімнати'));
      const list = h('div', { class: 'col' });
      if (!rooms.length) list.append(h('div', { class: 'muted' }, 'Поки немає жодної кімнати.'));
      for (const r of rooms)
        list.append(
          h(
            'div',
            { class: 'row', style: 'border-top:1px solid var(--line);padding-top:6px' },
            h('div', { style: 'flex:1' }, h('b', {}, r.name), h('div', { class: 'muted', style: 'font-size:0.85em' }, `${r.scenarioName} · господар грає за: ${SIDE_NAME[r.hostSide]} · гравців ${r.players}/2${r.started ? ' · бій триває' : ''}`)),
            btn('Приєднатися', () => net!.send({ t: 'join', roomId: r.id }), { disabled: r.started || r.players >= 2 }),
          ),
        );
      box.append(list, btn('Оновити список', () => net!.send({ t: 'list' })));
      const nameIn = h('input', { type: 'text', value: form.name, maxlength: '40' }) as HTMLInputElement;
      nameIn.addEventListener('input', () => (form.name = nameIn.value));
      box.append(
        h('h3', { style: 'margin-top:14px' }, 'Створити кімнату'),
        h('div', { class: 'field' }, h('label', {}, 'Назва'), nameIn),
        h('div', { class: 'field' }, h('label', {}, 'Сценарій'), seg(sc.map((s) => [s.id, s.name] as [string, string]), () => form.scenarioId, (v) => (form.scenarioId = v))),
        h('div', { class: 'field' }, h('label', {}, 'Ваша сторона'), seg<SideId>([['blue', 'Синя'], ['red', 'Червона']], () => form.side, (v) => (form.side = v))),
        h('div', { class: 'field' }, h('label', {}, 'Складність (характеристики бійців)'), seg<Difficulty>([['easy', 'Легка'], ['medium', 'Середня'], ['hard', 'Важка']], () => form.difficulty, (v) => (form.difficulty = v))),
        btn('Створити', () => net!.send({ t: 'create', settings: { ...form } }), { cls: 'primary' }),
      );
    }
    box.append(h('div', { class: 'row', style: 'margin-top:12px' }, btn('Назад', () => (dispose(), hooks.back()))));
  }

  function onMsg(m: ServerMsg): void {
    error = '';
    if (m.t === 'rooms') rooms = m.rooms;
    else if (m.t === 'joined') waiting = { room: m.room, side: m.side };
    else if (m.t === 'error') error = m.error;
    else if (m.t === 'start' && waiting) {
      const w = waiting;
      const n = net!;
      dispose(false);
      hooks.start(n, w.side, m.state, w.room.id);
      return;
    }
    draw();
  }

  async function connect(): Promise<void> {
    const url = urlInput.value.trim().replace(/\/+$/, '');
    setServerUrl(url === location.origin ? '' : url);
    net?.close();
    net = null;
    online = false;
    status = 'Перевірка сервера…';
    draw();
    const st = await checkServer(url);
    if (disposed) return;
    if (!st.ok) {
      status = url ? 'Сервер не відповідає (офлайн або невірна адреса)' : 'Вкажіть адресу сервера';
      draw();
      return;
    }
    try {
      net = new NetClient(url);
      net.onMessage = onMsg;
      net.onClose = () => {
        online = false;
        status = 'З’єднання втрачено';
        waiting = null;
        draw();
      };
      await net.connect();
      online = true;
      status = `Сервер онлайн · кімнат: ${st.rooms ?? 0}`;
      net.send({ t: 'list' });
      clearInterval(timer);
      timer = window.setInterval(() => !waiting && net?.send({ t: 'list' }), 5000);
    } catch {
      status = 'Не вдалося під’єднатися';
    }
    draw();
  }

  function dispose(closeNet = true): void {
    disposed = true;
    clearInterval(timer);
    if (closeNet) net?.close();
  }

  draw();
  if (urlInput.value) void connect();
  else {
    status = 'Вкажіть адресу сервера, яку дав господар';
    draw();
  }
  return () => dispose();
}
