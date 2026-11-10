import { content, itemDef, modDef } from '@/content';
import type { WeaponDefinition, WeaponInstance, WeaponModEffects } from '@/game/types';

/**
 * Модифікації зброї. Сумісність залежить від моделі (WeaponDefinition.mods),
 * вимоги — від інших модифікацій (коліматор потребує планки; магніфер — коліматора).
 * Змінюються лише перед місією (equipment/loadout.ts).
 */
export function validateMods(weaponId: string, mods: string[]): string[] {
  const w = itemDef<WeaponDefinition>(weaponId);
  const errors: string[] = [];
  const slots = new Map<string, string>();
  for (const id of mods) {
    const m = content().mods.get(id);
    if (!m) {
      errors.push(`Невідома модифікація ${id}`);
      continue;
    }
    if (m.planned) errors.push(`${m.name} ще не доступний`);
    if (!(w.mods ?? []).includes(id)) errors.push(`${m.name} несумісний з ${w.name}`);
    if (slots.has(m.slot)) errors.push(`${m.name} і ${modDef(slots.get(m.slot)!).name} займають одне місце`);
    slots.set(m.slot, id);
    for (const ex of m.excludes ?? []) if (mods.includes(ex) && mods.indexOf(ex) > mods.indexOf(id)) errors.push(`${m.name} і ${modDef(ex).name} не ставляться разом`);
    for (const req of m.requires) {
      const ok = req === 'rail' ? w.rail || mods.includes('rail') : mods.includes(req);
      if (!ok) errors.push(`${m.name} потребує: ${req === 'rail' ? 'планки Пікатінні' : modDef(req).name}`);
    }
  }
  if (w.rail && mods.includes('rail')) errors.push(`${w.name} вже має вбудовану планку`);
  return errors;
}

/** Сумарний вплив модифікацій зброї. */
export function modEffects(w: WeaponInstance | null): Required<WeaponModEffects> {
  const out = { snap: 0, burst: 0, aimed: 0, aimedFar: 0, cqb: 0, range: 0, recoil: 0 };
  for (const id of w?.mods ?? []) {
    const e = content().mods.get(id)?.effects ?? {};
    for (const k of Object.keys(out) as (keyof typeof out)[]) out[k] += e[k] ?? 0;
  }
  return out;
}

export function modsWeight(w: WeaponInstance | null): number {
  return (w?.mods ?? []).reduce((s, id) => s + (content().mods.get(id)?.weight ?? 0), 0);
}

export function modNames(w: WeaponInstance | null): string {
  return (w?.mods ?? []).map((id) => content().mods.get(id)?.name ?? id).join(', ');
}
