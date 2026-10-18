import { KickApiError } from './errors.js';
import { OAUTH_URL, getAppToken } from './oauth.js';
import type {
  AdBreak,
  AdBreakStatus,
  Ban,
  CategoryDetails,
  CategoryWithTags,
  Channel,
  ChannelReward,
  ChannelRewardInput,
  ChannelRewardUpdate,
  ChannelUpdate,
  ChatMessage,
  EventRequest,
  EventSubscription,
  EventSubscriptionResult,
  KickPaginatedResponse,
  KickResponse,
  KicksLeaderboard,
  Livestream,
  LivestreamStats,
  RedemptionFailure,
  RedemptionStatus,
  RewardRedemptions,
  SentChatMessage,
  User,
} from './types.js';

export const API_URL = 'https://api.kick.com';

const TOKEN_EXPIRY_MARGIN_MS = 60_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_TIMEOUT_MS = 15_000;
const BASE_RETRY_DELAY_MS = 500;
const MAX_RETRY_DELAY_MS = 30_000;
const ID_BATCH = 50;
const USER_LIVESTREAM_BATCH = 100;
const REDEMPTION_BATCH = 25;
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'DELETE', 'PUT']);

type QueryValue = string | number | boolean | undefined | Array<string | number>;
type TokenSource = string | (() => string | Promise<string>);
type Auth = 'app' | 'user' | 'any' | 'none';

interface RequestOptions {
  query?: Record<string, QueryValue>;
  body?: unknown;
  auth?: Auth;
}

