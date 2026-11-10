/**
 * Фонова музика: процедурний ембієнт на Web Audio (без файлів, працює офлайн).
 * Меню — спокійні акорди; бій — нижчий і напруженіший.
 */
export class Music {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private timer: number | null = null;
  private track: 'menu' | 'battle' = 'menu';
  volume = 0.4;

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      this.ctx = new AudioContext();
      this.gain = this.ctx.createGain();
      this.gain.gain.value = this.volume * 0.25;
      this.gain.connect(this.ctx.destination);
    } catch {
      return null;
    }
    return this.ctx;
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.gain) this.gain.gain.value = v * 0.25;
  }

  /** Запуск після першої взаємодії користувача (вимога браузерів). */
  private unlocked = false;

  /** Викликати з обробника першого жесту користувача. */
  unlock(): void {
    this.unlocked = true;
    this.play(this.track);
  }

  play(track: 'menu' | 'battle'): void {
    this.track = track;
    if (!this.unlocked) return;
    const ctx = this.ensure();
    if (!ctx) return;
    void ctx.resume();
    if (this.timer === null) this.loop();
  }

  private loop = () => {
    const ctx = this.ctx!;
    const menu = [[57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 55, 59]];
    const battle = [[45, 48, 52], [44, 47, 51], [41, 45, 48], [43, 46, 50]];
    const prog = this.track === 'menu' ? menu : battle;
    const dur = this.track === 'menu' ? 4 : 3;
    const t0 = ctx.currentTime + 0.05;
    prog.forEach((chord, i) => {
      for (const note of chord) this.tone(440 * Math.pow(2, (note - 69) / 12), t0 + i * dur, dur * 1.1, this.track === 'menu' ? 'triangle' : 'sawtooth');
      if (this.track === 'battle') for (let k = 0; k < 6; k++) this.tone(440 * Math.pow(2, (chord[0] - 12 - 69) / 12), t0 + i * dur + k * 0.5, 0.25, 'square', 0.5);
    });
    this.timer = window.setTimeout(this.loop, prog.length * dur * 1000 - 100);
  };

  private tone(freq: number, at: number, dur: number, type: OscillatorType, vol = 1): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = this.track === 'menu' ? 900 : 600;
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(0.12 * vol, at + Math.min(0.8, dur / 3));
    g.gain.linearRampToValueAtTime(0, at + dur);
    o.connect(f).connect(g).connect(this.gain!);
    o.start(at);
    o.stop(at + dur + 0.05);
  }
}
