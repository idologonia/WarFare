/** Процедурні звуки через WebAudio — без файлів. */
export type Sfx = 'shot' | 'burst' | 'boom' | 'glass' | 'click' | 'throw' | 'rocket' | 'drone' | 'clang' | 'engine' | 'fire';

let ctx: AudioContext | null = null;
let muted = false;
export const setMuted = (m: boolean) => (muted = m);
export const isMuted = () => muted;

function ac(): AudioContext | null {
  if (muted || typeof window === 'undefined' || !('AudioContext' in window)) return null;
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function noise(c: AudioContext, dur: number): AudioBufferSourceNode {
  const b = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * dur)), c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const n = c.createBufferSource();
  n.buffer = b;
  return n;
}

function burstNoise(c: AudioContext, t: number, dur: number, vol: number, type: BiquadFilterType, freq: number, q = 1) {
  const n = noise(c, dur);
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  n.connect(f).connect(g).connect(c.destination);
  n.start(t);
  n.stop(t + dur);
}

function tone(c: AudioContext, t: number, dur: number, vol: number, f0: number, f1: number, type: OscillatorType = 'sine') {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur);
}

export function sfx(kind: Sfx): void {
  const c = ac();
  if (!c) return;
  const t = c.currentTime;
  switch (kind) {
    case 'shot':
      burstNoise(c, t, 0.18, 0.5, 'lowpass', 2200);
      tone(c, t, 0.08, 0.3, 180, 60, 'square');
      break;
    case 'burst':
      for (let i = 0; i < 3; i++) {
        burstNoise(c, t + i * 0.09, 0.15, 0.45, 'lowpass', 2200);
        tone(c, t + i * 0.09, 0.07, 0.25, 170, 60, 'square');
      }
      break;
    case 'boom':
      burstNoise(c, t, 1.2, 0.9, 'lowpass', 500);
      tone(c, t, 0.6, 0.7, 90, 30);
      break;
    case 'glass':
      burstNoise(c, t, 0.35, 0.35, 'highpass', 4000);
      for (let i = 0; i < 4; i++) tone(c, t + i * 0.03, 0.2, 0.08, 2500 + Math.random() * 2500, 1800, 'triangle');
      break;
    case 'click':
      burstNoise(c, t, 0.03, 0.3, 'bandpass', 3000, 4);
      burstNoise(c, t + 0.12, 0.04, 0.3, 'bandpass', 2000, 4);
      break;
    case 'throw':
      burstNoise(c, t, 0.25, 0.15, 'bandpass', 800, 2);
      break;
    case 'rocket':
      burstNoise(c, t, 0.7, 0.5, 'bandpass', 1200, 0.7);
      tone(c, t, 0.3, 0.3, 120, 50, 'sawtooth');
      break;
    case 'drone':
      tone(c, t, 0.6, 0.07, 220, 240, 'sawtooth');
      tone(c, t, 0.6, 0.05, 330, 345, 'sawtooth');
      break;
    case 'clang':
      tone(c, t, 0.4, 0.3, 900, 600, 'triangle');
      burstNoise(c, t, 0.1, 0.3, 'highpass', 2500);
      break;
    case 'fire':
      burstNoise(c, t, 1.4, 0.35, 'lowpass', 900);
      for (let i = 0; i < 6; i++) burstNoise(c, t + Math.random() * 1.2, 0.04, 0.25, 'bandpass', 2500, 3);
      break;
    case 'engine':
      tone(c, t, 1.0, 0.18, 55, 70, 'sawtooth');
      burstNoise(c, t, 1.0, 0.12, 'lowpass', 300);
      break;
  }
}
