import { afterEach, describe, expect, it, vi } from 'vitest';
import { discoverServer } from '@/net/client';

const line = (m: object) => JSON.stringify({ event: 'message', message: JSON.stringify(m) });

describe('пошук сервера', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('бере найсвіжіше оголошення; офлайн — null', async () => {
    const body = [line({ app: 'warfare-server', url: 'https://a.trycloudflare.com', online: true, t: 1 }), line({ app: 'other', url: 'x', online: true, t: 9 }), line({ app: 'warfare-server', url: 'https://b.trycloudflare.com', online: true, t: 5 })].join('\n');
    vi.stubGlobal('fetch', async () => ({ text: async () => body }));
    expect(await discoverServer()).toBe('https://b.trycloudflare.com');
    const off = body + '\n' + line({ app: 'warfare-server', url: null, online: false, t: 7 });
    vi.stubGlobal('fetch', async () => ({ text: async () => off }));
    expect(await discoverServer()).toBeNull();
  });
});
