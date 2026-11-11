import { itemDef } from '@/content';
import { modsWeight } from '@/game/equipment/mods';
import type { ClassKit } from '@/content';
import type {
  AnyItem,
  ArmorDefinition,
  ArmorPiece,
  BackpackDefinition,
  Inventory,
  ItemDefinition,
  MagazineDefinition,
  MagazineInstance,
  HelmetMountDefinition,
  MedicalDefinition,
  MedicalEffect,
  RigDefinition,
  StackItem,
  Unit,
  WeaponDefinition,
  WeaponInstance,
} from '@/game/types';

export type IdGen = (prefix: string) => string;

export function createItem(defId: string, id: IdGen): AnyItem {
  const d = itemDef(defId);
  switch (d.kind) {
    case 'weapon':
      return { id: id('w'), defId, magazine: null, mods: [] } satisfies WeaponInstance;
    case 'magazine':
      return { id: id('m'), defId, rounds: d.capacity } satisfies MagazineInstance;
    case 'armor':
    case 'helmet':
      return { id: id('a'), defId, durability: d.durability } satisfies ArmorPiece;
    case 'medical':
      return { id: id('i'), defId, uses: d.uses } satisfies StackItem;
    case 'grenade':
      return { id: id('i'), defId, uses: 1 } satisfies StackItem;
    default:
      return { id: id('i'), defId, uses: 1 } satisfies StackItem;
  }
}

export function pouchCapacity(inv: Inventory): number {
  let n = 0;
  if (inv.armor) n += itemDef<ArmorDefinition>(inv.armor.defId).pouches ?? 0;
  if (inv.rig) n += itemDef<RigDefinition>(inv.rig.defId).pouches;
  return n;
}

/** Розміщує предмет у першій вільній позиції сітки рюкзака. */
export function placeInBackpack(inv: Inventory, item: AnyItem): boolean {
  if (!inv.backpack) return false;
  const [gw, gh] = itemDef<BackpackDefinition>(inv.backpack.defId).grid;
  const [iw, ih] = itemDef(item.defId).size;
  const occ: boolean[][] = Array.from({ length: gh }, () => Array<boolean>(gw).fill(false));
  for (const e of inv.backpackItems) {
    const [w, h] = itemDef(e.item.defId).size;
    for (let y = e.y; y < e.y + h; y++) for (let x = e.x; x < e.x + w; x++) occ[y][x] = true;
  }
  for (let y = 0; y + ih <= gh; y++)
    for (let x = 0; x + iw <= gw; x++) {
      let free = true;
      for (let yy = y; yy < y + ih && free; yy++) for (let xx = x; xx < x + iw && free; xx++) if (occ[yy][xx]) free = false;
      if (free) {
        inv.backpackItems.push({ item, x, y });
        return true;
      }
    }
  return false;
}

export function buildInventory(kit: ClassKit, id: IdGen): Inventory {
  const inv: Inventory = {
    primary: null,
    secondary: null,
    helmet: kit.helmet ? (createItem(kit.helmet, id) as ArmorPiece) : null,
    armor: kit.armor ? (createItem(kit.armor, id) as ArmorPiece) : null,
    rig: kit.rig ? { id: id('i'), defId: kit.rig } : null,
    pouches: [],
    belt: [],
    backpack: kit.backpack ? { id: id('i'), defId: kit.backpack } : null,
    backpackItems: [],
  };
  const w = createItem(kit.primary, id) as WeaponInstance;
  const wd = itemDef<WeaponDefinition>(kit.primary);
  w.magazine = createItem(kit.primaryMag ?? wd.magazines[0], id) as MagazineInstance;
  w.mods = [...(kit.primaryMods ?? [])];
  if (kit.secondary) {
    const sw = createItem(kit.secondary, id) as WeaponInstance;
    sw.magazine = createItem(kit.secondaryMag ?? itemDef<WeaponDefinition>(kit.secondary).magazines[0], id) as MagazineInstance;
    inv.secondary = sw;
  }
  inv.primary = w;
  const cap = pouchCapacity(inv);
  for (const m of kit.pouches) {
    const it = createItem(m, id) as MagazineInstance;
    if (inv.pouches.length < cap) inv.pouches.push(it);
    else placeInBackpack(inv, it);
  }
  for (const b of kit.belt) inv.belt.push(createItem(b, id) as StackItem);
  inv.helmetMounts = inv.helmet ? (kit.helmetMounts ?? []).map((m) => ({ id: id('i'), defId: m })) : [];
  for (const b of kit.backpackItems) placeInBackpack(inv, createItem(b, id));
  return inv;
}

function itemWeight(item: AnyItem | { defId: string } | null): number {
  if (!item) return 0;
  const d = itemDef(item.defId);
  let w = d.weight;
  if ('magazine' in item && item.magazine) w += itemDef(item.magazine.defId).weight;
  if ('mods' in item) w += modsWeight(item);
  return w;
}

export function totalWeight(inv: Inventory): number {
  let w = 0;
  for (const it of [inv.primary, inv.secondary, inv.helmet, inv.armor, inv.rig, inv.backpack, ...(inv.helmetMounts ?? []), ...(inv.extraArmor ?? [])]) w += itemWeight(it);
  for (const it of inv.pouches) w += itemWeight(it);
  for (const it of inv.belt) w += itemWeight(it);
  for (const e of inv.backpackItems) w += itemWeight(e.item);
  return Math.round(w * 10) / 10;
}

export function primaryDef(u: Unit): WeaponDefinition | null {
  return u.inventory.primary ? itemDef<WeaponDefinition>(u.inventory.primary.defId) : null;
}

const isMag = (it: AnyItem): it is MagazineInstance => itemDef(it.defId).kind === 'magazine';

