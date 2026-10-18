import { WebhookVerifier } from '@opuszek/kick-api';

const verifier = new WebhookVerifier();

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return new Response('Not found', { status: 404 });

    const event = await verifier.verify(request.headers, await request.arrayBuffer());
    if (!event) return new Response('Invalid signature', { status: 401 });

    if (event.type === 'livestream.status.updated' && event.payload.is_live) {
      console.log(`${event.payload.broadcaster.username} went live: ${event.payload.title}`);
    }

    return new Response('OK');
  },
};
