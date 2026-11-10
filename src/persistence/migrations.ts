import { GAME_VERSION, SCHEMA_VERSION } from '@/core/version';
import type { MissionState } from '@/game/simulation/state';

/** Міграції стану: ключ — версія схеми, з якої переводимо на наступну. */
const MIGRATIONS: Record<number, (s: any) => any> = {
  // 1: (s) => ({ ...s, newField: default, schemaVersion: 2 }),
};

export class IncompatibleSaveError extends Error {}

/** Привести збережений стан до поточної схеми або чітко повідомити про несумісність. */
export function migrate(raw: unknown): MissionState {
  if (!raw || typeof raw !== 'object') throw new IncompatibleSaveError('Файл не схожий на збереження WarFare');
  let s = raw as any;
  if (typeof s.schemaVersion !== 'number' || !s.map || !Array.isArray(s.units)) throw new IncompatibleSaveError('Пошкоджене або чуже збереження');
  if (s.schemaVersion > SCHEMA_VERSION)
    throw new IncompatibleSaveError(`Збереження з новішої версії гри (${s.gameVersion}). Оновіть гру до цієї версії або новішої.`);
  while (s.schemaVersion < SCHEMA_VERSION) {
    const m = MIGRATIONS[s.schemaVersion];
    if (!m) throw new IncompatibleSaveError(`Немає міграції зі схеми ${s.schemaVersion}; збереження несумісне з версією ${GAME_VERSION}`);
    s = m(s);
  }
  return s as MissionState;
}
