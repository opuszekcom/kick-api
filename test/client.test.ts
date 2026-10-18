import { describe, expect, it } from 'vitest';
import { KickApiError, KickClient } from '../src/index.js';

type Handler = (url: URL, init: RequestInit) => { status?: number; body?: unknown; headers?: Record<string, string> };

function mockFetch(handler: Handler) {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const fetchImpl = (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    const { status = 200, body = {}, headers = {} } = handler(url, init);
    return new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const token = { access_token: 'app-token', token_type: 'Bearer', expires_in: 3600 };

function client(handler: Handler) {
  const { fetchImpl, calls } = mockFetch((url, init) => (url.pathname === '/oauth/token' ? { body: token } : handler(url, init)));
  return { kick: new KickClient({ clientId: 'id', clientSecret: 'secret', fetch: fetchImpl, maxRetries: 2 }), calls };
}

describe('KickClient', () => {
  it('gets an app token once and sends it with every request', async () => {
    const { kick, calls } = client(() => ({ body: { data: [], message: 'OK' } }));
    await kick.channels.get({ slugs: ['some-channel'] });
    await kick.users.get([1]);

    expect(calls.filter(({ url }) => url.pathname === '/oauth/token')).toHaveLength(1);
    const apiCalls = calls.filter(({ url }) => url.hostname === 'api.kick.com');
    expect(apiCalls.map(({ init }) => (init.headers as Record<string, string>).Authorization)).toEqual(['Bearer app-token', 'Bearer app-token']);
  });

  it('splits long id lists into batches of 50 and repeats query params', async () => {
    const { kick, calls } = client((url) => ({ body: { data: url.searchParams.getAll('broadcaster_user_id').map((id) => ({ broadcaster_user_id: Number(id) })), message: 'OK' } }));
    const ids = Array.from({ length: 120 }, (_, index) => index + 1);
    const channels = await kick.channels.get({ broadcasterUserIds: ids });

    const apiCalls = calls.filter(({ url }) => url.pathname === '/public/v1/channels');
    expect(apiCalls.map(({ url }) => url.searchParams.getAll('broadcaster_user_id').length)).toEqual([50, 50, 20]);
    expect(channels).toHaveLength(120);
  });

  it('waits and retries when rate limited', async () => {
    let attempts = 0;
    const { kick } = client(() => {
      attempts += 1;
      return attempts === 1 ? { status: 429, headers: { 'retry-after': '0.01' } } : { body: { data: { total_count: 7 }, message: 'OK' } };
    });

    await expect(kick.livestreams.stats()).resolves.toEqual({ total_count: 7 });
    expect(attempts).toBe(2);
  });

  it('throws KickApiError with the status and message from Kick', async () => {
    const { kick } = client(() => ({ status: 404, body: { message: 'Category not found', data: null } }));
    const error = await kick.categories.get(999).catch((caught) => caught);

    expect(error).toBeInstanceOf(KickApiError);
    expect(error.status).toBe(404);
    expect(error.message).toContain('Category not found');
  });

  it('walks through every page with .all()', async () => {
    const pages: Record<string, { data: Array<{ id: string }>; next: string }> = {
      first: { data: [{ id: 'a' }, { id: 'b' }], next: 'c2' },
      c2: { data: [{ id: 'c' }], next: '' },
    };
    const { kick } = client((url) => {
      const page = pages[url.searchParams.get('cursor') ?? 'first']!;
      return { body: { data: page.data, message: 'OK', pagination: { next_cursor: page.next } } };
    });

    const ids: string[] = [];
    for await (const stream of kick.livestreams.all({ limit: 2 })) ids.push(stream.id);
    expect(ids).toEqual(['a', 'b', 'c']);
  });

  it('fetches the public key without a token and refuses user-only calls without a user token', async () => {
    const { kick, calls } = client(() => ({ body: { data: { public_key: 'PEM' }, message: 'OK' } }));

    await expect(kick.publicKey()).resolves.toBe('PEM');
    expect((calls.at(-1)!.init.headers as Record<string, string>).Authorization).toBeUndefined();
    await expect(kick.channels.update({ stream_title: 'Hi' })).rejects.toThrow(/user access token/);
  });

  it('sends event subscriptions as webhooks for the given broadcaster', async () => {
    const { kick, calls } = client(() => ({ body: { data: [{ name: 'livestream.status.updated', version: 1, subscription_id: 'sub_1' }], message: 'OK' } }));
    const [result] = await kick.events.subscribe({ broadcasterUserId: 42, events: [{ name: 'livestream.status.updated', version: 1 }] });

    expect(result?.subscription_id).toBe('sub_1');
    expect(JSON.parse(String(calls.at(-1)!.init.body))).toEqual({
      events: [{ name: 'livestream.status.updated', version: 1 }],
      method: 'webhook',
      broadcaster_user_id: 42,
    });
  });
});
