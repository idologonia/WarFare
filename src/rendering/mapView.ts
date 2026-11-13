import { content, objectDef, terrainDef } from '@/content';
import type { Cell } from '@/core/grid';
import type { EdgeSide, MapObjectDefinition, MapState } from '@/game/types';
import { Color3, StandardMaterial, Vector3, Mesh, type Scene } from './babylon';
import { GeoBuilder, hash2, hex, shade, type RGB } from './geo';
import { SURFACE_SCALE, surfaceMaterial, surfaceOf, type Surface } from './surfaces';

export const LH = () => content().rules.map.levelHeight;

/** Світові координати центру клітинки на висоті h (у одиницях поверху). */
export function world(x: number, y: number, h: number): Vector3 {
  return new Vector3(x, h * LH(), -y);
}
export const cellWorld = (c: Cell, h = c.z) => world(c.x + 0.5, c.y + 0.5, h);

export function makeMaterial(scene: Scene, name: string, alpha = 1, emissive = false): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.specularColor = new Color3(0.05, 0.05, 0.05);
  m.backFaceCulling = false;
  if (alpha < 1) {
    m.alpha = alpha;
  }
  if (emissive) {
    m.disableLighting = true;
    m.emissiveColor = new Color3(1, 1, 1);
  }
  return m;
}

