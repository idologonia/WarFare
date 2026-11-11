/**
 * Типізовані моделі гри (ТЗ, розділ 3).
 * Шаблони контенту (*Definition) лежать у JSON; екземпляри (*Instance, Unit) живуть у стані місії.
 */
import type { Cell } from '@/core/grid';

export type SideId = 'blue' | 'red';
export type ControllerKind = 'human' | 'ai';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type AiStyle = 'aggressive' | 'cautious' | 'defensive';

export type Stance = 'standing' | 'crouched' | 'prone';
export type WeaponState = 'high' | 'low' | 'carry';
export type MoveMode = 'fast' | 'standard' | 'careful';
export type FireMode = 'snap' | 'burst' | 'aimed' | 'blind';

export type BodyPart = 'head' | 'torso' | 'leftArm' | 'rightArm' | 'leftLeg' | 'rightLeg';
export const BODY_PARTS: BodyPart[] = ['head', 'torso', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'];

export type Material = 'concrete' | 'brick' | 'wood' | 'metal' | 'sandbag' | 'earth' | 'glass' | 'foliage';

// ---------- Контент: місцевість та об'єкти ----------

export interface TerrainDefinition {
  id: string;
  name: string;
  /** 0 — звичайна, 1 — повільна (бруд, кущі). Впливає на витривалість, шум і шанс реакції противника, але не на AP. */
  slow: number;
  color: string;
  indoor?: boolean;
}

export interface MapObjectDefinition {
  id: string;
  name: string;
  material: Material;
  /** 0 — немає, 1 — половинне, 2 — повне укриття. */
  cover: 0 | 1 | 2;
  blocksMove: boolean;
  /** Висота об'єкта в частках поверху (0..1): що нижче — перекривається для пострілів і огляду. */
  height: number;
  /** Чи прозорий для огляду вище "sill" (вікно). */
  window?: boolean;
  sill?: number;
  /** Зменшення дальності виявлення для цілі за/у об'єкті (рослинність). */
  concealment?: number;
  hp: number;
  /** На що перетворюється при пошкодженні (hp <= 50%) і руйнуванні. null — зникає. */
  damagedTo?: string;
  destroyedTo?: string | null;
  /** Стіни будівель (для прозорості та визначення приміщень). */
  wall?: boolean;
  /** Тонкий об'єкт: ставиться на межу клітинок (редактор пропонує саме так). */
  thin?: boolean;
  door?: boolean;
  color: string;
}

// ---------- Контент: спорядження ----------

export type ItemKind = 'weapon' | 'magazine' | 'grenade' | 'medical' | 'armor' | 'helmet' | 'rig' | 'backpack' | 'helmetMount' | 'drone';

export interface ItemDefinitionBase {
  id: string;
  kind: ItemKind;
  name: string;
  weight: number;
  /** Розмір у клітинках рюкзака. */
  size: [number, number];
}

export interface WeaponDefinition extends ItemDefinitionBase {
  kind: 'weapon';
  category: 'rifle' | 'marksman' | 'lmg' | 'pistol' | 'launcher';
  /** Калібр — для сумісності магазинів. */
  caliber: string;
  /** Які типи магазинів приймає (часткова сумісність). */
  magazines: string[];
  accuracy: number;
  damage: number;
  penetration: number;
  /** Ефективна дальність у клітинках. */
  range: number;
  burst: number;
  /** Бонус у ближньому бою (CQB, <= 3 клітинки). */
  cqb: number;
  /** Доступні режими стрільби. */
  modes: FireMode[];
  /** Модифікатори вартості пострілу в AP (додаються до базових). */
  apMod?: Partial<Record<FireMode, number>>;
  /** Застарілий опис слотів (умовна зброя першої версії). */
  modSlots?: string[];
  /** Вбудована планка Пікатінні. */
  rail?: boolean;
  /** Сумісні модифікації (id з mods.json). */
  mods?: string[];
  /** Віддача: додається до штрафу кожної наступної кулі черги. */
  recoil?: number;
  suppression: number;
  /** Одноразовий гранатомет: заряджений, після пострілу викидається. */
  disposable?: boolean;
  /** Гранатомет: параметри вибуху пострілу. */
  blast?: { radius: number; damage: number; fragments: number; objectDamage: number };
}

export interface WeaponModEffects {
  snap?: number;
  burst?: number;
  aimed?: number;
  /** Бонус прицільного пострілу на дальній дистанції. */
  aimedFar?: number;
  cqb?: number;
  range?: number;
  recoil?: number;
}

export interface WeaponModDefinition {
  id: string;
  name: string;
  slot: 'rail' | 'optic' | 'magnifier' | 'grip' | 'underbarrel';
  weight: number;
  requires: string[];
  /** Несумісні одночасно модифікації. */
  excludes?: string[];
  planned?: boolean;
  effects: WeaponModEffects;
}

export interface Warhead {
  /** heat — кумулятивний (пробиває стіни), frag — осколковий (не пробиває). */
  type: 'heat' | 'frag';
  damage: number;
  penetration: number;
  blast: { radius: number; damage: number; fragments: number; objectDamage: number };
}

export interface MagazineDefinition extends ItemDefinitionBase {
  kind: 'magazine';
  caliber: string;
  capacity: number;
  /** Для пострілів гранатомета — тип бойової частини. */
  warhead?: Warhead;
}

export interface GrenadeDefinition extends ItemDefinitionBase {
  kind: 'grenade';
  radius: number;
  damage: number;
  fragments: number;
  /** Шкода оточенню; звичайні осколкові гранати об'єкти не руйнують (0). */
  objectDamage?: number;
  /** Зміна дальності кидка (важка граната летить ближче). */
  rangeMod?: number;
  /** Димова: завіса на радіус і кількість ходів. */
  smoke?: { radius: number; turns: number };
}

export type MedicalEffect = 'tourniquet' | 'packing' | 'bandage' | 'chestSeal' | 'needle' | 'pills' | 'stabilize';

export interface MedicalDefinition extends ItemDefinitionBase {
  kind: 'medical';
  effect: MedicalEffect;
  ap: number;
  uses: number;
  /** Лише для бойового медика. */
  medicOnly?: boolean;
}

export interface ArmorDefinition extends ItemDefinitionBase {
  kind: 'armor' | 'helmet';
  /** Які частини тіла захищає і з яким покриттям (0..1). */
  covers: Partial<Record<BodyPart, number>>;
  protection: number;
  durability: number;
  /** Додатковий елемент захисту (шия, пах, плечі, ноги, боки). */
  slot?: 'extra';
  /** Кріпиться до плитоноски/РПС (без бронежилета не носиться). */
  requiresCarrier?: boolean;
  /** Скільки підсумків під магазини дає (для плитоноски/РПС). */
  pouches?: number;
}

export interface RigDefinition extends ItemDefinitionBase {
  kind: 'rig';
  pouches: number;
}

export interface HelmetMountDefinition extends ItemDefinitionBase {
  kind: 'helmetMount';
  mount: 'light' | 'nvg';
  /** ПНБ: множник дальності огляду вночі. */
  nightFactor?: number;
  /** ПНБ: штраф влучання вночі замість стандартного. */
  nightHitPenalty?: number;
}

export interface DroneItemDefinition extends ItemDefinitionBase {
  kind: 'drone';
  /** Який дрон (content/drones.json). */
  drone: string;
}

export interface BackpackDefinition extends ItemDefinitionBase {
  kind: 'backpack';
  grid: [number, number];
}

export type ItemDefinition =
  | WeaponDefinition
  | MagazineDefinition
  | GrenadeDefinition
  | MedicalDefinition
  | ArmorDefinition
  | RigDefinition
  | BackpackDefinition
  | HelmetMountDefinition
  | DroneItemDefinition;

// ---------- Екземпляри ----------

export interface ItemInstance {
  id: string;
  defId: string;
}

export interface WeaponInstance extends ItemInstance {
  /** Вставлений магазин (окремий предмет). */
  magazine: MagazineInstance | null;
  /** Встановлені модифікації (змінюються лише перед місією). */
  mods: string[];
}

export interface MagazineInstance extends ItemInstance {
  rounds: number;
}

export interface ArmorPiece extends ItemInstance {
  durability: number;
}

export interface StackItem extends ItemInstance {
  /** Для медицини — кількість застосувань, для гранат — 1. */
  uses: number;
}

export type AnyItem = WeaponInstance | MagazineInstance | ArmorPiece | StackItem;

export interface BackpackEntry {
  item: AnyItem;
  x: number;
  y: number;
}

export interface Inventory {
  primary: WeaponInstance | null;
  secondary: WeaponInstance | null;
  helmet: ArmorPiece | null;
  armor: ArmorPiece | null;
  rig: ItemInstance | null;
  /** Підсумки на РПС / плитоносці: швидкий доступ (перезаряджання дешевше). */
  pouches: (MagazineInstance | StackItem)[];
  /** Пояс: аптечка, гранати. */
  belt: StackItem[];
  backpack: ItemInstance | null;
  backpackItems: BackpackEntry[];
  /** Додатковий захист: шия, пах, плечі, ноги, боки. */
  extraArmor?: ArmorPiece[];
  /** Кріплення на каску: ліхтар, ПНБ (у старих збереженнях може бути відсутнє). */
  helmetMounts?: ItemInstance[];
}

// ---------- Бійці ----------

export interface UnitStats {
  health: number;
  stamina: number;
  training: number;
  morale: number;
  reaction: number;
  /** Додано за погодженням: впливає на огляд і виявлення. */
  perception: number;
  /** Додано за погодженням: впливає на допустиму вагу. */
  strength: number;
}

export type InjuryType =
  | 'gunshotLight'
  | 'gunshotHeavy'
  | 'shrapnelLight'
  | 'shrapnelHeavy'
  | 'laceration'
  | 'amputation'
  | 'pneumothorax';

export type Bleeding = 'none' | 'light' | 'massive';

export interface Injury {
  id: string;
  part: BodyPart;
  type: InjuryType;
  bleeding: Bleeding;
  /** Для поранень тулуба: чи закрита оклюзійною наліпкою. */
  sealed?: boolean;
  /** Накладено турнікет (кінцівки). */
  tourniquet?: boolean;
  bandaged?: boolean;
  /** Хід, коли отримано. */
  turn: number;
}

export interface Appearance {
  skin: number;
  hair: number;
  face: number;
}

export type UnitStatus = 'active' | 'down' | 'dead' | 'evacuated' | 'reserve';

export interface UnitMissionStats {
  shots: number;
  hits: number;
  kills: number;
  damageDealt: number;
  roundsUsed: number;
  grenades: number;
  medsUsed: number;
  woundsTaken: number;
}

export interface Unit {
  id: string;
  side: SideId;
  name: string;
  callsign: string;
  classId: string;
  appearance: Appearance;
  /** Максимальні значення. */
  stats: UnitStats;
  /** Поточні значення. */
  health: number;
  stamina: number;
  morale: number;
  xp: number;
  injuries: Injury[];
  inventory: Inventory;
  pos: Cell | null;
  stance: Stance;
  weaponState: WeaponState;
  status: UnitStatus;
  /** AP у десятих частках. */
  ap: number;
  apMax: number;
  /** Резерв AP під overwatch (у десятих). 0 — немає overwatch. */
  overwatch: number;
  suppression: number;
  panicked: boolean;
  /** Кого несе (id). */
  carrying: string | null;
  carriedBy: string | null;
  /** Ліхтар увімкнено (вночі видно далі, але й самого видно здалеку). */
  lightOn?: boolean;
  /** Боєць у техніці (id машини); pos при цьому null. */
  inVehicle?: string;
  /** Оператор керує дроном (id дрона). */
  piloting?: string;
  aiStyle?: AiStyle;
  stats_mission: UnitMissionStats;
  /** Хід, на якому має з'явитися підкріплення (для резерву). */
  reserveTurn?: number;
}

// ---------- Карта ----------

export type EdgeSide = 'n' | 'w' | 's' | 'e';

/** Тонкий об'єкт на межі клітинок (стіна, вікно, двері, паркан, мішки, парапет). */
export interface EdgeObject {
  defId: string;
  hp: number;
}

export interface MapCell {
  /** Межі клітинки: n (північ) і w (захід); s/e — лише на краю карти. */
  edges?: Partial<Record<EdgeSide, EdgeObject>>;
  terrain: string;
  /** Чи є підлога (на поверсі 0 завжди true). */
  floor: boolean;
  /** Пагорб: підйом у частках поверху (0..0.5). */
  elevation: number;
  /** rot — поворот моделі об'єкта на 90° (лише вигляд). */
  object: { defId: string; hp: number; rot?: number } | null;
  /** Техніка, що стоїть у клітинці (займає кілька клітинок). */
  vehicle?: string;
  /** Висота корпусу техніки в цій клітинці (для огляду/вогню). */
  vehicleHeight?: number;
  /** Димова завіса: скільки ходів ще тримається. */
  smoke?: number;
  /** Сходи з цього поверху на наступний. */
  stairsUp?: boolean;
  buildingId?: number;
}

export interface MapState {
  id: string;
  name: string;
  width: number;
  height: number;
  levels: number;
  /** cells[z][y][x] */
  cells: MapCell[][][];
}

export interface MapDefinition {
  id: string;
  name: string;
  width: number;
  height: number;
  /** Символи → вміст клітинки. */
  legend: Record<string, { terrain: string; object?: string; floor?: boolean; elevation?: number; stairsUp?: boolean; variation?: [string | null, number][] }>;
  /** Рядки по поверхах: layers[z][y] — рядок довжини width. */
  layers: string[][];
  /** Прямокутники будівель [x0,y0,x1,y1] для прозорості стін. */
  buildings: [number, number, number, number][];
  /** Тонкі об'єкти на межах клітинок: [x, y, поверх, бік, id об'єкта]. */
  edges?: [number, number, number, EdgeSide, string][];
  /** Повороти об'єктів у клітинках: [x, y, поверх, 0..3]. */
  rotations?: [number, number, number, number][];
}

// ---------- Сценарій ----------

export interface SideSetup {
  name: string;
  factionId: string;
  controller: ControllerKind;
  /** Склад: клас і кількість. */
  squad: { classId: string; count: number }[];
  deployZone: [number, number, number, number];
  /** Якщо true — гравець сам розставляє бійців. */
  manualDeploy: boolean;
  aiStyle?: AiStyle;
  /** Зміни стандартного комплекту класу для цього сценарію. */
  loadout?: SideLoadout;
  /** Техніка сторони (з екіпажем: водій і навідник). */
  vehicles?: string[];
}

export interface SideLoadout {
  /** Додаткові (або менше, якщо від'ємне) запасні магазини на бійця. */
  extraMags: number;
  /** Додаткові гранати на бійця. */
  extraGrenades: number;
  /** Без бронежилетів і касок. */
  noArmor: boolean;
  /** Повний комплект додаткового захисту (шия, пах, плечі, ноги, боки). */
  extraArmor?: boolean;
  /** Кріплення на каску для всієї сторони. */
  helmetMount?: 'none' | 'flashlight' | 'nvg_mono' | 'nvg_bino';
}

export interface Scenario {
  id: string;
  name: string;
  description: string;
  type: 'clear' | 'defense' | 'assault' | 'recon' | 'hold' | 'free';
  mapId: string;
  timeOfDay: 'day' | 'night';
  weather: 'clear' | 'fog' | 'rain';
  difficulty: Difficulty;
  sides: Record<SideId, SideSetup>;
  evacZone: [number, number, number, number] | null;
  /** Через скільки ходів приходить заміна за евакуйованого загиблого. */
  reinforcementDelay: number;
  victory: { type: 'eliminate' };
  randomEvents: boolean;
  /** Чи видно карту до місії. */
  mapPreview: boolean;
  maxTurns?: number;
}

// ---------- Хід і результат ----------

export type MissionPhase = 'deploy' | 'battle' | 'ended';

export interface TurnState {
  turn: number;
  side: SideId;
  phase: MissionPhase;
}

/** Що знає сторона про противника. */
export interface Contact {
  unitId: string;
  /** Поточна або остання відома позиція. */
  pos: Cell;
  visible: boolean;
  identified: boolean;
  lastSeenTurn: number;
}

export interface MissionResult {
  winner: SideId | null;
  reason: 'eliminated' | 'withdrawal' | 'turnLimit';
  turns: number;
  perSide: Record<
    SideId,
    {
      killed: number;
      wounded: number;
      evacuated: number;
      leftOnField: number;
      roundsUsed: number;
      grenades: number;
      medsUsed: number;
      /** Знищена техніка цієї сторони. */
      vehiclesLost?: number;
    }
  >;
  units: { id: string; name: string; side: SideId; status: UnitStatus; stats: UnitMissionStats; health: number; injuries: number }[];
}

// ---------- Техніка ----------

export type VehicleComponent = 'hull' | 'engine' | 'mobility' | 'weapon';

export interface VehicleDefinition {
  id: string;
  name: string;
  kind: 'tracked' | 'wheeled';
  footprint: [number, number];
  armor: number;
  /** Висота корпусу в частках поверху (для огляду й укриття). */
  height: number;
  /** AP водія за клітинку руху. */
  moveCost: number;
  weapon?: string;
  weaponAmmo?: string;
  ammoStock: number;
  passengers: number;
  components: Record<VehicleComponent, number>;
  colors: Record<string, string>;
}

export interface VehicleState {
  id: string;
  defId: string;
  side: SideId;
  /** Лівий верхній кут площі техніки (поверх 0). */
  x: number;
  y: number;
  /** Напрямок корпусу: 0 — північ, 1 — схід, 2 — південь, 3 — захід (вигляд). */
  facing: number;
  hp: Record<VehicleComponent, number>;
  driver: string | null;
  gunner: string | null;
  passengers: string[];
  weapon: WeaponInstance | null;
  ammoStock: number;
  destroyed: boolean;
  /** Однотонне фарбування корпусу (замість камуфляжу сторони). */
  paint?: string;
}

// ---------- Дрони ----------

export interface DroneDefinition {
  id: string;
  name: string;
  /** fpv — камікадзе, dropper — зі скидом, recon — розвідка. */
  kind: 'fpv' | 'dropper' | 'recon';
  ap: number;
  moveCost: number;
  battery: number;
  vision: number;
  /** Тепловізор: бачить уночі й крізь дим/рослинність. */
  thermal: boolean;
  /** Точність ураження (0..1): менше — більше відхилення. */
  accuracy?: number;
  warhead?: Warhead;
  drops?: number;
  dropBlast?: Warhead['blast'];
}

export interface DroneState {
  id: string;
  defId: string;
  side: SideId;
  operatorId: string;
  /** Предмет, з якого запущено (для посадки назад). */
  itemDefId: string;
  x: number;
  y: number;
  /** AP у десятих. */
  ap: number;
  battery: number;
  drops: number;
  destroyed: boolean;
  /** Висота польоту: рівень поверху 0..levels (levels — над дахами). */
  alt?: number;
}
