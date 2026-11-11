import { content, objectDef, terrainDef } from '@/content';
import { cellKey, type Cell } from '@/core/grid';
import type { EdgeSide, MapObjectDefinition, MapState } from '@/game/types';
import { Color3, StandardMaterial, Vector3, type Mesh, type Scene } from './babylon';
import { GeoBuilder, hash2, hex, shade, type RGB } from './geo';

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
      g.box(cx - 0.12, b + 0.18, cz + 0.05, 0.55, 0.36, 0.5, shade(col, 0.95 + n * 0.2));
      g.box(cx + 0.15, b + 0.28, cz - 0.1, 0.45, 0.4, 0.45, shade(col, 1.1));
      g.box(cx, b + 0.5, cz, 0.3, 0.2, 0.3, shade(col, 1.2));
      break;
    case 'tree':
    case 'tree_damaged': {
      g.box(cx, b + 0.55, cz, 0.22, 1.1, 0.22, col);
      const leaf: RGB = o.id === 'tree' ? [0.22, 0.42, 0.14] : [0.3, 0.36, 0.15];
      const s = o.id === 'tree' ? 1 : 0.7;
      g.box(cx, b + 1.35, cz, 0.95 * s, 0.6, 0.95 * s, shade(leaf, 0.9 + n * 0.2));
      g.box(cx + 0.1, b + 1.8, cz - 0.05, 0.7 * s, 0.45, 0.7 * s, shade(leaf, 1.1));
      g.box(cx - 0.05, b + 2.15, cz, 0.4 * s, 0.3, 0.4 * s, shade(leaf, 1.25));
      break;
    }
    case 'stump':
      g.box(cx, b + h / 2, cz, 0.26, h, 0.26, col);
      break;
    case 'sandbags':
    case 'sandbags_damaged': {
      const rows = o.id === 'sandbags' ? 3 : 2;
      for (let r = 0; r < rows; r++)
        for (let i = 0; i < 3; i++)
          g.box(cx - 0.31 + i * 0.31 + (r % 2) * 0.1 - 0.05, b + 0.1 + r * (h / rows), cz + (hash2(x + i, y + r) - 0.5) * 0.06, 0.3, h / rows - 0.02, 0.62, shade(col, 0.92 + hash2(i, r, x) * 0.18));
      break;
    }
    case 'fence':
      for (const dx of [-0.4, 0, 0.4]) g.box(cx + dx, b + h / 2 + 0.05, cz, 0.08, h + 0.1, 0.08, shade(col, 0.8));
      g.box(cx, b + h * 0.35, cz, 1, 0.1, 0.05, col);
      g.box(cx, b + h * 0.8, cz, 1, 0.1, 0.05, col);
      break;
    case 'crates':
      g.box(cx - 0.15, b + 0.2, cz + 0.1, 0.5, 0.4, 0.5, col);
      g.box(cx + 0.2, b + 0.18, cz - 0.15, 0.42, 0.36, 0.42, shade(col, 1.1));
      g.box(cx - 0.1, b + 0.55, cz + 0.05, 0.36, 0.3, 0.36, shade(col, 0.9));
      break;
    case 'container':
    case 'container_damaged':
      g.box(cx, b + h / 2, cz, 1, h, 1, col);
      for (const dz of [-0.3, 0, 0.3]) g.box(cx, b + h / 2, cz + dz, 1.02, h * 0.95, 0.06, shade(col, 0.8));
      if (o.id === 'container_damaged') g.box(cx + 0.3, b + h * 0.6, cz + 0.51, 0.2, 0.15, 0.02, [0.1, 0.1, 0.1]);
      break;
    case 'scrap':
      g.box(cx - 0.15, b + 0.12, cz, 0.6, 0.24, 0.4, col);
      g.box(cx + 0.2, b + 0.25, cz + 0.1, 0.4, 0.3, 0.3, shade(col, 1.2));
      break;
    case 'earth_berm':
      g.box(cx, b + h / 2, cz, 1, h, 0.9, col);
      g.box(cx, b + h + 0.03, cz, 0.9, 0.06, 0.7, shade(col, 1.1));
      break;
    case 'brick_rubble':
    case 'concrete_rubble':
      for (let i = 0; i < 5; i++) {
        const a = hash2(x, y, i + 1);
        const c2 = hash2(y, x, i + 7);
        g.box(cx - 0.35 + a * 0.7, b + 0.08 + (i % 2) * 0.12, cz - 0.35 + c2 * 0.7, 0.25 + a * 0.15, 0.16, 0.25, shade(col, 0.85 + c2 * 0.3), 1, a * 3);
      }
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

  constructor(private scene: Scene, private map: MapState, private onMesh: (m: Mesh, receive: boolean) => void) {
    this.solid = makeMaterial(scene, 'solid');
    this.ghost = makeMaterial(scene, 'ghost', 0.22);
    this.glass = makeMaterial(scene, 'glass', 0.999);
    this.build();
  }

  private build(): void {
    const m = this.map;
    // Темна основа під картою — проміжки між плитками дають сітку.
    const bg = new GeoBuilder().box(m.width / 2, -0.2, -m.height / 2, m.width + 0.2, 0.36, m.height + 0.2, [0.16, 0.14, 0.11]);
    this.base = bg.build('base', this.scene, this.solid);
    this.onMesh(this.base, true);
    for (let z = 0; z < m.levels; z++) this.levelMeshes.push(this.buildLevel(z));
    for (let z = 0; z < m.levels; z++)
      for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) this.rebuildObject({ x, y, z });
  }

  private buildLevel(z: number): Mesh {
    const m = this.map;
    const L = LH();
      const g = new GeoBuilder();
      for (let y = 0; y < m.height; y++)
        for (let x = 0; x < m.width; x++) {
          const cell = m.cells[z][y][x];
          if (!cell.floor) continue;
          const t = terrainDef(cell.terrain);
          const n = hash2(x, y, z);
          const checker = (x + y) % 2 === 0 ? 1.0 : 0.94;
          const col = shade(hex(t.color), checker * (0.92 + n * 0.16));
          if (z === 0) {
            const top = cell.elevation * L;
            g.box(x + 0.5, (top - 0.02) / 2 + 0.0, -(y + 0.5), 0.96, top + 0.02, 0.96, col);
            if (cell.elevation > 0) g.box(x + 0.5, top / 2 - 0.01, -(y + 0.5), 1.0, top, 1.0, shade(col, 0.8));
          } else {
            g.box(x + 0.5, z * L - 0.06, -(y + 0.5), 1.0, 0.12, 1.0, col);
          }
          // Кущики трави й камінці на частині плиток — щоб земля не була пласкою.
          if (z === 0 && (cell.terrain === 'grass' || cell.terrain === 'dirt') && !cell.object) {
            const top = cell.elevation * L;
            const k = hash2(x * 7, y * 13, 5);
            if (k < 0.45) {
              const grass = cell.terrain === 'grass';
              for (let i = 0; i < (grass ? 3 : 1); i++) {
                const a = hash2(x, y, i + 11);
                const b = hash2(y, x, i + 17);
                const c2: RGB = grass ? shade(col, 1.04 + a * 0.08) : shade(col, 0.85);
                g.box(x + 0.15 + a * 0.7, top + (grass ? 0.05 : 0.03), -(y + 0.15 + b * 0.7), grass ? 0.06 : 0.09, grass ? 0.1 : 0.05, grass ? 0.06 : 0.08, c2);
              }
            }
          }
          if (cell.stairsUp) {
            for (let i = 0; i < 5; i++) g.box(x + 0.5, z * L + (i + 0.5) * (L / 5) / 2, -(y + 0.1 + i * 0.18), 0.8, (i + 1) * (L / 5), 0.18, shade([0.55, 0.45, 0.35], 0.9 + i * 0.04));
          }
        }
    const mesh = g.build(`level${z}`, this.scene, this.solid);
    this.onMesh(mesh, true);
    return mesh;
  }

  /** Перебудувати плитки поверху (після зміни місцевості в редакторі). */
  rebuildLevel(z: number): void {
    this.levelMeshes[z]?.dispose();
    this.levelMeshes[z] = this.buildLevel(z);
  }

  dispose(): void {
    this.base?.dispose();
    for (const m of this.levelMeshes) m.dispose();
    for (const o of this.objects.values()) o.mesh.dispose();
    this.objects.clear();
    this.levelMeshes = [];
  }

  rebuildObject(c: Cell): void {
    const key = cellKey(c);
    for (const k of [key, `e:${key}`, `eg:${key}`]) {
      const old = this.objects.get(k);
      if (old) {
        old.mesh.dispose();
        this.objects.delete(k);
      }
    }
    const cell = this.map.cells[c.z][c.y][c.x];
    const base = c.z + (c.z === 0 ? cell.elevation : 0);
    if (cell.object) {
      const o = objectDef(cell.object.defId);
      const g = new GeoBuilder();
      buildObject(g, o, c.x, c.y, c.z, base);
      const mesh = g.build(`obj_${key}`, this.scene, o.window ? this.glass : this.solid);
      if (cell.object.rot) {
        mesh.setPivotPoint(new Vector3(c.x + 0.5, 0, -(c.y + 0.5)));
        mesh.rotation.y = (cell.object.rot * Math.PI) / 2;
      }
      mesh.isPickable = false;
      this.onMesh(mesh, false);
      this.objects.set(key, { mesh, level: c.z, buildingId: cell.buildingId, wall: !!o.wall || o.id === 'parapet', glass: !!o.window });
    }
    if (cell.edges && Object.keys(cell.edges).length) {
      const g = new GeoBuilder();
      const gg = new GeoBuilder();
      let wall = false;
      let glass = false;
      let building = cell.buildingId;
      for (const side of Object.keys(cell.edges) as EdgeSide[]) {
        const e = cell.edges[side]!;
        const o = objectDef(e.defId);
        buildEdge(g, o, c.x, c.y, c.z, side, c.z, gg);
        if (o.wall || o.id === 'parapet') wall = true;
        if (o.window) glass = true;
        if (building === undefined) {
          const n = side === 'n' ? { x: c.x, y: c.y - 1 } : side === 'w' ? { x: c.x - 1, y: c.y } : null;
          if (n && n.x >= 0 && n.y >= 0) building = this.map.cells[c.z][n.y][n.x].buildingId;
        }
      }
      const mesh = g.build(`edge_${key}`, this.scene, this.solid);
      mesh.isPickable = false;
      this.onMesh(mesh, false);
      this.objects.set(`e:${key}`, { mesh, level: c.z, buildingId: building, wall, glass: false });
      if (glass && gg.positions.length > 0) {
        const gm = gg.build(`edgeg_${key}`, this.scene, this.glass);
        gm.isPickable = false;
        this.onMesh(gm, false);
        this.objects.set(`eg:${key}`, { mesh: gm, level: c.z, buildingId: building, wall, glass: true });
      }
    }
  }

  /** Приховати поверхи вище viewLevel; стіни будівель з «нашими» бійцями — прозорі. */
  applyVisibility(viewLevel: number, transparentBuildings: Set<number>): void {
    this.levelMeshes.forEach((m, z) => m.setEnabled(z <= viewLevel));
    for (const info of this.objects.values()) {
      info.mesh.setEnabled(info.level <= viewLevel);
      // Стіни не робимо прозорими: огляд усередину — поворотом камери й перемиканням поверхів.
      void transparentBuildings;
      info.mesh.material = info.glass ? this.glass : this.solid;
    }
  }
}

/**
 * Тонкий об'єкт уздовж межі клітинки. Будується в локальних координатах:
 * a — уздовж межі (−0.5..0.5), b — поперек (товщина), y — висота.
 */
function buildEdge(g: GeoBuilder, o: MapObjectDefinition, x: number, y: number, _z: number, side: EdgeSide, base: number, gGlass: GeoBuilder = g): void {
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
          put(-0.33 + i * 0.33 + (r % 2) * 0.08 - 0.04, 0.08 + r * (h / rows), (hash2(x + i, y + r) - 0.5) * 0.04, 0.32, h / rows - 0.02, 0.3, shade(col, 0.92 + hash2(i, r, x) * 0.18));
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
        if (o.material === 'brick') for (let r = 1; r < 5; r++) put(0, (h * r) / 5, 0, LEN - 0.002, 0.025, T + 0.012, shade(col, 0.75));
        put(0, h + 0.02, 0, LEN + (horizontal ? 0.02 : -0.002), 0.04, T + (horizontal ? 0.03 : 0.026), shade(col, 1.15));
      }
  }
}