/** Геометрія об'єктів карти (ретро-стиль: прості «рублені» форми). */
function buildObject(g: GeoBuilder, o: MapObjectDefinition, x: number, y: number, z: number, base: number): void {
  const L = LH();
  const cx = x + 0.5;
  const cz = -(y + 0.5);
  const b = base * L;
  const col = hex(o.color);
  const h = o.height * L;
  const n = hash2(x, y, z);
  switch (o.id) {
    case 'bush':
      // Кущ: кілька округлих «куль» листя.
      g.prism(cx - 0.12, b + 0.2, cz + 0.05, 0.58, 0.52, 0.38, 9, shade(col, 0.95 + n * 0.2), Math.PI / 2);
      g.prism(cx + 0.15, b + 0.3, cz - 0.1, 0.48, 0.44, 0.42, 9, shade(col, 1.1), Math.PI / 2);
      g.prism(cx, b + 0.5, cz, 0.32, 0.3, 0.22, 9, shade(col, 1.2), Math.PI / 2);
      break;
    case 'tree':
    case 'tree_damaged': {
      // Дерево: стовбур-призма, гілки й крона з кількох округлих ярусів.
      g.prism(cx, b + 0.55, cz, 0.2, 0.2, 1.1, 7, col, Math.PI / 2);
      g.prism(cx + 0.12, b + 1.0, cz, 0.07, 0.07, 0.35, 6, col, Math.PI / 2 - 0.6, 0.4);
      const leaf: RGB = o.id === 'tree' ? [0.22, 0.42, 0.14] : [0.3, 0.36, 0.15];
      const s = o.id === 'tree' ? 1 : 0.7;
      g.prism(cx, b + 1.32, cz, 1.0 * s, 0.95 * s, 0.55, 10, shade(leaf, 0.9 + n * 0.2), Math.PI / 2);
      g.prism(cx + 0.08, b + 1.72, cz - 0.04, 0.78 * s, 0.74 * s, 0.42, 10, shade(leaf, 1.05), Math.PI / 2);
      g.prism(cx - 0.04, b + 2.05, cz + 0.02, 0.48 * s, 0.46 * s, 0.32, 10, shade(leaf, 1.2), Math.PI / 2);
      g.prism(cx + 0.3 * s, b + 1.45, cz + 0.2 * s, 0.4 * s, 0.38 * s, 0.3, 8, shade(leaf, 1.0), Math.PI / 2);
      break;
    }
    case 'stump':
      // Пень: круглий, з кільцями на зрізі й корінням.
      g.prism(cx, b + h / 2, cz, 0.3, 0.3, h, 10, col, Math.PI / 2);
      g.prism(cx, b + h + 0.003, cz, 0.22, 0.22, 0.006, 10, [0.62, 0.5, 0.33], Math.PI / 2);
      g.prism(cx, b + h + 0.006, cz, 0.1, 0.1, 0.006, 10, [0.5, 0.38, 0.24], Math.PI / 2);
      for (let i = 0; i < 3; i++) g.prism(cx + Math.cos(i * 2.1 + n) * 0.17, b + 0.03, cz + Math.sin(i * 2.1 + n) * 0.17, 0.06, 0.05, 0.16, 6, shade(col, 0.85), 0, i * 2.1 + n);
      break;
    case 'sandbags':
    case 'sandbags_damaged': {
      const rows = o.id === 'sandbags' ? 3 : 2;
      for (let r = 0; r < rows; r++)
        for (let i = 0; i < 3; i++)
          g.chamferBox(cx - 0.31 + i * 0.31 + (r % 2) * 0.1 - 0.05, b + 0.1 + r * (h / rows), cz + (hash2(x + i, y + r) - 0.5) * 0.06, 0.3, h / rows + 0.01, 0.6, shade(col, 0.92 + hash2(i, r, x) * 0.18), 0.06, (hash2(x, r, i) - 0.5) * 0.15);
      break;
    }
    case 'fence':
      for (const dx of [-0.4, 0, 0.4]) g.prism(cx + dx, b + h / 2 + 0.05, cz, 0.08, 0.08, h + 0.1, 7, shade(col, 0.8), Math.PI / 2);
      for (let i = 0; i < 9; i++) g.box(cx - 0.44 + i * 0.11, b + h * 0.55, cz + 0.035, 0.09, h * (0.85 + hash2(x, i, 3) * 0.2), 0.02, shade(col, 0.9 + hash2(i, y, 4) * 0.2)); // штакетник
      g.box(cx, b + h * 0.3, cz, 1, 0.07, 0.04, shade(col, 0.75));
      g.box(cx, b + h * 0.8, cz, 1, 0.07, 0.04, shade(col, 0.75));
      break;
    case 'crates':
      crate(g, cx - 0.15, b, cz + 0.1, 0.5, 0.4, col, n * 0.6);
      crate(g, cx + 0.2, b, cz - 0.15, 0.42, 0.36, shade(col, 1.1), n * 1.3);
      crate(g, cx - 0.1, b + 0.4, cz + 0.05, 0.36, 0.3, shade(col, 0.92), n * 2);
      break;
    case 'container':
    case 'container_damaged':
      // Контейнер: корпус зі скосами, ребра даху, кутові фітинги, двері з запорами на торці.
      g.chamferBox(cx, b + h / 2, cz, 0.98, h, 0.98, col, 0.04);
      for (const dz of [-0.3, 0, 0.3]) g.box(cx, b + h + 0.01, cz + dz, 0.96, 0.02, 0.05, shade(col, 0.85));
      for (const sx of [-0.47, 0.47]) for (const sz of [-0.47, 0.47]) for (const sy of [0.05, h - 0.05]) g.box(cx + sx, b + sy, cz + sz, 0.08, 0.1, 0.08, shade(col, 0.6));
      for (const dx of [-0.3, -0.12, 0.12, 0.3]) g.prism(cx + dx, b + h / 2, cz + 0.5, 0.025, 0.025, h * 0.9, 6, [0.45, 0.45, 0.43], Math.PI / 2); // запори
      g.box(cx, b + h / 2, cz + 0.495, 0.01, h * 0.92, 0.012, shade(col, 0.5)); // щілина між стулками
      if (o.id === 'container_damaged') {
        g.box(cx + 0.3, b + h * 0.6, cz + 0.505, 0.2, 0.15, 0.02, [0.06, 0.06, 0.06]);
        g.box(cx - 0.51, b + h * 0.4, cz - 0.2, 0.02, 0.18, 0.12, [0.06, 0.06, 0.06]);
        g.box(cx + 0.2, b + h * 0.75, cz + 0.52, 0.12, 0.08, 0.04, [0.42, 0.2, 0.1], 1, 0, 0.5); // загнутий метал
      }
      break;
    case 'scrap':
      // Брухт: зігнуті листи, труби, шина, іржа.
      g.box(cx - 0.12, b + 0.1, cz, 0.62, 0.03, 0.45, col, 1, 0.3, 0.25);
      g.box(cx + 0.15, b + 0.16, cz + 0.08, 0.45, 0.03, 0.35, [0.5, 0.28, 0.15], 1, -0.6, -0.4);
      g.prism(cx - 0.05, b + 0.06, cz - 0.15, 0.08, 0.08, 0.7, 8, shade(col, 1.2), 0, 0.9);
      g.prism(cx + 0.25, b + 0.05, cz - 0.05, 0.06, 0.06, 0.5, 8, [0.45, 0.25, 0.14], 0.15, -0.5);
      g.prism(cx - 0.22, b + 0.14, cz + 0.22, 0.34, 0.34, 0.12, 12, [0.08, 0.08, 0.08], Math.PI / 2 - 0.2); // шина
      g.prism(cx - 0.22, b + 0.15, cz + 0.22, 0.16, 0.16, 0.125, 12, shade(col, 0.6), Math.PI / 2 - 0.2);
      break;
    case 'earth_berm':
      // Земляний вал: округлий профіль, трава зверху.
      g.prism(cx, b + h * 0.45, cz, 1.0, h * 1.1, 1.0, 10, col, 0, Math.PI / 2);
      g.prism(cx, b + h * 0.75, cz, 0.7, h * 0.6, 1.0, 10, shade(col, 1.1), 0, Math.PI / 2);
      for (let i = 0; i < 4; i++) g.box(cx - 0.4 + i * 0.27, b + h + 0.02, cz + (hash2(x, i, 9) - 0.5) * 0.3, 0.04, 0.08, 0.04, [0.32, 0.45, 0.2]);
      break;
    case 'brick_rubble':
    case 'concrete_rubble':
      for (let i = 0; i < 5; i++) {
        const a = hash2(x, y, i + 1);
        const c2 = hash2(y, x, i + 7);
        g.chamferBox(cx - 0.35 + a * 0.7, b + 0.08 + (i % 2) * 0.12, cz - 0.35 + c2 * 0.7, 0.25 + a * 0.15, 0.16, 0.25, shade(col, 0.85 + c2 * 0.3), 0.04, a * 3, (c2 - 0.5) * 0.5);
      }
      if (o.id === 'concrete_rubble') for (let i = 0; i < 3; i++) g.prism(cx - 0.2 + i * 0.2, b + 0.2, cz + (hash2(x, i, 5) - 0.5) * 0.4, 0.02, 0.02, 0.4, 5, [0.4, 0.25, 0.18], Math.PI / 2 - 0.5, i); // арматура
      break;
    case 'parapet':
      g.box(cx, b + h / 2, cz, 1, h, 1, col);
      break;
    default:
      if (o.window) {
        const sill = (o.sill ?? 0.4) * L;
        g.box(cx, b + sill / 2, cz, 1, sill, 1, col);
        g.box(cx, b + L * 0.97, cz, 1, L * 0.06, 1, col);
        // Рама і скло.
        g.box(cx, b + sill + (L * 0.94 - sill) / 2, cz, 0.12, L * 0.94 - sill, 0.12, shade(col, 0.7));
        g.box(cx, b + sill + (L * 0.94 - sill) / 2, cz, 0.96, L * 0.94 - sill, 0.96, [0.55, 0.75, 0.9], 0.35);
      } else if (o.door) {
        g.box(cx, b + L * 0.94, cz, 1, L * 0.12, 1, hex('#a4553a'));
        g.box(cx - 0.47, b + L * 0.45, cz, 0.06, L * 0.9, 1, col);
        g.box(cx + 0.47, b + L * 0.45, cz, 0.06, L * 0.9, 1, col);
      } else if (o.wall) {
        g.box(cx, b + h / 2, cz, 1, h, 1, shade(col, 0.95 + n * 0.1));
        // Цегляна «кладка» — смужки.
        if (o.material === 'brick') for (let r = 1; r < 5; r++) g.box(cx, b + (h * r) / 5, cz, 1.01, 0.025, 1.01, shade(col, 0.75));
        g.box(cx, b + h + 0.02, cz, 1.02, 0.04, 1.02, shade(col, 1.15));
      } else {
        g.box(cx, b + h / 2, cz, 0.9, h, 0.9, col);
      }
  }
}

