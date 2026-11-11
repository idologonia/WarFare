import type { DroneState } from '@/game/types';
import { Mesh, TransformNode, type Scene, type StandardMaterial } from './babylon';
import { GeoBuilder, type RGB } from './geo';

export interface DroneModel {
  root: TransformNode;
  body: Mesh;
  rotors: Mesh[];
  hit: Mesh;
}

const DARK: RGB = [0.12, 0.12, 0.13];
const GREY: RGB = [0.45, 0.46, 0.47];
const CARBON: RGB = [0.16, 0.16, 0.17];
const PROP: RGB = [0.08, 0.08, 0.08];

/** Модель дрона (масштаб збільшено, щоб було видно в ізометрії). */
export function buildDroneModel(scene: Scene, mat: StandardMaterial, d: DroneState, sideColor: RGB): DroneModel {
  const root = new TransformNode(`drone_${d.id}`, scene);
  const g = new GeoBuilder();
  const arms: [number, number][] = [[0.22, 0.22], [-0.22, 0.22], [0.22, -0.22], [-0.22, -0.22]];
  if (d.defId === 'mavic3t') {
    g.prism(0, 0, 0, 0.16, 0.08, 0.26, 8, GREY);
    g.prism(0, -0.02, 0.15, 0.06, 0.06, 0.05, 8, DARK); // камера
    g.prism(0, -0.02, 0.18, 0.04, 0.04, 0.004, 8, [0.3, 0.55, 0.75]);
    for (const [x, z] of arms) g.prism(x / 2, 0, z / 2, 0.035, 0.03, 0.32, 6, GREY, 0, Math.atan2(x, z));
    g.box(0, -0.06, 0, 0.1, 0.04, 0.06, DARK); // скидач
    g.box(0, 0.045, -0.06, 0.06, 0.01, 0.03, sideColor);
  } else if (d.defId === 'avata') {
    g.prism(0, 0, 0, 0.18, 0.08, 0.22, 8, DARK);
    for (const [x, z] of arms) g.prism(x * 0.8, 0, z * 0.8, 0.17, 0.17, 0.04, 12, DARK, Math.PI / 2);
    g.prism(0, -0.01, 0.12, 0.05, 0.05, 0.04, 8, GREY);
    g.box(0, 0.045, -0.05, 0.06, 0.01, 0.03, sideColor);
  } else {
    // FPV: X-рама з карбону, бойова частина знизу.
    g.box(0, 0, 0, 0.12, 0.04, 0.14, CARBON);
    for (const [x, z] of arms) g.box(x / 2, 0, z / 2, 0.035, 0.02, 0.34, CARBON, 1, Math.atan2(x, z));
    const big = d.defId === 'fpv10';
    g.prism(0, -0.06, 0.04, big ? 0.09 : 0.07, big ? 0.09 : 0.07, big ? 0.24 : 0.17, 10, [0.32, 0.36, 0.24]);
    g.prism(0, -0.06, big ? 0.17 : 0.13, big ? 0.06 : 0.05, big ? 0.06 : 0.05, 0.04, 10, [0.2, 0.22, 0.16]);
    g.box(0, 0.035, -0.04, 0.05, 0.03, 0.05, [0.2, 0.25, 0.3]); // камера
    g.box(0, 0.03, 0.04, 0.05, 0.01, 0.03, sideColor);
  }
  const body = g.build('drone', scene, mat);
  body.parent = root;
  body.metadata = { droneId: d.id };
  const rotors: Mesh[] = [];
  for (const [x, z] of arms) {
    const r = new GeoBuilder().box(0, 0, 0, 0.26, 0.006, 0.03, PROP).box(0, 0, 0, 0.03, 0.006, 0.26, PROP).build('rotor', scene, mat);
    r.parent = root;
    r.position.set(d.defId === 'avata' ? x * 0.8 : x, 0.03, d.defId === 'avata' ? z * 0.8 : z);
    rotors.push(r);
  }
  root.scaling.setAll(1.6);
  const hit = new GeoBuilder().box(0, 0, 0, 0.8, 0.4, 0.8, [1, 1, 1]).build('dhit', scene, mat);
  hit.parent = root;
  hit.visibility = 0;
  hit.metadata = { droneId: d.id, hitbox: true, drone: true };
  return { root, body, rotors, hit };
}
