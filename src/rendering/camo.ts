import { DynamicTexture, StandardMaterial, Texture, Color3, type Scene } from './babylon';

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

const fbm = (x: number, y: number, s: number) => noise(x, y, s) * 0.6 + noise(x * 2.1, y * 2.1, s + 1) * 0.28 + noise(x * 4.3, y * 4.3, s + 2) * 0.12;

const rgb = (c: string) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];

/**
 * Мультикам (синя сторона): органічні плями з розмитими краями й «гілочками»
 * на пісочній основі — коричневий, оливковий, світлий, темні цятки.
 */
function drawMulticam(img: ImageData, size: number): void {
  const base = rgb('#b3a07a');
  const brown = rgb('#87694a');
  const green = rgb('#6b6c45');
  const light = rgb('#cfc19a');
  const dark = rgb('#4a3826');
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      // Деформація координат — плями неправильної форми.
      const wx = x / 38 + fbm(x / 60, y / 60, 9) * 1.4;
      const wy = y / 30 + fbm(x / 60 + 5, y / 60 + 3, 9) * 1.4;
      let c = base;
      const n1 = fbm(wx, wy, 1);
      const n2 = fbm(wx * 1.3 + 7, wy * 1.1 + 2, 2);
      const n3 = fbm(wx * 1.7 + 3, wy * 1.9 + 8, 3);
      if (n2 > 0.6) c = green;
      if (n1 > 0.62) c = brown;
      if (n3 > 0.7) c = light;
      // Дрібні темні «гілочки».
      const t = fbm(x / 9, y / 22, 4);
      if (t > 0.74 && n1 > 0.45) c = dark;
      const i = (y * size + x) * 4;
      // Легке зерно тканини.
      const grain = (hash(x, y, 5) - 0.5) * 10;
      img.data[i] = c[0] + grain;
      img.data[i + 1] = c[1] + grain;
      img.data[i + 2] = c[2] + grain;
      img.data[i + 3] = 255;
    }
}

/**
 * «Ратник» / російська цифра (червона сторона): піксельний візерунок —
 * світла сіро-олива, зелений, коричневий і чорні «пікселі» кластерами.
 */
function drawRatnik(img: ImageData, size: number): void {
  const base = rgb('#8f9370');
  const green = rgb('#5c6443');
  const brown = rgb('#5a4b35');
  const black = rgb('#262720');
  const px = 4;
  for (let y = 0; y < size; y += px)
    for (let x = 0; x < size; x += px) {
      const gx = x / px;
      const gy = y / px;
      let c = base;
      const n1 = fbm(gx / 7, gy / 9, 11);
      const n2 = fbm(gx / 5 + 4, gy / 6 + 1, 12) + (hash(gx, gy, 13) - 0.5) * 0.18;
      const n3 = fbm(gx / 3 + 9, gy / 4 + 6, 14) + (hash(gx, gy, 15) - 0.5) * 0.25;
      if (n1 > 0.5) c = green;
      if (n2 > 0.62) c = brown;
      if (n3 > 0.68 && n1 > 0.42) c = black;
      for (let yy = 0; yy < px; yy++)
        for (let xx = 0; xx < px; xx++) {
          const i = ((y + yy) * size + (x + xx)) * 4;
          img.data[i] = c[0];
          img.data[i + 1] = c[1];
          img.data[i + 2] = c[2];
          img.data[i + 3] = 255;
        }
    }
}

const cache = new WeakMap<Scene, Map<string, StandardMaterial>>();

/**
 * Текстура 256×256 з камуфляжем сторони і білими ділянками в кутах
 * для однотонних деталей (їхній колір задають вершини).
 */
export function camoMaterial(scene: Scene, side: string): StandardMaterial {
  let perScene = cache.get(scene);
  if (!perScene) cache.set(scene, (perScene = new Map()));
  const hit = perScene.get(side);
  if (hit) return hit;
  const size = 256;
  const pixel = side === 'red';
  const tex = new DynamicTexture(`camo_${side}`, { width: size, height: size }, scene, false, pixel ? Texture.NEAREST_SAMPLINGMODE : Texture.TRILINEAR_SAMPLINGMODE);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const img = ctx.createImageData(size, size);
  if (pixel) drawRatnik(img, size);
  else drawMulticam(img, size);
  ctx.putImageData(img, 0, 0);
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
  perScene.set(side, m);
  return m;
}

/** Назва камуфляжу сторони (для інтерфейсу). */
export const CAMO_NAMES: Record<string, string> = { blue: 'Мультикам', red: 'Ратник (цифра)' };
