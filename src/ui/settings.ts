export interface Settings {
  uiScale: number;
  fontScale: number;
  buttonSize: number;
  panelSide: 'left' | 'right';
  shadows: boolean;
  /** Пост-обробка: згладжування, світіння, тонування. */
  postfx: boolean;
  renderScale: number;
  engine: 'webgl' | 'webgpu';
  animSpeed: number;
  music: number;
}

const KEY = 'warfare.settings';
const DEFAULTS: Settings = {
  uiScale: 1,
  fontScale: 1,
  buttonSize: matchMedia('(pointer: coarse)').matches ? 40 : 38,
  panelSide: 'left',
  shadows: true,
  postfx: true,
  renderScale: 1,
  engine: 'webgl',
  animSpeed: 1,
  music: 0.4,
};

export function loadSettings(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* приватний режим — працюємо без збереження */
  }
}

export function applySettings(s: Settings): void {
  const r = document.documentElement.style;
  r.setProperty('--font-scale', String(s.fontScale * s.uiScale));
  r.setProperty('--btn', `${Math.round(s.buttonSize * s.uiScale)}px`);
  document.body.classList.toggle('right', s.panelSide === 'right');
}
