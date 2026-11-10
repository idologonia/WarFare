/** Мінімальні помічники для DOM. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, unknown> = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'style') el.setAttribute('style', String(v));
    else if (k === 'html') el.innerHTML = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : document.createTextNode(c));
  return el;
}

export function btn(label: string, onClick: () => void, opts: { cls?: string; title?: string; disabled?: boolean; on?: boolean } = {}): HTMLButtonElement {
  return h('button', { class: [opts.cls, opts.on ? 'on' : ''].filter(Boolean).join(' '), title: opts.title, disabled: opts.disabled, onclick: onClick }, label);
}

export function bar(value: number, max: number, color: string): HTMLElement {
  const pct = Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100));
  return h('div', { class: 'bar' }, h('i', { style: `width:${pct}%;background:${color}` }));
}

export function modal(title: string, body: HTMLElement, onClose: () => void, extra: HTMLElement[] = []): HTMLElement {
  const back = h('div', { class: 'modal-back' });
  const close = () => {
    back.remove();
    onClose();
  };
  back.append(
    h('div', { class: 'modal panel' }, h('div', { class: 'head' }, h('h2', {}, title), h('div', { class: 'row' }, ...extra, btn('Закрити', close))), body),
  );
  back.addEventListener('pointerdown', (e) => {
    if (e.target === back) close();
  });
  return back;
}

export const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
