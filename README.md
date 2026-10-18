# @opuszek/kick-api

[![npm](https://img.shields.io/npm/v/@opuszek/kick-api)](https://www.npmjs.com/package/@opuszek/kick-api)
[![CI](https://github.com/opuszekcom/kick-api/actions/workflows/ci.yml/badge.svg)](https://github.com/opuszekcom/kick-api/actions/workflows/ci.yml)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@opuszek/kick-api)](https://bundlephobia.com/package/@opuszek/kick-api)
[![license](https://img.shields.io/npm/l/@opuszek/kick-api)](LICENSE)

Typed, zero-dependency client for the official [Kick.com public API](https://docs.kick.com).

- App access tokens are fetched and refreshed for you
- The whole public API: channels, users, livestreams, categories, chat, moderation, channel point rewards, KICKs, ads and event subscriptions
- Webhook signature verification and typed event payloads
- OAuth 2.1 helpers with PKCE for user tokens
- Long ID lists are split into batches, cursor pages can be iterated, rate limits and temporary Kick errors are retried, requests time out
- Works in Node.js 20.19+, Bun, Deno and Cloudflare Workers (uses `fetch` and Web Crypto only)

Built and used in production by [Opuszek](https://opuszek.com), a Discord bot for stream notifications.

> This is an unofficial library. It is not affiliated with or endorsed by Kick.

## Install

```sh
npm install @opuszek/kick-api
```

## Quick start

Create an app in your [Kick developer settings](https://kick.com/settings/developer) to get a client ID and secret.

```ts
import { KickClient } from '@opuszek/kick-api';

const kick = new KickClient({
  clientId: process.env.KICK_CLIENT_ID,
  clientSecret: process.env.KICK_CLIENT_SECRET,
});

const channel = await kick.channels.getBySlug('your-channel');
console.log(channel?.stream.is_live, channel?.stream_title);
```

## API

### Channels

```ts
await kick.channels.get({ slugs: ['channel-one', 'channel-two'] });
await kick.channels.get({ broadcasterUserIds: [123456, 234567] });
await kick.channels.getBySlug('your-channel');

// needs a user token with the channel:write scope
await kick.channels.update({ stream_title: 'Late night chill', category_id: 15 });
```

### Livestreams

```ts
const page = await kick.livestreams.list({ categoryIds: [1552], languageCodes: ['en'], limit: 100 });
const next = await kick.livestreams.list({ cursor: page.nextCursor });

for await (const stream of kick.livestreams.all({ categoryIds: [1552] })) {
  console.log(stream.channel.slug, stream.viewer_count);
}

await kick.livestreams.forUsers([123456, 234567]);
await kick.livestreams.stats();
```

### Users and categories

```ts
await kick.users.get([123456]);

await kick.categories.list({ names: ['Counter-Strike 2'] });
await kick.categories.get(1552);
```

### Chat and moderation

These need a user token (see [User tokens](#user-tokens-oauth-21-with-pkce)).

```ts
const sent = await kick.chat.send({ type: 'user', broadcaster_user_id: 123456, content: 'Hello chat!' });
await kick.chat.send({ type: 'bot', content: 'Reply', reply_to_message_id: sent.message_id });
await kick.chat.delete(sent.message_id);

await kick.moderation.ban({ broadcaster_user_id: 123456, user_id: 345678, duration: 10, reason: 'Spam' });
await kick.moderation.unban({ broadcaster_user_id: 123456, user_id: 345678 });
```

### Channel point rewards, KICKs and ads

```ts
const reward = await kick.rewards.create({ title: 'Hydrate!', cost: 500 });
await kick.rewards.update(reward.id, { is_paused: true });

const { data } = await kick.rewards.redemptions({ status: 'pending' });
const failed = await kick.rewards.accept(data.flatMap(({ redemptions }) => redemptions.map(({ id }) => id)));

await kick.kicks.leaderboard(10);

await kick.ads.status();
await kick.ads.startBreak(60);
```

### Any other endpoint

```ts
const response = await kick.request('GET', '/public/v1/livestreams/stats');
```

### Event subscriptions (webhooks)

```ts
const results = await kick.events.subscribe({
  broadcasterUserId: 123456,
  events: [{ name: 'livestream.status.updated', version: 1 }],
});

await kick.events.list(123456);
await kick.events.unsubscribe(results.map((result) => result.subscription_id!));
```

## Receiving webhooks

`WebhookVerifier` fetches Kick's public key, checks the signature and message age, and returns a typed event. Pass the **raw** request body, not parsed JSON.

```ts
import express from 'express';
import { WebhookVerifier } from '@opuszek/kick-api';

const verifier = new WebhookVerifier();
const app = express();

app.post('/webhooks/kick', express.raw({ type: 'application/json' }), async (req, res) => {
  const event = await verifier.verify(req.headers, req.body);
  if (!event) return res.sendStatus(401);

  if (event.type === 'livestream.status.updated') {
    console.log(event.payload.broadcaster.username, event.payload.is_live ? 'went live' : 'went offline');
  }

  res.sendStatus(200);
});
```

The same works with the Fetch API (`Request`) in Bun, Deno or Workers:

```ts
const event = await verifier.verify(request.headers, await request.text());
```

If you manage the key yourself, use the lower-level functions:

```ts
import { parseWebhookEvent, verifyWebhookSignature } from '@opuszek/kick-api';

const valid = await verifyWebhookSignature({ headers, body, publicKey });
const event = valid ? parseWebhookEvent(headers, body) : null;
```

All ten event types from the Kick docs are typed: `chat.message.sent`, `channel.followed`, `channel.subscription.new`, `channel.subscription.renewal`, `channel.subscription.gifts`, `channel.reward.redemption.updated`, `livestream.status.updated`, `livestream.metadata.updated`, `moderation.banned` and `kicks.gifted`.

## User tokens (OAuth 2.1 with PKCE)

```ts
import { createPkce, exchangeCode, getAuthorizationUrl, refreshUserToken, KickClient } from '@opuszek/kick-api';

const { codeVerifier, codeChallenge } = await createPkce();
const url = getAuthorizationUrl({
  clientId,
  redirectUri: 'https://example.com/callback',
  scopes: ['user:read', 'channel:read', 'channel:write'],
  state: crypto.randomUUID(),
  codeChallenge,
});

// after Kick redirects back with ?code=...
const token = await exchangeCode({ clientId, clientSecret }, { code, redirectUri: 'https://example.com/callback', codeVerifier });

const kick = new KickClient({ userToken: token.access_token });
await kick.channels.update({ stream_title: 'Hello from the API' });

// later
const refreshed = await refreshUserToken({ clientId, clientSecret }, token.refresh_token);
```

`userToken` can also be a function, so you can return a fresh token from your own storage on every request.

## Errors

API errors throw `KickApiError` with `status`, `method`, `path` and the response `body`. OAuth errors throw `KickAuthError`.

```ts
import { KickApiError } from '@opuszek/kick-api';

try {
  await kick.categories.get(999999);
} catch (error) {
  if (error instanceof KickApiError && error.status === 404) console.log('No such category');
}
```

## Options

| Option         | Description                                                        |
| -------------- | ------------------------------------------------------------------ |
| `clientId`     | Your Kick app client ID, used for app access tokens                |
| `clientSecret` | Your Kick app client secret                                        |
| `userToken`    | A user access token, or a function returning one                   |
| `maxRetries`   | Retries for rate limits and temporary Kick errors, default 2      |
| `timeoutMs`    | Request timeout in milliseconds, default 15000                     |
| `fetch`        | Custom `fetch` implementation                                      |
| `apiUrl`       | Override the API base URL, default `https://api.kick.com`          |
| `oauthUrl`     | Override the OAuth base URL, default `https://id.kick.com`         |

## Examples

See [`examples/`](examples) for a webhook server, a Cloudflare Worker and a Discord live alert.

Write requests such as `chat.send` are never repeated after a dropped connection, so a message cannot be posted twice.

## License

MIT