/** Водостічні труби на зовнішніх кутах будівлі (від даху до землі, з коліном унизу). */
function downpipes(g: GeoBuilder, map: MapState, x: number, y: number): void {
  const L = LH();
  const bid = map.cells[0][y][x].buildingId;
  const same = (dx: number, dy: number) => map.cells[0][y + dy]?.[x + dx]?.buildingId === bid;
  let floors = 0;
  while (floors < map.levels && map.cells[floors][y][x].floor && map.cells[floors][y][x].terrain !== 'roof') floors++;
  if (!floors) return;
  const H = floors * L;
  const pipe: RGB = [0.5, 0.52, 0.52];
  for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    if (same(dx, 0) || same(0, dy)) continue; // не зовнішній кут
    if (hash2(x + dx, y + dy, 77) < 0.35) continue; // не на кожному куті
    const px = x + 0.5 + dx * 0.56;
    const pz = -(y + 0.5 + dy * 0.56);
    g.prism(px, H / 2, pz, 0.05, 0.05, H, 8, pipe, Math.PI / 2);
    for (let k = 0.3; k < H - 0.1; k += 0.45) g.box(px - dx * 0.025, k, pz + dy * 0.025, 0.07, 0.02, 0.07, shade(pipe, 0.7)); // хомути
    g.box(px, H - 0.02, pz, 0.14, 0.05, 0.14, shade(pipe, 0.9)); // воронка
    g.prism(px - dx * 0.06, 0.05, pz + dy * 0.06, 0.06, 0.06, 0.14, 8, pipe, 0, Math.atan2(-dx, dy)); // коліно
  }
}

/** Дерев'яний ящик: корпус, рамка з дощок по ребрах, дошки кришки. */
function crate(g: GeoBuilder, cx: number, y0: number, cz: number, s: number, h: number, col: RGB, rot: number): void {
  const dark = shade(col, 0.72);
  g.box(cx, y0 + h / 2, cz, s, h, s, col, 1, rot);
  const c = Math.cos(rot), sn = Math.sin(rot);
  const at = (dx: number, dz: number): [number, number] => [cx + dx * c + dz * sn, cz - dx * sn + dz * c];
  for (const dx of [-s / 2, s / 2])
    for (const dz of [-s / 2, s / 2]) {
      const [px, pz] = at(dx * 0.98, dz * 0.98);
      g.box(px, y0 + h / 2, pz, 0.04, h + 0.01, 0.04, dark, 1, rot); // вертикальні ребра
    }
  for (const yy of [0.02, h - 0.02]) {
    g.box(cx, y0 + yy, cz, s + 0.02, 0.035, s + 0.02, dark, 1, rot); // обв'язка
  }
  for (let i = 0; i < 3; i++) {
    const [px, pz] = at(0, -s / 2 + (i + 0.5) * (s / 3));
    g.box(px, y0 + h + 0.005, pz, s * 0.95, 0.01, s / 3 - 0.02, shade(col, 0.95 + i * 0.05), 1, rot); // дошки кришки
  }
  const [mx, mz] = at(0, s / 2 + 0.002);
  g.box(mx, y0 + h / 2, mz, s * 0.4, h * 0.25, 0.004, [0.15, 0.15, 0.12], 1, rot); // маркування
}

export interface ObjectMeshInfo {
  mesh: Mesh;
  level: number;
  buildingId?: number;
  wall: boolean;
  glass: boolean;
}

/** Відображення карти: плитки по поверхах і окремі сітки об'єктів (для руйнування й прозорості). */
export class MapView {
  levelMeshes: Mesh[] = [];
  objects = new Map<string, ObjectMeshInfo>();
  solid: StandardMaterial;
  ghost: StandardMaterial;
  glass: StandardMaterial;
  private base: Mesh | null = null;

  /** Світні елементи вночі (вікна, ліхтарі) — емісивний матеріал, підхоплюється світінням. */
  private litMat: StandardMaterial;

  constructor(private scene: Scene, private map: MapState, private onMesh: (m: Mesh, receive: boolean) => void, private night = false) {
    this.litMat = makeMaterial(scene, 'litWin', 1, true);
    this.solid = makeMaterial(scene, 'solid');
    this.ghost = makeMaterial(scene, 'ghost', 0.22);
    this.glass = makeMaterial(scene, 'glass', 0.999);
    this.build();
  }

