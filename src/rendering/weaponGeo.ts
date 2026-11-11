import { itemDef } from '@/content';
import type { WeaponDefinition } from '@/game/types';
import type { GeoBuilder, RGB } from './geo';

const STEEL: RGB = [0.13, 0.13, 0.14];
const DARK: RGB = [0.09, 0.09, 0.1];
const POLY: RGB = [0.19, 0.19, 0.18];
const WOOD: RGB = [0.48, 0.28, 0.14];
const BAKELITE: RGB = [0.5, 0.24, 0.11];
const TAN: RGB = [0.58, 0.5, 0.36];
const LENS: RGB = [0.3, 0.55, 0.75];

/**
 * Геометрія зброї з обвісом (локальні координати моделі бійця, ствол — уздовж +Z, руків'я біля z≈0.05).
 * Використовуються призми: круглі стволи, восьмигранні цівки, вигнуті магазини, нахилені руків'я.
 */
export function buildWeaponGeo(g: GeoBuilder, weaponId: string, mods: string[], magId: string | null): void {
  const wd = itemDef<WeaponDefinition>(weaponId);
  const id = wd.id;
  const has = (m: string) => mods.includes(m);

  /** Приціли й обвіс на верхній планці. */
  const optics = (y: number, z: number, railLen = 0.22) => {
    if (has('rail') || wd.rail) {
      g.box(0, y - 0.035, z + 0.02, 0.045, 0.018, railLen, DARK);
      for (let i = 0; i < 6; i++) g.box(0, y - 0.024, z - railLen / 2 + 0.03 + i * (railLen / 6), 0.047, 0.006, 0.012, STEEL);
    }
    if (has('reddot')) {
      g.box(0, y - 0.015, z, 0.04, 0.02, 0.06, DARK);
      g.prism(0, y + 0.012, z, 0.042, 0.042, 0.07, 8, DARK);
      g.prism(0, y + 0.012, z + 0.036, 0.03, 0.03, 0.004, 8, [0.85, 0.2, 0.2]);
    }
    if (has('magnifier')) {
      g.prism(0, y + 0.015, z - 0.1, 0.045, 0.045, 0.09, 8, DARK);
      g.prism(0, y + 0.015, z - 0.146, 0.034, 0.034, 0.004, 8, LENS);
    }
    if (has('scope4')) {
      g.box(0, y - 0.012, z - 0.04, 0.03, 0.025, 0.03, DARK);
      g.box(0, y - 0.012, z + 0.05, 0.03, 0.025, 0.03, DARK);
      g.prism(0, y + 0.02, z, 0.04, 0.04, 0.2, 10, [0.08, 0.08, 0.09]);
      g.prism(0, y + 0.02, z + 0.12, 0.06, 0.06, 0.05, 10, [0.08, 0.08, 0.09]); // об'єктив
      g.prism(0, y + 0.02, z - 0.11, 0.05, 0.05, 0.035, 10, [0.08, 0.08, 0.09]); // окуляр
      g.prism(0, y + 0.02, z + 0.146, 0.05, 0.05, 0.004, 10, LENS);
      g.prism(0, y + 0.05, z, 0.02, 0.02, 0.025, 6, DARK, Math.PI / 2); // барабанчик
    }
  };
  /** Вигнутий магазин із сегментів. */
  const curvedMag = (z: number, len: number, col: RGB) => {
    const segs = Math.max(3, Math.round(len / 0.05));
    let y = -0.08;
    let zz = z;
    for (let i = 0; i < segs; i++) {
      const a = 0.12 + i * 0.09;
      g.prism(0, y, zz, 0.05, 0.072, 0.06, 6, col, Math.PI / 2 - a);
      y -= Math.cos(a) * 0.05;
      zz += Math.sin(a) * 0.05;
    }
  };
  const pistolGrip = (z: number, col: RGB) => g.prism(0, -0.075, z, 0.045, 0.06, 0.11, 6, col, Math.PI / 2 + 0.35);
  const muzzle = (z: number, r = 0.045) => {
    g.prism(0, 0.012, z, r, r, 0.07, 8, STEEL);
    g.box(0, 0.012, z + 0.02, r * 1.1, 0.012, 0.02, DARK);
  };

  if (wd.category === 'lmg') {
    const minimi = id === 'minimi';
    const body: RGB = minimi ? [0.16, 0.16, 0.15] : STEEL;
    g.prism(0, 0, 0.17, 0.09, 0.11, 0.42, 8, body); // ствольна коробка
    g.box(0, 0.06, 0.17, 0.085, 0.02, 0.4, body); // кришка
    g.prism(0, 0.012, 0.6, 0.04, 0.04, 0.44, 8, STEEL); // ствол
    g.prism(0, 0.012, 0.6, 0.05, 0.05, 0.06, 8, DARK); // газовий вузол
    muzzle(0.84, 0.05);
    g.prism(0, -0.005, 0.44, 0.075, 0.07, 0.16, 8, id === 'pkm' ? WOOD : POLY); // цівка
    // Короб зі стрічкою.
    g.box(-0.005, -0.12, 0.15, 0.13, 0.13, 0.17, minimi ? TAN : [0.28, 0.31, 0.22]);
    g.box(-0.005, -0.05, 0.15, 0.12, 0.012, 0.15, DARK);
    for (let i = 0; i < 4; i++) g.prism(0.06 - i * 0.012, 0.02, 0.15, 0.012, 0.02, 0.025, 6, [0.72, 0.6, 0.3]); // набої стрічки
    pistolGrip(0.06, POLY);
    g.prism(0, -0.02, -0.12, 0.06, 0.1, 0.22, 6, id === 'pkm' ? WOOD : POLY); // приклад
    g.prism(0, -0.04, -0.06, 0.04, 0.06, 0.07, 6, id === 'pkm' ? WOOD : POLY, 0.3);
    g.prism(0, 0.085, 0.12, 0.02, 0.02, 0.14, 6, DARK); // ручка
    g.prism(-0.035, -0.08, 0.7, 0.015, 0.015, 0.16, 6, DARK, Math.PI / 2 - 0.4, 0.25); // сошки
    g.prism(0.035, -0.08, 0.7, 0.015, 0.015, 0.16, 6, DARK, Math.PI / 2 - 0.4, -0.25);
    optics(0.1, 0.15);
    return;
  }
  if (wd.category === 'marksman') {
    g.prism(0, 0, 0.16, 0.07, 0.09, 0.36, 8, STEEL);
    g.prism(0, 0.01, 0.56, 0.035, 0.035, 0.44, 8, STEEL);
    muzzle(0.8);
    g.prism(0, 0.0, 0.42, 0.07, 0.07, 0.18, 8, POLY);
    g.prism(0, 0.09, 0.16, 0.05, 0.05, 0.26, 10, [0.08, 0.08, 0.09]);
    g.prism(0, 0.09, 0.3, 0.065, 0.065, 0.04, 10, [0.08, 0.08, 0.09]);
    g.prism(0, 0.09, 0.322, 0.05, 0.05, 0.004, 10, LENS);
    g.box(0, -0.1, 0.2, 0.05, 0.12, 0.07, STEEL);
    g.prism(0, -0.02, -0.12, 0.07, 0.12, 0.22, 6, WOOD);
    pistolGrip(0.06, POLY);
    return;
  }
  if (id === 'ar15') {
    const black: RGB = [0.15, 0.15, 0.14];
    g.box(0, 0.0, 0.11, 0.065, 0.085, 0.24, black); // верхня й нижня ствольні коробки
    g.box(0, -0.045, 0.1, 0.06, 0.03, 0.2, black);
    g.prism(0, 0.0, 0.37, 0.075, 0.075, 0.28, 8, black); // цівка M-LOK
    for (let i = 0; i < 4; i++) g.box(0.038, 0, 0.27 + i * 0.06, 0.004, 0.02, 0.035, DARK); // вирізи M-LOK
    g.prism(0, 0.012, 0.6, 0.032, 0.032, 0.2, 8, STEEL);
    muzzle(0.72, 0.04);
    g.prism(0, -0.115, 0.17, 0.05, 0.13, 0.065, 4, DARK, Math.PI / 2 - 0.12); // прямий магазин
    pistolGrip(0.03, POLY);
    g.box(0, -0.035, 0.09, 0.012, 0.04, 0.06, DARK); // спусковий
    g.prism(0, 0.0, -0.08, 0.035, 0.035, 0.18, 8, DARK); // буферна труба
    g.prism(0, -0.025, -0.15, 0.05, 0.085, 0.1, 6, POLY); // телескопічний приклад
    g.box(0, -0.03, -0.2, 0.05, 0.1, 0.01, DARK);
    g.box(0, 0.06, 0.03, 0.03, 0.025, 0.04, DARK); // ручка зведення
    if (has('foregrip')) g.prism(0, -0.08, 0.38, 0.035, 0.035, 0.1, 8, POLY, Math.PI / 2);
    optics(0.075, 0.18, 0.4);
    return;
  }
  // Сімейство АК.
  const furniture: RGB = id === 'akm' ? WOOD : id === 'ak74' ? BAKELITE : POLY;
  const magCol: RGB = id === 'akm' ? [0.3, 0.28, 0.21] : id === 'ak74' ? BAKELITE : [0.14, 0.14, 0.14];
  g.box(0, 0, 0.13, 0.068, 0.085, 0.3, STEEL); // ствольна коробка
  g.prism(0, 0.04, 0.13, 0.066, 0.03, 0.29, 8, STEEL); // кришка ствольної коробки (заокруглена)
  g.box(0.036, 0.015, 0.16, 0.006, 0.012, 0.14, DARK); // переводчик
  g.prism(0, 0.012, 0.47, 0.03, 0.03, 0.34, 8, STEEL); // ствол
  g.prism(0, 0.045, 0.43, 0.03, 0.03, 0.2, 8, STEEL); // газова трубка
  g.box(0, 0.03, 0.55, 0.045, 0.05, 0.04, STEEL); // газовий вузол
  g.box(0, 0.06, 0.6, 0.01, 0.03, 0.01, DARK); // мушка
  muzzle(0.66, id === 'akm' ? 0.035 : 0.045);
  g.prism(0, 0.0, 0.37, 0.078, 0.07, 0.17, 8, furniture); // цівка
  g.prism(0, 0.045, 0.39, 0.06, 0.035, 0.13, 8, furniture); // накладка газової трубки
  const rpk = magId === 'mag_rpk545_45';
  curvedMag(0.2, rpk ? 0.3 : 0.2, magCol);
  pistolGrip(0.04, furniture);
  g.box(0, -0.04, 0.09, 0.012, 0.035, 0.05, DARK); // спусковий
  // Приклад: шийка й потиличник.
  g.prism(0, -0.015, -0.06, 0.045, 0.07, 0.12, 6, furniture, 0.12);
  g.prism(0, -0.035, -0.16, 0.05, 0.11, 0.1, 6, furniture, 0.12);
  g.box(0, -0.04, -0.215, 0.05, 0.12, 0.012, DARK);
  if (id === 'ak12' || id === 'ak200') g.box(0, 0.065, 0.2, 0.045, 0.015, 0.36, DARK); // довга планка на кришці
  if (has('foregrip')) g.prism(0, -0.08, 0.38, 0.035, 0.035, 0.1, 8, POLY, Math.PI / 2);
  if (has('underbarrel')) {
    // Підствольний модуль.
    g.prism(0, -0.075, 0.42, 0.06, 0.06, 0.22, 10, STEEL);
    g.prism(0, -0.075, 0.535, 0.045, 0.045, 0.01, 10, DARK);
    g.prism(0, -0.13, 0.32, 0.035, 0.05, 0.07, 6, POLY, Math.PI / 2 + 0.3);
  }
  optics(0.085, 0.15);
}
