export interface KickResponse<T> {
  data: T;
  message: string;
}

export interface KickPaginatedResponse<T> extends KickResponse<T> {
  pagination: { next_cursor: string };
}

export interface Category {
  id: number;
  name: string;
  thumbnail: string;
}

export interface CategoryWithTags extends Category {
  tags: string[];
}

export interface CategoryDetails extends CategoryWithTags {
  viewer_count: number;
}

export interface ChannelStream {
  is_live: boolean;
  is_mature: boolean;
  key: string;
  language: string;
  start_time: string;
  thumbnail: string;
  url: string;
  viewer_count: number;
  custom_tags: string[];
}

export interface Channel {
  broadcaster_user_id: number;
  slug: string;
  channel_description: string;
  banner_picture: string;
  stream_title: string;
  active_subscribers_count: number;
  active_gifted_subscribers_count: number;
  canceled_subscribers_count: number;
  category: Category;
  stream: ChannelStream;
}

export interface ChannelUpdate {
  stream_title?: string;
  category_id?: number;
  custom_tags?: string[];
}

export interface User {
  user_id: number;
  name: string;
  email?: string;
  profile_picture: string;
}

export interface Livestream {
  id: string;
  title: string;
  thumbnail: string;
  started_at: string;
  viewer_count: number;
  language_code: string;
  has_mature_content: boolean;
  tags: string[];
  broadcaster_user: { id: number; username: string; profile_picture: string };
  channel: { slug: string };
  category: Category;
}

export interface LivestreamStats {
  total_count: number;
}

export interface EventSubscription {
  id: string;
  event: string;
  version: number;
  method: string;
  app_id: string;
  broadcaster_user_id: number;
  created_at: string;
  updated_at: string;
}

export interface EventSubscriptionResult {
  name: string;
  version: number;
  subscription_id?: string;
  error?: string;
}

export interface EventRequest {
  name: KickEventType | (string & {});
  version: number;
}

export type KickEventType =
  | 'chat.message.sent'
  | 'channel.followed'
  | 'channel.subscription.renewal'
  | 'channel.subscription.gifts'
  | 'channel.subscription.new'
  | 'channel.reward.redemption.updated'
  | 'livestream.status.updated'
  | 'livestream.metadata.updated'
  | 'moderation.banned'
  | 'kicks.gifted';
