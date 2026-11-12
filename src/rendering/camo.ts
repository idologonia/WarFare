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

const put = (img: ImageData, size: number, x: number, y: number, c: number[], grain = 8) => {
  const i = (y * size + x) * 4;
  const g = (hash(x, y, 77) - 0.5) * grain;
  img.data[i] = c[0] + g;
  img.data[i + 1] = c[1] + g;
  img.data[i + 2] = c[2] + g;
  img.data[i + 3] = 255;
};

/** «Мох»: оливкова основа з темно-зеленими й коричневими розмитими плямами. */
function drawMoss(img: ImageData, size: number): void {
  const base = rgb('#6f6c4a'), dk = rgb('#3f4630'), br = rgb('#5b4a33'), lt = rgb('#8d8a62');
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const n1 = fbm(x / 26, y / 26, 21), n2 = fbm(x / 18 + 3, y / 18, 22), n3 = fbm(x / 12, y / 12 + 5, 23);
      let c = base;
      if (n3 > 0.62) c = lt;
      if (n1 > 0.58) c = dk;
      if (n2 > 0.66) c = br;
      put(img, size, x, y, c);
    }
}

/** «Флора»: вертикальні хвилясті смуги — світло-зелена основа, темно-зелені й коричневі смуги. */
function drawFlora(img: ImageData, size: number): void {
  const base = rgb('#8a9a6a'), dk = rgb('#3f5a35'), br = rgb('#6d5a3b');
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const wave = x + Math.sin(y / 14 + fbm(x / 30, y / 40, 31) * 3) * 6;
      const b1 = fbm(wave / 9, y / 70, 32);
      const b2 = fbm(wave / 7 + 11, y / 60, 33);
      let c = base;
      if (b1 > 0.56) c = dk;
      if (b2 > 0.63) c = br;
      put(img, size, x, y, c);
    }
}

/** «Гірка»: однотонна хакі-олива з темнішими накладками й грубою тканиною. */
function drawGorka(img: ImageData, size: number): void {
  const base = rgb('#7a7253'), patch = rgb('#5f5a40');
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const p = fbm(x / 40, y / 40, 41) > 0.6 ? patch : base;
      put(img, size, x, y, p, 18);
    }
}

/** «Березка» (КЛМК): світла хакі-зелена основа з дрібними темно-зеленими «листочками». */
function drawBerezka(img: ImageData, size: number): void {
  const base = rgb('#a7ad84'), leaf = rgb('#5d6b3e'), dk = rgb('#46512f');
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const n = fbm(x / 6, y / 11, 51) + (hash(x >> 1, y >> 2, 52) - 0.5) * 0.25;
      const big = fbm(x / 34, y / 34, 53);
      let c = base;
      if (n > 0.6) c = leaf;
      if (n > 0.6 && big > 0.6) c = dk;
      put(img, size, x, y, c, 6);
    }
}

/** «Бутан» / ТТсКО: чотириколірні чіткі плями — світло-зелений, коричневий, темно-зелений, чорний. */
function drawTtsko(img: ImageData, size: number): void {
  const base = rgb('#8d9a5e'), br = rgb('#6b4f35'), dg = rgb('#3d4a2c'), bk = rgb('#23231f');
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const n1 = fbm(x / 22, y / 15, 61), n2 = fbm(x / 18 + 9, y / 14, 62), n3 = fbm(x / 12, y / 10 + 4, 63);
      let c = base;
      if (n1 > 0.55) c = br;
      if (n2 > 0.6) c = dg;
      if (n3 > 0.7) c = bk;
      put(img, size, x, y, c, 5);
    }
}

/** Однотонна тканина з фактурою (афганка, цивільний одяг). twill — діагональне плетіння (джинс). */
function drawPlain(img: ImageData, size: number, hexc: string, grain = 14, twill = false, stripes?: string): void {
  const c0 = rgb(hexc);
  const st = stripes ? rgb(stripes) : null;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let k = 1 + (fbm(x / 50, y / 50, 71) - 0.5) * 0.12;
      if (twill) k += ((x + y) % 4 < 2 ? 0.05 : -0.05) + (hash(x, y, 72) - 0.5) * 0.08;
      let c = [c0[0] * k, c0[1] * k, c0[2] * k];
      // Лампаси спортивного костюма: дві світлі смуги.
      if (st && (Math.abs((x % 128) - 20) < 3 || Math.abs((x % 128) - 30) < 3)) c = st;
      put(img, size, x, y, c, grain);
    }
}

/**
 * Атлас форми: 8×2 унікальних тайлів по 256 px (+ дзеркальні 2 нижні рядки — щоб не залежати
 * від перевертання текстури). Тайл 0 — білий (однотонні деталі, колір у вершинах).
 */
