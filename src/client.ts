import { KickApiError } from './errors.js';
import { OAUTH_URL, getAppToken } from './oauth.js';
import type {
  CategoryDetails,
  CategoryWithTags,
  Channel,
  ChannelUpdate,
  EventRequest,
  EventSubscription,
  EventSubscriptionResult,
  KickPaginatedResponse,
  KickResponse,
  Livestream,
  LivestreamStats,
  User,
} from './types.js';

export const API_URL = 'https://api.kick.com';

const TOKEN_EXPIRY_MARGIN_MS = 60_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 30_000;
const CHANNEL_BATCH = 50;
const USER_LIVESTREAM_BATCH = 100;

type QueryValue = string | number | boolean | undefined | Array<string | number>;
type TokenSource = string | (() => string | Promise<string>);
type Auth = 'app' | 'user' | 'any' | 'none';

interface RequestOptions {
  query?: Record<string, QueryValue>;
  body?: unknown;
  auth?: Auth;
}

export interface KickClientOptions {
  clientId?: string;
  clientSecret?: string;
  userToken?: TokenSource;
  fetch?: typeof fetch;
  apiUrl?: string;
  oauthUrl?: string;
  maxRetries?: number;
}

export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}

export interface LivestreamQuery {
  categoryIds?: number[];
  languageCodes?: string[];
  limit?: number;
  cursor?: string;
}

