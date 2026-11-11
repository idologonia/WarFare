import { itemDef } from '@/content';
import { createItem, type IdGen } from '@/game/inventory/inventory';
import type { MissionState } from '@/game/simulation/state';
import type { Cell } from '@/core/grid';
import type { AnyItem, Inventory, SideId, Unit, WeaponDefinition } from '@/game/types';

/**
 * Логістика: точки постачання (ящики), вантаж у техніці, передача предметів між бійцями.
 * Склад зберігає предмети в простому списку; доступ — упритул до ящика або до техніки
 * (екіпаж — зсередини). Облік витрат БК/медицини — у stats_mission бійців (підсумки місії).
 */
export interface SupplyCache {
  id: string;
  name: string;
  /** null — нічий (може взяти будь-хто). */
  side: SideId | null;
  /** Позиція ящика; для вантажу техніки — vehicleId. */
  pos?: Cell;
  vehicleId?: string;
  items: AnyItem[];
}

export interface SupplyPointSetup {
  x: number;
  y: number;
  side?: SideId | null;
  /** Кількість магазинів до кожної зброї сторони, медицини й гранат. */
  mags?: number;
  meds?: number;
  grenades?: number;
}

/** Що передається живому бійцю поруч: лише дрібне (БК, медицина, гранати). */
export const TRANSFERABLE = ['magazine', 'medical', 'grenade'];

export const caches = (s: MissionState) => (s.supplies ??= []);
export const cacheById = (s: MissionState, id: string) => caches(s).find((c) => c.id === id);
export const isCacheId = (id: string) => id.startsWith('sup');

/** Набір постачання для сторони: магазини до її зброї + медицина + гранати. */
export function stockFor(s: MissionState, side: SideId | null, p: { mags?: number; meds?: number; grenades?: number }, id: IdGen): AnyItem[] {
  const out: AnyItem[] = [];
  const mags = new Set<string>();
  for (const u of s.units)
    if (side === null || u.side === side) {
      const w = u.inventory.primary ? itemDef<WeaponDefinition>(u.inventory.primary.defId) : null;
      if (w?.magazines?.[0]) mags.add(w.magazines[0]);
    }
  for (const m of mags) for (let i = 0; i < (p.mags ?? 4); i++) out.push(createItem(m, id));
  const meds = ['med_tourniquet', 'med_packing', 'med_bandage', 'med_seal', 'med_needle'];
  for (let i = 0; i < (p.meds ?? 4); i++) out.push(createItem(meds[i % meds.length], id));
  for (let i = 0; i < (p.grenades ?? 2); i++) out.push(createItem('rgd5', id));
  return out;
}

/** Клітинки, з яких доступний склад. */
export function cacheReachable(s: MissionState, c: SupplyCache, u: Unit): boolean {
  if (c.vehicleId) {
    const v = (s.vehicles ?? []).find((x) => x.id === c.vehicleId);
    if (!v) return false;
    if (u.inVehicle === v.id) return true;
    if (!u.pos || u.pos.z !== 0) return false;
    return u.pos.x >= v.x - 1 && u.pos.x <= v.x + 2 && u.pos.y >= v.y - 1 && u.pos.y <= v.y + 2;
  }
  if (!c.pos || !u.pos || u.pos.z !== c.pos.z) return false;
  return Math.abs(u.pos.x - c.pos.x) <= 1 && Math.abs(u.pos.y - c.pos.y) <= 1;
}

/** Обгортка складу як «власника інвентаря» для спільних функцій перекладання. */
export function cacheAsOwner(c: SupplyCache): Unit {
  const inv: Inventory = { primary: null, secondary: null, helmet: null, armor: null, rig: null, pouches: c.items as Inventory['pouches'], belt: [], backpack: null, backpackItems: [] };
  return { id: c.id, callsign: c.name, status: 'dead', inventory: inv } as unknown as Unit;
}
