import { describe, expect, it } from 'vitest';
import { createPkce, getAuthorizationUrl, refreshUserToken } from '../src/index.js';

describe('oauth', () => {
  it('builds the authorization URL with PKCE', async () => {
    const { codeVerifier, codeChallenge } = await createPkce();
    const url = new URL(getAuthorizationUrl({ clientId: 'id', redirectUri: 'https://example.com/callback', scopes: ['user:read', 'channel:read'], state: 'xyz', codeChallenge }));

    expect(url.origin + url.pathname).toBe('https://id.kick.com/oauth/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'id',
      redirect_uri: 'https://example.com/callback',
      scope: 'user:read channel:read',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state: 'xyz',
    });

    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
    const expected = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(codeChallenge).toBe(expected);
  });

  it('sends refresh requests as a form and surfaces errors', async () => {
    let sent: URLSearchParams | undefined;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      sent = init.body as URLSearchParams;
      return new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Refresh token expired' }), { status: 400 });
    }) as unknown as typeof fetch;

    await expect(refreshUserToken({ clientId: 'id', clientSecret: 'secret', fetch: fetchImpl }, 'old')).rejects.toThrow('Refresh token expired');
    expect(sent?.get('grant_type')).toBe('refresh_token');
    expect(sent?.get('refresh_token')).toBe('old');
  });
});
