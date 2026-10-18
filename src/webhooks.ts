import { API_URL } from './client.js';
import type { KickWebhookEvent } from './events.js';

export type WebhookHeaders = Headers | Record<string, string | string[] | undefined>;
export type WebhookBody = string | Uint8Array | ArrayBuffer;

export interface VerifyOptions {
  headers: WebhookHeaders;
  body: WebhookBody;
  publicKey: string;
  maxAgeMs?: number;
  now?: number;
}

const DEFAULT_MAX_AGE_MS = 10 * 60 * 1000;
const KEY_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const PEM_PATTERN = /-----BEGIN PUBLIC KEY-----([\s\S]+?)-----END PUBLIC KEY-----/;

/** Reads a header from a Headers object or a plain object, ignoring case. */
export function readHeader(headers: WebhookHeaders, name: string): string | undefined {
  if (typeof (headers as Headers).get === 'function') return (headers as Headers).get(name) ?? undefined;

  const lower = name.toLowerCase();
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === lower)?.[1];
  return Array.isArray(entry) ? entry[0] : entry;
}

function toBytes(body: WebhookBody): Uint8Array {
  if (typeof body === 'string') return new TextEncoder().encode(body);
  return body instanceof Uint8Array ? body : new Uint8Array(body);
}

function toText(body: WebhookBody): string {
  return typeof body === 'string' ? body : new TextDecoder().decode(toBytes(body));
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const importedKeys = new Map<string, Promise<CryptoKey>>();

function importPublicKey(pem: string): Promise<CryptoKey> {
  let key = importedKeys.get(pem);
  if (!key) {
    const base64 = pem.match(PEM_PATTERN)?.[1]?.replace(/\s+/g, '');
    if (!base64) throw new TypeError('The public key must be a PEM "PUBLIC KEY"');
    key = crypto.subtle.importKey('spki', decodeBase64(base64), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    importedKeys.set(pem, key);
  }
  return key;
}

/** Checks the Kick signature and message age of a webhook. Pass the raw, unparsed body. */
export async function verifyWebhookSignature({ headers, body, publicKey, maxAgeMs = DEFAULT_MAX_AGE_MS, now = Date.now() }: VerifyOptions): Promise<boolean> {
  const messageId = readHeader(headers, 'kick-event-message-id');
  const timestamp = readHeader(headers, 'kick-event-message-timestamp');
  const signature = readHeader(headers, 'kick-event-signature');
  if (!messageId || !timestamp || !signature) return false;

  const age = now - Date.parse(timestamp);
  if (!(Math.abs(age) <= maxAgeMs)) return false;

  const prefix = new TextEncoder().encode(`${messageId}.${timestamp}.`);
  const payload = toBytes(body);
  const signed = new Uint8Array(prefix.length + payload.length);
  signed.set(prefix);
  signed.set(payload, prefix.length);

  try {
    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', await importPublicKey(publicKey), decodeBase64(signature), signed);
  } catch {
    return false;
  }
}

/** Turns webhook headers and body into a typed event. Does not verify the signature. */
export function parseWebhookEvent(headers: WebhookHeaders, body: WebhookBody): KickWebhookEvent {
  const type = readHeader(headers, 'kick-event-type');
  if (!type) throw new TypeError('Missing Kick-Event-Type header');

  return {
    type,
    version: readHeader(headers, 'kick-event-version') ?? '1',
    messageId: readHeader(headers, 'kick-event-message-id') ?? '',
    subscriptionId: readHeader(headers, 'kick-event-subscription-id') ?? '',
    timestamp: readHeader(headers, 'kick-event-message-timestamp') ?? '',
    payload: JSON.parse(toText(body)),
  } as KickWebhookEvent;
}

export interface WebhookVerifierOptions {
  fetch?: typeof fetch;
  apiUrl?: string;
  maxAgeMs?: number;
}

/** Verifies webhooks with Kick's public key, fetched and cached automatically. */
export class WebhookVerifier {
  private readonly options: WebhookVerifierOptions;
  private publicKey: Promise<string> | null = null;
  private publicKeyFetchedAt = 0;

  constructor(options: WebhookVerifierOptions = {}) {
    this.options = options;
  }

  /** Returns the typed event when the webhook is genuine, otherwise null. */
  async verify(headers: WebhookHeaders, body: WebhookBody): Promise<KickWebhookEvent | null> {
    const { maxAgeMs } = this.options;
    if (await verifyWebhookSignature({ headers, body, publicKey: await this.getPublicKey(), maxAgeMs })) return parseWebhookEvent(headers, body);

    if (Date.now() - this.publicKeyFetchedAt < KEY_REFRESH_INTERVAL_MS) return null;
    this.publicKey = null;
    if (await verifyWebhookSignature({ headers, body, publicKey: await this.getPublicKey(), maxAgeMs })) return parseWebhookEvent(headers, body);
    return null;
  }

  private getPublicKey(): Promise<string> {
    const { fetch: fetchImpl = fetch, apiUrl = API_URL } = this.options;
    if (!this.publicKey) this.publicKeyFetchedAt = Date.now();
    this.publicKey ??= fetchImpl(`${apiUrl}/public/v1/public-key`)
      .then((response) => {
        if (!response.ok) throw new Error(`Could not fetch the Kick public key (${response.status})`);
        return response.json() as Promise<{ data: { public_key: string } }>;
      })
      .then(({ data }) => data.public_key)
      .catch((error) => {
        this.publicKey = null;
        throw error;
      });
    return this.publicKey;
  }
}