export const UNIFORMS = ['white', 'multicam', 'emr', 'moss', 'flora', 'gorka', 'berezka', 'ttsko', 'afghanka', 'denim', 'black', 'tracksuit', 'civkhaki', 'olive', 'hoodie', 'brownjacket'] as const;
export type UniformId = (typeof UNIFORMS)[number];
export const UNIFORM_NAMES: Record<string, string> = {
  multicam: 'Мультикам', emr: 'Ратник (цифра)', moss: 'Мох', flora: 'Флора', gorka: 'Гірка', berezka: 'Березка', ttsko: 'Бутан (ТТсКО)', afghanka: 'Афганка',
  denim: 'Джинси', black: 'Чорна куртка', tracksuit: 'Спортивний костюм', civkhaki: 'Цивільне хакі', olive: 'Олива', hoodie: 'Худі', brownjacket: 'Коричнева куртка',
};
export const uniformTile = (id: string): number => Math.max(0, UNIFORMS.indexOf(id as UniformId));

function drawTile(id: UniformId, img: ImageData, size: number): void {
  switch (id) {
    case 'white': for (let i = 0; i < img.data.length; i++) img.data[i] = 255; return;
    case 'multicam': return drawMulticam(img, size);
    case 'emr': return drawRatnik(img, size);
    case 'moss': return drawMoss(img, size);
    case 'flora': return drawFlora(img, size);
    case 'gorka': return drawGorka(img, size);
    case 'berezka': return drawBerezka(img, size);
    case 'ttsko': return drawTtsko(img, size);
    case 'afghanka': return drawPlain(img, size, '#a2976a', 12);
    case 'denim': return drawPlain(img, size, '#3e5677', 10, true);
    case 'black': return drawPlain(img, size, '#26272a', 10);
    case 'tracksuit': return drawPlain(img, size, '#1f2b4d', 8, false, '#d8d8d8');
    case 'civkhaki': return drawPlain(img, size, '#8b7f60', 12);
    case 'olive': return drawPlain(img, size, '#5d6340', 12);
    case 'hoodie': return drawPlain(img, size, '#5b5c61', 14);
    case 'brownjacket': return drawPlain(img, size, '#5c4231', 12);
  }
}

/** Атласний матеріал форми (один на сцену для всіх бійців і техніки). */
export function uniformAtlas(scene: Scene): StandardMaterial {
  let perScene = cache.get(scene);
  if (!perScene) cache.set(scene, (perScene = new Map()));
  const hit = perScene.get('__atlas');
  if (hit) return hit;
  const T = 256;
  const tex = new DynamicTexture('uniformAtlas', { width: T * 8, height: T * 4 }, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  UNIFORMS.forEach((id, i) => {
    const img = ctx.createImageData(T, T);
    drawTile(id, img, T);
    const col = i % 8;
    const row = Math.floor(i / 8);
    ctx.putImageData(img, col * T, row * T); // ряди 0–1
    ctx.putImageData(img, col * T, (3 - row) * T); // дзеркально 2–3
  });
  tex.update(false);
  tex.wrapU = Texture.CLAMP_ADDRESSMODE;
  tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  const m = new StandardMaterial('uniformAtlasMat', scene);
  m.diffuseTexture = tex;
  m.specularColor = new Color3(0.05, 0.05, 0.05);
  m.emissiveColor = new Color3(0.1, 0.1, 0.1);
  m.backFaceCulling = false;
  perScene.set('__atlas', m);
  return m;
}

/** UV-прямокутник тайла атласу: [u0, v0, du, dv]. Ряд 0/1 у UV — дзеркальний, тож байдуже на перевертання. */
export function tileRect(tile: number): [number, number, number, number] {
  const col = tile % 8;
  const row = Math.floor(tile / 8);
  return [col / 8, row / 4, 1 / 8, 1 / 4];
}

/** Камуфляж за фракцією (null — за стороною: сині — мультикам, червоні — цифра). */
export const camoFor = (camo: string | null | undefined, side: string): string => camo ?? (side === 'red' ? 'emr' : 'multicam');


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
  const key = side === 'red' ? 'emr' : side === 'blue' ? 'multicam' : side;
  const pixel = key === 'emr';
  const tex = new DynamicTexture(`camo_${side}`, { width: size, height: size }, scene, false, pixel ? Texture.NEAREST_SAMPLINGMODE : Texture.TRILINEAR_SAMPLINGMODE);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const img = ctx.createImageData(size, size);
  if (key === 'emr') drawRatnik(img, size);
  else if (key === 'moss') drawMoss(img, size);
  else if (key === 'flora') drawFlora(img, size);
  else if (key === 'gorka') drawGorka(img, size);
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
  m.emissiveColor = new Color3(0.1, 0.1, 0.1); // бійці не тонуть у тінях
  m.backFaceCulling = false;
  perScene.set(side, m);
  return m;
}

/** Назва камуфляжу сторони (для інтерфейсу). */
export const CAMO_NAMES: Record<string, string> = { blue: 'Мультикам', red: 'Ратник (цифра)', multicam: 'Мультикам', emr: 'Ратник (цифра)', moss: 'Мох', flora: 'Флора', gorka: 'Гірка' };
