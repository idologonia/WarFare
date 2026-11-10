import type { Rng } from '@/core/rng';
import { content } from '@/content';
import { buildInventory, type IdGen } from '@/game/inventory/inventory';
import type { AiStyle, SideId, Unit, UnitStats } from '@/game/types';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Ім'я, позивний, зовнішність і характеристики генеруються грою. */
export function generateUnit(side: SideId, classId: string, rng: Rng, id: IdGen, opts: { statBonus?: number; aiStyle?: AiStyle } = {}): Unit {
  const db = content();
  const cls = db.classes.get(classId);
  if (!cls || !cls.kit) throw new Error(`Клас ${classId} ще не має комплекту для першої версії`);
  const b = opts.statBonus ?? 0;
  const roll = (mean: number, sd: number, lo: number, hi: number) => Math.round(clamp(rng.gaussian(mean, sd), lo, hi));
  const stats: UnitStats = {
    health: roll(95, 8, 75, 115),
    stamina: roll(85, 8, 65, 100),
    training: roll(58 + b, 9, 35, 90),
    morale: roll(72, 9, 50, 95),
    reaction: roll(55 + b / 2, 9, 35, 85),
    perception: roll(55, 9, 35, 85),
    strength: roll(60, 9, 40, 85),
  };
  for (const [k, v] of Object.entries(cls.statMods)) {
    const key = k as keyof UnitStats;
    stats[key] = clamp(stats[key] + (v ?? 0), 1, 120);
  }
  const unitId = id('u');
  return {
    id: unitId,
    side,
    name: `${rng.pick(db.names.first)} ${rng.pick(db.names.last)}`,
    callsign: rng.pick(db.names.callsigns),
    classId,
    appearance: { skin: rng.int(0, 3), hair: rng.int(0, 4), face: rng.int(0, 5) },
    stats,
    health: stats.health,
    stamina: stats.stamina,
    morale: stats.morale,
    xp: 0,
    injuries: [],
    inventory: buildInventory(cls.kit, id),
    pos: null,
    stance: 'standing',
    weaponState: 'low',
    status: 'active',
    ap: 0,
    apMax: 0,
    overwatch: 0,
    suppression: 0,
    panicked: false,
    carrying: null,
    carriedBy: null,
    aiStyle: opts.aiStyle,
    stats_mission: { shots: 0, hits: 0, kills: 0, damageDealt: 0, roundsUsed: 0, grenades: 0, medsUsed: 0, woundsTaken: 0 },
  };
}
