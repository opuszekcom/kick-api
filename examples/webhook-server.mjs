import { createServer } from 'node:http';
import { WebhookVerifier } from '@opuszek/kick-api';

const verifier = new WebhookVerifier();

createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/webhooks/kick') {
    res.writeHead(404).end();
    return;
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const event = await verifier.verify(req.headers, Buffer.concat(chunks));

  if (!event) {
    res.writeHead(401).end();
    return;
  }

  switch (event.type) {
    case 'livestream.status.updated':
      console.log(`${event.payload.broadcaster.username} is ${event.payload.is_live ? 'live' : 'offline'}: ${event.payload.title}`);
      break;
    case 'chat.message.sent':
      console.log(`${event.payload.sender.username}: ${event.payload.content}`);
      break;
    case 'channel.followed':
      console.log(`${event.payload.follower.username} followed ${event.payload.broadcaster.username}`);
      break;
  }

  res.writeHead(200).end();
}).listen(3000, () => console.log('Listening on http://localhost:3000/webhooks/kick'));
