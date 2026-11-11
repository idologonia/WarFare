import type { VehicleState } from '@/game/types';
import { Mesh, TransformNode, type Scene, type StandardMaterial } from './babylon';
import { GeoBuilder, shade, type RGB } from './geo';
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
export function buildVehicleModel(scene: Scene, mat: StandardMaterial, v: VehicleState): VehicleModel {
  const root = new TransformNode(`veh_${v.id}`, scene);
  const g = new GeoBuilder();
  const L = LH();
  const camo = (on: boolean) => (g.camo = on ? 0.35 : null);
  switch (v.defId) {
    case 'mtlb': {
      const h = 0.75 * L;
      for (const x of [-0.78, 0.78]) {
        g.box(x, 0.22, 0, 0.32, 0.44, 1.92, TRACK);
        for (let i = 0; i < 6; i++) g.box(x, 0.18, -0.75 + i * 0.3, 0.34, 0.22, 0.2, shade(TRACK, 1.4)); // катки
      }
      camo(true);
      g.box(0, h * 0.62, 0, 1.3, h * 0.6, 1.85, WHITE); // корпус
      g.box(0, h * 0.55, 0.98, 1.3, h * 0.35, 0.12, WHITE); // лобовий лист
      g.box(-0.3, h * 0.98, 0.55, 0.38, 0.16, 0.38, WHITE); // башточка
      camo(false);
      g.box(-0.3, h * 1.0, 0.95, 0.05, 0.05, 0.55, DARK); // ПКТ
      g.box(0.35, h * 0.95, 0.6, 0.3, 0.06, 0.3, shade(DARK, 1.5)); // люк водія
      g.box(0, h * 0.95, -0.4, 0.9, 0.05, 0.7, shade(DARK, 1.6)); // люки десанту
      break;
    }
    case 'm113': {
      const h = 0.95 * L;
      for (const x of [-0.8, 0.8]) {
        g.box(x, 0.24, 0, 0.3, 0.48, 1.9, TRACK);
        for (let i = 0; i < 5; i++) g.box(x, 0.2, -0.72 + i * 0.36, 0.32, 0.24, 0.24, shade(TRACK, 1.4));
      }
      camo(true);
      g.box(0, h * 0.55, -0.05, 1.42, h * 0.62, 1.8, WHITE); // коробчастий корпус
      g.box(0, h * 0.45, 0.9, 1.42, h * 0.42, 0.25, WHITE); // похилий лоб (сходинка)
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
      g.box(0, 0.42, 0, 1.25, 0.28, 1.9, WHITE); // рама/борти
      g.box(0, 0.75, 0.35, 1.2, 0.5, 0.75, WHITE); // кабіна
      g.box(0, 0.58, 0.85, 1.2, 0.25, 0.25, WHITE); // капот
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
