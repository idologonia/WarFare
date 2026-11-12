import type { VehicleState } from '@/game/types';
import { Mesh, TransformNode, type Scene, type StandardMaterial } from './babylon';
import { GeoBuilder, hex, shade, type RGB } from './geo';
import { LH } from './mapView';

export interface VehicleModel {
  root: TransformNode;
  meshes: Mesh[];
  hit: Mesh;
}

const WHITE: RGB = [1, 1, 1];
const TRACK: RGB = [0.13, 0.13, 0.12];
const DARK: RGB = [0.1, 0.1, 0.1];
const GLASS: RGB = [0.35, 0.5, 0.6];

/**
 * Модель техніки з блоків. Початок координат — центр площі 2×2, «перед» — уздовж +Z.
 * Корпус — у камуфляжі сторони (текстура матеріалу), деталі — однотонні.
 */
export function buildVehicleModel(scene: Scene, mat: StandardMaterial, v: VehicleState, tile: number | null = null): VehicleModel {
  const root = new TransformNode(`veh_${v.id}`, scene);
  const g = new GeoBuilder();
  const L = LH();
  // Однотонне фарбування замість камуфляжу (М113 — койот, L200 — випадковий колір).
  const paint: RGB | null = v.paint ? hex(v.paint) : null;
  g.tile = tile;
  const camo = (on: boolean) => (g.camo = on && !paint ? 0.35 : null);
  const HULL: RGB = paint ?? WHITE;
  switch (v.defId) {
    case 'mtlb': {
      // МТ-ЛБ: низький довгий корпус, похилий лоб, кабіна з приладами, башточка з ПКТ, 6 котків.
      const h = 0.62 * L;
      for (const x of [-0.72, 0.72]) {
        g.box(x, 0.16, 0, 0.26, 0.28, 1.86, TRACK); // гусениця
        g.box(x, 0.31, 0, 0.27, 0.03, 1.7, shade(TRACK, 1.3)); // верхня гілка
        for (let i = 0; i < 6; i++) g.prism(x, 0.16, -0.7 + i * 0.28, 0.24, 0.24, 0.29, 8, shade(TRACK, 1.6), 0, Math.PI / 2); // котки
        g.prism(x, 0.22, 0.88, 0.2, 0.2, 0.3, 8, shade(TRACK, 1.9), 0, Math.PI / 2); // ведуче колесо
        g.prism(x, 0.22, -0.9, 0.18, 0.18, 0.3, 8, shade(TRACK, 1.9), 0, Math.PI / 2); // лінивець
      }
      camo(true);
      g.box(0, 0.33, -0.06, 1.18, 0.3, 1.7, HULL); // нижня частина корпусу
      g.box(0, h * 0.86, -0.18, 1.5, 0.22, 1.42, HULL); // верхня частина з надгусеничними полицями
      g.box(0, h * 0.62, 0.74, 1.18, 0.36, 0.42, HULL, 1, 0, -0.62); // похилий лобовий лист
      g.box(0, 0.24, 0.9, 1.1, 0.2, 0.12, HULL, 1, 0, 0.5); // нижній лобовий лист
      g.box(0, h * 1.02, 0.42, 1.18, 0.12, 0.34, HULL); // кабіна водія й командира
      for (const x of [-0.72, 0.72]) g.box(x, h * 0.72, -0.18, 0.3, 0.03, 1.5, shade(HULL, 0.9)); // крила над гусеницями
      g.prism(0.32, h * 1.18, 0.38, 0.36, 0.36, 0.16, 8, HULL, Math.PI / 2); // башточка
      camo(false);
      g.box(0.32, h * 1.2, 0.68, 0.045, 0.045, 0.42, DARK); // ПКТ
      g.box(0.32, h * 1.2, 0.48, 0.1, 0.09, 0.08, shade(DARK, 1.6)); // маска
      for (const x of [-0.42, -0.22, 0.02]) g.box(x, h * 1.1, 0.58, 0.12, 0.05, 0.04, GLASS); // оглядові прилади
      g.box(-0.32, h * 1.09, 0.38, 0.28, 0.025, 0.24, shade(DARK, 1.7)); // люк водія
      for (const x of [-0.3, 0.3]) g.box(x, h * 0.99, -0.5, 0.42, 0.025, 0.5, shade(DARK, 1.7)); // люки десанту
      for (const x of [-0.28, 0.28]) g.box(x, 0.42, -0.93, 0.44, 0.38, 0.04, shade(HULL, 0.85)); // задні двері
      for (const x of [-0.28, 0.28]) g.box(x, 0.48, -0.955, 0.08, 0.06, 0.02, GLASS); // бійниці в дверях
      g.box(-0.62, h * 0.95, -0.55, 0.18, 0.12, 0.4, shade(HULL, 0.8)); // ящик ЗІП
      g.box(0.62, h * 0.95, 0.05, 0.14, 0.1, 0.5, shade(HULL, 0.8)); // ящик ЗІП
      g.box(-0.55, h * 1.15, -0.85, 0.02, 0.6, 0.02, DARK); // антена
      g.box(0.5, 0.6, -0.88, 0.08, 0.08, 0.14, shade(DARK, 1.3)); // вихлоп
      g.box(-0.4, 0.3, 0.97, 0.12, 0.05, 0.04, [0.8, 0.8, 0.6]); // фари
      g.box(0.4, 0.3, 0.97, 0.12, 0.05, 0.04, [0.8, 0.8, 0.6]);
      break;
    }
    case 'm113': {
      const h = 0.95 * L;
      for (const x of [-0.8, 0.8]) {
        g.box(x, 0.24, 0, 0.3, 0.48, 1.9, TRACK);
        for (let i = 0; i < 5; i++) g.box(x, 0.2, -0.72 + i * 0.36, 0.32, 0.24, 0.24, shade(TRACK, 1.4));
      }
      camo(true);
      g.box(0, h * 0.55, -0.05, 1.42, h * 0.62, 1.8, HULL); // коробчастий корпус
      g.box(0, h * 0.45, 0.9, 1.42, h * 0.42, 0.25, HULL); // похилий лоб (сходинка)
      camo(false);
      g.box(0.3, h * 0.92, 0.15, 0.4, 0.12, 0.4, shade(DARK, 1.5)); // командирська башточка
      g.box(0.3, h * 1.03, 0.4, 0.42, 0.18, 0.05, shade(DARK, 1.7)); // щиток
      g.box(0.3, h * 1.02, 0.75, 0.06, 0.06, 0.75, DARK); // ВКК
      g.box(0, h * 0.4, -0.96, 0.9, h * 0.55, 0.04, shade(DARK, 1.8)); // кормова рампа
      break;
    }
    default: {
      // L200: пікап із кулеметом у кузові.
      for (const [x, z] of [[-0.7, 0.6], [0.7, 0.6], [-0.7, -0.6], [0.7, -0.6]]) g.box(x, 0.2, z, 0.2, 0.4, 0.42, DARK);
      camo(true);
      g.box(0, 0.42, 0, 1.25, 0.28, 1.9, HULL); // рама/борти
      g.box(0, 0.75, 0.35, 1.2, 0.5, 0.75, HULL); // кабіна
      g.box(0, 0.58, 0.85, 1.2, 0.25, 0.25, HULL); // капот
      camo(false);
      g.box(0, 0.82, 0.72, 1.1, 0.26, 0.02, GLASS); // лобове скло
      for (const x of [-0.6, 0.6]) g.box(x, 0.66, -0.5, 0.05, 0.25, 0.8, shade(DARK, 2)); // борти кузова
      g.box(0, 0.62, -0.5, 0.05, 0.3, 0.05, DARK); // турель
      g.box(0, 0.8, -0.25, 0.06, 0.06, 0.6, DARK); // кулемет
      g.box(0, 0.65, 0.97, 1.0, 0.08, 0.04, [0.8, 0.8, 0.6]); // фари
    }
  }
  const body = g.build('vehicle', scene, mat);
  body.parent = root;
  body.metadata = { vehicleId: v.id };
  const hit = new GeoBuilder().box(0, 0.6, 0, 2, 1.2, 2, WHITE).build('vhit', scene, mat);
  hit.parent = root;
  hit.visibility = 0;
  hit.metadata = { vehicleId: v.id, hitbox: true, vehicle: true };
  body.enableEdgesRendering(0.95);
  body.edgesWidth = 2;
  body.edgesColor.set(0.04, 0.04, 0.05, 0.8);
  return { root, meshes: [body], hit };
}

export const facingAngle = (f: number) => [0, Math.PI / 2, Math.PI, -Math.PI / 2][f] ?? 0;