export interface KickClientOptions {
  /** Client ID of your Kick app, used to get app access tokens. */
  clientId?: string;
  /** Client secret of your Kick app. */
  clientSecret?: string;
  /** User access token, or a function that returns a fresh one for every request. */
  userToken?: TokenSource;
  /** How many times to retry rate-limited requests and temporary Kick errors. Defaults to 2. */
  maxRetries?: number;
  /** Request timeout in milliseconds. Defaults to 15000. */
  timeoutMs?: number;
  /** Custom fetch implementation. */
  fetch?: typeof fetch;
  /** API base URL. Defaults to https://api.kick.com. */
  apiUrl?: string;
  /** OAuth base URL. Defaults to https://id.kick.com. */
  oauthUrl?: string;
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

export interface RedemptionQuery {
  rewardId?: string;
  status?: RedemptionStatus;
  ids?: string[];
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

function rateLimitDelay(response: Response): number | null {
  const retryAfter = Number(response.headers.get('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter * 1000, MAX_RETRY_DELAY_MS);

  const untilReset = Number(response.headers.get('ratelimit-reset')) * 1000 - Date.now();
  return Number.isFinite(untilReset) && untilReset > 0 ? Math.min(untilReset, MAX_RETRY_DELAY_MS) : null;
}

function backoff(attempt: number): number {
  return Math.min(BASE_RETRY_DELAY_MS * 2 ** attempt, MAX_RETRY_DELAY_MS);
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class KickClient {
  private readonly options: KickClientOptions;
  private readonly fetchImpl: typeof fetch;
  private appToken: { value: string; expiresAt: number } | null = null;
  private appTokenRequest: Promise<string> | null = null;

  constructor(options: KickClientOptions = {}) {
    this.options = options;
    this.fetchImpl = options.fetch ?? ((...args) => fetch(...args));
  }

  readonly channels = {
    /** Channels by slugs or broadcaster user IDs (batched by 50), or the authorised user's channel when called without arguments. */
    get: async ({ slugs, broadcasterUserIds }: { slugs?: string[]; broadcasterUserIds?: number[] } = {}): Promise<Channel[]> => {
      if (slugs?.length && broadcasterUserIds?.length) throw new TypeError('Pass either slugs or broadcasterUserIds, not both');
      if (slugs?.length) return this.batched(slugs, ID_BATCH, (slug) => this.get<Channel[]>('/public/v1/channels', { query: { slug } }));
      if (broadcasterUserIds?.length) {
        return this.batched(broadcasterUserIds, ID_BATCH, (ids) => this.get<Channel[]>('/public/v1/channels', { query: { broadcaster_user_id: ids } }));
      }
      return this.get<Channel[]>('/public/v1/channels', { auth: 'user' });
    },

    /** A single channel by its slug, or null when it does not exist. */
    getBySlug: async (slug: string): Promise<Channel | null> => (await this.channels.get({ slugs: [slug.toLowerCase()] }))[0] ?? null,

    /** Changes the stream title, category or tags of the authorised user's channel. Needs `channel:write`. */
    update: async (update: ChannelUpdate): Promise<void> => {
      await this.request('PATCH', '/public/v1/channels', { body: update, auth: 'user' });
    },
  };

  readonly users = {
    /** Users by ID (batched by 50), or the authorised user when called without arguments. */
    get: async (ids?: number[]): Promise<User[]> => {
      if (!ids?.length) return this.get<User[]>('/public/v1/users', { auth: 'user' });
      return this.batched(ids, ID_BATCH, (id) => this.get<User[]>('/public/v1/users', { query: { id } }));
    },
  };

  readonly livestreams = {
    /** One page of live streams, optionally filtered by categories and languages. */
    list: async ({ categoryIds, languageCodes, limit, cursor }: LivestreamQuery = {}): Promise<Page<Livestream>> => {
      const response = await this.request<KickPaginatedResponse<Livestream[]>>('GET', '/public/v2/livestreams', {
        query: { category_id: categoryIds, language_code: languageCodes, limit, cursor },
      });
      return { data: response.data, nextCursor: response.pagination?.next_cursor || null };
    },

    /** Iterates over every live stream that matches the filters, page by page. */
    all: (query: Omit<LivestreamQuery, 'cursor'> = {}): AsyncGenerator<Livestream> => this.paginate((cursor) => this.livestreams.list({ ...query, cursor })),

    /** Live streams of the given broadcaster user IDs (batched by 100). Offline users are left out. */
    forUsers: async (userIds: number[]): Promise<Livestream[]> =>
      this.batched(userIds, USER_LIVESTREAM_BATCH, (user_id) => this.get<Livestream[]>('/public/v1/users/livestreams', { query: { user_id } })),

    /** Total number of live streams on Kick right now. */
    stats: (): Promise<LivestreamStats> => this.get<LivestreamStats>('/public/v1/livestreams/stats'),
  };

  readonly categories = {
    /** One page of categories, optionally filtered by names, tags or IDs. */
    list: async ({ names, tags, ids, limit, cursor }: CategoryQuery = {}): Promise<Page<CategoryWithTags>> => {
      const response = await this.request<KickPaginatedResponse<CategoryWithTags[]>>('GET', '/public/v2/categories', {
        query: { name: names, tag: tags, id: ids, limit, cursor },
      });
      return { data: response.data, nextCursor: response.pagination?.next_cursor || null };
    },

    /** Iterates over every category that matches the filters, page by page. */
    all: (query: Omit<CategoryQuery, 'cursor'> = {}): AsyncGenerator<CategoryWithTags> => this.paginate((cursor) => this.categories.list({ ...query, cursor })),

    /** A single category with its current viewer count. */
    get: (id: number): Promise<CategoryDetails> => this.get<CategoryDetails>(`/public/v1/categories/${id}`),
  };

  readonly chat = {
    /** Sends a chat message as the user or as your bot. Needs `chat:write`. */
    send: (message: ChatMessage): Promise<SentChatMessage> => this.mutate<SentChatMessage>('POST', '/public/v1/chat', message),

    /** Deletes a chat message. Needs `moderation:chat_message:manage`. */
    delete: async (messageId: string): Promise<void> => {
      await this.request('DELETE', `/public/v1/chat/${encodeURIComponent(messageId)}`, { auth: 'user' });
    },
  };

  readonly moderation = {
    /** Bans a user, or times them out when `duration` (minutes, up to 10080) is set. Needs `moderation:ban`. */
    ban: async (ban: Ban): Promise<void> => {
      await this.request('POST', '/public/v1/moderation/bans', { body: ban, auth: 'user' });
    },

    /** Removes a ban or timeout. Needs `moderation:ban`. */
    unban: async ({ broadcaster_user_id, user_id }: Pick<Ban, 'broadcaster_user_id' | 'user_id'>): Promise<void> => {
      await this.request('DELETE', '/public/v1/moderation/bans', { body: { broadcaster_user_id, user_id }, auth: 'user' });
    },
  };

  readonly rewards = {
    /** All channel point rewards of the authorised channel, enabled and disabled. */
    list: (): Promise<ChannelReward[]> => this.get<ChannelReward[]>('/public/v1/channels/rewards', { auth: 'user' }),

    /** Creates a channel point reward. Needs `channel:rewards:write`. */
    create: (reward: ChannelRewardInput): Promise<ChannelReward> => this.mutate<ChannelReward>('POST', '/public/v1/channels/rewards', reward),

    /** Updates a reward created by your app. Needs `channel:rewards:write`. */
    update: (id: string, update: ChannelRewardUpdate): Promise<ChannelReward> =>
      this.mutate<ChannelReward>('PATCH', `/public/v1/channels/rewards/${encodeURIComponent(id)}`, update),

    /** Deletes a reward created by your app. Needs `channel:rewards:write`. */
    delete: async (id: string): Promise<void> => {
      await this.request('DELETE', `/public/v1/channels/rewards/${encodeURIComponent(id)}`, { auth: 'user' });
    },

    /** One page of redemptions, by default the pending ones. */
    redemptions: async ({ rewardId, status, ids, cursor }: RedemptionQuery = {}): Promise<Page<RewardRedemptions>> => {
      const response = await this.request<KickPaginatedResponse<RewardRedemptions[]>>('GET', '/public/v1/channels/rewards/redemptions', {
        query: { reward_id: rewardId, status, id: ids, cursor },
        auth: 'user',
      });
      return { data: response.data, nextCursor: response.pagination?.next_cursor || null };
    },

    /** Accepts redemptions (batched by 25) and returns the ones that could not be accepted. */
    accept: (ids: string[]): Promise<RedemptionFailure[]> =>
      this.batched(ids, REDEMPTION_BATCH, (batch) => this.mutate<RedemptionFailure[]>('POST', '/public/v1/channels/rewards/redemptions/accept', { ids: batch })),

    /** Rejects redemptions (batched by 25) and returns the ones that could not be rejected. */
    reject: (ids: string[]): Promise<RedemptionFailure[]> =>
      this.batched(ids, REDEMPTION_BATCH, (batch) => this.mutate<RedemptionFailure[]>('POST', '/public/v1/channels/rewards/redemptions/reject', { ids: batch })),
  };

  readonly kicks = {
    /** KICKs leaderboard of the authorised broadcaster for the week, month and lifetime. Needs `kicks:read`. */
    leaderboard: (top?: number): Promise<KicksLeaderboard> => this.get<KicksLeaderboard>('/public/v1/kicks/leaderboard', { query: { top }, auth: 'user' }),
  };

  readonly ads = {
    /** Starts an ad break of 7 to 90 seconds. Needs `ads:write`. */
    startBreak: (durationSeconds: number, id: string = crypto.randomUUID()): Promise<AdBreak> =>
      this.mutate<AdBreak>('POST', '/public/v1/ads/ad-break', { break_duration_seconds: durationSeconds, id }),

    /** Current ad break status and limits. Needs `ads:read` or `ads:write`. */
    status: (): Promise<AdBreakStatus> => this.get<AdBreakStatus>('/public/v1/ads/ad-break-status', { auth: 'user' }),

    /** Enrolls the channel in ads. Needs `ads:write`. */
    enroll: async (): Promise<void> => {
      await this.request('POST', '/public/v1/ads/enroll', { auth: 'user' });
    },
  };

  readonly events = {
    /** Your app's event subscriptions, optionally for one broadcaster. */
    list: (broadcasterUserId?: number): Promise<EventSubscription[]> =>
      this.get<EventSubscription[]>('/public/v1/events/subscriptions', { query: { broadcaster_user_id: broadcasterUserId } }),

    /** Subscribes to webhook events. `broadcasterUserId` is required with an app token. */
    subscribe: ({ events, broadcasterUserId }: { events: EventRequest[]; broadcasterUserId?: number }): Promise<EventSubscriptionResult[]> =>
      this.request<KickResponse<EventSubscriptionResult[]>>('POST', '/public/v1/events/subscriptions', {
        body: { events, method: 'webhook', ...(broadcasterUserId !== undefined && { broadcaster_user_id: broadcasterUserId }) },
      }).then(({ data }) => data),

    /** Deletes event subscriptions by ID. */
    unsubscribe: async (subscriptionIds: string[]): Promise<void> => {
      for (const id of chunk(subscriptionIds, ID_BATCH)) await this.request('DELETE', '/public/v1/events/subscriptions', { query: { id } });
    },
  };

  /** Kick's current public key (PEM) for verifying webhook signatures. */
  async publicKey(): Promise<string> {
    const { data } = await this.request<KickResponse<{ public_key: string }>>('GET', '/public/v1/public-key', { auth: 'none' });
    return data.public_key;
  }

  /** Low-level request to any Kick API path, with authentication, retries and errors handled. */
  async request<T = unknown>(method: string, path: string, { query, body, auth = 'any' }: RequestOptions = {}, attempt = 0): Promise<T> {
    const { maxRetries = DEFAULT_MAX_RETRIES, timeoutMs = DEFAULT_TIMEOUT_MS, apiUrl = API_URL } = this.options;
    const retry = async (delay: number) => {
      await sleep(delay);
      return this.request<T>(method, path, { query, body, auth }, attempt + 1);
    };

    const headers: Record<string, string> = {
      ...(auth !== 'none' && { Authorization: `Bearer ${await this.token(auth)}` }),
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
    };

    let response: Response;
    try {
      response = await this.fetchImpl(`${apiUrl}${path}${buildQuery(query)}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (attempt < maxRetries && IDEMPOTENT_METHODS.has(method)) return retry(backoff(attempt));
      throw error;
    }

    if (response.status === 429 && attempt < maxRetries) return retry(rateLimitDelay(response) ?? backoff(attempt));
    if (response.status >= 500 && attempt < maxRetries && IDEMPOTENT_METHODS.has(method)) return retry(backoff(attempt));
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

  private async mutate<T>(method: string, path: string, body: unknown): Promise<T> {
    const { data } = await this.request<KickResponse<T>>(method, path, { body, auth: 'user' });
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
