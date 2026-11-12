import { content } from '@/content';
import { Rng } from '@/core/rng';
import { applyFaction } from '@/game/simulation/mission';
import { newId, type MissionState } from '@/game/simulation/state';
import { generateUnit } from '@/game/units/generator';
import type { SideId, Unit, UnitStats } from '@/game/types';

/**
 * Ростер (як у Door Kickers): постійний загін фракції з іменами. Перед місією гравець обирає,
 * кого взяти; після місії — досвід, лікування, втрати. Зберігається в браузері окремо від збережень місій.
 */
export interface RosterSoldier {
  id: string;
  name: string;
  callsign: string;
  classId: string;
  appearance: Unit['appearance'];
  stats: UnitStats;
  xp: number;
  missions: number;
  kills: number;
  /** ready — готовий; wounded — лікується ще stateTurns місій; kia — загинув. */
  status: 'ready' | 'wounded' | 'kia';
  recovery?: number;
}

export interface Roster {
  factionId: string;
  soldiers: RosterSoldier[];
  seq: number;
}

/** Склад нового ростера: різні класи. */
export const START_CLASSES = ['rifleman', 'rifleman', 'rifleman', 'rifleman', 'marksman', 'mg1', 'mg2', 'grenadier1', 'grenadier2', 'scout', 'medic', 'droneOperator'];
export const ROSTER_MAX = 16;

export function recruit(r: Roster, classId: string, seed = Date.now()): RosterSoldier {
  const rng = Rng.fromSeed(seed + r.seq * 7919);
  const u = generateUnit('blue', classId, rng, (p) => `${p}${r.seq}`);
  r.seq++;
  const s: RosterSoldier = { id: `r${r.seq}_${seed % 100000}`, name: u.name, callsign: u.callsign, classId, appearance: u.appearance, stats: u.stats, xp: 0, missions: 0, kills: 0, status: 'ready' };
  r.soldiers.push(s);
  return s;
}

export function newRoster(factionId: string, seed = Date.now()): Roster {
  const r: Roster = { factionId, soldiers: [], seq: 0 };
  for (const c of START_CLASSES) recruit(r, c, seed);
  return r;
}

const KEY = (f: string) => `warfare.roster.${f}`;

export function loadRoster(factionId: string): Roster {
  try {
    const raw = localStorage.getItem(KEY(factionId));
    if (raw) return JSON.parse(raw) as Roster;
  } catch {
    /* немає сховища */
  }
  const r = newRoster(factionId);
  saveRoster(r);
  return r;
}

export function saveRoster(r: Roster): void {
  try {
    localStorage.setItem(KEY(r.factionId), JSON.stringify(r));
  } catch {
    /* немає сховища */
  }
}

/** Скільки бійців бере сторона в цю місію (за сценарієм; екіпаж техніки — окремо). */
export const squadSize = (s: MissionState, side: SideId) => s.scenario.sides[side].squad.reduce((a, q) => a + q.count, 0);

/** Замінити згенерований загін сторони на обраних бійців ростера (до початку бою). */
export function applyRosterPicks(s: MissionState, side: SideId, picks: RosterSoldier[]): void {
  const rng = Rng.fromSeed(s.seed + 17);
  s.units = s.units.filter((u) => u.side !== side || u.inVehicle);
  const setup = s.scenario.sides[side];
  for (const p of picks) {
    const u = generateUnit(side, p.classId, rng, (pre) => newId(s, pre), { aiStyle: setup.aiStyle });
    u.name = p.name;
    u.callsign = p.callsign;
    u.appearance = p.appearance;
    u.stats = { ...p.stats };
    u.health = p.stats.health;
    u.stamina = p.stats.stamina;
    u.morale = p.stats.morale;
    u.xp = p.xp;
    u.rosterId = p.id;
    s.units.push(u);
    applyFaction(s, u, setup.factionId);
  }
}

/** Ранги за досвідом (лише назва й невеликий ріст навченості — нараховується після місії). */
export const RANKS: [number, string][] = [[0, 'Солдат'], [60, 'Старший солдат'], [150, 'Молодший сержант'], [300, 'Сержант'], [500, 'Старший сержант']];
export const rankOf = (xp: number) => [...RANKS].reverse().find(([x]) => xp >= x)![1];

/** Наслідки місії для ростера: досвід, ранги, поранені на лікуванні, загиблі. */
export function applyMissionResult(r: Roster, s: MissionState, side: SideId): string[] {
  const notes: string[] = [];
  for (const sol of r.soldiers) if (sol.status === 'wounded' && sol.recovery !== undefined) {
    sol.recovery -= 1;
    if (sol.recovery <= 0) {
      sol.status = 'ready';
      delete sol.recovery;
      notes.push(`${sol.callsign} повернувся з лікування`);
    }
  }
  for (const u of s.units) {
    if (u.side !== side || !u.rosterId) continue;
    const sol = r.soldiers.find((x) => x.id === u.rosterId);
    if (!sol) continue;
    const before = rankOf(sol.xp);
    sol.xp = u.xp;
    sol.missions += 1;
    sol.kills += u.stats_mission.kills;
    const after = rankOf(sol.xp);
    if (after !== before) {
      sol.stats.training = Math.min(95, sol.stats.training + 3);
      notes.push(`${sol.callsign}: нове звання — ${after}`);
    }
    if (u.status === 'dead') {
      sol.status = 'kia';
      notes.push(`${sol.callsign} загинув`);
    } else if (u.injuries.some((i) => i.type !== 'burn' || u.health < u.stats.health * 0.5) && u.health < u.stats.health * 0.7) {
      // Евакуйовані поранені повертаються відновленими (правило GDD); решта лікується.
      if (u.status !== 'evacuated') {
        sol.status = 'wounded';
        sol.recovery = u.health < u.stats.health * 0.35 ? 2 : 1;
        notes.push(`${sol.callsign} поранений — лікування ${sol.recovery} міс.`);
      }
    }
  }
  return notes;
}

export const className = (id: string) => content().classes.get(id)?.name ?? id;
