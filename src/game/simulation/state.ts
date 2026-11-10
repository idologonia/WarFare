import type { Rng } from '@/core/rng';
import { cellKey, sameCell, type Cell } from '@/core/grid';
import type { Point } from '@/game/visibility/los';
import type {
  BodyPart,
  Contact,
  ControllerKind,
  InjuryType,
  MapState,
  MedicalEffect,
  MissionResult,
  MoveMode,
  Scenario,
  SideId,
  TurnState,
  Unit,
  UnitStatus,
} from '@/game/types';

/** Повний серіалізований стан місії (звичайний JSON). */
export interface MissionState {
  schemaVersion: number;
  gameVersion: string;
  seed: number;
  scenario: Scenario;
  map: MapState;
  units: Unit[];
  turn: TurnState;
  rng: number;
  contacts: Record<SideId, Record<string, Contact>>;
  controllers: Record<SideId, ControllerKind>;
  /** Тестовий режим: усе видно обом сторонам. */
  revealAll: boolean;
  nextId: number;
  result: MissionResult | null;
}

/** Події симуляції для рендерингу/UI (не бойова стрічка: лише для анімацій і спливаючих підказок). */
export type SimEvent =
  | { t: 'deployed'; unitId: string; cell: Cell }
  | { t: 'moved'; unitId: string; path: Cell[]; mode: MoveMode }
  | { t: 'pose'; unitId: string }
  | { t: 'fired'; unitId: string; from: Point; shots: { to: Point; hitUnit: string | null }[]; targetUnit: string | null }
  | { t: 'damaged'; unitId: string; part: BodyPart; amount: number; injury: InjuryType | null; armorStopped: boolean }
  | { t: 'status'; unitId: string; status: UnitStatus }
  | { t: 'object'; cell: Cell; defId: string | null }
  | { t: 'grenade'; unitId: string; from: Point; to: Point }
  | { t: 'rocket'; unitId: string; from: Point; to: Point }
  | { t: 'explosion'; at: Point; radius: number }
  | { t: 'reload'; unitId: string }
  | { t: 'overwatch'; unitId: string }
  | { t: 'reaction'; unitId: string; targetId: string }
  | { t: 'panic'; unitId: string }
  | { t: 'treated'; unitId: string; targetId: string; effect: MedicalEffect }
  | { t: 'carry'; unitId: string; targetId: string | null }
  | { t: 'evacuated'; unitId: string }
  | { t: 'reinforcement'; unitId: string }
  | { t: 'contact'; side: SideId; unitId: string }
  | { t: 'turn'; turn: number; side: SideId }
  | { t: 'float'; unitId: string; text: string; kind: 'info' | 'bad' | 'good' }
  | { t: 'missionEnd'; result: MissionResult };

export interface Ctx {
  s: MissionState;
  rng: Rng;
  ev: SimEvent[];
}

export const other = (side: SideId): SideId => (side === 'blue' ? 'red' : 'blue');

export function newId(s: MissionState, prefix: string): string {
  return `${prefix}${s.nextId++}`;
}

export function unitById(s: MissionState, id: string): Unit {
  const u = s.units.find((x) => x.id === id);
  if (!u) throw new Error(`Невідомий боєць: ${id}`);
  return u;
}

export const isActive = (u: Unit): boolean => u.status === 'active' && u.pos !== null;
/** На полі як тіло або активний (займає місце, видимий). */
export const onField = (u: Unit): boolean => (u.status === 'active' || u.status === 'down' || u.status === 'dead') && u.pos !== null;

/** Хто стоїть у клітинці (лише активні займають клітинку; тіла не блокують рух). */
export function activeUnitAt(s: MissionState, c: Cell): Unit | undefined {
  return s.units.find((u) => isActive(u) && sameCell(u.pos!, c));
}

export function anyUnitAt(s: MissionState, c: Cell): Unit[] {
  return s.units.filter((u) => onField(u) && sameCell(u.pos!, c));
}

export function occupiedKeys(s: MissionState, except?: string): Set<string> {
  const set = new Set<string>();
  for (const u of s.units) if (isActive(u) && u.id !== except) set.add(cellKey(u.pos!));
  return set;
}

export function sideUnits(s: MissionState, side: SideId): Unit[] {
  return s.units.filter((u) => u.side === side);
}

export function float(ctx: Ctx, unitId: string, text: string, kind: 'info' | 'bad' | 'good' = 'info'): void {
  ctx.ev.push({ t: 'float', unitId, text, kind });
}
