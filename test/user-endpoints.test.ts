import { describe, expect, it } from 'vitest';
import { KickClient } from '../src/index.js';

type Reply = { status?: number; body?: unknown } | Error;

function userClient(reply: (url: URL, init: RequestInit) => Reply, options: { timeoutMs?: number } = {}) {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const fetchImpl = (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    const result = reply(url, init);
    if (result instanceof Error) throw result;
    const { status = 200, body = { data: {}, message: 'OK' } } = result;
    return new Response(status === 204 ? null : JSON.stringify(body), { status });
  }) as typeof fetch;

  const kick = new KickClient({ userToken: async () => 'user-token', fetch: fetchImpl, maxRetries: 2, ...options });
  return { kick, calls };
}

const bodyOf = (init: RequestInit) => JSON.parse(String(init.body));

describe('user endpoints', () => {
  it('sends chat messages with the user token', async () => {
    const { kick, calls } = userClient(() => ({ body: { data: { is_sent: true, message_id: 'm1' }, message: 'OK' } }));
    const sent = await kick.chat.send({ content: 'Hello chat', type: 'user', broadcaster_user_id: 42 });

    expect(sent).toEqual({ is_sent: true, message_id: 'm1' });
    expect(calls[0]!.init.method).toBe('POST');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer user-token');
    expect(bodyOf(calls[0]!.init)).toEqual({ content: 'Hello chat', type: 'user', broadcaster_user_id: 42 });
  });

  it('never resends a chat message after a dropped connection', async () => {
    const { kick, calls } = userClient(() => new TypeError('fetch failed'));
    await expect(kick.chat.send({ content: 'Once', type: 'bot' })).rejects.toThrow('fetch failed');
    expect(calls).toHaveLength(1);
  });

  it('retries reads after a temporary Kick error', async () => {
    let attempts = 0;
    const { kick } = userClient(() => {
      attempts += 1;
      return attempts < 2 ? { status: 503, body: { message: 'Service Unavailable' } } : { body: { data: [], message: 'OK' } };
    });

    await expect(kick.rewards.list()).resolves.toEqual([]);
    expect(attempts).toBe(2);
  });

  it('gives up on a request that takes longer than the timeout', async () => {
    const { kick } = userClient(() => new DOMException('The operation was aborted due to timeout', 'TimeoutError'), { timeoutMs: 5 });
    await expect(kick.kicks.leaderboard(5)).rejects.toThrow(/timeout/);
  });

  it('bans, times out and unbans with the documented bodies', async () => {
    const { kick, calls } = userClient(() => ({ body: { data: {}, message: 'OK' } }));
    await kick.moderation.ban({ broadcaster_user_id: 1, user_id: 2, duration: 10, reason: 'spam' });
    await kick.moderation.unban({ broadcaster_user_id: 1, user_id: 2 });

    expect(calls.map(({ init }) => init.method)).toEqual(['POST', 'DELETE']);
    expect(bodyOf(calls[0]!.init)).toEqual({ broadcaster_user_id: 1, user_id: 2, duration: 10, reason: 'spam' });
    expect(bodyOf(calls[1]!.init)).toEqual({ broadcaster_user_id: 1, user_id: 2 });
  });

  it('accepts redemptions in batches of 25 and collects the failures', async () => {
    const { kick, calls } = userClient((url, init) => ({
      body: { data: bodyOf(init).ids.slice(0, 1).map((id: string) => ({ id, reason: 'NOT_PENDING' })), message: 'OK' },
    }));
    const ids = Array.from({ length: 30 }, (_, index) => `r${index}`);
    const failures = await kick.rewards.accept(ids);

    expect(calls.map(({ init }) => bodyOf(init).ids.length)).toEqual([25, 5]);
    expect(failures).toEqual([
      { id: 'r0', reason: 'NOT_PENDING' },
      { id: 'r25', reason: 'NOT_PENDING' },
    ]);
  });

  it('starts an ad break with a generated id', async () => {
    const { kick, calls } = userClient(() => ({ status: 202, body: { data: { id: 'x', remaining_ad_breaks: 2 }, message: 'OK' } }));
    await expect(kick.ads.startBreak(30)).resolves.toEqual({ id: 'x', remaining_ad_breaks: 2 });

    const body = bodyOf(calls[0]!.init);
    expect(body.break_duration_seconds).toBe(30);
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
