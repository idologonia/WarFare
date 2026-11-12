import { Mesh, VertexData, type Scene, type StandardMaterial } from './babylon';

export type RGB = [number, number, number];

export function hex(c: string): RGB {
  let h = c.replace('#', '');
  if (h.length === 3) h = h.split('').map((x) => x + x).join('');
  const n = parseInt(h, 16);
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
  /** Світові UV (масштаб повторень на одиницю): текстура деталей поверхні (surfaces.ts). */
  worldUV: number | null = null;
  /** Тайл атласу форми (camo.ts: tileRect); null — стара окрема текстура. */
  tile: number | null = null;
  private camoSeed = 0.13;

  /** UV візерунка (0..1 у межах візерунка) → координати в атласі з полями. */
  private camoUV(a: number, b: number): [number, number] {
    const fa = Math.min(0.97, Math.max(0.03, a));
    const fb = Math.min(0.97, Math.max(0.03, b));
    if (this.tile === null) return [fa, fb];
    const col = this.tile % 8;
    const row = Math.floor(this.tile / 8);
    return [(col + fa) / 8, (row + fb) / 4];
  }

  get empty(): boolean {
    return this.indices.length === 0;
  }

  /** Коробка з центром (cx, cy, cz) і розмірами; rotY — поворот навколо вертикалі. */
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, color: RGB, alpha = 1, rotY = 0, rotX = 0): this {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const cos = Math.cos(rotY), sin = Math.sin(rotY);
    const cx_ = Math.cos(rotX), sx_ = Math.sin(rotX);
    const px = (v: number[]): number[] => (rotX ? [v[0], v[1] * cx_ - v[2] * sx_, v[1] * sx_ + v[2] * cx_] : v);
    const faces: [number[], number[][]][] = [
      [[0, 1, 0], [[-hx, hy, -hz], [-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz]]],
      [[0, -1, 0], [[-hx, -hy, hz], [-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz]]],
      [[1, 0, 0], [[hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], [hx, -hy, hz]]],
      [[-1, 0, 0], [[-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz], [-hx, -hy, -hz]]],
      [[0, 0, 1], [[hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz], [-hx, -hy, hz]]],
      [[0, 0, -1], [[-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz], [hx, -hy, -hz]]],
    ];
    const camo = this.camo;
    for (const [n0, verts0] of faces) {
      const n = px(n0);
      const verts = verts0.map(px);
      const base = this.positions.length / 3;
      // Зсув візерунка для кожної грані, щоб плями не повторювались.
      this.camoSeed = (this.camoSeed * 9301 + 0.4927) % 1;
      const off = 0.1 + this.camoSeed * 0.08;
      // Легке «запечене» затінення граней для ретро-вигляду.
      const k = n[1] > 0.5 ? 1.0 : n[1] < -0.5 ? 0.55 : Math.abs(n[0]) > 0.5 ? 0.8 : 0.88 + Math.max(0, n[1]) * 0.12;
      const wn = [n[0] * cos + n[2] * sin, n[1], -n[0] * sin + n[2] * cos];
      for (const [x, y, z] of verts) {
        const wx = cx + x * cos + z * sin, wy = cy + y, wz = cz - x * sin + z * cos;
        this.positions.push(wx, wy, wz);
        this.normals.push(wn[0], wn[1], wn[2]);
        this.colors.push(color[0] * k, color[1] * k, color[2] * k, alpha);
        if (this.worldUV !== null && camo === null) {
          const S = this.worldUV;
          const ax = Math.abs(wn[0]), ay = Math.abs(wn[1]);
          if (ay > 0.6) this.uvs.push(wx * S, wz * S);
          else if (ax > Math.abs(wn[2])) this.uvs.push(wz * S, wy * S);
          else this.uvs.push(wx * S, wy * S);
        } else if (camo === null) this.uvs.push(0.02, 0.02);
        else {
          // Проєкція на площину грані: дві осі, перпендикулярні нормалі.
          const [a, b] = n0[0] !== 0 ? [z, y] : n0[1] !== 0 ? [x, z] : [x, y];
          const ua = (a + (n0[0] !== 0 ? hz : hx)) * camo;
          const vb = (b + (n0[1] !== 0 ? hz : hy)) * camo;
          const [uu, vv] = this.camoUV(off + Math.min(0.8, ua), off + Math.min(0.8, vb));
          this.uvs.push(uu, vv);
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
    const camo = this.camo;
    this.camoSeed = (this.camoSeed * 9301 + 0.4927) % 1;
    const off = 0.08 + this.camoSeed * 0.1;
    const per = (Math.PI * (w + h)) / 2;
    const push = (pts: [number, number, number][], n: [number, number, number], k: number, uv?: [number, number][]) => {
      const base = this.positions.length / 3;
      const nt = tf(n[0], n[1], n[2]);
      pts.forEach(([x, y, z], j) => {
        const p = tf(x, y, z);
        this.positions.push(cx + p[0], cy + p[1], cz + p[2]);
        this.normals.push(nt[0], nt[1], nt[2]);
        this.colors.push(color[0] * k, color[1] * k, color[2] * k, alpha);
        if (camo === null && this.worldUV !== null) {
          const S = this.worldUV;
          const wx = cx + p[0], wy = cy + p[1], wz = cz + p[2];
          if (Math.abs(nt[1]) > 0.6) this.uvs.push(wx * S, wz * S);
          else if (Math.abs(nt[0]) > Math.abs(nt[2])) this.uvs.push(wz * S, wy * S);
          else this.uvs.push(wx * S, wy * S);
        } else if (camo === null) this.uvs.push(0.02, 0.02);
        else {
          const [a, b] = uv ? uv[j] : [(x + w / 2) * camo, (y + h / 2) * camo];
          const [uu, vv] = this.camoUV(off + Math.min(0.8, a), off + Math.min(0.8, b));
          this.uvs.push(uu, vv);
        }
      });
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
      const ua = (i / sides) * per * (camo ?? 0);
      const ub = ((i + 1) / sides) * per * (camo ?? 0);
      const L = len * (camo ?? 0);
      push([[x0, y0, -hz], [x1, y1, -hz], [x1, y1, hz], [x0, y0, hz]], [nx / nl, ny2, 0], k, [[ua, 0], [ub, 0], [ub, L], [ua, L]]);
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
