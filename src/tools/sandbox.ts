import { content, itemDef } from '@/content';
import { Rng } from '@/core/rng';
import { sameCell, type Cell } from '@/core/grid';
import { createItem, placeInBackpack, pouchCapacity } from '@/game/inventory/inventory';
import { isStandable } from '@/game/maps/map';
import { canPlace, embark, spawnVehicle } from '@/game/vehicles';
import { newId, type MissionState } from '@/game/simulation/state';
import { computeApMax } from '@/game/units/derived';
import { generateUnit } from '@/game/units/generator';
import type { BodyPart, MagazineDefinition, MagazineInstance, SideId, Unit, WeaponDefinition, WeaponInstance } from '@/game/types';

/**
 * Інструменти тестового режиму. Змінюють стан місії напряму, в обхід правил,
 * тому доступні лише в режимі «Тест» (state.revealAll) і не використовуються в звичайній грі.
 */
function assertTest(s: MissionState): void {
  if (!s.revealAll) throw new Error('Інструменти пісочниці доступні лише в тестовому режимі');
}

function occupied(s: MissionState, c: Cell): boolean {
  return s.units.some((u) => u.status === 'active' && u.pos && sameCell(u.pos, c));
}

export function sandboxAddUnit(s: MissionState, side: SideId, classId: string, cell: Cell): Unit | string {
  assertTest(s);
  if (!isStandable(s.map, cell)) return 'Тут не можна стояти';
  if (occupied(s, cell)) return 'Клітинка зайнята';
  const rng = new Rng(s.rng ^ s.nextId);
  const u = generateUnit(side, classId, rng, (p) => newId(s, p), { aiStyle: s.scenario.sides[side].aiStyle });
  u.pos = { ...cell };
  if (side === 'red') u.weaponState = 'low';
  const ap = computeApMax(u);
  u.apMax = ap.total;
  u.ap = s.turn.side === side ? ap.total : 0;
  s.units.push(u);
  return u;
}

export function sandboxRemove(s: MissionState, unitId: string): void {
  assertTest(s);
  s.units = s.units.filter((u) => u.id !== unitId);
  for (const side of ['blue', 'red'] as SideId[]) delete s.contacts[side][unitId];
  for (const u of s.units) {
    if (u.carrying === unitId) u.carrying = null;
  }
}

export function sandboxTeleport(s: MissionState, unitId: string, cell: Cell): string | null {
  assertTest(s);
  if (!isStandable(s.map, cell)) return 'Тут не можна стояти';
  if (occupied(s, cell)) return 'Клітинка зайнята';
  const u = s.units.find((x) => x.id === unitId);
  if (!u) return 'Бійця не знайдено';
  u.pos = { ...cell };
  return null;
}

export function sandboxWeapons(): WeaponDefinition[] {
  return [...content().items.values()].filter((d) => d.kind === 'weapon' && (d as WeaponDefinition).category !== 'launcher') as WeaponDefinition[];
}

/** Видати зброю з повним магазином і трьома запасними. */
export function sandboxGiveWeapon(s: MissionState, unitId: string, weaponId: string): void {
  assertTest(s);
  const u = s.units.find((x) => x.id === unitId)!;
  const id = (p: string) => newId(s, p);
  const wd = itemDef<WeaponDefinition>(weaponId);
  const w = createItem(weaponId, id) as WeaponInstance;
  w.magazine = createItem(wd.magazines[0], id) as MagazineInstance;
  u.inventory.primary = w;
  // Прибрати несумісні магазини, додати сумісні.
  u.inventory.pouches = u.inventory.pouches.filter((p) => itemDef(p.defId).kind !== 'magazine' || wd.magazines.includes(p.defId));
  for (let i = 0; i < 3; i++) {
    const m = createItem(wd.magazines[0], id);
    if (u.inventory.pouches.length < pouchCapacity(u.inventory)) u.inventory.pouches.push(m as MagazineInstance);
    else placeInBackpack(u.inventory, m);
  }
}

export function sandboxHeal(s: MissionState, unitId: string): void {
  assertTest(s);
  const u = s.units.find((x) => x.id === unitId)!;
  u.injuries = [];
  u.health = u.stats.health;
  u.stamina = u.stats.stamina;
  u.morale = u.stats.morale;
  u.suppression = 0;
  u.panicked = false;
  if (u.status === 'down' || u.status === 'dead') {
    u.status = 'active';
    u.stance = 'standing';
  }
}

/** Поранення для перевірки медицини. */
export function sandboxWound(s: MissionState, unitId: string, part: BodyPart, kind: 'light' | 'heavy' | 'pneumo'): void {
  assertTest(s);
  const u = s.units.find((x) => x.id === unitId)!;
  const inj = { id: newId(s, 'inj'), part, turn: s.turn.turn };
  if (kind === 'pneumo') u.injuries.push({ ...inj, part: 'torso', type: 'pneumothorax', bleeding: 'none' });
  else u.injuries.push({ ...inj, type: kind === 'heavy' ? 'gunshotHeavy' : 'gunshotLight', bleeding: kind === 'heavy' ? 'massive' : 'light' });
  u.health = Math.max(1, u.health - (kind === 'heavy' ? 25 : 10));
}

export function sandboxRefill(s: MissionState, unitId: string): void {
  assertTest(s);
  const u = s.units.find((x) => x.id === unitId)!;
  const ap = computeApMax(u);
  u.apMax = ap.total;
  u.ap = ap.total;
  if (u.inventory.primary?.magazine) {
    u.inventory.primary.magazine.rounds = itemDef<MagazineDefinition>(u.inventory.primary.magazine.defId).capacity;
  }
}

/** Поставити техніку з екіпажем (водій, навідник) у тестовому режимі. */
export function sandboxAddVehicle(s: MissionState, side: SideId, defId: string, cell: Cell): string | null {
  assertTest(s);
  if (cell.z !== 0 || !canPlace(s, defId, cell.x, cell.y)) return 'Тут не поміститься (потрібно 2×2 вільних клітинки на землі)';
  const id = (p: string) => newId(s, p);
  const v = spawnVehicle(s, side, defId, cell.x, cell.y, id);
  const rng = new Rng(s.rng ^ s.nextId);
  const crewList = ['driver', ...(v.weapon ? ['rifleman'] : [])];
  for (const cls of crewList) {
    const u = generateUnit(side, cls, rng, id, { aiStyle: s.scenario.sides[side].aiStyle });
    const ap = computeApMax(u);
    u.apMax = ap.total;
    u.ap = s.turn.side === side ? ap.total : 0;
    s.units.push(u);
    embark(v, u, cls === 'driver' ? 'driver' : 'gunner');
  }
  return null;
}