  private build(): void {
    const m = this.map;
    // Темна основа під картою — проміжки між плитками дають сітку.
    const bg = new GeoBuilder();
    bg.smooth = true;
    bg.box(m.width / 2, -0.2, -m.height / 2, m.width + 0.2, 0.36, m.height + 0.2, [0.16, 0.14, 0.11]);
    // Околиці за межами карти: поле з плямами й деревами вдалині (лише вигляд, ходити не можна).
    const O = 18;
    const fieldCol: RGB = [0.42, 0.52, 0.26];
    bg.box(m.width / 2, -0.06, -m.height / 2, m.width + O * 2, 0.04, m.height + O * 2, shade(fieldCol, 0.85));
    for (let i = 0; i < 160; i++) {
      const a = hash2(i, 3, 7) * (m.width + O * 2) - O;
      const b = hash2(7, i, 3) * (m.height + O * 2) - O;
      if (a > -1 && a < m.width + 1 && b > -1 && b < m.height + 1) continue;
      const k = hash2(i, i, 11);
      if (k < 0.55) bg.box(a, -0.035, -b, 1 + k * 3, 0.01, 1 + hash2(i, 5, 5) * 3, shade(fieldCol, 0.8 + k * 0.4));
      else {
        // дерево
        const h = 1.2 + k * 1.4;
        bg.prism(a, h * 0.3 - 0.04, -b, 0.22, 0.22, h * 0.6, 7, [0.25, 0.18, 0.12], Math.PI / 2);
        bg.prism(a, h * 0.75, -b, 1.15, 1.1, h * 0.55, 10, shade([0.18, 0.3, 0.14], 0.85 + k * 0.3), Math.PI / 2);
        bg.prism(a, h * 1.05, -b, 0.72, 0.7, 0.35, 10, shade([0.2, 0.33, 0.15], 0.9 + k * 0.3), Math.PI / 2);
      }
    }
    this.base = bg.build('base', this.scene, this.solid);
    this.buildLamps();
    this.onMesh(this.base, true);
    for (let z = 0; z < m.levels; z++) this.levelMeshes.push(this.buildLevel(z));
    for (let z = 0; z < m.levels; z++)
      for (let cy = 0; cy * MapView.CH < m.height; cy++) for (let cx = 0; cx * MapView.CH < m.width; cx++) this.rebuildChunk(z, cx, cy);
  }

