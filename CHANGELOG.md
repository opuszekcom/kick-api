# Changelog

All notable changes to this project are documented here. The project follows [Semantic Versioning](https://semver.org).

## 0.1.0

First release.

- `KickClient` with automatic app access tokens, optional user tokens and request timeouts
- Channels, users, livestreams, categories, chat, moderation, channel point rewards, KICKs leaderboard, ads and event subscriptions
- Cursor pagination with `.all()` async iterators, ID lists split into batches automatically
- Retries for rate limits (`429`) and temporary Kick errors (`5xx`); write requests are never repeated after a dropped connection
- `WebhookVerifier`, `verifyWebhookSignature` and `parseWebhookEvent` with typed payloads for all ten event types
- OAuth 2.1 helpers with PKCE: `createPkce`, `getAuthorizationUrl`, `exchangeCode`, `refreshUserToken`, `revokeToken`
- Zero dependencies, runs on Node.js 20.19+, Bun, Deno and Cloudflare Workers
