import type { Command } from '@/game/simulation/commands';
import type { MissionState } from '@/game/simulation/state';
import type { Difficulty, SideId } from '@/game/types';

/** Мережевий протокол (JSON через WebSocket). Сервер — авторитетний: перевіряє кожну команду. */
export interface RoomInfo {
  id: string;
  name: string;
  scenarioId: string;
  scenarioName: string;
  hostSide: SideId;
  players: number;
  started: boolean;
}

export interface RoomSettings {
  name: string;
  scenarioId: string;
  side: SideId;
  difficulty: Difficulty;
}

export type ClientMsg =
  | { t: 'list' }
  | { t: 'create'; settings: RoomSettings }
  | { t: 'join'; roomId: string }
  | { t: 'rejoin'; roomId: string; token: string }
  | { t: 'leave' }
  | { t: 'cmd'; seq: number; cmd: Command };

export type ServerMsg =
  | { t: 'rooms'; rooms: RoomInfo[] }
  | { t: 'joined'; room: RoomInfo; side: SideId; token: string }
  | { t: 'start'; state: MissionState; seq: number }
  /** Команда суперника (або власна, якщо сервер її прийняв). */
  | { t: 'cmd'; seq: number; side: SideId; cmd: Command }
  /** Сервер відхилив команду — повний стан для синхронізації. */
  | { t: 'sync'; state: MissionState; seq: number; error?: string }
  | { t: 'peer'; connected: boolean }
  | { t: 'error'; error: string };

export const PROTOCOL_VERSION = 1;

/** Тема ntfy, де сервер оголошує свою публічну адресу. */
export const DISCOVERY_TOPIC = 'warfare-idologonia-v1-server';
export const NTFY_URL = 'https://ntfy.sh';
