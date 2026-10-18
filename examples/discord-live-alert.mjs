import { createServer } from 'node:http';
import { KickClient, WebhookVerifier } from '@opuszek/kick-api';

const { KICK_CLIENT_ID, KICK_CLIENT_SECRET, KICK_CHANNEL, DISCORD_WEBHOOK_URL, PORT = '3000' } = process.env;

const kick = new KickClient({ clientId: KICK_CLIENT_ID, clientSecret: KICK_CLIENT_SECRET });
const verifier = new WebhookVerifier();

const channel = await kick.channels.getBySlug(KICK_CHANNEL);
if (!channel) throw new Error(`Kick channel "${KICK_CHANNEL}" not found`);

const [result] = await kick.events.subscribe({
  broadcasterUserId: channel.broadcaster_user_id,
  events: [{ name: 'livestream.status.updated', version: 1 }],
});
console.log(result?.error ? `Subscription error: ${result.error}` : `Subscribed to ${channel.slug} (${result?.subscription_id})`);

async function announce({ broadcaster, title }) {
  await fetch(DISCORD_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: `**${broadcaster.username}** is live on Kick!`,
      embeds: [{ title, url: `https://kick.com/${broadcaster.channel_slug}`, color: 0x53fc18 }],
    }),
  });
}

createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const event = await verifier.verify(req.headers, Buffer.concat(chunks));

  if (event?.type === 'livestream.status.updated' && event.payload.is_live) await announce(event.payload);
  res.writeHead(event ? 200 : 401).end();
}).listen(Number(PORT), () => console.log(`Waiting for Kick webhooks on port ${PORT}`));
