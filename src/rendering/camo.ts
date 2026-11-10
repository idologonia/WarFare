import { DynamicTexture, StandardMaterial, Texture, Color3, type Scene } from './babylon';

/** Палітри піксельного камуфляжу сторін: основний, плями, темні, світлі. */
export const CAMO: Record<string, string[]> = {
  blue: ['#59673f', '#3d4a2b', '#7d7b54', '#262c1c'],
  red: ['#8a7550', '#665236', '#a99369', '#433522'],
};

function hash(x: number, y: number, s: number): number {
  let h = (x * 374761393 + y * 668265263 + s * 982451653) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Гладкий шум для форм плям. */
function noise(x: number, y: number, s: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const sm = (t: number) => t * t * (3 - 2 * t);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  const u = sm(fx), v = sm(fy);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

/**
 * Текстура 256×256: піксельний камуфляж (клітинки 8 px) і біла ділянка в куті
 * для однотонних деталей (їхній колір задають вершини).
 */
export function camoMaterial(scene: Scene, side: string): StandardMaterial {
  const size = 256;
  const tex = new DynamicTexture(`camo_${side}`, { width: size, height: size }, scene, false, Texture.NEAREST_SAMPLINGMODE);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const pal = CAMO[side] ?? CAMO.blue;
  const px = 8;
  const seed = side === 'red' ? 7 : 3;
  for (let y = 0; y < size / px; y++)
    for (let x = 0; x < size / px; x++) {
      const n1 = noise(x / 5, y / 5, seed) * 0.7 + noise(x / 2, y / 2, seed + 1) * 0.3;
      const n2 = noise(x / 4 + 9, y / 4 + 3, seed + 2) * 0.75 + hash(x, y, seed) * 0.25;
      let c = pal[0];
      if (n1 > 0.58) c = pal[1];
      if (n2 > 0.66) c = pal[2];
      if (n1 < 0.3 && n2 < 0.45) c = pal[3];
      ctx.fillStyle = c;
      ctx.fillRect(x * px, y * px, px, px);
    }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, size - 16, 16, 16);
  ctx.fillRect(0, 0, 16, 16);
  tex.update(false);
  tex.wrapU = Texture.CLAMP_ADDRESSMODE;
  tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  const m = new StandardMaterial(`unitMat_${side}`, scene);
  m.diffuseTexture = tex;
  m.specularColor = new Color3(0.06, 0.06, 0.06);
  m.backFaceCulling = false;
  return m;
}
