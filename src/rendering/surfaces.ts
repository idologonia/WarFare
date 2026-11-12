import { Color3, DynamicTexture, StandardMaterial, Texture, type Scene } from './babylon';

/**
 * Процедурні текстури деталей для карти. Сіра шкала (≈0.6–1.0) множиться на колір вершин,
 * тож відтінки об'єктів зберігаються, а поверх з'являється фактура: цегла, бетон, дошки, ґрунт тощо.
 * Текстура покриває 1×1 клітинку світу й повторюється (UV — проєкція світових координат).
 */
export type Surface = 'brick' | 'concrete' | 'wood' | 'roof' | 'ground' | 'foliage' | 'metal' | 'fabric' | 'floor';

function h(x: number, y: number, s: number): number {
  let v = (x * 374761393 + y * 668265263 + s * 982451653) | 0;
  v = Math.imul(v ^ (v >>> 13), 1274126177);
  return ((v ^ (v >>> 16)) >>> 0) / 4294967296;
}
function noise(x: number, y: number, s: number, period: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const w = (i: number) => ((i % period) + period) % period;
  const sm = (t: number) => t * t * (3 - 2 * t);
  const a = h(w(xi), w(yi), s), b = h(w(xi + 1), w(yi), s), c = h(w(xi), w(yi + 1), s), d = h(w(xi + 1), w(yi + 1), s);
  const u = sm(fx), v = sm(fy);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}
/** Безшовний шум (період = розмір текстури). */
const fbm = (x: number, y: number, s: number, N: number, base = 16) =>
  noise((x / N) * base, (y / N) * base, s, base) * 0.55 + noise((x / N) * base * 2, (y / N) * base * 2, s + 1, base * 2) * 0.3 + noise((x / N) * base * 4, (y / N) * base * 4, s + 2, base * 4) * 0.15;

function paint(kind: Surface, x: number, y: number, N: number): number {
  switch (kind) {
    case 'brick': {
      const rows = 14;
      const rh = N / rows;
      const r = Math.floor(y / rh);
      const bw = N / 4;
      const off = (r % 2) * bw * 0.5;
      const c = Math.floor((x + off) / bw);
      const inY = y - r * rh;
      const inX = (x + off) - c * bw;
      if (inY < 2 || inX < 2) return 0.62; // шви
      return 0.84 + h(c, r, 3) * 0.16 + (fbm(x, y, 4, N, 32) - 0.5) * 0.12;
    }
    case 'concrete': {
      let v = 0.86 + (fbm(x, y, 11, N, 8) - 0.5) * 0.22 + (h(x, y, 12) - 0.5) * 0.08;
      if (x % (N / 2) < 2 || y % (N / 2) < 2) v -= 0.18; // шви плит
      if (fbm(x, y, 13, N, 4) > 0.68) v -= 0.1; // патьоки
      return v;
    }
    case 'wood': {
      const pw = N / 5;
      const p = Math.floor(y / pw);
      const inY = y - p * pw;
      if (inY < 2) return 0.55;
      const grain = Math.sin((x / N) * 40 + Math.sin((y / N) * 30 + p) * 2 + p * 7) * 0.06;
      return 0.85 + h(p, 1, 21) * 0.12 + grain + (h(x, y, 22) - 0.5) * 0.05;
    }
    case 'floor': {
      const pw = N / 6;
      const p = Math.floor(x / pw);
      if (x - p * pw < 2) return 0.6;
      return 0.86 + h(p, 2, 31) * 0.12 + Math.sin((y / N) * 50 + p * 3) * 0.04;
    }
    case 'roof': {
      const sw = N / 10;
      const st = Math.floor(y / sw);
      const inY = y - st * sw;
      return (inY < 3 ? 0.68 : 0.9) + (fbm(x, y, 41, N, 8) - 0.5) * 0.18 + h(st, Math.floor(x / (N / 6)), 42) * 0.06;
    }
    case 'ground': {
      let v = 0.88 + (fbm(x, y, 51, N, 6) - 0.5) * 0.3;
      if (h(x >> 2, y >> 2, 52) > 0.97) v -= 0.25; // камінці / грудки
      return v + (h(x, y, 53) - 0.5) * 0.1;
    }
    case 'foliage': {
      const v = fbm(x, y, 61, N, 24);
      return 0.7 + v * 0.42 + (h(x >> 1, y >> 1, 62) > 0.9 ? 0.12 : 0);
    }
    case 'metal': {
      // Гофрований профіль (контейнери) + іржаві плями.
      const ridge = Math.abs(Math.sin((x / N) * Math.PI * 14));
      let v = 0.78 + ridge * 0.22;
      if (fbm(x, y, 71, N, 6) > 0.66) v -= 0.15;
      return v;
    }
    case 'fabric': {
      const weave = ((x >> 1) + (y >> 1)) % 2 ? 0.05 : -0.05;
      return 0.86 + weave + (fbm(x, y, 81, N, 12) - 0.5) * 0.18;
    }
  }
}

const cache = new WeakMap<Scene, Map<Surface, StandardMaterial>>();

export function surfaceMaterial(scene: Scene, kind: Surface, alpha = 1): StandardMaterial {
  let per = cache.get(scene);
  if (!per) cache.set(scene, (per = new Map()));
  const hit = per.get(kind);
  if (hit && alpha === 1) return hit;
  const N = 256;
  const tex = new DynamicTexture(`surf_${kind}`, { width: N, height: N }, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const img = ctx.createImageData(N, N);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const v = Math.max(0, Math.min(1, paint(kind, x, y, N))) * 255;
      const i = (y * N + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  tex.update(true);
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.anisotropicFilteringLevel = 4;
  const m = new StandardMaterial(`surfMat_${kind}`, scene);
  m.diffuseTexture = tex;
  m.specularColor = kind === 'metal' ? new Color3(0.12, 0.12, 0.12) : new Color3(0.04, 0.04, 0.04);
  m.backFaceCulling = false;
  per.set(kind, m);
  return m;
}

/** Масштаб повторення текстури (разів на клітинку). */
export const SURFACE_SCALE: Record<Surface, number> = { brick: 1, concrete: 0.5, wood: 1, roof: 1, ground: 0.5, foliage: 1.5, metal: 1, fabric: 2, floor: 1 };

/** Матеріал об'єкта → поверхня. */
export function surfaceOf(material: string, id: string): Surface | null {
  if (id.startsWith('tree') || id === 'bush') return 'foliage';
  switch (material) {
    case 'brick': return 'brick';
    case 'concrete': return 'concrete';
    case 'wood': return 'wood';
    case 'metal': return 'metal';
    case 'sandbag': return 'fabric';
    case 'earth': return 'ground';
    case 'foliage': return 'foliage';
  }
  return null;
}
