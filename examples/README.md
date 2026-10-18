# Examples

| File | What it does |
| --- | --- |
| [`webhook-server.mjs`](webhook-server.mjs) | Plain Node.js server that verifies Kick webhooks and logs live, chat and follow events. |
| [`cloudflare-worker.ts`](cloudflare-worker.ts) | The same webhook check running on Cloudflare Workers. |
| [`discord-live-alert.mjs`](discord-live-alert.mjs) | Subscribes to one Kick channel and posts to a Discord webhook when it goes live. |

Kick sends webhooks to the URL set in your app's settings on Kick, so the server has to be reachable from the internet. For local testing use a tunnel such as [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) or ngrok.

## Discord live alert

```sh
KICK_CLIENT_ID=... KICK_CLIENT_SECRET=... KICK_CHANNEL=your-channel \
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/... node discord-live-alert.mjs
```

Want this for many channels without hosting anything? [Opuszek](https://opuszek.com) sends Kick, Twitch, YouTube and TikTok live notifications to Discord, with a dashboard for messages, roles and embeds.
