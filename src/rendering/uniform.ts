import { content } from '@/content';
import type { SideId, Unit } from '@/game/types';
import { camoFor, uniformTile } from './camo';

export interface UnitLook {
  jacket: number;
  pants: number;
  helmetCover: number;
  helmet: 'highcut' | '6b47' | 'ssh68';
  /** Головний убір без каски. */
  headgear: 'none' | 'cap' | 'beanie' | 'ushanka';
  gear: string;
  /** Цивільний одяг (без налокітників і кишень). */
  civilian?: boolean;
}

const hashStr = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

const CIVIL = new Set(['black', 'brownjacket', 'tracksuit', 'civkhaki', 'hoodie']);
const GEAR_MIX = ['#5d5a3e', '#4a4a3c', '#6b5a40', '#3f4433', '#555046', '#2e2f2b'];

/** Вигляд форми бійця за фракцією його сторони (стабільний для кожного бійця). */
export function lookFor(u: Unit, factionId: string | undefined, side: SideId): UnitLook {
  const f = content().factions.find((x) => x.id === factionId);
  const uf = f?.uniform;
  const h = hashStr(u.id + u.name);
  const pick = <T>(arr: T[], salt: number): T => arr[(h >>> salt) % arr.length];
  if (!uf) {
    const t = uniformTile(camoFor(f?.camo, side));
    return { jacket: t, pants: t, helmetCover: t, helmet: side === 'red' ? '6b47' : 'highcut', headgear: 'none', gear: side === 'red' ? '#4f5438' : '#7d6847' };
  }
  const jacket = uniformTile(pick(uf.jackets, 1));
  const pants = uniformTile(pick(uf.pants, 7));
  return {
    jacket,
    pants,
    helmetCover: uf.helmet === 'ssh68' ? uniformTile('olive') : jacket,
    helmet: uf.helmet ?? 'highcut',
    headgear: (uf.headgear ? pick(uf.headgear, 13) : 'none') as UnitLook['headgear'],
    gear: uf.mixedGear ? pick(GEAR_MIX, 17) : uf.gear ?? '#7d6847',
    civilian: CIVIL.has(pick(uf.jackets, 1)),
  };
}
