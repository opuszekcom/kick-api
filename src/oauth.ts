import { KickAuthError } from './errors.js';

export const OAUTH_URL = 'https://id.kick.com';

export interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
  fetch?: typeof fetch;
  oauthUrl?: string;
}

export interface AppToken {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface UserToken extends AppToken {
  refresh_token: string;
  scope: string;
}

export interface AuthorizationRequest {
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state: string;
  codeChallenge: string;
  oauthUrl?: string;
}

export interface Pkce {
  codeVerifier: string;
  codeChallenge: string;
}

async function postForm<T>({ fetch: fetchImpl = fetch, oauthUrl = OAUTH_URL }: Partial<OAuthCredentials>, path: string, form: Record<string, string>): Promise<T> {
  const response = await fetchImpl(`${oauthUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
  });
  const text = await response.text();
  const body = parseJson(text);
  if (!response.ok) throw new KickAuthError(response.status, body);
  return body as T;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Generates a PKCE code verifier and its S256 challenge. Keep the verifier until the code exchange. */
export async function createPkce(): Promise<Pkce> {
  const codeVerifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
  return { codeVerifier, codeChallenge: base64Url(new Uint8Array(digest)) };
}

/** URL that sends the user to Kick to approve your app. */
export function getAuthorizationUrl({ clientId, redirectUri, scopes, state, codeChallenge, oauthUrl = OAUTH_URL }: AuthorizationRequest): string {
  const url = new URL('/oauth/authorize', oauthUrl);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scopes.join(' '),
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
  }).toString();
  return url.toString();
}

/** Gets an app access token with the client credentials grant. */
export function getAppToken(credentials: OAuthCredentials): Promise<AppToken> {
  return postForm(credentials, '/oauth/token', {
    grant_type: 'client_credentials',
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
  });
}

/** Exchanges the authorization code from the redirect for a user token. */
export function exchangeCode(credentials: OAuthCredentials, { code, redirectUri, codeVerifier }: { code: string; redirectUri: string; codeVerifier: string }): Promise<UserToken> {
  return postForm(credentials, '/oauth/token', {
    grant_type: 'authorization_code',
    code,
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });
}

/** Gets a new user token with a refresh token. */
export function refreshUserToken(credentials: OAuthCredentials, refreshToken: string): Promise<UserToken> {
  return postForm(credentials, '/oauth/token', {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
  });
}

/** Revokes an access or refresh token. */
export async function revokeToken(options: Partial<OAuthCredentials>, token: string, tokenHintType?: 'access_token' | 'refresh_token'): Promise<void> {
  await postForm(options, '/oauth/revoke', { token, ...(tokenHintType && { token_hint_type: tokenHintType }) });
}