  private buildLevel(z: number): Mesh {
    const m = this.map;
    const L = LH();
      // Окремі сітки за поверхнею: ґрунт, підлога, дах — кожна зі своєю текстурою деталей.
      const groups: Record<'ground' | 'floor' | 'roof', GeoBuilder> = { ground: new GeoBuilder(), floor: new GeoBuilder(), roof: new GeoBuilder() };
      for (const [k, b] of Object.entries(groups)) b.worldUV = SURFACE_SCALE[k as Surface];
      let g = groups.ground;
      for (let y = 0; y < m.height; y++)
        for (let x = 0; x < m.width; x++) {
          const cell = m.cells[z][y][x];
          if (!cell.floor) continue;
          g = cell.terrain === 'floor' ? groups.floor : cell.terrain === 'roof' ? groups.roof : groups.ground;
          if (cell.terrain === 'roof' && z > 0) {
            // Обладнання на даху: вентиляція, кондиціонери, антени (рідко, біля краю клітинки).
            const rr = hash2(x * 11, y * 7, z * 3 + 41);
            const ox = x + 0.25 + hash2(x, y, 42) * 0.1, oz = -(y + 0.25 + hash2(y, x, 43) * 0.1);
            const metal: RGB = [0.55, 0.56, 0.56];
            if (rr < 0.07) {
              g.chamferBox(ox, z * L + 0.12, oz, 0.26, 0.22, 0.26, metal, 0.03); // вентиляційна шахта
              g.box(ox, z * L + 0.25, oz, 0.32, 0.03, 0.32, shade(metal, 0.8));
              for (let i = 0; i < 3; i++) g.box(ox + 0.131, z * L + 0.07 + i * 0.05, oz, 0.004, 0.02, 0.2, [0.15, 0.15, 0.15]);
            } else if (rr < 0.11) {
              g.chamferBox(ox, z * L + 0.14, oz, 0.34, 0.26, 0.22, [0.78, 0.78, 0.76], 0.02); // кондиціонер
              g.prism(ox, z * L + 0.14, oz + 0.112, 0.18, 0.18, 0.006, 14, [0.25, 0.25, 0.27]); // решітка вентилятора
            } else if (rr < 0.125) {
              g.prism(ox, z * L + 0.45, oz, 0.025, 0.025, 0.9, 6, [0.35, 0.35, 0.35], Math.PI / 2); // антена
              for (let i = 0; i < 3; i++) g.box(ox, z * L + 0.6 + i * 0.12, oz, 0.3 - i * 0.07, 0.012, 0.012, [0.35, 0.35, 0.35]);
            }
            // Бортик (відлив) уздовж краю даху.
            const ry = z * L + 0.04;
            const lip: RGB = [0.42, 0.42, 0.42];
            const nb = (dx: number, dy: number) => m.cells[z][y + dy]?.[x + dx]?.terrain === 'roof';
            if (!nb(0, -1)) g.box(x + 0.5, ry, -y - 0.03, 1.0, 0.08, 0.06, lip);
            if (!nb(0, 1)) g.box(x + 0.5, ry, -y - 0.97, 1.0, 0.08, 0.06, lip);
            if (!nb(-1, 0)) g.box(x + 0.03, ry, -(y + 0.5), 0.06, 0.08, 1.0, lip);
            if (!nb(1, 0)) g.box(x + 0.97, ry, -(y + 0.5), 0.06, 0.08, 1.0, lip);
          }
          const t = terrainDef(cell.terrain);
          const n = hash2(x, y, z);
          const col = shade(hex(t.color), 0.93 + n * 0.14);
          const top = z === 0 ? cell.elevation * L : z * L;
          if (z === 0) {
            // Підкладка темнішого відтінку + плитка трохи менша: тонка ненав'язлива сітка замість чорних щілин.
            g.box(x + 0.5, (top - 0.02) / 2, -(y + 0.5), 1.0, top + 0.02, 1.0, shade(col, 0.78));
            g.box(x + 0.5, top - 0.005, -(y + 0.5), 0.975, 0.012, 0.975, col);
          } else {
            g.box(x + 0.5, z * L - 0.06, -(y + 0.5), 1.0, 0.12, 1.0, shade(col, 0.8));
            g.box(x + 0.5, z * L + 0.001, -(y + 0.5), 0.975, 0.012, 0.975, col);
          }
          // Строкатість: кілька плоских плям іншого відтінку — земля не виглядає однотонною.
          if (cell.terrain !== 'floor' && cell.terrain !== 'roof') {
            for (let i = 0; i < 3; i++) {
              const a = hash2(x, y, i + 31);
              const b = hash2(y, x, i + 37);
              const sz = 0.2 + hash2(x + i, y, 41) * 0.3;
              const pc = shade(col, 0.86 + hash2(i, x, y) * 0.24);
              g.box(x + 0.12 + a * 0.76, top + 0.004 + i * 0.001, -(y + 0.12 + b * 0.76), sz, 0.006, sz * (0.6 + b * 0.8), pc);
            }
            if (cell.terrain === 'road') {
              // Колії.
              g.box(x + 0.32, top + 0.009, -(y + 0.5), 0.12, 0.004, 0.98, shade(col, 0.82));
              g.box(x + 0.68, top + 0.009, -(y + 0.5), 0.12, 0.004, 0.98, shade(col, 0.82));
            }
          } else if (z > 0 || cell.terrain === 'floor') {
            // Підлога: дошки/плитка.
            for (let i = 1; i < 4; i++) g.box(x + i * 0.25, top + 0.009, -(y + 0.5), 0.01, 0.003, 0.97, shade(col, 0.82));
          }
          // Трава й камінці.
          if (z === 0 && (cell.terrain === 'grass' || cell.terrain === 'dirt' || cell.terrain === 'mud') && !cell.object) {
            const grass = cell.terrain === 'grass';
            const cnt = grass ? 4 + Math.floor(hash2(x * 7, y * 13, 5) * 5) : hash2(x * 7, y * 13, 5) < 0.5 ? 2 : 0;
            for (let i = 0; i < cnt; i++) {
              const a = hash2(x, y, i + 11);
              const b = hash2(y, x, i + 17);
              if (grass) {
                const h = 0.07 + hash2(i, y, x) * 0.1;
                const c2: RGB = shade(col, 1.05 + a * 0.18);
                g.box(x + 0.1 + a * 0.8, top + h / 2, -(y + 0.1 + b * 0.8), 0.035, h, 0.035, c2);
                g.box(x + 0.13 + a * 0.8, top + h * 0.4, -(y + 0.12 + b * 0.8), 0.03, h * 0.8, 0.03, shade(c2, 0.85));
              } else g.box(x + 0.15 + a * 0.7, top + 0.025, -(y + 0.15 + b * 0.7), 0.07 + a * 0.05, 0.045, 0.06 + b * 0.05, [0.5 + a * 0.15, 0.48 + a * 0.12, 0.44 + a * 0.1]);
            }
          }
          // Дрібниці на землі: сміття біля доріг і будівель, калюжі в багнюці, квіти в траві, старі вирви.
          if (z === 0 && !cell.object && !cell.vehicle) {
            const r = hash2(x * 5, y * 3, 91);
            const t = cell.elevation * L;
            if ((cell.terrain === 'dirt' || cell.terrain === 'road') && r < 0.09) {
              const a = hash2(x, y, 92), c2 = hash2(y, x, 93);
              if (r < 0.04) g.box(x + 0.2 + a * 0.6, t + 0.012, -(y + 0.2 + c2 * 0.6), 0.12, 0.006, 0.09, [0.78, 0.76, 0.7], 1, a * 3); // папір
              else if (r < 0.07) g.prism(x + 0.2 + a * 0.6, t + 0.025, -(y + 0.2 + c2 * 0.6), 0.04, 0.04, 0.12, 8, [0.2, 0.35, 0.22], 0, a * 6); // пляшка
              else g.chamferBox(x + 0.2 + a * 0.6, t + 0.03, -(y + 0.2 + c2 * 0.6), 0.14, 0.06, 0.1, [0.42, 0.4, 0.36], 0.02, a * 4); // уламок цегли
            }
            if (cell.terrain === 'mud' && r < 0.6) g.prism(x + 0.5, t + 0.006, -(y + 0.5), 0.7 + r * 0.3, 0.5 + r * 0.4, 0.008, 12, [0.16, 0.18, 0.2], Math.PI / 2, r * 3); // калюжа
            if (cell.terrain === 'grass' && r < 0.12)
              for (let i = 0; i < 3; i++) g.box(x + 0.2 + hash2(x, i, 94) * 0.6, t + 0.09, -(y + 0.2 + hash2(i, y, 95) * 0.6), 0.03, 0.03, 0.03, r < 0.06 ? [0.95, 0.9, 0.4] : [0.92, 0.92, 0.95]); // квіти
            if ((cell.terrain === 'grass' || cell.terrain === 'dirt') && r > 0.985 && cell.buildingId === undefined) {
              g.prism(x + 0.5, t + 0.006, -(y + 0.5), 0.8, 0.8, 0.01, 14, [0.24, 0.2, 0.15], Math.PI / 2); // стара вирва
              g.prism(x + 0.5, t + 0.009, -(y + 0.5), 0.45, 0.45, 0.01, 12, [0.16, 0.13, 0.1], Math.PI / 2);
            }
          }
          if (cell.stairsUp) {
            for (let i = 0; i < 5; i++) g.box(x + 0.5, z * L + (i + 0.5) * (L / 5) / 2, -(y + 0.1 + i * 0.18), 0.8, (i + 1) * (L / 5), 0.18, shade([0.55, 0.45, 0.35], 0.9 + i * 0.04));
          }
        }
    const root = new Mesh(`level${z}`, this.scene);
    for (const [k, b] of Object.entries(groups)) {
      if (b.empty) continue;
      const mesh = b.build(`level${z}_${k}`, this.scene, surfaceMaterial(this.scene, k as Surface));
      mesh.parent = root;
      this.onMesh(mesh, true);
    }
    return root;
  }

