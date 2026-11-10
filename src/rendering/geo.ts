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
    for (const [n, verts] of faces) {
      const base = this.positions.length / 3;
      // Легке «запечене» затінення граней для ретро-вигляду.
      const k = n[1] > 0 ? 1.0 : n[1] < 0 ? 0.55 : n[0] !== 0 ? 0.8 : 0.88;
      for (const [x, y, z] of verts) {
        this.positions.push(cx + x * cos + z * sin, cy + y, cz - x * sin + z * cos);
        this.normals.push(n[0] * cos + n[2] * sin, n[1], -n[0] * sin + n[2] * cos);
        this.colors.push(color[0] * k, color[1] * k, color[2] * k, alpha);
      }
      this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    return this;
  }

  build(name: string, scene: Scene, material: StandardMaterial): Mesh {
    const mesh = new Mesh(name, scene);
    const vd = new VertexData();
    vd.positions = this.positions;
    vd.normals = this.normals;
    vd.colors = this.colors;
    vd.indices = this.indices;
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
