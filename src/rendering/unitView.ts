import { itemDef } from '@/content';
import type { Stance, Unit, WeaponDefinition, WeaponState } from '@/game/types';
import { Mesh, TransformNode, type Scene, type StandardMaterial } from './babylon';
import { GeoBuilder, hex, shade, type RGB } from './geo';

const SKIN = ['#e8c39e', '#d4a373', '#a87449', '#7a4e2d'];
export const SIDE_COLOR: Record<string, string> = { blue: '#3d82e8', red: '#e5463b' };
const UNIFORM: Record<string, [string, string]> = { blue: ['#56683e', '#3f4c2e'], red: ['#7a6440', '#5c4a30'] };

/** Частина моделі: сітка з точкою обертання (pivot) у початку координат вузла. */
function part(scene: Scene, mat: StandardMaterial, parent: TransformNode, name: string, build: (g: GeoBuilder) => void): Mesh {
  const g = new GeoBuilder();
  build(g);
  const m = g.build(name, scene, mat);
  m.parent = parent;
  return m;
}

export interface UnitModel {
  root: TransformNode;
  body: TransformNode;
  legL: Mesh;
  legR: Mesh;
  armL: Mesh;
  armR: Mesh;
  torso: TransformNode;
  weapon: TransformNode;
  meshes: Mesh[];
  pool: Mesh;
}

/** Ретро-модель бійця з коробок: насичені кольори, кольорова пов'язка сторони. */
export function buildUnitModel(scene: Scene, mat: StandardMaterial, u: Unit): UnitModel {
  const root = new TransformNode(`unit_${u.id}`, scene);
  const body = new TransformNode('body', scene);
  body.parent = root;
  const [uni, uniDark] = UNIFORM[u.side].map(hex) as [RGB, RGB];
  const side = hex(SIDE_COLOR[u.side]);
  const skin = hex(SKIN[u.appearance.skin % SKIN.length]);
  const boots: RGB = [0.16, 0.13, 0.1];
  const gear: RGB = shade(uniDark, 0.85);
  const meshes: Mesh[] = [];
  const reg = (m: Mesh) => {
    m.metadata = { unitId: u.id };
    meshes.push(m);
    return m;
  };

  const hips = new TransformNode('hips', scene);
  hips.parent = body;
  hips.position.y = 0.52;
  const leg = (x: number) => {
    const n = new TransformNode('legPivot', scene);
    n.parent = hips;
    n.position.x = x;
    return reg(
      part(scene, mat, n, 'leg', (g) => {
        g.box(0, -0.2, 0, 0.15, 0.42, 0.17, uni);
        g.box(0, -0.47, 0.03, 0.16, 0.1, 0.22, boots);
        g.box(0, -0.2, 0.09, 0.12, 0.1, 0.03, shade(uni, 0.8)); // наколінник
      }),
    );
  };
  const legL = leg(-0.1);
  const legR = leg(0.1);

  const torso = new TransformNode('torso', scene);
  torso.parent = hips;
  reg(
    part(scene, mat, torso, 'torso', (g) => {
      g.box(0, 0.22, 0, 0.36, 0.44, 0.22, uni);
      if (u.inventory.armor) {
        g.box(0, 0.24, 0.01, 0.4, 0.36, 0.28, gear);
        for (const x of [-0.12, 0, 0.12]) g.box(x, 0.12, 0.15, 0.1, 0.12, 0.05, shade(gear, 1.15));
      }
      g.box(0, 0.0, 0, 0.38, 0.06, 0.24, [0.2, 0.17, 0.12]); // пояс
      if (u.inventory.backpack && u.classId !== 'scout') g.box(0, 0.26, -0.2, 0.3, 0.32, 0.14, shade(gear, 0.95));
      // Голова й каска.
      g.box(0, 0.54, 0.01, 0.19, 0.2, 0.19, skin);
      g.box(0, 0.66, 0.0, 0.25, 0.1, 0.26, shade(uni, 0.75));
      g.box(0, 0.6, 0.0, 0.26, 0.04, 0.27, side); // пов'язка на касці
      g.box(0.2, 0.36, 0, 0.03, 0.08, 0.13, side); // пов'язка на плечі
      g.box(-0.2, 0.36, 0, 0.03, 0.08, 0.13, side);
    }),
  );
  const arm = (x: number) => {
    const n = new TransformNode('armPivot', scene);
    n.parent = torso;
    n.position.set(x, 0.4, 0);
    return reg(
      part(scene, mat, n, 'arm', (g) => {
        g.box(0, -0.17, 0, 0.11, 0.36, 0.12, uni);
        g.box(0, -0.38, 0, 0.1, 0.08, 0.1, skin);
      }),
    );
  };
  const armL = arm(-0.24);
  const armR = arm(0.24);

  const weapon = new TransformNode('weapon', scene);
  weapon.parent = torso;
  const wd = u.inventory.primary ? itemDef<WeaponDefinition>(u.inventory.primary.defId) : null;
  reg(
    part(scene, mat, weapon, 'weapon', (g) => {
      const dark: RGB = [0.13, 0.13, 0.13];
      const wood: RGB = [0.42, 0.27, 0.15];
      if (wd?.category === 'lmg') {
        g.box(0, 0, 0.25, 0.1, 0.12, 0.75, dark);
        g.box(0, -0.1, 0.18, 0.14, 0.12, 0.16, [0.25, 0.28, 0.2]); // короб
        g.box(0, -0.06, 0.62, 0.02, 0.1, 0.02, dark); // сошки
      } else if (wd?.category === 'marksman') {
        g.box(0, 0, 0.3, 0.07, 0.08, 0.82, dark);
        g.box(0, 0.08, 0.2, 0.05, 0.05, 0.22, [0.1, 0.1, 0.12]); // приціл
        g.box(0, -0.02, -0.08, 0.08, 0.12, 0.2, wood);
      } else {
        g.box(0, 0, 0.22, 0.07, 0.09, 0.62, dark);
        g.box(0, -0.09, 0.27, 0.05, 0.13, 0.06, dark); // магазин
        g.box(0, -0.02, -0.06, 0.07, 0.11, 0.18, wood);
      }
    }),
  );

  const pool = new GeoBuilder().box(0, 0.015, 0, 0.7, 0.01, 0.55, [0.42, 0.04, 0.04]).build('pool', scene, mat);
  pool.parent = root;
  pool.setEnabled(false);
  pool.isPickable = false;

  return { root, body, legL, legR, armL, armR, torso, weapon, meshes, pool };
}

