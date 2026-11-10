import { GAME_VERSION, SCHEMA_VERSION } from '@/core/version';
import type { MissionState } from '@/game/simulation/state';
import { migrate } from './migrations';

/**
 * Локальні збереження в IndexedDB (обрано через обсяг і асинхронність; localStorage має ліміт ~5 МБ).
 * Слоти: 'auto' (автозбереження) і 'slot1'..'slot3'. Хмарна синхронізація — на майбутнє.
 */
export interface SaveRecord {
  slot: string;
  name: string;
  savedAt: number;
  gameVersion: string;
  schemaVersion: number;
  state: MissionState;
}

export const SLOTS = ['auto', 'slot1', 'slot2', 'slot3'] as const;
const DB = 'warfare';
const STORE = 'saves';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'slot' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function describe(s: MissionState): string {
  return `${s.scenario.name} — хід ${s.turn.turn}`;
}

export async function saveGame(slot: string, state: MissionState): Promise<void> {
  const rec: SaveRecord = { slot, name: describe(state), savedAt: Date.now(), gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, state: structuredClone(state) };
  await tx('readwrite', (s) => s.put(rec));
}

export async function listSaves(): Promise<Omit<SaveRecord, 'state'>[]> {
  try {
    const all = await tx<SaveRecord[]>('readonly', (s) => s.getAll() as IDBRequest<SaveRecord[]>);
    return all.map(({ state: _s, ...rest }) => rest);
  } catch {
    return [];
  }
}

export async function loadGame(slot: string): Promise<MissionState | null> {
  const rec = await tx<SaveRecord | undefined>('readonly', (s) => s.get(slot) as IDBRequest<SaveRecord | undefined>);
  return rec ? migrate(rec.state) : null;
}

export async function deleteSave(slot: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(slot));
}

export function exportToFile(state: MissionState): void {
  const data = JSON.stringify({ format: 'warfare-save', gameVersion: GAME_VERSION, schemaVersion: SCHEMA_VERSION, state });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  a.download = `warfare-${state.scenario.id}-turn${state.turn.turn}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function importFromFile(file: File): Promise<MissionState> {
  const json = JSON.parse(await file.text());
  return migrate(json?.format === 'warfare-save' ? json.state : json);
}
