/**
 * Процедурні звуки через WebAudio (без файлів), наближені до реальних:
 * постріл = різкий «тріск» + низький удар + відлуння; вибух = удар + довгий гул + відлуння;
 * гучність і «глухість» залежать від відстані до камери.
 */
export type Sfx =
  | 'shot' | 'burst' | 'rifle' | 'mg' | 'lmg' | 'dmr' | 'boom' | 'glass' | 'click' | 'throw' | 'rocket' | 'drone' | 'clang' | 'engine' | 'fire' | 'step' | 'thud';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let verb: ConvolverNode | null = null;
let verbIn: GainNode | null = null;
let muted = false;
let volume = 0.8;
export const setMuted = (m: boolean) => (muted = m);
export const isMuted = () => muted;
export const setSfxVolume = (v: number) => {
  volume = v;
  if (master) master.gain.value = v;
};

/** Відлуння «на відкритій місцевості»: згасаючий шум ~1.6 с. */
function impulse(c: AudioContext, sec: number, decay: number): AudioBuffer {
  const len = Math.floor(c.sampleRate * sec);
  const b = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      // кілька пізніх відбиттів (будівлі, ліс)
      const echo = Math.abs(t - 0.18) < 0.004 || Math.abs(t - 0.34) < 0.004 ? 2.5 : 1;
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * echo;
    }
  }
  return b;
}

function ac(): AudioContext | null {
  if (muted || typeof window === 'undefined' || !('AudioContext' in window)) return null;
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);
    verb = ctx.createConvolver();
    verb.buffer = impulse(ctx, 1.8, 3.2);
    verbIn = ctx.createGain();
    verbIn.gain.value = 0.35;
    verbIn.connect(verb).connect(master);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

const noiseCache = new Map<number, AudioBuffer>();
function noise(c: AudioContext, dur: number): AudioBufferSourceNode {
  const key = Math.round(dur * 100);
  let b = noiseCache.get(key);
  if (!b) {
    b = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * dur)), c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(key, b);
  }
  const n = c.createBufferSource();
  n.buffer = b;
  return n;
}

/** Вихід звуку: прямий сигнал (приглушений з відстанню) + відлуння (з відстанню більше). */
function out(c: AudioContext, dist: number): AudioNode {
  const near = Math.max(0.12, 1 - dist / 45);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 16000 * Math.pow(near, 1.6) + 900; // далекі звуки глухіші
  const dry = c.createGain();
  dry.gain.value = near;
  const wet = c.createGain();
  wet.gain.value = 0.5 + (1 - near) * 0.8;
  lp.connect(dry).connect(master!);
  lp.connect(wet).connect(verbIn!);
  return lp;
}

function burstNoise(c: AudioContext, dst: AudioNode, t: number, dur: number, vol: number, type: BiquadFilterType, freq: number, q = 1, attack = 0.001) {
  const n = noise(c, dur);
  n.playbackRate.value = 0.9 + Math.random() * 0.2;
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  n.connect(f).connect(g).connect(dst);
  n.start(t);
  n.stop(t + dur + 0.05);
}

function tone(c: AudioContext, dst: AudioNode, t: number, dur: number, vol: number, f0: number, f1: number, type: OscillatorType = 'sine') {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(dst);
  o.start(t);
  o.stop(t + dur + 0.05);
}

/** Один постріл: надзвуковий тріск + пороховий удар + механіка. power — калібр (1 — автомат). */
function gunshot(c: AudioContext, d: AudioNode, t: number, power: number) {
  burstNoise(c, d, t, 0.05, 0.9, 'highpass', 2500, 0.7); // тріск кулі
  burstNoise(c, d, t, 0.22 * power, 0.85, 'lowpass', 1400 / power, 0.8, 0.002); // дульна хвиля
  tone(c, d, t, 0.12 * power, 0.6, 140 / power, 45, 'sine'); // удар у груди
  burstNoise(c, d, t + 0.03, 0.04, 0.12, 'bandpass', 3500, 6); // затвор
}