  /** Перебудувати плитки поверху (після зміни місцевості в редакторі). */
  rebuildLevel(z: number): void {
    this.levelMeshes[z]?.dispose();
    this.levelMeshes[z] = this.buildLevel(z);
  }

  dispose(): void {
    this.base?.dispose();
    for (const d of this.decor) d.dispose();
    this.decor = [];
    for (const m of this.levelMeshes) m.dispose();
    for (const o of this.objects.values()) o.mesh.dispose();
    this.objects.clear();
    this.levelMeshes = [];
  }

  /** Вуличні ліхтарі вздовж доріг (лише вигляд). Уночі — світні плафони й світлові плями на землі. */
  lamps: { x: number; y: number }[] = [];
  private buildLamps(): void {
    const m = this.map;
    const pole = new GeoBuilder();
    pole.smooth = true;
    const glow = new GeoBuilder();
    const road = (x: number, y: number) => m.cells[0][y]?.[x]?.terrain === 'road';
    for (let y = 0; y < m.height; y++)
      for (let x = 0; x < m.width; x++) {
        const c = m.cells[0][y][x];
        if (!road(x, y) || c.object || (x * 7 + y * 13) % 9 !== 0) continue;
        const side = !road(x - 1, y) ? [-1, 0] : !road(x + 1, y) ? [1, 0] : !road(x, y - 1) ? [0, -1] : !road(x, y + 1) ? [0, 1] : null;
        if (!side) continue;
        const px = x + 0.5 + side[0] * 0.42;
        const pz = -(y + 0.5 + side[1] * 0.42);
        const H = 1.7;
        pole.prism(px, H / 2, pz, 0.06, 0.06, H, 8, [0.3, 0.31, 0.32], Math.PI / 2);
        pole.prism(px - side[0] * 0.2, H - 0.02, pz + side[1] * 0.2, 0.035, 0.035, 0.42, 6, [0.3, 0.31, 0.32], 0, Math.atan2(-side[0], side[1]) + Math.PI);
        const hx = px - side[0] * 0.38, hz = pz + side[1] * 0.38;
        pole.chamferBox(hx, H - 0.06, hz, 0.18, 0.06, 0.18, [0.25, 0.26, 0.27], 0.02);
        (this.night ? glow : pole).box(hx, H - 0.1, hz, 0.12, 0.03, 0.12, this.night ? [1, 0.85, 0.55] : [0.75, 0.75, 0.7]);
        if (this.night) glow.prism(hx, 0.02, hz, 1.6, 1.6, 0.004, 16, [0.55, 0.42, 0.22], Math.PI / 2, 0, 0.22); // пляма світла
        this.lamps.push({ x: hx, y: hz });
      }
    if (!pole.empty) {
      const mesh = pole.build('lamps', this.scene, this.solid);
      mesh.isPickable = false;
      this.onMesh(mesh, false);
      this.decor.push(mesh);
    }
    if (!glow.empty) {
      const mesh = glow.build('lampGlow', this.scene, this.litMat);
      mesh.isPickable = false;
      mesh.hasVertexAlpha = true;
      this.decor.push(mesh);
    }
  }
  private decor: Mesh[] = [];

  /** Об'єкти карти зібрані блоками CH×CH клітинок на поверх: мало draw calls. */
  static readonly CH = 8;

  rebuildObject(c: Cell): void {
    this.rebuildChunk(c.z, Math.floor(c.x / MapView.CH), Math.floor(c.y / MapView.CH));
  }

