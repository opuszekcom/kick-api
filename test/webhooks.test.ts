import { beforeAll, describe, expect, it } from 'vitest';
import { WebhookVerifier, parseWebhookEvent, verifyWebhookSignature } from '../src/index.js';

let privateKey: CryptoKey;
let publicKeyPem: string;

function toBase64(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  privateKey = pair.privateKey;
  const spki = toBase64(await crypto.subtle.exportKey('spki', pair.publicKey));
  publicKeyPem = `-----BEGIN PUBLIC KEY-----\n${spki.match(/.{1,64}/g)!.join('\n')}\n-----END PUBLIC KEY-----\n`;
});

async function signedRequest(body: string, timestamp = new Date().toISOString()) {
  const messageId = '01JABCDEF';
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(`${messageId}.${timestamp}.${body}`));
  return {
    'Kick-Event-Message-Id': messageId,
    'Kick-Event-Message-Timestamp': timestamp,
    'Kick-Event-Signature': toBase64(signature),
    'Kick-Event-Subscription-Id': '01JSUB',
    'Kick-Event-Type': 'livestream.status.updated',
    'Kick-Event-Version': '1',
  };
}

const body = JSON.stringify({ broadcaster: { user_id: 42, username: 'opuszek' }, is_live: true, title: 'Hello', started_at: '2026-10-18T12:00:00Z', ended_at: null });

describe('webhooks', () => {
  it('accepts a correctly signed webhook in any header casing', async () => {
    const headers = await signedRequest(body);
    const lowercased = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));

    await expect(verifyWebhookSignature({ headers, body, publicKey: publicKeyPem })).resolves.toBe(true);
    await expect(verifyWebhookSignature({ headers: new Headers(lowercased), body: new TextEncoder().encode(body), publicKey: publicKeyPem })).resolves.toBe(true);
  });

  it('rejects a tampered body, a missing signature and an old message', async () => {
    const headers = await signedRequest(body);
    await expect(verifyWebhookSignature({ headers, body: body.replace('Hello', 'Hacked'), publicKey: publicKeyPem })).resolves.toBe(false);
    await expect(verifyWebhookSignature({ headers: { ...headers, 'Kick-Event-Signature': undefined }, body, publicKey: publicKeyPem })).resolves.toBe(false);

    const old = await signedRequest(body, new Date(Date.now() - 60 * 60 * 1000).toISOString());
    await expect(verifyWebhookSignature({ headers: old, body, publicKey: publicKeyPem })).resolves.toBe(false);
  });

  it('parses the event into a typed object', async () => {
    const event = parseWebhookEvent(await signedRequest(body), body);

    expect(event.type).toBe('livestream.status.updated');
    if (event.type === 'livestream.status.updated') {
      expect(event.payload.is_live).toBe(true);
      expect(event.payload.broadcaster.user_id).toBe(42);
    }
    expect(event.subscriptionId).toBe('01JSUB');
  });

  it('WebhookVerifier fetches the public key once and returns the event', async () => {
    let keyRequests = 0;
    const verifier = new WebhookVerifier({
      fetch: (async () => {
        keyRequests += 1;
        return new Response(JSON.stringify({ data: { public_key: publicKeyPem }, message: 'OK' }));
      }) as typeof fetch,
    });

    const headers = await signedRequest(body);
    expect((await verifier.verify(headers, body))?.type).toBe('livestream.status.updated');
    expect(await verifier.verify(headers, body.replace('Hello', 'Hacked'))).toBeNull();
    expect(keyRequests).toBe(1);
  });
});
