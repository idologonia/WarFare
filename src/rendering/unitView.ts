import { itemDef } from '@/content';
import type { Stance, Unit, WeaponDefinition, WeaponState } from '@/game/types';
import { Color4, Mesh, TransformNode, type Scene, type StandardMaterial } from './babylon';
import { GeoBuilder, hex, shade, type RGB } from './geo';
import { buildWeaponGeo } from './weaponGeo';
import type { UnitLook } from './uniform';
import { uniformTile } from './camo';

const SKIN = ['#e8c39e', '#d4a373', '#a87449', '#7a4e2d'];
const HAIR = ['#2b2118', '#4a3524', '#7a5a35', '#1a1a1a', '#8a7a6a'];
export const SIDE_COLOR: Record<string, string> = { blue: '#3d82e8', red: '#e5463b' };
/** Колір спорядження (плитоноска, підсумки, рюкзак) за стороною. */
const GEAR: Record<string, string> = { blue: '#7d6847', red: '#4f5438' };
const CAMO_SCALE = 1.15;

/** Вигляд за замовчуванням (без фракції): за стороною. */
function defaultLook(u: Unit): UnitLook & { civilian?: boolean } {
  const t = uniformTile(u.side === 'red' ? 'emr' : 'multicam');
  return { jacket: t, pants: t, helmetCover: t, helmet: u.side === 'red' ? '6b47' : 'highcut', headgear: 'none', gear: GEAR[u.side] };
}

