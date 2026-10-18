import type { KickEventType } from './types.js';

export interface EventUser {
  is_anonymous: boolean;
  user_id: number;
  username: string;
  is_verified: boolean;
  profile_picture: string;
  channel_slug: string;
  identity: null;
}

export interface EventUserReduced {
  user_id: number;
  username: string;
  is_verified: boolean;
  profile_picture: string;
  channel_slug: string;
}

export interface ChatBadge {
  text: string;
  type: string;
  count?: number;
}

export interface ChatMessageSent {
  message_id: string;
  replies_to: {
    message_id: string;
    content: string;
    sender: EventUser;
  } | null;
  broadcaster: EventUser;
  sender: Omit<EventUser, 'identity'> & { identity: { username_color: string; badges: ChatBadge[] } };
  content: string;
  emotes: Array<{ emote_id: string; positions: Array<{ s: number; e: number }> }>;
  created_at: string;
}

export interface ChannelFollowed {
  broadcaster: EventUser;
  follower: EventUser;
}

export interface ChannelSubscription {
  broadcaster: EventUser;
  subscriber: EventUser;
  duration: number;
  created_at: string;
  expires_at: string;
}

export interface ChannelSubscriptionGifts {
  broadcaster: EventUser;
  gifter: EventUser;
  giftees: EventUser[];
  created_at: string;
  expires_at: string;
}

export interface ChannelRewardRedemptionUpdated {
  id: string;
  user_input: string;
  status: 'pending' | 'accepted' | 'rejected';
  redeemed_at: string;
  reward: { id: string; title: string; cost: number; description: string };
  redeemer: EventUserReduced;
  broadcaster: EventUserReduced;
}

export interface LivestreamStatusUpdated {
  broadcaster: EventUser;
  is_live: boolean;
  title: string;
  started_at: string;
  ended_at: string | null;
}

export interface LivestreamMetadataUpdated {
  broadcaster: EventUser;
  metadata: {
    title: string;
    language: string;
    has_mature_content: boolean;
    category: { id: number; name: string; thumbnail: string };
  };
}

export interface ModerationBanned {
  broadcaster: EventUser;
  moderator: EventUser;
  banned_user: EventUser;
  metadata: { reason: string; created_at: string; expires_at: string | null };
}

export interface KicksGifted {
  broadcaster: EventUserReduced;
  sender: EventUserReduced;
  gift: { amount: number; name: string; type: string; tier: string; message: string; pinned_time_seconds: number };
  created_at: string;
}

export interface KickEventPayloads {
  'chat.message.sent': ChatMessageSent;
  'channel.followed': ChannelFollowed;
  'channel.subscription.renewal': ChannelSubscription;
  'channel.subscription.gifts': ChannelSubscriptionGifts;
  'channel.subscription.new': ChannelSubscription;
  'channel.reward.redemption.updated': ChannelRewardRedemptionUpdated;
  'livestream.status.updated': LivestreamStatusUpdated;
  'livestream.metadata.updated': LivestreamMetadataUpdated;
  'moderation.banned': ModerationBanned;
  'kicks.gifted': KicksGifted;
}

export type KickWebhookEvent = {
  [Type in KickEventType]: {
    type: Type;
    version: string;
    messageId: string;
    subscriptionId: string;
    timestamp: string;
    payload: KickEventPayloads[Type];
  };
}[KickEventType];
