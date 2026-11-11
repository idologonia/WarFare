import type { Command } from '@/game/simulation/commands';
import type { MissionState } from '@/game/simulation/state';
import type { Difficulty, SideId } from '@/game/types';
import type { OnlineLink } from './link';

/**
 * Обгортка над SDK HOME GAME SERVER (public/hgs.js → window.HGS).
 * HGS сам знаходить сервер за адресою з репозиторію idologonia/hgs-address, показує вхід/реєстрацію.
 */
export const HGS_GAME_ID = 'warfare';
export const HGS_SERVER = 'github:idologonia/hgs-address';

export interface HgsRoom {
  id: string;
  name: string;
  players?: number;
  max_players?: number;
  status?: string;
  params?: { scenarioId?: string; side?: SideId; difficulty?: Difficulty };
}

export interface HgsClient {
  state: string;
  player: { id: string; name: string } | null;
  room: HgsRoom | null;
  send(event: string, data?: unknown): void;
  on(event: string, fn: (data: any, meta?: any) => void): () => void;
  listRooms(): Promise<HgsRoom[]>;
  createRoom(o: { name: string; maxPlayers: number; private?: boolean; params?: Record<string, unknown> }): Promise<HgsRoom>;
  joinRoom(id: string): Promise<HgsRoom>;
  leaveRoom(): Promise<void>;
  disconnect(): void;
}

interface HgsGlobal {
  start(o: { gameId: string; server: string; room?: string; lang?: string }): Promise<HgsClient>;
}

export const hgsAvailable = () => typeof window !== 'undefined' && !!(window as unknown as { HGS?: HgsGlobal }).HGS;

let client: HgsClient | null = null;
let starting: Promise<HgsClient> | null = null;

/** Підключитися (один раз за сесію): пошук сервера, вхід, кімната lobby. */
export function hgsStart(): Promise<HgsClient> {
  if (client && client.state !== 'failed' && client.state !== 'disconnected') return Promise.resolve(client);
  const H = (window as unknown as { HGS?: HgsGlobal }).HGS;
  if (!H) return Promise.reject(new Error('SDK HGS не завантажено'));
  starting ??= H.start({ gameId: HGS_GAME_ID, server: HGS_SERVER, lang: 'uk' }).then((c) => {
    client = c;
    starting = null;
    return c;
  });
  return starting;
}

/** Прибрати вікно входу/«сервер вимкнено» від SDK (кнопка «Назад»). */
export function hgsCancelOverlay(): void {
  document.querySelectorAll('[data-hgs-login]').forEach((e) => e.remove());
  if (!client) starting = null; // наступного разу — нова спроба
}

/** Зв'язок бою через HGS: дії → wf_action, від сервера — wf_applied / wf_state / wf_peer. */
export function hgsLink(c: HgsClient, side: SideId): OnlineLink {
  const offs: (() => void)[] = [];
  return {
    side,
    send: (cmd: Command) => c.send('wf_action', { cmd }),
    attach(h) {
      offs.push(
        c.on('wf_applied', (d: { cmd: Command }) => h.remote(d.cmd)),
        c.on('wf_state', (d: { state: MissionState; error?: string }) => d.state && h.state(d.state, d.error)),
        c.on('wf_peer', (d: { connected: boolean; name: string }) => h.notice(d.connected ? `${d.name} знову на зв’язку` : `${d.name} від’єднався — чекаємо повернення`)),
        c.on('hgs:reconnecting', () => h.notice('Зв’язок перервано — перепідключення…')),
        c.on('hgs:room_joined', () => c.send('wf_sync', {})),
        c.on('hgs:server_shutdown', () => h.notice('Сервер гри вимкнено')),
      );
    },
    close() {
      offs.forEach((f) => f());
      void c.leaveRoom().catch(() => {});
    },
  };
}
