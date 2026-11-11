import { itemDef } from '@/content';
import type { AnyItem, BackpackDefinition, Inventory, StackItem, Unit, WeaponDefinition, WeaponInstance } from '@/game/types';
import { pouchCapacity } from './inventory';

/**
 * Перекладання предметів (як у рюкзаку з клітинками): підсумки, пояс, рюкзак, основна зброя.
 * Також обшук тіл і непритомних (лутання). Перевірка — до будь-яких змін.
 */
export type ItemArea = 'primary' | 'pouches' | 'belt' | 'backpack';

export interface ItemRef {
  owner: string;
  area: ItemArea;
  index?: number;
}

export interface ItemDest {
  owner: string;
  area: ItemArea;
  x?: number;
  y?: number;
}

export const BELT_CAPACITY = 6;

export function itemAt(inv: Inventory, ref: ItemRef): AnyItem | null {
  if (ref.area === 'primary') return inv.primary;
  if (ref.area === 'pouches') return inv.pouches[ref.index ?? -1] ?? null;
  if (ref.area === 'belt') return inv.belt[ref.index ?? -1] ?? null;
  return inv.backpackItems[ref.index ?? -1]?.item ?? null;
}

export function removeAt(inv: Inventory, ref: ItemRef): void {
  if (ref.area === 'primary') inv.primary = null;
  else if (ref.area === 'pouches') inv.pouches.splice(ref.index!, 1);
  else if (ref.area === 'belt') inv.belt.splice(ref.index!, 1);
  else inv.backpackItems.splice(ref.index!, 1);
}

/** Чи вільна ділянка сітки рюкзака (ігноруючи вказаний предмет, якщо його переносять усередині). */
export function backpackFits(inv: Inventory, item: AnyItem, x: number, y: number, ignore?: AnyItem): boolean {
  if (!inv.backpack) return false;
  const [gw, gh] = itemDef<BackpackDefinition>(inv.backpack.defId).grid;
  const [w, h] = itemDef(item.defId).size;
  if (x < 0 || y < 0 || x + w > gw || y + h > gh) return false;
  for (const e of inv.backpackItems) {
    if (e.item === ignore || e.item === item) continue;
    const [ew, eh] = itemDef(e.item.defId).size;
    if (x < e.x + ew && x + w > e.x && y < e.y + eh && y + h > e.y) return false;
  }
  return true;
}

const kindOf = (it: AnyItem) => itemDef(it.defId).kind;

/** Перевірка переміщення; повертає текст помилки або null. */
export function validateMove(src: Unit, dst: Unit, from: ItemRef, to: ItemDest): string | null {
  const item = itemAt(src.inventory, from);
  if (!item) return 'Предмета немає';
  const k = kindOf(item);
  const inv = dst.inventory;
  const same = src === dst;
  switch (to.area) {
    case 'pouches':
      if (!['magazine', 'medical', 'grenade'].includes(k)) return 'У підсумки — лише магазини, медицина й гранати';
      if (itemDef(item.defId).size[0] * itemDef(item.defId).size[1] > 2) return 'Завеликий для підсумка';
      if (!(same && from.area === 'pouches') && inv.pouches.length >= pouchCapacity(inv)) return 'Підсумки заповнені';
      return null;
    case 'belt':
      if (!['medical', 'grenade'].includes(k)) return 'На пояс — лише медицина й гранати';
      if (!(same && from.area === 'belt') && inv.belt.length >= BELT_CAPACITY) return 'Пояс заповнений';
      return null;
    case 'backpack':
      if (!inv.backpack) return 'Немає рюкзака';
      if (to.x === undefined || to.y === undefined) return 'Оберіть місце в рюкзаку';
      if (!backpackFits(inv, item, to.x, to.y, same && from.area === 'backpack' ? item : undefined)) return 'Не поміщається тут';
      return null;
    case 'primary': {
      if (k !== 'weapon') return 'Це не зброя';
      const wd = itemDef<WeaponDefinition>(item.defId);
      if (wd.category === 'launcher' || wd.weight >= 15) return 'Це не основна зброя';
      // Старa зброя переходить на місце нової (обмін).
      if (inv.primary && same && from.area === 'backpack') {
        const e = src.inventory.backpackItems[from.index!];
        if (!backpackFits(inv, inv.primary, e.x, e.y, item)) return 'Немає місця в рюкзаку для поточної зброї';
      }
      return null;
    }
  }
}

/** Виконати переміщення (після validateMove). */
export function applyMove(src: Unit, dst: Unit, from: ItemRef, to: ItemDest): void {
  const item = itemAt(src.inventory, from)!;
  const fromEntry = from.area === 'backpack' ? src.inventory.backpackItems[from.index!] : null;
  removeAt(src.inventory, from);
  const inv = dst.inventory;
  switch (to.area) {
    case 'pouches':
      inv.pouches.push(item as StackItem);
      break;
    case 'belt':
      inv.belt.push(item as StackItem);
      break;
    case 'backpack':
      inv.backpackItems.push({ item, x: to.x!, y: to.y! });
      break;
    case 'primary': {
      const old = inv.primary;
      inv.primary = item as WeaponInstance;
      if (old) {
        // Обмін: стара зброя — туди, звідки взяли нову.
        if (from.area === 'primary') src.inventory.primary = old;
        else if (fromEntry) src.inventory.backpackItems.push({ item: old, x: fromEntry.x, y: fromEntry.y });
        else src.inventory.belt.push(old as unknown as StackItem);
      }
      break;
    }
  }
}
