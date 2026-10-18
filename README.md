# @opuszek/kick-api

Typed, zero-dependency client for the official [Kick.com public API](https://docs.kick.com).

- App access tokens are fetched and refreshed for you
- Channels, users, livestreams, categories and event subscriptions
- Webhook signature verification and typed event payloads
- OAuth 2.1 helpers with PKCE for user tokens
- Long ID lists are split into batches, cursor pages can be iterated, `429` responses are retried
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
| `maxRetries`   | How many times to retry a rate-limited (`429`) request, default 2 |
| `fetch`        | Custom `fetch` implementation                                      |
| `apiUrl`       | Override the API base URL, default `https://api.kick.com`          |
| `oauthUrl`     | Override the OAuth base URL, default `https://id.kick.com`         |

## License

MIT
