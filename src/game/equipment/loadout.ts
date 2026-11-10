import { itemDef } from '@/content';
import { createItem, placeInBackpack, pouchCapacity } from '@/game/inventory/inventory';
import { newId, type MissionState } from '@/game/simulation/state';
import type { AnyItem, GrenadeDefinition, MagazineInstance, StackItem, Unit, WeaponDefinition, WeaponInstance } from '@/game/types';
import { validateMods } from './mods';

/** Зміни спорядження дозволені лише до початку бою (етап розгортання). */
function assertBeforeBattle(s: MissionState): void {
  if (s.turn.phase !== 'deploy') throw new Error('Спорядження й модифікації змінюються лише перед місією');
}

const isMag = (it: AnyItem) => itemDef(it.defId).kind === 'magazine';

/**
 * Видати бійцю зброю з модифікаціями й типом магазинів.
 * Старі магазини, несумісні з новою зброєю, замінюються тією ж кількістю нових.
 */
export function equipWeapon(s: MissionState, u: Unit, weaponId: string, mods: string[], magType?: string): string[] {
  assertBeforeBattle(s);
  const errors = validateMods(weaponId, mods);
  const wd = itemDef<WeaponDefinition>(weaponId);
  const mag = magType ?? wd.magazines[0];
  if (!wd.magazines.includes(mag)) errors.push(`${itemDef(mag).name} не підходить до ${wd.name}`);
  if (errors.length) return errors;
  const id = (p: string) => newId(s, p);
  const inv = u.inventory;
  // Скільки магазинів було (заряджений + запасні).
  const spare = [...inv.pouches.filter(isMag), ...inv.backpackItems.map((e) => e.item).filter(isMag)].length;
  inv.pouches = inv.pouches.filter((p) => !isMag(p));
  inv.backpackItems = inv.backpackItems.filter((e) => !isMag(e.item));
  const w = createItem(weaponId, id) as WeaponInstance;
  w.mods = [...mods];
  w.magazine = createItem(mag, id) as MagazineInstance;
  inv.primary = w;
  const count = Math.max(2, spare);
  for (let i = 0; i < count; i++) {
    const m = createItem(mag, id);
    // Великі короби — у рюкзак, магазини — у підсумки.
    const big = itemDef(mag).size[0] > 1;
    if (!big && inv.pouches.length < pouchCapacity(inv)) inv.pouches.push(m as MagazineInstance);
    else if (!placeInBackpack(inv, m)) break;
  }
  return [];
}

/** Замінити тип гранат (РГД-5 / Ф-1), зберігши кількість. */
export function setGrenadeType(s: MissionState, u: Unit, grenadeId: string): void {
  assertBeforeBattle(s);
  if (itemDef(grenadeId).kind !== 'grenade') throw new Error('Це не граната');
  const swap = (it: StackItem) => (itemDef(it.defId).kind === 'grenade' ? { ...it, defId: grenadeId } : it);
  u.inventory.belt = u.inventory.belt.map(swap);
  u.inventory.backpackItems = u.inventory.backpackItems.map((e) => ({ ...e, item: itemDef(e.item.defId).kind === 'grenade' ? { ...e.item, defId: grenadeId } : e.item }));
}

export function grenadeTypes(): GrenadeDefinition[] {
  return ['rgd5', 'f1'].map((id) => itemDef<GrenadeDefinition>(id));
}
