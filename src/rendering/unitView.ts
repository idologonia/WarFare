import { itemDef } from '@/content';
import type { Stance, Unit, WeaponDefinition, WeaponState } from '@/game/types';
import { Color4, Mesh, TransformNode, type Scene, type StandardMaterial } from './babylon';
import { GeoBuilder, hex, shade, type RGB } from './geo';
import { buildWeaponGeo } from './weaponGeo';

const SKIN = ['#e8c39e', '#d4a373', '#a87449', '#7a4e2d'];
const HAIR = ['#2b2118', '#4a3524', '#7a5a35', '#1a1a1a', '#8a7a6a'];
export const SIDE_COLOR: Record<string, string> = { blue: '#3d82e8', red: '#e5463b' };
/** Колір спорядження (плитоноска, підсумки, рюкзак) за стороною. */
const GEAR: Record<string, string> = { blue: '#7d6847', red: '#4f5438' };
const CAMO_SCALE = 1.15;

/** Частина моделі: сітка з точкою обертання у початку координат вузла. */
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
  hit: Mesh;
}

const WHITE: RGB = [1, 1, 1];

/**
 * Модель бійця з блоків у ретро-стилі: камуфляжна форма (текстура сторони),
 * однотонне спорядження, кольорові пов'язки сторони, контур граней.
 */
