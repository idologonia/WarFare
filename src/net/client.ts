import { DISCOVERY_TOPIC, NTFY_URL, type ClientMsg, type ServerMsg } from './protocol';

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

/** Знайти сервер автоматично: останнє оголошення сервера в ntfy за добу. */
export async function discoverServer(): Promise<string | null> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 6000);
    const r = await fetch(`${NTFY_URL}/${DISCOVERY_TOPIC}/json?poll=1&since=24h`, { cache: 'no-store', signal: ctl.signal });
    clearTimeout(t);
    let best: { url: string | null; online: boolean; t: number } | null = null;
    for (const line of (await r.text()).split('\n')) {
      try {
        const ev = JSON.parse(line) as { event: string; message: string };
        if (ev.event !== 'message') continue;
        const a = JSON.parse(ev.message) as { app: string; url: string | null; online: boolean; t: number };
        if (a.app === 'warfare-server' && (!best || a.t > best.t)) best = a;
      } catch {
        /* чуже повідомлення */
      }
    }
    return best?.online && best.url ? best.url : null;
  } catch {
    return null;
  }
}
