import type { ClientMsg, ServerMsg } from './protocol';

const KEY = 'warfare.server';

/** Адреса сервера: якщо гра відкрита з самого сервера — той самий адрес; інакше — збережена гравцем. */
export function serverUrl(): string {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) return saved;
  } catch {
    /* немає сховища */
  }
  return location.protocol.startsWith('http') && !location.hostname.endsWith('github.io') ? location.origin : '';
}

export function setServerUrl(url: string): void {
  try {
    if (url) localStorage.setItem(KEY, url.replace(/\/+$/, ''));
    else localStorage.removeItem(KEY);
  } catch {
    /* немає сховища */
  }
}

/** Перевірка, чи сервер онлайн. */
export async function checkServer(url = serverUrl()): Promise<{ ok: boolean; rooms?: number }> {
  if (!url) return { ok: false };
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 4000);
    const r = await fetch(`${url}/api/health`, { signal: ctl.signal });
    clearTimeout(t);
    const j = (await r.json()) as { ok: boolean; name: string; rooms: number };
    return { ok: j.ok && j.name === 'WarFare', rooms: j.rooms };
  } catch {
    return { ok: false };
  }
}

/** З'єднання з сервером. Обробники можна міняти (меню → бій). */
export class NetClient {
  private ws: WebSocket | null = null;
  onMessage: (m: ServerMsg) => void = () => {};
  onClose: () => void = () => {};

  constructor(public url: string) {}

  connect(): Promise<void> {
    return new Promise((ok, fail) => {
      const ws = new WebSocket(this.url.replace(/^http/, 'ws') + '/ws');
      ws.onopen = () => ok();
      ws.onerror = () => fail(new Error('Немає з’єднання з сервером'));
      ws.onmessage = (e) => this.onMessage(JSON.parse(String(e.data)) as ServerMsg);
      ws.onclose = () => this.onClose();
      this.ws = ws;
    });
  }

  send(m: ClientMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  get open(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  close(): void {
    this.onClose = () => {};
    this.ws?.close();
  }
}