  private rebuildChunk(z: number, cx: number, cy: number): void {
    const key = `${z}:${cx}:${cy}`;
    for (const k of [...this.objects.keys()])
      if (k === `ch:${key}` || k === `chg:${key}` || k.startsWith(`cht:${key}:`)) {
        this.objects.get(k)?.mesh.dispose();
        this.objects.delete(k);
      }
    const g = new GeoBuilder();
    const gg = new GeoBuilder();
    const gl = new GeoBuilder(); // освітлені вікна (вночі)
    const tex = new Map<Surface, GeoBuilder>();
    const forSurf = (sf: Surface | null): GeoBuilder => {
      if (!sf) return g;
      let b = tex.get(sf);
      if (!b) {
        b = new GeoBuilder();
        b.smooth = true;
        b.worldUV = SURFACE_SCALE[sf];
        tex.set(sf, b);
      }
      return b;
    };
    let wall = false;
    const CH = MapView.CH;
    for (let y = cy * CH; y < Math.min(this.map.height, (cy + 1) * CH); y++)
      for (let x = cx * CH; x < Math.min(this.map.width, (cx + 1) * CH); x++) {
        const cell = this.map.cells[z][y][x];
        const base = z + (z === 0 ? cell.elevation : 0);
        if (z === 0 && cell.buildingId !== undefined) downpipes(g, this.map, x, y);
        if (cell.object) {
          const o = objectDef(cell.object.defId);
          const tgt = o.window ? gg : forSurf(surfaceOf(o.material, o.id));
          const from = tgt.positions.length;
          buildObject(tgt, o, x, y, z, base);
          if (cell.object.rot) rotateSince(tgt, from, x + 0.5, -(y + 0.5), (cell.object.rot * Math.PI) / 2);
          if (o.wall || o.id === 'parapet') wall = true;
        }
        if (cell.edges)
          for (const side of Object.keys(cell.edges) as EdgeSide[]) {
            const o = objectDef(cell.edges[side]!.defId);
            const lit = this.night && !!o.window && !o.id.endsWith('_broken') && hash2(x * 3 + z, y * 5, side.charCodeAt(0)) < 0.35;
            buildEdge(forSurf(surfaceOf(o.material, o.id)), o, x, y, z, side, z, lit ? gl : gg, isTopWall(this.map, x, y, z));
            if (o.wall || o.id === 'parapet') wall = true;
          }
      }
    if (!g.empty) {
      const mesh = g.build(`ch_${key}`, this.scene, this.solid);
      mesh.isPickable = false;
      this.onMesh(mesh, false);
      this.objects.set(`ch:${key}`, { mesh, level: z, buildingId: undefined, wall, glass: false });
    }
    for (const [sf, b] of tex) {
      if (b.empty) continue;
      const mesh = b.build(`cht_${key}_${sf}`, this.scene, surfaceMaterial(this.scene, sf));
      mesh.isPickable = false;
      this.onMesh(mesh, false);
      this.objects.set(`cht:${key}:${sf}`, { mesh, level: z, buildingId: undefined, wall, glass: false });
    }
    if (!gg.empty) {
      const mesh = gg.build(`chg_${key}`, this.scene, this.glass);
      mesh.isPickable = false;
      this.onMesh(mesh, false);
      this.objects.set(`chg:${key}`, { mesh, level: z, buildingId: undefined, wall, glass: true });
    }
    if (!gl.empty) {
      // Тепле світло у вікні: перефарбувати скло.
      for (let i = 0; i < gl.colors.length; i += 4) {
        const k = 0.75 + hash2(i, z, 5) * 0.25;
        gl.colors[i] = 1 * k;
        gl.colors[i + 1] = 0.76 * k;
        gl.colors[i + 2] = 0.4 * k;
        gl.colors[i + 3] = 0.9;
      }
      const mesh = gl.build(`chl_${key}`, this.scene, this.litMat);
      mesh.isPickable = false;
      mesh.hasVertexAlpha = true;
      this.objects.set(`chl:${key}`, { mesh, level: z, buildingId: undefined, wall, glass: true });
    }
  }

  /** Приховати поверхи вище viewLevel; стіни будівель з «нашими» бійцями — прозорі. */
  applyVisibility(viewLevel: number, transparentBuildings: Set<number>): void {
    this.levelMeshes.forEach((m, z) => m.setEnabled(z <= viewLevel));
    for (const info of this.objects.values()) {
      info.mesh.setEnabled(info.level <= viewLevel);
      // Стіни не робимо прозорими: огляд усередину — поворотом камери й перемиканням поверхів.
      void transparentBuildings;
    }
  }
}

/**
 * Тонкий об'єкт уздовж межі клітинки. Будується в локальних координатах:
 * a — уздовж межі (−0.5..0.5), b — поперек (товщина), y — висота.
 */