/** Знайти найповніший сумісний магазин: спершу в підсумках, потім у рюкзаку. */
export function findReloadMagazine(u: Unit): { where: 'pouch' | 'backpack'; index: number; mag: MagazineInstance } | null {
  const w = primaryDef(u);
  if (!w) return null;
  let best: { where: 'pouch' | 'backpack'; index: number; mag: MagazineInstance } | null = null;
  u.inventory.pouches.forEach((it, index) => {
    if (isMag(it) && w.magazines.includes(it.defId) && it.rounds > 0 && (!best || it.rounds > best.mag.rounds))
      best = { where: 'pouch', index, mag: it };
  });
  if (best) return best;
  u.inventory.backpackItems.forEach((e, index) => {
    const it = e.item;
    if (isMag(it) && w.magazines.includes(it.defId) && it.rounds > 0 && (!best || it.rounds > best.mag.rounds))
      best = { where: 'backpack', index, mag: it };
  });
  return best;
}

/**
 * Заміна магазину. Старий магазин (з залишком набоїв) повертається на місце нового.
 * Повертає false, якщо сумісного магазину немає.
 */
export function swapMagazine(u: Unit): { ok: boolean; where?: 'pouch' | 'backpack' } {
  const w = u.inventory.primary;
  const found = findReloadMagazine(u);
  if (!w || !found) return { ok: false };
  const old = w.magazine;
  if (found.where === 'pouch') {
    if (old) u.inventory.pouches[found.index] = old;
    else u.inventory.pouches.splice(found.index, 1);
  } else {
    const entry = u.inventory.backpackItems[found.index];
    u.inventory.backpackItems.splice(found.index, 1);
    if (old) {
      if (u.inventory.pouches.length < pouchCapacity(u.inventory)) u.inventory.pouches.push(old);
      else if (!placeInBackpack(u.inventory, old)) u.inventory.backpackItems.push({ item: old, x: entry.x, y: entry.y });
    }
  }
  w.magazine = found.mag;
  return { ok: true, where: found.where };
}

/** Кількість набоїв: у зброї та в запасних сумісних магазинах. */
export function ammoSummary(u: Unit): { loaded: number; capacity: number; spareMags: number; spareRounds: number } {
  const w = u.inventory.primary;
  const wd = primaryDef(u);
  if (!w || !wd) return { loaded: 0, capacity: 0, spareMags: 0, spareRounds: 0 };
  let spareMags = 0;
  let spareRounds = 0;
  const all = [...u.inventory.pouches, ...u.inventory.backpackItems.map((e) => e.item)];
  for (const it of all)
    if (isMag(it) && wd.magazines.includes(it.defId) && it.rounds > 0) {
      spareMags++;
      spareRounds += it.rounds;
    }
  return {
    loaded: w.magazine?.rounds ?? 0,
    capacity: w.magazine ? itemDef<MagazineDefinition>(w.magazine.defId).capacity : 0,
    spareMags,
    spareRounds,
  };
}

export type ItemLocation = { where: 'belt' | 'pouch' | 'backpack'; index: number; item: StackItem };

/** Знайти предмет за фільтром (медицина, гранати): пояс → підсумки → рюкзак. */
export function findItem(u: Unit, pred: (d: ItemDefinition) => boolean): ItemLocation | null {
  const inv = u.inventory;
  for (let i = 0; i < inv.belt.length; i++) if (pred(itemDef(inv.belt[i].defId)) && inv.belt[i].uses > 0) return { where: 'belt', index: i, item: inv.belt[i] };
  for (let i = 0; i < inv.pouches.length; i++) {
    const it = inv.pouches[i] as StackItem;
    if (pred(itemDef(it.defId)) && (it.uses ?? 0) > 0) return { where: 'pouch', index: i, item: it };
  }
  for (let i = 0; i < inv.backpackItems.length; i++) {
    const it = inv.backpackItems[i].item as StackItem;
    if (pred(itemDef(it.defId)) && (it.uses ?? 0) > 0) return { where: 'backpack', index: i, item: it };
  }
  return null;
}

export const findMedical = (u: Unit, effect: MedicalEffect) =>
  findItem(u, (d) => d.kind === 'medical' && (d as MedicalDefinition).effect === effect);

/** Списати одне використання; порожній предмет прибирається. */
export function consume(u: Unit, loc: ItemLocation): void {
  loc.item.uses -= 1;
  if (loc.item.uses > 0) return;
  const inv = u.inventory;
  if (loc.where === 'belt') inv.belt.splice(inv.belt.indexOf(loc.item), 1);
  else if (loc.where === 'pouch') inv.pouches.splice(inv.pouches.indexOf(loc.item), 1);
  else inv.backpackItems.splice(inv.backpackItems.findIndex((e) => e.item === loc.item), 1);
}

export function countItems(u: Unit, pred: (d: ItemDefinition) => boolean): number {
  let n = 0;
  const inv = u.inventory;
  for (const it of [...inv.belt, ...(inv.pouches as StackItem[]), ...inv.backpackItems.map((e) => e.item as StackItem)])
    if (pred(itemDef(it.defId))) n += 'uses' in it ? it.uses : 1;
  return n;
}

/** Кріплення на каску певного типу (ліхтар / ПНБ). */
export function helmetMount(u: Unit, mount: 'light' | 'nvg'): HelmetMountDefinition | null {
  for (const m of u.inventory.helmetMounts ?? []) {
    const d = itemDef(m.defId) as HelmetMountDefinition;
    if (d.mount === mount) return d;
  }
  return null;
}

/** ПНБ, що зараз працює (є на касці й не відкинутий). */
export const activeNvg = (u: Unit) => (u.nvgUp ? null : helmetMount(u, 'nvg'));