export function buildUnitModel(scene: Scene, mat: StandardMaterial, u: Unit): UnitModel {
  const root = new TransformNode(`unit_${u.id}`, scene);
  const body = new TransformNode('body', scene);
  body.parent = root;
  const side = hex(SIDE_COLOR[u.side]);
  const gear = hex(GEAR[u.side]);
  const gearDark = shade(gear, 0.78);
  const skin = hex(SKIN[u.appearance.skin % SKIN.length]);
  const hair = hex(HAIR[u.appearance.hair % HAIR.length]);
  const boots: RGB = [0.17, 0.14, 0.11];
  const black: RGB = [0.09, 0.09, 0.1];
  const gloves: RGB = [0.2, 0.19, 0.16];
  const meshes: Mesh[] = [];
  const reg = (m: Mesh) => {
    m.metadata = { unitId: u.id };
    meshes.push(m);
    return m;
  };
  const camo = (g: GeoBuilder, on: boolean) => {
    g.camo = on ? CAMO_SCALE : null;
  };

  const hips = new TransformNode('hips', scene);
  hips.parent = body;
  hips.position.y = 0.5;

  // ---- Ноги ----
  const leg = (x: number) => {
    const n = new TransformNode('legPivot', scene);
    n.parent = hips;
    n.position.x = x;
    return reg(
      part(scene, mat, n, 'leg', (g) => {
        camo(g, true);
        g.box(0, -0.12, 0, 0.16, 0.24, 0.18, WHITE); // стегно
        g.box(0, -0.33, 0, 0.145, 0.2, 0.16, WHITE); // гомілка
        camo(g, false);
        g.box(0, -0.25, 0.085, 0.12, 0.09, 0.04, black); // наколінник
        if (u.inventory.extraArmor?.some((a) => a.defId === 'leg_guards')) g.box(0, -0.13, 0.09, 0.15, 0.17, 0.04, gear);
        g.box(0, -0.45, 0.025, 0.16, 0.09, 0.24, boots); // черевик
        g.box(0, -0.495, 0.025, 0.17, 0.02, 0.25, shade(boots, 0.6)); // підошва
        if (x < 0) g.box(-0.085, -0.1, 0.02, 0.03, 0.1, 0.1, gearDark); // кишеня
      }),
    );
  };
  const legL = leg(-0.095);
  const legR = leg(0.095);

  // ---- Тулуб, голова, шолом ----
  const torso = new TransformNode('torso', scene);
  torso.parent = hips;
  const armorId = u.inventory.armor?.defId ?? null;
  reg(
    part(scene, mat, torso, 'torso', (g) => {
      camo(g, true);
      g.box(0, 0.22, 0, 0.34, 0.42, 0.2, WHITE); // куртка
      camo(g, false);
      if (u.inventory.rig) {
        // Пояс рейнджера з підсумками.
        g.box(0, 0.02, 0, 0.38, 0.08, 0.24, gearDark);
        for (const x of [-0.14, 0.14]) g.box(x, 0.02, 0.12, 0.07, 0.09, 0.05, gear);
        g.box(0.19, 0.0, -0.04, 0.04, 0.1, 0.1, gear); // аптечка
        g.box(0, 0.02, 0.125, 0.06, 0.05, 0.02, [0.55, 0.5, 0.4]); // пряжка
      } else g.box(0, 0.02, 0, 0.36, 0.04, 0.22, [0.2, 0.17, 0.12]); // звичайний ремінь
      if (armorId === 'plate_carrier') {
        // Плитоноска: передня й задня плити, камербанд, три магазинні підсумки, адмін-панель.
        g.box(0, 0.28, 0.065, 0.31, 0.3, 0.1, gear);
        g.box(0, 0.28, -0.065, 0.31, 0.3, 0.1, gear);
        g.box(-0.18, 0.2, 0, 0.04, 0.16, 0.2, gearDark);
        g.box(0.18, 0.2, 0, 0.04, 0.16, 0.2, gearDark);
        g.box(-0.12, 0.44, 0, 0.07, 0.04, 0.24, gearDark);
        g.box(0.12, 0.44, 0, 0.07, 0.04, 0.24, gearDark);
        for (const x of [-0.1, 0, 0.1]) {
          g.box(x, 0.19, 0.13, 0.085, 0.13, 0.05, shade(gear, 1.08));
          g.box(x, 0.255, 0.133, 0.085, 0.02, 0.05, gearDark);
        }
        g.box(0, 0.34, 0.12, 0.16, 0.07, 0.03, gearDark);
        g.box(0, 0.345, 0.137, 0.1, 0.035, 0.005, side);
        g.box(0, 0.38, -0.12, 0.12, 0.06, 0.02, gearDark); // ручка евакуації
      } else if (armorId) {
        // РПС з балістичним захистом: нагрудник із двома рядами підсумків, X-лямки на спині.
        g.box(0, 0.22, 0.08, 0.32, 0.22, 0.07, gear);
        for (const x of [-0.11, -0.037, 0.037, 0.11]) {
          g.box(x, 0.15, 0.125, 0.065, 0.09, 0.04, shade(gear, 1.1));
          g.box(x, 0.25, 0.125, 0.065, 0.08, 0.04, shade(gear, 0.95));
        }
        g.box(-0.1, 0.38, 0.06, 0.05, 0.14, 0.03, gearDark);
        g.box(0.1, 0.38, 0.06, 0.05, 0.14, 0.03, gearDark);
        g.box(0, 0.28, -0.105, 0.05, 0.3, 0.02, gearDark, 1, 0.6);
        g.box(0, 0.28, -0.105, 0.05, 0.3, 0.02, gearDark, 1, -0.6);
        g.box(-0.18, 0.15, 0, 0.04, 0.12, 0.14, gearDark); // бічний підсумок
        g.box(0, 0.335, 0.118, 0.08, 0.03, 0.005, side);
      } else {
        g.box(0.13, 0.36, 0.105, 0.08, 0.05, 0.01, side); // нашивка сторони на куртці
      }
      if (u.inventory.secondary && itemDef<WeaponDefinition>(u.inventory.secondary.defId).category === 'launcher') {
        // Труба гранатомета за спиною.
        g.box(0.12, 0.3, -0.27, 0.09, 0.09, 0.09, [0.3, 0.33, 0.22]);
        const tube: RGB = [0.27, 0.3, 0.2];
        for (let i = 0; i < 6; i++) g.box(0.12 - 0.04 * i * 0.6, 0.12 + i * 0.1, -0.26, 0.08, 0.1, 0.08, tube);
        g.box(0.12 - 0.15, 0.72, -0.26, 0.12, 0.12, 0.12, [0.3, 0.35, 0.25]); // постріл
      }
      const extra = new Set((u.inventory.extraArmor ?? []).map((a) => a.defId));
      if (extra.has('neck_guard')) g.box(0, 0.45, 0.02, 0.24, 0.07, 0.24, gearDark);
      if (extra.has('groin_guard')) g.box(0, -0.06, 0.12, 0.14, 0.12, 0.04, gear);
      if (extra.has('side_plates')) {
        g.box(-0.19, 0.22, 0, 0.04, 0.2, 0.16, gear);
        g.box(0.19, 0.22, 0, 0.04, 0.2, 0.16, gear);
      }
      if (u.inventory.backpack) {
        g.box(0, 0.27, -0.19, 0.26, 0.3, 0.13, shade(gear, 0.92));
        g.box(0, 0.4, -0.2, 0.22, 0.05, 0.14, gearDark);
        g.box(0, 0.18, -0.26, 0.18, 0.12, 0.03, gearDark); // кишеня рюкзака
      }
      // Шия й голова.
      g.box(0, 0.45, 0.0, 0.1, 0.05, 0.1, skin);
      g.box(0, 0.56, 0.01, 0.2, 0.2, 0.19, skin);
      g.box(-0.045, 0.575, 0.102, 0.03, 0.016, 0.006, [0.16, 0.13, 0.1]); // очі
      g.box(0.045, 0.575, 0.102, 0.03, 0.016, 0.006, [0.16, 0.13, 0.1]);
      g.box(0, 0.6, 0.104, 0.13, 0.014, 0.008, shade(hair, 1)); // брови
      if (u.appearance.face % 3 === 0) g.box(0, 0.495, 0.07, 0.19, 0.07, 0.07, hair); // борода
      else if (u.appearance.face % 3 === 1) g.box(0, 0.523, 0.103, 0.09, 0.02, 0.01, hair); // вуса
      g.box(0, 0.53, -0.09, 0.18, 0.1, 0.03, hair); // потилиця
      if (u.inventory.helmet) {
        // Шолом (high-cut) у чохлі з камуфляжем.
        camo(g, true);
        g.box(0, 0.69, -0.005, 0.25, 0.09, 0.25, WHITE);
        g.box(0, 0.745, -0.005, 0.2, 0.04, 0.2, WHITE);
        camo(g, false);
        g.box(-0.13, 0.66, 0.0, 0.02, 0.04, 0.17, black); // рейки
        g.box(0.13, 0.66, 0.0, 0.02, 0.04, 0.17, black);
        g.box(-0.12, 0.575, 0.0, 0.05, 0.08, 0.08, black); // навушники
        g.box(0.12, 0.575, 0.0, 0.05, 0.08, 0.08, black);
        g.box(0, 0.7, 0.128, 0.06, 0.04, 0.02, black); // кріплення ПНБ
        g.box(0, 0.69, -0.13, 0.12, 0.04, 0.012, side); // мітка сторони на шоломі
        const mounts = (u.inventory.helmetMounts ?? []).map((m) => m.defId);
        if (mounts.includes('nvg_mono')) g.box(0.045, 0.66, 0.16, 0.05, 0.05, 0.08, [0.1, 0.12, 0.1]);
        if (mounts.includes('nvg_bino')) {
          g.box(-0.04, 0.66, 0.16, 0.05, 0.05, 0.08, [0.1, 0.12, 0.1]);
          g.box(0.04, 0.66, 0.16, 0.05, 0.05, 0.08, [0.1, 0.12, 0.1]);
        }
        if (mounts.includes('flashlight')) {
          g.box(0.15, 0.68, 0.05, 0.04, 0.04, 0.09, black);
          g.box(0.15, 0.68, 0.096, 0.03, 0.03, 0.004, [1, 0.95, 0.7]);
        }
      } else {
        g.box(0, 0.665, -0.005, 0.21, 0.05, 0.2, hair); // зачіска
      }
    }),
  );

  // ---- Руки ----
  const arm = (x: number) => {
    const n = new TransformNode('armPivot', scene);
    n.parent = torso;
    n.position.set(x, 0.4, 0);
    return reg(
      part(scene, mat, n, 'arm', (g) => {
        camo(g, true);
        g.box(0, -0.09, 0, 0.115, 0.2, 0.125, WHITE);
        g.box(0, -0.27, 0, 0.105, 0.18, 0.115, WHITE);
        camo(g, false);
        g.box(0, -0.06, 0, 0.122, 0.06, 0.132, side); // пов'язка сторони
        if (u.classId === 'medic') {
          // Нашивка медика: білий квадрат із червоним хрестом.
          g.box(x > 0 ? 0.061 : -0.061, -0.13, 0, 0.004, 0.07, 0.07, [0.92, 0.92, 0.9]);
          g.box(x > 0 ? 0.064 : -0.064, -0.13, 0, 0.004, 0.05, 0.016, [0.8, 0.1, 0.1]);
          g.box(x > 0 ? 0.064 : -0.064, -0.13, 0, 0.004, 0.016, 0.05, [0.8, 0.1, 0.1]);
        }
        if (u.inventory.extraArmor?.some((a) => a.defId === 'shoulder_guards')) g.box(0, -0.02, 0, 0.14, 0.12, 0.15, gear);
        g.box(0, -0.39, 0.0, 0.1, 0.08, 0.1, gloves); // рукавиця
      }),
    );
  };
  const armL = arm(-0.235);
  const armR = arm(0.235);

  // ---- Зброя ----
  const weapon = new TransformNode('weapon', scene);
  weapon.parent = torso;
  reg(
    part(scene, mat, weapon, 'weapon', (g) => {
      if (u.inventory.primary) buildWeaponGeo(g, u.inventory.primary.defId, u.inventory.primary.mods, u.inventory.primary.magazine?.defId ?? null);
    }),
  );

  const pool = new GeoBuilder().box(0, 0.015, 0, 0.7, 0.01, 0.55, [0.42, 0.04, 0.04]).build('pool', scene, mat);
  pool.parent = root;
  pool.setEnabled(false);
  pool.isPickable = false;

  // Невидима зона для вибору кліком (більша за модель).
  const hit = new GeoBuilder().box(0, 0.55, 0, 0.8, 1.1, 0.8, WHITE).build('hit', scene, mat);
  hit.parent = root;
  hit.visibility = 0;
  hit.metadata = { unitId: u.id, hitbox: true };

  for (const m of meshes) {
    m.enableEdgesRendering(0.95);
    m.edgesWidth = 1.6;
    m.edgesColor = new Color4(0.04, 0.04, 0.05, 0.75);
  }

  return { root, body, legL, legR, armL, armR, torso, weapon, meshes, pool, hit };
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
  hips.position.y = 0.5;
  legL.rotation.set(0, 0, 0);
  legR.rotation.set(0, 0, 0);
  m.torso.rotation.set(0, 0, 0);
  m.pool.setEnabled(false);
  m.hit.scaling.set(1, 1, 1);
  m.hit.position.set(0, 0, 0);

  if (status === 'down' || status === 'dead') {
    m.body.rotation.x = -Math.PI / 2;
    m.body.position.set(0, 0.12, 0.35);
    armL.rotation.set(0, 0, 0.5);
    armR.rotation.set(0, 0, -0.5);
    m.weapon.setEnabled(false);
    m.pool.setEnabled(status === 'dead');
    m.hit.scaling.set(1, 0.35, 1.2);
    return;
  }
  m.weapon.setEnabled(true);
  if (stance === 'crouched') {
    hips.position.y = 0.3;
    legL.rotation.x = -1.35;
    legR.rotation.x = 0.35;
    m.torso.rotation.x = 0.12;
    m.hit.scaling.set(1, 0.75, 1);
  } else if (stance === 'prone') {
    m.body.rotation.x = Math.PI / 2;
    m.body.position.set(0, 0.13, -0.3);
    m.hit.scaling.set(1, 0.35, 1.3);
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