function buildEdge(g: GeoBuilder, o: MapObjectDefinition, x: number, y: number, _z: number, side: EdgeSide, base: number, gGlass: GeoBuilder = g, top = false): void {
  const L = LH();
  const b0 = base * L;
  const col = hex(o.color);
  const h = o.height * L;
  const horizontal = side === 'n' || side === 's';
  const ex = side === 'w' ? x : side === 'e' ? x + 1 : x + 0.5;
  const ez = side === 'n' ? -y : side === 's' ? -(y + 1) : -(y + 0.5);
  const put = (a: number, yy: number, b: number, sa: number, sy: number, sb: number, c: RGB, alpha = 1) => {
    const t = alpha < 1 ? gGlass : g;
    if (horizontal) t.box(ex + a, b0 + yy, ez + b, sa, sy, sb, c, alpha);
    else t.box(ex + b, b0 + yy, ez - a, sb, sy, sa, c, alpha);
  };
  const T = 0.16;
  // Пн/пд стіни — на всю довжину з кутами, зх/сх — між ними (без накладання граней у кутах).
  const LEN = horizontal ? 1 + T : 1.002;
  const n = hash2(x * 3 + (horizontal ? 1 : 2), y, _z);
  switch (o.id) {
    case 'fence':
      for (const a of [-0.45, 0, 0.45]) put(a, h / 2 + 0.05, 0, 0.08, h + 0.1, 0.08, shade(col, 0.8));
      put(0, h * 0.35, 0, 1, 0.1, 0.05, col);
      put(0, h * 0.8, 0, 1, 0.1, 0.05, col);
      break;
    case 'sandbags':
    case 'sandbags_damaged': {
      const rows = o.id === 'sandbags' ? 3 : 2;
      for (let r = 0; r < rows; r++)
        for (let i = 0; i < 3; i++)
        {
          // Мішок — округла «подушка» вздовж межі.
          const a = -0.33 + i * 0.33 + (r % 2) * 0.08 - 0.04;
          const bb = (hash2(x + i, y + r) - 0.5) * 0.04;
          const yy = 0.08 + r * (h / rows);
          const c = shade(col, 0.92 + hash2(i, r, x) * 0.18);
          if (horizontal) g.chamferBox(ex + a, b0 + yy, ez + bb, 0.3, h / rows + 0.01, 0.34, c, 0.06, Math.PI / 2);
          else g.chamferBox(ex + bb, b0 + yy, ez - a, 0.3, h / rows + 0.01, 0.34, c, 0.06);
        }
      break;
    }
    case 'parapet':
      put(0, h / 2, 0, LEN, h, 0.22, col);
      break;
    case 'door':
      // Рама: перемичка й два косяки; полотно — у прорізі рами, трохи відчинене.
      put(0, L * 0.95, 0, LEN, L * 0.1, T, hex('#a4553a'));
      put(-(LEN / 2) + 0.06, L * 0.45, 0, 0.12, L * 0.9, T, hex('#a4553a'));
      put(LEN / 2 - 0.06, L * 0.45, 0, 0.12, L * 0.9, T, hex('#a4553a'));
      put(-0.36, L * 0.45, 0, 0.06, L * 0.9, T + 0.02, shade(col, 0.7)); // лутка
      put(0.36, L * 0.45, 0, 0.06, L * 0.9, T + 0.02, shade(col, 0.7));
      put(0, L * 0.88, 0, 0.78, 0.05, T + 0.02, shade(col, 0.7));
      put(-0.05, L * 0.43, 0.05, 0.62, L * 0.84, 0.05, col); // полотно
      put(0.2, L * 0.43, 0.09, 0.05, 0.05, 0.04, [0.75, 0.68, 0.4]); // ручка
      break;
    case 'brick_rubble':
    case 'concrete_rubble':
      for (let i = 0; i < 4; i++) {
        const a = hash2(x, y, i + 1);
        put(-0.4 + a * 0.8, 0.07 + (i % 2) * 0.1, (hash2(y, x, i) - 0.5) * 0.3, 0.22, 0.14, 0.2, shade(col, 0.85 + a * 0.3));
      }
      break;
    default:
      if (o.window) {
        const sill = (o.sill ?? 0.4) * L;
        const broken = o.id.endsWith('_broken');
        put(0, sill / 2, 0, LEN, sill, T, col);
        put(0, L * 0.97, 0, LEN, L * 0.06, T, col);
        put(0, L * 0.9, 0, 0.92, 0.05, T + 0.05, shade(col, 0.82)); // перемичка над вікном
        if (o.wall) wallTrim(put, h, LEN, T, col, _z, top, horizontal);
        put(-(LEN / 2) + 0.04, L * 0.6, 0, 0.08, L * 0.8, T, col);
        put(LEN / 2 - 0.04, L * 0.6, 0, 0.08, L * 0.8, T, col);
        put(0, sill + (L * 0.94 - sill) / 2, 0, 0.05, L * 0.94 - sill, 0.06, shade(col, 0.6));
        put(0, sill + 0.02, 0, 0.86, 0.04, T + 0.04, [0.85, 0.85, 0.82]); // підвіконня
        if (!broken) put(0, sill + (L * 0.94 - sill) / 2, 0, 0.86, L * 0.94 - sill, 0.03, [0.55, 0.75, 0.9], 0.35);
        else {
          // Розбите скло: уламки в рамі та на підвіконні.
          put(-0.3, L * 0.85, 0, 0.18, 0.12, 0.02, [0.55, 0.75, 0.9], 0.5);
          put(0.32, sill + 0.12, 0, 0.14, 0.18, 0.02, [0.55, 0.75, 0.9], 0.5);
          put(0.1, sill + 0.05, 0.08, 0.1, 0.02, 0.06, [0.6, 0.8, 0.9], 0.6);
        }
      } else {
        put(0, h / 2, 0, LEN, h, T, shade(col, 0.95 + n * 0.1));
        put(0, h + 0.02, 0, LEN + (horizontal ? 0.02 : -0.002), 0.04, T + (horizontal ? 0.03 : 0.026), shade(col, 1.15));
        if (o.wall) wallTrim(put, h, LEN, T, col, _z, top, horizontal);
      }
  }
}

/** Повернути геометрію, додану після позиції from, навколо вертикалі через (px, pz). */
function rotateSince(g: GeoBuilder, from: number, px: number, pz: number, a: number): void {
  const c = Math.cos(a);
  const sn = Math.sin(a);
  for (let i = from; i < g.positions.length; i += 3) {
    const dx = g.positions[i] - px;
    const dz = g.positions[i + 2] - pz;
    g.positions[i] = px + dx * c + dz * sn;
    g.positions[i + 2] = pz - dx * sn + dz * c;
    const nx = g.normals[i];
    const nz = g.normals[i + 2];
    g.normals[i] = nx * c + nz * sn;
    g.normals[i + 2] = -nx * sn + nz * c;
  }
}

/** Верхній поверх будівлі в цій клітинці (над стіною — дах або нічого). */
function isTopWall(map: MapState, x: number, y: number, z: number): boolean {
  if (z + 1 >= map.levels) return true;
  const up = map.cells[z + 1][y][x];
  return !up.floor || up.terrain === 'roof';
}

type PutFn = (a: number, yy: number, b: number, sa: number, sy: number, sb: number, c: RGB, alpha?: number) => void;

/** Деталі стіни: цоколь на першому поверсі, міжповерховий пояс, карниз під дахом. */
function wallTrim(put: PutFn, h: number, LEN: number, T: number, col: RGB, z: number, top: boolean, horizontal: boolean): void {
  const ext = horizontal ? 0.03 : -0.002;
  if (z === 0) put(0, 0.08, 0, LEN + ext, 0.16, T + 0.035, shade(col, 0.62)); // цоколь
  else put(0, 0.03, 0, LEN + ext, 0.05, T + 0.03, shade(col, 0.82)); // міжповерховий пояс
  if (top) {
    put(0, h - 0.05, 0, LEN + ext, 0.06, T + 0.05, shade(col, 1.08)); // карниз
    put(0, h - 0.1, 0, LEN + ext, 0.035, T + 0.025, shade(col, 0.9));
  }
}
