import type { Command } from '@/game/simulation/commands';
import type { MissionState } from '@/game/simulation/state';
import type { SideId } from '@/game/types';

/** Мережевий зв'язок під час бою (HGS або резервний власний сервер). */
export interface OnlineLink {
  side: SideId;
  /** Надіслати дію гравця на сервер (локально вже застосована). */
  send(cmd: Command): void;
  /** Підписка на події з сервера. */
  attach(h: { remote: (cmd: Command) => void; state: (s: MissionState, error?: string) => void; notice: (text: string) => void }): void;
  close(): void;
}