/** Поза за станом: позиція тіла, стан зброї, поранений/загиблий. */
export function applyPose(m: UnitModel, stance: Stance, ws: WeaponState, status: Unit['status']): void {
  const hips = m.legL.parent!.parent as TransformNode;
  const legL = m.legL.parent as TransformNode;
  const legR = m.legR.parent as TransformNode;
  const armL = m.armL.parent as TransformNode;
  const armR = m.armR.parent as TransformNode;
  m.body.rotation.set(0, 0, 0);
  m.body.position.set(0, 0, 0);
  hips.position.y = 0.52;
  legL.rotation.set(0, 0, 0);
  legR.rotation.set(0, 0, 0);
  m.torso.rotation.set(0, 0, 0);
  m.pool.setEnabled(false);

  if (status === 'down' || status === 'dead') {
    m.body.rotation.x = -Math.PI / 2;
    m.body.position.set(0, 0.12, 0.35);
    armL.rotation.set(0, 0, 0.5);
    armR.rotation.set(0, 0, -0.5);
    m.weapon.setEnabled(false);
    m.pool.setEnabled(status === 'dead');
    return;
  }
  m.weapon.setEnabled(true);
  if (stance === 'crouched') {
    hips.position.y = 0.3;
    legL.rotation.x = -1.35;
    legR.rotation.x = 0.35;
    m.torso.rotation.x = 0.12;
  } else if (stance === 'prone') {
    m.body.rotation.x = Math.PI / 2;
    m.body.position.set(0, 0.13, -0.3);
  }
  // Стан зброї: high ready — біля плеча, low ready — стволом донизу, вільне — на ремені.
  if (ws === 'high') {
    armL.rotation.set(-1.45, 0, 0.25);
    armR.rotation.set(-1.25, 0, -0.1);
    m.weapon.position.set(0.05, 0.38, 0.12);
    m.weapon.rotation.set(0, 0, 0);
  } else if (ws === 'low') {
    armL.rotation.set(-0.9, 0, 0.3);
    armR.rotation.set(-0.6, 0, -0.1);
    m.weapon.position.set(0.05, 0.22, 0.18);
    m.weapon.rotation.set(0.6, 0, 0);
  } else {
    armL.rotation.set(0, 0, 0.05);
    armR.rotation.set(-0.2, 0, -0.05);
    m.weapon.position.set(0.12, 0.3, -0.16);
    m.weapon.rotation.set(-1.3, 0, 0.4);
  }
}
