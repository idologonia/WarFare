import { itemDef } from '@/content';
import type { WeaponDefinition } from '@/game/types';
import type { GeoBuilder, RGB } from './geo';

/**
 * Геометрія зброї з обвісом (у локальних координатах моделі бійця, ствол — уздовж +Z).
 * Використовується і на бійці, і в збільшеному вигляді в майстерні.
 */
export function buildWeaponGeo(g: GeoBuilder, weaponId: string, wmods: string[], magId: string | null): void {
  const wd = itemDef<WeaponDefinition>(weaponId);
  const black: RGB = [0.09, 0.09, 0.1];
  const u = { inventory: { primary: { magazine: magId ? { defId: magId } : null } } };

  const dark: RGB = [0.12, 0.12, 0.13];
  const poly: RGB = [0.2, 0.2, 0.19];
  const wood: RGB = [0.45, 0.27, 0.14];
  const bakelite: RGB = [0.45, 0.22, 0.12];
  const tan: RGB = [0.55, 0.47, 0.33];
  const id = wd?.id ?? '';
  // Прицільні пристрої та обвіс за встановленими модифікаціями.
  const optics = (y: number, z: number) => {
    if (wmods.includes('rail') || wd?.rail) g.box(0, y - 0.035, z + 0.02, 0.05, 0.02, 0.22, dark);
    if (wmods.includes('reddot')) {
      g.box(0, y, z, 0.045, 0.05, 0.07, black);
      g.box(0, y + 0.005, z + 0.036, 0.03, 0.03, 0.006, [0.85, 0.2, 0.2]);
    }
    if (wmods.includes('magnifier')) g.box(0, y, z - 0.09, 0.05, 0.05, 0.08, black);
    if (wmods.includes('scope4')) {
      g.box(0, y + 0.01, z, 0.05, 0.05, 0.24, [0.08, 0.08, 0.09]);
      g.box(0, y + 0.01, z + 0.13, 0.065, 0.065, 0.03, [0.08, 0.08, 0.09]);
      g.box(0, y + 0.01, z + 0.146, 0.045, 0.045, 0.006, [0.3, 0.55, 0.7]);
    }
  };
  if (wd?.category === 'lmg') {
    const body: RGB = id === 'minimi' ? [0.16, 0.16, 0.15] : dark;
    g.box(0, 0, 0.18, 0.1, 0.12, 0.44, body);
    g.box(0, 0.01, 0.58, 0.04, 0.04, 0.38, dark);
    g.box(0, -0.005, 0.46, 0.08, 0.08, 0.14, id === 'pkm' ? wood : poly);
    g.box(0, -0.12, 0.15, 0.15, 0.13, 0.17, id === 'minimi' ? tan : [0.27, 0.3, 0.21]); // короб
    g.box(0, -0.02, -0.12, 0.07, 0.11, 0.22, id === 'pkm' ? wood : poly); // приклад
    g.box(0, -0.09, 0.06, 0.05, 0.1, 0.05, poly);
    g.box(0, 0.08, 0.12, 0.03, 0.03, 0.14, dark);
    g.box(-0.03, -0.07, 0.66, 0.015, 0.12, 0.015, dark);
    g.box(0.03, -0.07, 0.66, 0.015, 0.12, 0.015, dark);
    optics(0.1, 0.15);
  } else if (wd?.category === 'marksman') {
    g.box(0, 0, 0.16, 0.07, 0.09, 0.38, dark);
    g.box(0, 0.01, 0.54, 0.035, 0.035, 0.4, dark);
    g.box(0, 0.0, 0.43, 0.07, 0.07, 0.18, poly);
    g.box(0, 0.09, 0.16, 0.055, 0.055, 0.26, [0.08, 0.08, 0.09]);
    g.box(0, -0.1, 0.2, 0.05, 0.12, 0.07, dark);
    g.box(0, -0.02, -0.12, 0.07, 0.12, 0.22, wood);
    g.box(0, -0.09, 0.06, 0.05, 0.1, 0.05, poly);
  } else if (id === 'ar15') {
    g.box(0, 0, 0.14, 0.07, 0.1, 0.3, [0.16, 0.16, 0.15]);
    g.box(0, 0.01, 0.46, 0.035, 0.035, 0.3, dark);
    g.box(0, 0.0, 0.37, 0.08, 0.08, 0.2, [0.16, 0.16, 0.15]); // цівка M-LOK
    g.box(0, -0.12, 0.17, 0.055, 0.15, 0.065, dark); // прямий магазин
    g.box(0, 0.0, -0.08, 0.04, 0.04, 0.16, dark); // буферна труба
    g.box(0, -0.02, -0.17, 0.065, 0.11, 0.1, poly); // приклад
    g.box(0, -0.08, 0.05, 0.05, 0.1, 0.05, poly);
    g.box(0, 0.07, 0.07, 0.03, 0.03, 0.05, dark); // ручка зведення
    if (wmods.includes('foregrip')) g.box(0, -0.09, 0.38, 0.035, 0.1, 0.035, poly);
    optics(0.085, 0.16);
  } else {
    // Сімейство АК: вигнутий магазин, дерев'яні накладки в АКМ.
    const furniture: RGB = id === 'akm' ? wood : id === 'ak74' ? bakelite : poly;
    g.box(0, 0, 0.14, 0.07, 0.09, 0.32, dark);
    g.box(0, 0.01, 0.47, 0.035, 0.035, 0.32, dark);
    g.box(0, 0.035, 0.42, 0.03, 0.03, 0.18, dark); // газова трубка
    g.box(0, -0.005, 0.37, 0.075, 0.075, 0.16, furniture);
    const magCol: RGB = id === 'akm' ? [0.3, 0.27, 0.2] : id === 'ak74' ? bakelite : [0.13, 0.13, 0.13];
    const rpk = u.inventory.primary?.magazine?.defId === 'mag_rpk545_45';
    g.box(0, -0.11, 0.21, 0.055, 0.13, 0.07, magCol);
    g.box(0, -0.18, 0.25, 0.055, rpk ? 0.12 : 0.06, 0.07, magCol);
    g.box(0, -0.02, -0.1, 0.06, 0.1, 0.18, id === 'akm' ? wood : poly);
    g.box(0, -0.08, 0.05, 0.05, 0.1, 0.05, poly);
    if (wmods.includes('foregrip')) g.box(0, -0.09, 0.38, 0.035, 0.1, 0.035, poly);
    if (wmods.includes('underbarrel')) {
      // Підствольний модуль під цівкою.
      g.box(0, -0.075, 0.4, 0.065, 0.065, 0.26, dark);
      g.box(0, -0.13, 0.33, 0.04, 0.07, 0.05, poly);
    }
    optics(0.08, 0.15);
  }
}