/** Частина моделі: сітка з точкою обертання у початку координат вузла. */
function part(scene: Scene, mat: StandardMaterial, parent: TransformNode, name: string, build: (g: GeoBuilder) => void): Mesh {
  const g = new GeoBuilder();
  g.smooth = true;
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
 * Модель бійця: реалістичні пропорції (ноги ≈ половина зросту, вужчі плечі, менша голова),
 * округлі кінцівки з багатогранних призм. Форма — з атласу (куртка й штани можуть різнитися),
 * однотонне спорядження, кольорові пов'язки сторони.
 */
export function buildUnitModel(scene: Scene, mat: StandardMaterial, u: Unit, look?: UnitLook): UnitModel {
  const L = look ?? defaultLook(u);
  const root = new TransformNode(`unit_${u.id}`, scene);
  const body = new TransformNode('body', scene);
  body.parent = root;
  // Індивідуальна статура: зріст і ширина трохи різняться в кожного бійця.
  let hs = 2166136261;
  for (const ch of u.id + u.name) hs = Math.imul(hs ^ ch.charCodeAt(0), 16777619);
  const r1 = ((hs >>> 0) % 1000) / 1000;
  const r2 = ((hs >>> 10) % 1000) / 1000;
  body.scaling.set(0.95 + r2 * 0.1, 0.94 + r1 * 0.12, 0.95 + r2 * 0.1);
  const side = hex(SIDE_COLOR[u.side]);
  const gear = hex(L.gear);
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
  /** Увімкнути візерунок тайла атласу (або вимкнути — однотонні деталі). */
  const camo = (g: GeoBuilder, tile: number | false) => {
    g.camo = tile === false ? null : CAMO_SCALE;
    g.tile = tile === false ? null : tile;
  };
  const V = Math.PI / 2; // призма вертикально

  const hips = new TransformNode('hips', scene);
  hips.parent = body;
  hips.position.y = 0.5;

  // ---- Ноги: стегно, коліно, гомілка, черевик ----
  const leg = (x: number) => {
    const n = new TransformNode('legPivot', scene);
    n.parent = hips;
    n.position.x = x;
    return reg(
      part(scene, mat, n, 'leg', (g) => {
        camo(g, L.pants);
        g.prism(0, -0.125, 0.004, 0.155, 0.165, 0.25, 12, WHITE, V); // стегно
        g.prism(0, -0.355, 0, 0.125, 0.135, 0.21, 12, WHITE, V); // гомілка
        camo(g, false);
        g.prism(0, -0.255, 0.07, 0.1, 0.06, 0.08, 6, black, V); // наколінник
        if (u.inventory.extraArmor?.some((a) => a.defId === 'leg_guards')) g.box(0, -0.13, 0.085, 0.14, 0.16, 0.035, gear);
        g.prism(0, -0.445, 0.03, 0.13, 0.1, 0.23, 8, boots); // черевик
        g.box(0, -0.492, 0.03, 0.135, 0.018, 0.235, shade(boots, 0.55)); // підошва
        if (x < 0 && !L.civilian) g.box(-0.08, -0.11, 0.015, 0.03, 0.1, 0.09, gearDark); // кишеня
      }),
    );
  };
  const legL = leg(-0.085);
  const legR = leg(0.085);

  // ---- Тулуб, голова, шолом ----
  const torso = new TransformNode('torso', scene);
  torso.parent = hips;
  const armorId = u.inventory.armor?.defId ?? null;
  reg(
    part(scene, mat, torso, 'torso', (g) => {
      camo(g, L.pants);
      g.prism(0, 0.055, 0, 0.3, 0.19, 0.12, 12, WHITE, V); // таз
      camo(g, L.jacket);
      g.prism(0, 0.17, 0, 0.305, 0.195, 0.13, 12, WHITE, V); // живіт
      g.prism(0, 0.32, 0.005, 0.345, 0.215, 0.2, 12, WHITE, V); // груди
      g.prism(0, 0.415, 0, 0.13, 0.13, 0.4, 8, WHITE, 0, V); // плечі
      camo(g, false);
      if (u.inventory.rig) {
        // Пояс рейнджера з підсумками.
        g.prism(0, 0.03, 0, 0.33, 0.22, 0.07, 8, gearDark, V);
        for (const x of [-0.12, 0.12]) g.box(x, 0.03, 0.115, 0.07, 0.085, 0.045, gear);
        g.box(0.17, 0.02, -0.04, 0.045, 0.1, 0.1, gear); // аптечка
        g.box(0, 0.03, 0.118, 0.06, 0.045, 0.02, [0.55, 0.5, 0.4]); // пряжка
      } else g.prism(0, 0.03, 0, 0.31, 0.2, 0.035, 8, [0.2, 0.17, 0.12], V); // звичайний ремінь
      if (armorId === 'plate_carrier') {
        // Плитоноска: передня й задня плити, камербанд, підсумки, адмін-панель.
        g.box(0, 0.29, 0.085, 0.29, 0.28, 0.06, gear);
        g.box(0, 0.29, -0.085, 0.29, 0.28, 0.06, gear);
        g.prism(0, 0.22, 0, 0.36, 0.23, 0.14, 8, gearDark, V); // камербанд
        for (const x of [-0.105, 0.105]) g.box(x, 0.445, 0, 0.065, 0.035, 0.22, gearDark); // лямки
        for (const x of [-0.095, 0, 0.095]) {
          g.box(x, 0.2, 0.135, 0.08, 0.12, 0.045, shade(gear, 1.08));
          g.box(x, 0.262, 0.137, 0.08, 0.018, 0.048, gearDark);
        }
        g.box(0, 0.35, 0.122, 0.15, 0.065, 0.025, gearDark);
        g.box(0, 0.354, 0.136, 0.09, 0.032, 0.005, side);
        g.box(0, 0.4, -0.12, 0.11, 0.05, 0.02, gearDark); // ручка евакуації
      } else if (armorId) {
        // РПС із балістичним захистом: нагрудник, два ряди підсумків, X-лямки на спині.
        g.box(0, 0.23, 0.09, 0.3, 0.2, 0.05, gear);
        for (const x of [-0.105, -0.035, 0.035, 0.105]) {
          g.box(x, 0.16, 0.125, 0.062, 0.085, 0.035, shade(gear, 1.1));
          g.box(x, 0.255, 0.125, 0.062, 0.075, 0.035, shade(gear, 0.95));
        }
        g.box(-0.095, 0.39, 0.07, 0.045, 0.13, 0.025, gearDark);
        g.box(0.095, 0.39, 0.07, 0.045, 0.13, 0.025, gearDark);
        g.box(0, 0.29, -0.11, 0.045, 0.3, 0.018, gearDark, 1, 0.6);
        g.box(0, 0.29, -0.11, 0.045, 0.3, 0.018, gearDark, 1, -0.6);
        g.box(-0.165, 0.15, 0, 0.04, 0.11, 0.13, gearDark); // бічний підсумок
        g.box(0, 0.34, 0.115, 0.08, 0.028, 0.005, side);
      } else {
        g.box(0.11, 0.37, 0.108, 0.07, 0.045, 0.01, side); // нашивка сторони на куртці
      }
      if (u.inventory.secondary && itemDef<WeaponDefinition>(u.inventory.secondary.defId).category === 'launcher') {
        // Труба гранатомета за спиною.
        const tube: RGB = [0.27, 0.3, 0.2];
        g.prism(0.05, 0.38, -0.2, 0.08, 0.08, 0.62, 10, tube, V - 0.35);
        g.prism(0.12, 0.66, -0.26, 0.11, 0.11, 0.12, 8, [0.3, 0.35, 0.25], V - 0.35); // постріл
      }
      const extra = new Set((u.inventory.extraArmor ?? []).map((a) => a.defId));
      if (extra.has('neck_guard')) g.prism(0, 0.465, 0.01, 0.2, 0.2, 0.06, 10, gearDark, V);
      if (extra.has('groin_guard')) g.box(0, -0.05, 0.11, 0.13, 0.11, 0.035, gear);
      if (extra.has('side_plates')) {
        g.box(-0.18, 0.23, 0, 0.035, 0.18, 0.15, gear);
        g.box(0.18, 0.23, 0, 0.035, 0.18, 0.15, gear);
      }
      if (u.inventory.backpack) {
        g.prism(0, 0.27, -0.185, 0.25, 0.13, 0.3, 8, shade(gear, 0.92), V);
        g.box(0, 0.41, -0.19, 0.2, 0.045, 0.13, gearDark);
        g.box(0, 0.19, -0.255, 0.17, 0.11, 0.03, gearDark); // кишеня рюкзака
      }
      // Відмінності класів — щоб бійця можна було впізнати на полі.
      switch (u.classId) {
        case 'medic':
          g.box(0.19, 0.08, -0.02, 0.07, 0.13, 0.15, [0.35, 0.33, 0.22]);
          g.box(0.227, 0.08, -0.02, 0.004, 0.045, 0.045, [0.8, 0.1, 0.1]);
          break;
        case 'mg1':
        case 'mg2':
          g.box(0.185, 0.1, 0.02, 0.065, 0.11, 0.15, [0.28, 0.3, 0.22]);
          for (let i = 0; i < 7; i++) g.box(-0.11 + i * 0.037, 0.43 - i * 0.043, 0.13, 0.028, 0.028, 0.02, [0.75, 0.6, 0.25]);
          break;
        case 'droneOperator':
          g.box(0.08, 0.55, -0.22, 0.012, 0.35, 0.012, [0.12, 0.12, 0.12]);
          g.box(-0.08, 0.5, -0.22, 0.012, 0.25, 0.012, [0.12, 0.12, 0.12]);
          g.box(0, 0.16, 0.16, 0.15, 0.075, 0.045, [0.15, 0.15, 0.16]);
          g.box(0, 0.19, 0.185, 0.11, 0.045, 0.005, [0.25, 0.45, 0.6]);
          break;
        case 'scout':
          g.prism(0, 0.2, 0.15, 0.11, 0.05, 0.05, 8, [0.13, 0.13, 0.12], 0, V);
          g.box(-0.16, 0.33, -0.12, 0.055, 0.09, 0.045, [0.15, 0.16, 0.14]);
          g.box(-0.16, 0.48, -0.12, 0.01, 0.22, 0.01, [0.1, 0.1, 0.1]);
          break;
        case 'marksman':
          for (let i = 0; i < 5; i++) g.prism(-0.15 + i * 0.075, 0.44, -0.02 + (i % 2) * 0.03, 0.05, 0.05, 0.07, 6, shade(gear, 0.8 + (i % 3) * 0.1), V);
          break;
      }
      // ---- Шия й голова ----
      g.prism(0, 0.495, 0.005, 0.085, 0.09, 0.07, 12, skin, V); // шия
      g.prism(0, 0.605, 0.01, 0.15, 0.17, 0.165, 12, skin, V); // голова
      g.box(0, 0.53, 0.035, 0.11, 0.035, 0.1, skin); // щелепа
      g.box(0, 0.6, 0.095, 0.025, 0.04, 0.02, shade(skin, 0.92)); // ніс
      g.box(-0.035, 0.622, 0.085, 0.025, 0.012, 0.006, [0.16, 0.13, 0.1]); // очі
      g.box(0.035, 0.622, 0.085, 0.025, 0.012, 0.006, [0.16, 0.13, 0.1]);
      g.box(0, 0.642, 0.087, 0.1, 0.01, 0.006, hair); // брови
      for (const x of [-0.077, 0.077]) g.box(x, 0.605, 0.0, 0.012, 0.04, 0.03, shade(skin, 0.9)); // вуха
      if (u.appearance.face % 3 === 0) g.prism(0, 0.545, 0.035, 0.13, 0.11, 0.06, 12, hair, V); // борода
      else if (u.appearance.face % 3 === 1) g.box(0, 0.572, 0.088, 0.065, 0.015, 0.01, hair); // вуса
      g.prism(0, 0.6, -0.04, 0.15, 0.1, 0.12, 12, hair, V); // потилиця
      const mounts = (u.inventory.helmetMounts ?? []).map((m) => m.defId);
      if (u.inventory.helmet) {
        camo(g, L.helmetCover);
        if (L.helmet === 'ssh68') {
          // Радянська каска СШ-68: висока куля з невеликими полями.
          g.prism(0, 0.675, 0.0, 0.2, 0.215, 0.09, 12, WHITE, V);
          g.prism(0, 0.735, 0.0, 0.165, 0.18, 0.04, 12, WHITE, V);
          g.prism(0, 0.632, 0.0, 0.225, 0.24, 0.016, 12, WHITE, V); // поля
        } else {
          g.prism(0, 0.682, -0.005, 0.195, 0.21, 0.085, 12, WHITE, V);
          g.prism(0, 0.735, -0.005, 0.15, 0.165, 0.035, 12, WHITE, V);
          if (L.helmet === '6b47') g.prism(0, 0.636, -0.01, 0.205, 0.22, 0.03, 12, WHITE, V); // довші боки «Ратника»
        }
        camo(g, false);
        if (L.helmet !== 'ssh68') {
          g.box(-0.103, 0.67, 0.0, 0.016, 0.03, 0.15, black); // рейки
          g.box(0.103, 0.67, 0.0, 0.016, 0.03, 0.15, black);
          g.box(-0.1, 0.6, 0.0, 0.04, 0.07, 0.07, black); // навушники
          g.box(0.1, 0.6, 0.0, 0.04, 0.07, 0.07, black);
          g.box(0, 0.705, 0.1, 0.05, 0.035, 0.02, black); // кріплення ПНБ
          g.box(0, 0.7, -0.1, 0.1, 0.035, 0.012, side); // мітка сторони
        }
        g.box(-0.08, 0.55, 0.04, 0.01, 0.11, 0.01, black, 1, 0, 0.3); // підборідний ремінь
        g.box(0.08, 0.55, 0.04, 0.01, 0.11, 0.01, black, 1, 0, 0.3);
        // ПНБ: опущений — перед очима, відкинутий — догори на кріпленні.
        const ny = u.nvgUp ? 0.745 : 0.64;
        const nz = u.nvgUp ? 0.095 : 0.135;
        const nh = u.nvgUp ? 0.07 : 0.045;
        const nd = u.nvgUp ? 0.045 : 0.07;
        if (mounts.includes('nvg_mono')) g.prism(0.035, ny, nz, 0.045, nh, nd, 8, [0.1, 0.12, 0.1]);
        if (mounts.includes('nvg_bino')) for (const x of [-0.033, 0.033]) g.prism(x, ny, nz, 0.042, nh, nd, 8, [0.1, 0.12, 0.1]);
        if (mounts.includes('flashlight')) {
          g.prism(0.118, 0.675, 0.04, 0.035, 0.035, 0.085, 8, black);
          g.prism(0.118, 0.675, 0.084, 0.028, 0.028, 0.004, 8, [1, 0.95, 0.7]);
        }
      } else if (u.classId === 'driver') {
        g.prism(0, 0.675, -0.01, 0.2, 0.215, 0.1, 10, [0.18, 0.17, 0.15], V); // шоломофон
      } else if (L.headgear === 'cap') {
        camo(g, L.jacket);
        g.prism(0, 0.685, 0.0, 0.165, 0.18, 0.065, 10, WHITE, V);
        camo(g, false);
        g.box(0, 0.665, 0.11, 0.13, 0.012, 0.07, shade(gear, 0.6)); // козирок
      } else if (L.headgear === 'beanie') {
        g.prism(0, 0.685, -0.005, 0.165, 0.18, 0.08, 10, shade(gear, 0.7), V);
        g.prism(0, 0.73, -0.005, 0.12, 0.13, 0.03, 10, shade(gear, 0.7), V);
      } else if (L.headgear === 'ushanka') {
        const fur: RGB = [0.32, 0.26, 0.2];
        g.prism(0, 0.69, -0.005, 0.19, 0.2, 0.09, 10, [0.25, 0.27, 0.2], V);
        g.prism(0, 0.66, -0.005, 0.2, 0.215, 0.04, 10, fur, V);
        for (const x of [-0.095, 0.095]) g.box(x, 0.61, 0.0, 0.03, 0.09, 0.1, fur); // вуха шапки
      } else {
        g.prism(0, 0.69, -0.01, 0.155, 0.17, 0.04, 10, hair, V); // зачіска
      }
    }),
  );

  // ---- Руки: плече, лікоть, передпліччя, кисть ----
  const arm = (x: number) => {
    const n = new TransformNode('armPivot', scene);
    n.parent = torso;
    n.position.set(x, 0.41, 0);
    return reg(
      part(scene, mat, n, 'arm', (g) => {
        camo(g, L.jacket);
        g.prism(0, -0.1, 0, 0.1, 0.105, 0.2, 12, WHITE, V);
        g.prism(0, -0.28, 0.005, 0.09, 0.095, 0.17, 12, WHITE, V);
        camo(g, false);
        g.prism(0, -0.05, 0, 0.108, 0.113, 0.05, 8, side, V); // пов'язка сторони
        if (u.classId === 'medic') {
          g.box(x > 0 ? 0.053 : -0.053, -0.12, 0, 0.004, 0.06, 0.06, [0.92, 0.92, 0.9]);
          g.box(x > 0 ? 0.056 : -0.056, -0.12, 0, 0.004, 0.045, 0.014, [0.8, 0.1, 0.1]);
          g.box(x > 0 ? 0.056 : -0.056, -0.12, 0, 0.004, 0.014, 0.045, [0.8, 0.1, 0.1]);
        }
        if (u.inventory.extraArmor?.some((a) => a.defId === 'shoulder_guards')) g.prism(0, -0.03, 0, 0.13, 0.135, 0.11, 8, gear, V);
        if (!L.civilian) g.prism(0, -0.19, -0.005, 0.105, 0.11, 0.045, 8, shade(gear, 0.85), V); // налокітник
        g.prism(0, -0.375, 0.005, 0.075, 0.08, 0.06, 8, gloves, V); // долоня
        g.box(0, -0.405, 0.035, 0.065, 0.04, 0.03, shade(gloves, 1.3)); // пальці
      }),
    );
  };
  const armL = arm(-0.212);
  const armR = arm(0.212);

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
    // Контур лише на гострих гранях (округлі кінцівки без «сітки» ліній).
    m.enableEdgesRendering(0.55);
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
