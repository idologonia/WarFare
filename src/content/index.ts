/** Реєстр контенту: усе завантажується з JSON, логіка звертається лише сюди. */
import rulesJson from './rules.json';
import itemsJson from './items.json';
import terrainJson from './terrain.json';
import classesJson from './classes.json';
import namesJson from './names.json';
import factionsJson from './factions.json';
import villageMap from './maps/village.json';
import industrialMap from './maps/industrial.json';
import treelineMap from './maps/treeline.json';
import industrialAssault from './scenarios/industrial_assault.json';
import treelineNight from './scenarios/treeline_night.json';
import firstMission from './scenarios/first_mission.json';
import nightRaid from './scenarios/night_raid.json';
import armorAssault from './scenarios/armor_assault.json';
import modsJson from './mods.json';
import vehiclesJson from './vehicles.json';
import dronesJson from './drones.json';
import type {
  ItemDefinition,
  MapDefinition,
  MapObjectDefinition,
  Scenario,
  TerrainDefinition,
  UnitStats,
  DroneDefinition,
  VehicleDefinition,
  WeaponModDefinition,
} from '@/game/types';

export type Rules = typeof rulesJson;

export interface ClassKit {
  primary: string;
  primaryMag?: string;
  primaryMods?: string[];
  secondary?: string;
  secondaryMag?: string;
  helmetMounts?: string[];
  armor?: string;
  helmet?: string;
  rig?: string;
  backpack?: string;
  pouches: string[];
  belt: string[];
  backpackItems: string[];
}

export interface ClassDefinition {
  id: string;
  name: string;
  planned?: boolean;
  /** Особливі вміння класу (medic — повна медична допомога). */
  skills?: string[];
  statMods: Partial<UnitStats>;
  kit: ClassKit | null;
}

export interface ContentDb {
  rules: Rules;
  items: Map<string, ItemDefinition>;
  terrain: Map<string, TerrainDefinition>;
  objects: Map<string, MapObjectDefinition>;
  classes: Map<string, ClassDefinition>;
  names: { first: string[]; last: string[]; callsigns: string[] };
  maps: Map<string, MapDefinition>;
  scenarios: Map<string, Scenario>;
  factions: { id: string; name: string; classes: string[] }[];
  mods: Map<string, WeaponModDefinition>;
  vehicles: Map<string, VehicleDefinition>;
  drones: Map<string, DroneDefinition>;
}

function byId<T extends { id: string }>(list: T[]): Map<string, T> {
  return new Map(list.map((x) => [x.id, x]));
}

export function loadContent(): ContentDb {
  return {
    rules: rulesJson,
    items: byId(itemsJson.items as ItemDefinition[]),
    terrain: byId(terrainJson.terrain as TerrainDefinition[]),
    objects: byId(terrainJson.objects as MapObjectDefinition[]),
    classes: byId(classesJson.classes as ClassDefinition[]),
    names: namesJson,
    maps: byId([villageMap, industrialMap, treelineMap] as unknown as MapDefinition[]),
    scenarios: byId([firstMission as unknown as Scenario, nightRaid as unknown as Scenario, armorAssault as unknown as Scenario, industrialAssault as unknown as Scenario, treelineNight as unknown as Scenario]),
    factions: factionsJson.factions,
    mods: byId(modsJson.mods as WeaponModDefinition[]),
    vehicles: byId(vehiclesJson.vehicles as unknown as VehicleDefinition[]),
    drones: byId(dronesJson.drones as unknown as DroneDefinition[]),
  };
}

let cached: ContentDb | null = null;
export function content(): ContentDb {
  return (cached ??= loadContent());
}

export function itemDef<T extends ItemDefinition = ItemDefinition>(id: string): T {
  const d = content().items.get(id);
  if (!d) throw new Error(`Невідомий предмет: ${id}`);
  return d as T;
}

export function objectDef(id: string): MapObjectDefinition {
  const d = content().objects.get(id);
  if (!d) throw new Error(`Невідомий об'єкт карти: ${id}`);
  return d;
}

export function terrainDef(id: string): TerrainDefinition {
  const d = content().terrain.get(id);
  if (!d) throw new Error(`Невідомий тип місцевості: ${id}`);
  return d;
}

/** Вбудовані (не користувацькі) карти й сценарії — їх не можна перезаписати з редактора. */
export const BUILTIN_IDS = new Set(['village', 'industrial', 'treeline', 'first_mission', 'night_raid', 'armor_assault', 'industrial_assault', 'treeline_night']);

/** Додати або оновити користувацьку карту/сценарій у реєстрі контенту. */
export function registerMap(def: MapDefinition): void {
  content().maps.set(def.id, def);
}
export function registerScenario(sc: Scenario): void {
  content().scenarios.set(sc.id, sc);
}
export function unregister(kind: 'map' | 'scenario', id: string): void {
  if (BUILTIN_IDS.has(id)) return;
  if (kind === 'map') content().maps.delete(id);
  else content().scenarios.delete(id);
}

export function modDef(id: string): WeaponModDefinition {
  const d = content().mods.get(id);
  if (!d) throw new Error(`Невідома модифікація: ${id}`);
  return d;
}

export function vehicleDef(id: string): VehicleDefinition {
  const d = content().vehicles.get(id);
  if (!d) throw new Error(`Невідома техніка: ${id}`);
  return d;
}

export function hasSkill(classId: string, skill: string): boolean {
  return !!content().classes.get(classId)?.skills?.includes(skill);
}

export function droneDef(id: string): DroneDefinition {
  const d = content().drones.get(id);
  if (!d) throw new Error(`Невідомий дрон: ${id}`);
  return d;
}