export interface CategoryQuery {
  names?: string[];
  tags?: string[];
  ids?: number[];
  limit?: number;
  cursor?: string;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function buildQuery(query: Record<string, QueryValue> = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, String(item));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

function retryDelay(response: Response): number {
  const retryAfter = Number(response.headers.get('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter * 1000, MAX_RETRY_DELAY_MS);

  const resetAt = Number(response.headers.get('ratelimit-reset')) * 1000;
  const untilReset = resetAt - Date.now();
  return Number.isFinite(untilReset) && untilReset > 0 ? Math.min(untilReset, MAX_RETRY_DELAY_MS) : DEFAULT_RETRY_DELAY_MS;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class KickClient {
  readonly channels;
  readonly users;
  readonly livestreams;
  readonly categories;
  readonly events;

  private readonly options: KickClientOptions;
  private readonly fetchImpl: typeof fetch;
  private appToken: { value: string; expiresAt: number } | null = null;
  private appTokenRequest: Promise<string> | null = null;

  constructor(options: KickClientOptions = {}) {
    this.options = options;
    this.fetchImpl = options.fetch ?? ((...args) => fetch(...args));

    this.channels = {
      get: async ({ slugs, broadcasterUserIds }: { slugs?: string[]; broadcasterUserIds?: number[] } = {}): Promise<Channel[]> => {
        if (slugs?.length && broadcasterUserIds?.length) throw new TypeError('Pass either slugs or broadcasterUserIds, not both');
        if (slugs?.length) return this.batched(slugs, CHANNEL_BATCH, (slug) => this.get<Channel[]>('/public/v1/channels', { query: { slug } }));
        if (broadcasterUserIds?.length) {
          return this.batched(broadcasterUserIds, CHANNEL_BATCH, (ids) => this.get<Channel[]>('/public/v1/channels', { query: { broadcaster_user_id: ids } }));
        }
        return this.get<Channel[]>('/public/v1/channels', { auth: 'user' });
      },
      getBySlug: async (slug: string): Promise<Channel | null> => (await this.channels.get({ slugs: [slug.toLowerCase()] }))[0] ?? null,
      update: async (update: ChannelUpdate): Promise<void> => {
        await this.request('PATCH', '/public/v1/channels', { body: update, auth: 'user' });
      },
    };

    this.users = {
      get: async (ids?: number[]): Promise<User[]> => {
        if (!ids?.length) return this.get<User[]>('/public/v1/users', { auth: 'user' });
        return this.batched(ids, CHANNEL_BATCH, (id) => this.get<User[]>('/public/v1/users', { query: { id } }));
      },
    };

    this.livestreams = {
      list: async ({ categoryIds, languageCodes, limit, cursor }: LivestreamQuery = {}): Promise<Page<Livestream>> => {
        const response = await this.request<KickPaginatedResponse<Livestream[]>>('GET', '/public/v2/livestreams', {
          query: { category_id: categoryIds, language_code: languageCodes, limit, cursor },
        });
        return { data: response.data, nextCursor: response.pagination?.next_cursor || null };
      },
      all: (query: Omit<LivestreamQuery, 'cursor'> = {}): AsyncGenerator<Livestream> => this.paginate((cursor) => this.livestreams.list({ ...query, cursor })),
      forUsers: async (userIds: number[]): Promise<Livestream[]> =>
        this.batched(userIds, USER_LIVESTREAM_BATCH, (user_id) => this.get<Livestream[]>('/public/v1/users/livestreams', { query: { user_id } })),
      stats: (): Promise<LivestreamStats> => this.get<LivestreamStats>('/public/v1/livestreams/stats'),
    };

    this.categories = {
      list: async ({ names, tags, ids, limit, cursor }: CategoryQuery = {}): Promise<Page<CategoryWithTags>> => {
        const response = await this.request<KickPaginatedResponse<CategoryWithTags[]>>('GET', '/public/v2/categories', {
          query: { name: names, tag: tags, id: ids, limit, cursor },
        });
        return { data: response.data, nextCursor: response.pagination?.next_cursor || null };
      },
      all: (query: Omit<CategoryQuery, 'cursor'> = {}): AsyncGenerator<CategoryWithTags> => this.paginate((cursor) => this.categories.list({ ...query, cursor })),
      get: (id: number): Promise<CategoryDetails> => this.get<CategoryDetails>(`/public/v1/categories/${id}`),
    };

    this.events = {
      list: (broadcasterUserId?: number): Promise<EventSubscription[]> =>
        this.get<EventSubscription[]>('/public/v1/events/subscriptions', { query: { broadcaster_user_id: broadcasterUserId } }),
      subscribe: ({ events, broadcasterUserId }: { events: EventRequest[]; broadcasterUserId?: number }): Promise<EventSubscriptionResult[]> =>
        this.request<KickResponse<EventSubscriptionResult[]>>('POST', '/public/v1/events/subscriptions', {
          body: { events, method: 'webhook', ...(broadcasterUserId !== undefined && { broadcaster_user_id: broadcasterUserId }) },
        }).then(({ data }) => data),
      unsubscribe: async (subscriptionIds: string[]): Promise<void> => {
        for (const id of chunk(subscriptionIds, CHANNEL_BATCH)) await this.request('DELETE', '/public/v1/events/subscriptions', { query: { id } });
      },
    };
  }

  async publicKey(): Promise<string> {
    const { data } = await this.request<KickResponse<{ public_key: string }>>('GET', '/public/v1/public-key', { auth: 'none' });
    return data.public_key;
  }

  async request<T = unknown>(method: string, path: string, { query, body, auth = 'any' }: RequestOptions = {}, attempt = 0): Promise<T> {
    const response = await this.fetchImpl(`${this.options.apiUrl ?? API_URL}${path}${buildQuery(query)}`, {
      method,
      headers: {
        ...(auth !== 'none' && { Authorization: `Bearer ${await this.token(auth)}` }),
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const maxRetries = this.options.maxRetries ?? DEFAULT_MAX_RETRIES;
    if (response.status === 429 && attempt < maxRetries) {
      await sleep(retryDelay(response));
      return this.request(method, path, { query, body, auth }, attempt + 1);
    }
    if (response.status === 401 && attempt === 0 && this.usesAppToken(auth)) {
      this.appToken = null;
      return this.request(method, path, { query, body, auth }, attempt + 1);
    }

    const text = await response.text();
    const parsed = text ? safeJson(text) : null;
    if (!response.ok) throw new KickApiError({ status: response.status, method, path, body: parsed });
    return parsed as T;
  }

  private async get<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { data } = await this.request<KickResponse<T>>('GET', path, options);
    return data;
  }

  private async batched<T, R>(items: T[], size: number, load: (batch: T[]) => Promise<R[]>): Promise<R[]> {
    const results: R[] = [];
    for (const batch of chunk(items, size)) results.push(...(await load(batch)));
    return results;
  }

  private async *paginate<T>(loadPage: (cursor?: string) => Promise<Page<T>>): AsyncGenerator<T> {
    let cursor: string | undefined;
    do {
      const page = await loadPage(cursor);
      yield* page.data;
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }

  private usesAppToken(auth: Auth): boolean {
    return auth === 'app' || (auth === 'any' && !this.options.userToken);
  }

  private async token(auth: Auth): Promise<string> {
    const { userToken } = this.options;
    if (auth !== 'app' && userToken) return typeof userToken === 'function' ? userToken() : userToken;
    if (auth === 'user') throw new TypeError('This endpoint needs a user access token. Pass `userToken` to KickClient.');
    return this.getAppToken();
  }

  private async getAppToken(): Promise<string> {
    if (this.appToken && Date.now() < this.appToken.expiresAt) return this.appToken.value;

    const { clientId, clientSecret, oauthUrl = OAUTH_URL } = this.options;
    if (!clientId || !clientSecret) throw new TypeError('Pass clientId and clientSecret (or a userToken) to KickClient.');

    this.appTokenRequest ??= getAppToken({ clientId, clientSecret, oauthUrl, fetch: this.fetchImpl })
      .then(({ access_token, expires_in }) => {
        this.appToken = { value: access_token, expiresAt: Date.now() + expires_in * 1000 - TOKEN_EXPIRY_MARGIN_MS };
        return access_token;
      })
      .finally(() => {
        this.appTokenRequest = null;
      });
    return this.appTokenRequest;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
