import { Mesh, VertexData, type Scene, type StandardMaterial } from './babylon';

export type RGB = [number, number, number];

export function hex(c: string): RGB {
  const n = parseInt(c.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function shade(c: RGB, k: number): RGB {
  return [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)];
}

/** Детермінований «шум» для варіацій кольору плиток. */
export function hash2(x: number, y: number, z = 0): number {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Збирач геометрії з кольоровими вершинами: багато коробок → одна сітка (мало draw calls).
 * Стиль — пласкі грані й насичені кольори, як у ранніх ізометричних тактиках.
 */
export class GeoBuilder {
  positions: number[] = [];
  normals: number[] = [];
  colors: number[] = [];
  indices: number[] = [];
  uvs: number[] = [];
  /** Якщо задано — грані отримують UV для камуфляжної текстури (масштаб на одиницю світу). */
  camo: number | null = null;
  private camoSeed = 0.13;

  get empty(): boolean {
    return this.indices.length === 0;
  }

  /** Коробка з центром (cx, cy, cz) і розмірами; rotY — поворот навколо вертикалі. */
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, color: RGB, alpha = 1, rotY = 0): this {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const cos = Math.cos(rotY), sin = Math.sin(rotY);
    const faces: [number[], number[][]][] = [
      [[0, 1, 0], [[-hx, hy, -hz], [-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz]]],
      [[0, -1, 0], [[-hx, -hy, hz], [-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz]]],
      [[1, 0, 0], [[hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], [hx, -hy, hz]]],
      [[-1, 0, 0], [[-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz], [-hx, -hy, -hz]]],
      [[0, 0, 1], [[hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz], [-hx, -hy, hz]]],
      [[0, 0, -1], [[-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz], [hx, -hy, -hz]]],
    ];
    const camo = this.camo;
    for (const [n, verts] of faces) {
      const base = this.positions.length / 3;
      // Зсув візерунка для кожної грані, щоб плями не повторювались.
      this.camoSeed = (this.camoSeed * 9301 + 0.4927) % 1;
      const off = 0.1 + this.camoSeed * 0.08;
      // Легке «запечене» затінення граней для ретро-вигляду.
      const k = n[1] > 0 ? 1.0 : n[1] < 0 ? 0.55 : n[0] !== 0 ? 0.8 : 0.88;
      for (const [x, y, z] of verts) {
        this.positions.push(cx + x * cos + z * sin, cy + y, cz - x * sin + z * cos);
        this.normals.push(n[0] * cos + n[2] * sin, n[1], -n[0] * sin + n[2] * cos);
        this.colors.push(color[0] * k, color[1] * k, color[2] * k, alpha);
        if (camo === null) this.uvs.push(0.02, 0.02);
        else {
          // Проєкція на площину грані: дві осі, перпендикулярні нормалі.
          const [a, b] = n[0] !== 0 ? [z, y] : n[1] !== 0 ? [x, z] : [x, y];
          const ua = (a + (n[0] !== 0 ? hz : hx)) * camo;
          const vb = (b + (n[1] !== 0 ? hz : hy)) * camo;
          this.uvs.push(off + Math.min(0.8, ua), off + Math.min(0.8, vb));
        }
      }
      this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    return this;
  }

  /**
   * Призма вздовж локальної осі Z: переріз — многокутник (sides) в еліпсі w×h, довжина len.
   * rotX — нахил (тангаж), rotY — поворот. Пласкі грані для «рубленого», але не квадратного вигляду.
   */
  prism(cx: number, cy: number, cz: number, w: number, h: number, len: number, sides: number, color: RGB, rotX = 0, rotY = 0, alpha = 1): this {
    const cxr = Math.cos(rotX), sxr = Math.sin(rotX), cyr = Math.cos(rotY), syr = Math.sin(rotY);
    const tf = (x: number, y: number, z: number): [number, number, number] => {
      // Нахил навколо X, потім поворот навколо Y.
      const y1 = y * cxr - z * sxr;
      const z1 = y * sxr + z * cxr;
      return [x * cyr + z1 * syr, y1, -x * syr + z1 * cyr];
    };
    const ring: [number, number][] = [];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2 + Math.PI / sides;
      ring.push([(Math.cos(a) * w) / 2, (Math.sin(a) * h) / 2]);
    }
    const push = (pts: [number, number, number][], n: [number, number, number], k: number) => {
      const base = this.positions.length / 3;
      const nt = tf(n[0], n[1], n[2]);
      for (const [x, y, z] of pts) {
        const p = tf(x, y, z);
        this.positions.push(cx + p[0], cy + p[1], cz + p[2]);
        this.normals.push(nt[0], nt[1], nt[2]);
        this.colors.push(color[0] * k, color[1] * k, color[2] * k, alpha);
        this.uvs.push(0.02, 0.02);
      }
      for (let i = 1; i < pts.length - 1; i++) this.indices.push(base, base + i, base + i + 1);
    };
    const hz = len / 2;
    for (let i = 0; i < sides; i++) {
      const [x0, y0] = ring[i];
      const [x1, y1] = ring[(i + 1) % sides];
      const nx = (y1 - y0) * h;
      const ny = -(x1 - x0) * w;
      const nl = Math.hypot(nx, ny) || 1;
      const ny2 = ny / nl;
      const k = ny2 > 0.5 ? 1.0 : ny2 < -0.5 ? 0.6 : 0.82;
      push([[x0, y0, -hz], [x1, y1, -hz], [x1, y1, hz], [x0, y0, hz]], [nx / nl, ny2, 0], k);
    }
    push(ring.map(([x, y]) => [x, y, hz] as [number, number, number]), [0, 0, 1], 0.9);
    push(ring.map(([x, y]) => [x, y, -hz] as [number, number, number]).reverse(), [0, 0, -1], 0.7);
    return this;
  }

  build(name: string, scene: Scene, material: StandardMaterial): Mesh {
    const mesh = new Mesh(name, scene);
    const vd = new VertexData();
    vd.positions = this.positions;
    vd.normals = this.normals;
    vd.colors = this.colors;
    vd.indices = this.indices;
    vd.uvs = this.uvs;
    vd.applyToMesh(mesh);
    mesh.material = material;
    for (let i = 3; i < this.colors.length; i += 4)
      if (this.colors[i] < 1) {
        mesh.hasVertexAlpha = true;
        break;
      }
    return mesh;
  }
}
