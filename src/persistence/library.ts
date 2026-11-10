import { registerMap, registerScenario, unregister } from '@/content';
import type { MapDefinition, Scenario } from '@/game/types';

/**
 * Бібліотека користувацьких карт і сценаріїв (localStorage: дані невеликі, синхронний доступ).
 * Сценарії можна поширювати експортом у файл і імпортом (разом із картою).
 */
const KEY = 'warfare.library.v1';

interface LibraryData {
  maps: MapDefinition[];
  scenarios: Scenario[];
}

function read(): LibraryData {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { maps: d.maps ?? [], scenarios: d.scenarios ?? [] };
  } catch {
    return { maps: [], scenarios: [] };
  }
}

function write(d: LibraryData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* немає сховища — бібліотека живе до перезавантаження */
  }
}

/** Завантажити бібліотеку в реєстр контенту (при старті). */
export function loadLibrary(): void {
  const d = read();
  d.maps.forEach(registerMap);
  d.scenarios.forEach(registerScenario);
}

export function listLibrary(): LibraryData {
  return read();
}

export function saveMap(def: MapDefinition): void {
  const d = read();
  d.maps = [...d.maps.filter((m) => m.id !== def.id), def];
  write(d);
  registerMap(def);
}

export function saveScenario(sc: Scenario): void {
  const d = read();
  d.scenarios = [...d.scenarios.filter((s) => s.id !== sc.id), sc];
  write(d);
  registerScenario(sc);
}

export function deleteFromLibrary(kind: 'map' | 'scenario', id: string): void {
  const d = read();
  if (kind === 'map') d.maps = d.maps.filter((m) => m.id !== id);
  else d.scenarios = d.scenarios.filter((s) => s.id !== id);
  write(d);
  unregister(kind, id);
}

/** Файл для поширення: сценарій разом із його картою. */
export interface SharedScenario {
  format: 'warfare-scenario';
  version: 1;
  scenario: Scenario;
  map: MapDefinition;
}

export function packScenario(sc: Scenario, map: MapDefinition): SharedScenario {
  return { format: 'warfare-scenario', version: 1, scenario: sc, map };
}

export function unpackShared(raw: unknown): { scenario?: Scenario; map?: MapDefinition } {
  const o = raw as Record<string, unknown>;
  if (o?.format === 'warfare-scenario') return { scenario: o.scenario as Scenario, map: o.map as MapDefinition };
  if (o?.format === 'warfare-map') return { map: o.map as MapDefinition };
  throw new Error('Файл не є сценарієм або картою WarFare');
}

export function downloadJson(name: string, data: unknown): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function pickJsonFile(): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        resolve(JSON.parse(await f.text()));
      } catch (e) {
        reject(e);
      }
    });
    input.click();
  });
}