export function sfx(kind: Sfx, dist = 12): void {
  const c = ac();
  if (!c) return;
  const t = c.currentTime + 0.01;
  const d = out(c, dist);
  switch (kind) {
    case 'shot':
    case 'rifle':
      gunshot(c, d, t, 1);
      break;
    case 'dmr':
      gunshot(c, d, t, 1.35);
      break;
    case 'lmg':
      gunshot(c, d, t, 1.2);
      break;
    case 'burst':
      for (let i = 0; i < 3; i++) gunshot(c, d, t + i * 0.095, 1);
      break;
    case 'mg':
      for (let i = 0; i < 5; i++) gunshot(c, d, t + i * 0.085, 1.2);
      break;
    case 'boom':
      burstNoise(c, d, t, 0.08, 1, 'highpass', 1800, 0.5); // ударна хвиля
      burstNoise(c, d, t, 1.8, 1, 'lowpass', 380, 0.7, 0.004); // гул
      tone(c, d, t, 0.9, 0.9, 70, 22, 'sine');
      for (let i = 0; i < 6; i++) burstNoise(c, d, t + 0.25 + Math.random() * 0.8, 0.05, 0.08, 'bandpass', 2000 + Math.random() * 2000, 4); // уламки, що падають
      break;
    case 'glass':
      burstNoise(c, d, t, 0.25, 0.4, 'highpass', 5000);
      for (let i = 0; i < 7; i++) tone(c, d, t + Math.random() * 0.25, 0.12 + Math.random() * 0.15, 0.05, 3000 + Math.random() * 4000, 2500, 'triangle');
      break;
    case 'click': // перезаряджання: магазин виймається, вставляється, затвор
      burstNoise(c, d, t, 0.03, 0.35, 'bandpass', 2200, 5);
      burstNoise(c, d, t + 0.35, 0.04, 0.45, 'bandpass', 1600, 5);
      burstNoise(c, d, t + 0.6, 0.05, 0.5, 'bandpass', 2800, 4);
      burstNoise(c, d, t + 0.66, 0.04, 0.35, 'bandpass', 1900, 4);
      break;
    case 'throw':
      burstNoise(c, d, t, 0.3, 0.12, 'bandpass', 600, 1.5, 0.08);
      break;
    case 'rocket':
      burstNoise(c, d, t, 0.12, 1, 'lowpass', 900, 0.7); // вистріл
      burstNoise(c, d, t + 0.05, 0.9, 0.5, 'bandpass', 1500, 0.8, 0.05); // реактивний двигун
      tone(c, d, t, 0.25, 0.6, 110, 40);
      break;
    case 'drone': {
      // Дзижчання пропелерів: кілька близьких частот із биттям.
      for (const f of [180, 186, 362, 371]) {
        const o = c.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f * (0.97 + Math.random() * 0.06);
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.03, t + 0.15);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
        const f2 = c.createBiquadFilter();
        f2.type = 'lowpass';
        f2.frequency.value = 2200;
        o.connect(f2).connect(g).connect(d);
        o.start(t);
        o.stop(t + 1.2);
      }
      break;
    }
    case 'clang':
      tone(c, d, t, 0.6, 0.35, 820, 760, 'triangle');
      tone(c, d, t, 0.4, 0.2, 1730, 1650, 'sine');
      burstNoise(c, d, t, 0.06, 0.5, 'highpass', 3000);
      break;
    case 'engine': {
      // Дизель: низький пульсуючий гул.
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 38;
      const lfo = c.createOscillator();
      lfo.frequency.value = 9;
      const lg = c.createGain();
      lg.gain.value = 6;
      lfo.connect(lg).connect(o.frequency);
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 280;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.3, t + 0.2);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
      o.connect(f).connect(g).connect(d);
      o.start(t);
      lfo.start(t);
      o.stop(t + 1.7);
      lfo.stop(t + 1.7);
      burstNoise(c, d, t, 1.5, 0.08, 'lowpass', 500, 0.7, 0.2);
      break;
    }
    case 'fire':
      burstNoise(c, d, t, 1.6, 0.3, 'lowpass', 700, 0.7, 0.2); // рев полум'я
      for (let i = 0; i < 10; i++) burstNoise(c, d, t + Math.random() * 1.4, 0.03, 0.2, 'bandpass', 1800 + Math.random() * 2500, 3); // тріск
      break;
    case 'step':
      burstNoise(c, d, t, 0.07, 0.12, 'lowpass', 500, 1, 0.005);
      burstNoise(c, d, t + 0.01, 0.04, 0.05, 'bandpass', 2500, 2);
      break;
    case 'thud':
      burstNoise(c, d, t, 0.25, 0.45, 'lowpass', 300, 1, 0.005);
      tone(c, d, t, 0.2, 0.3, 90, 50);
      break;
  }
}
