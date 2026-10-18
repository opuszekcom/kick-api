export interface KickResponse<T> {
  data: T;
  message: string;
}

export interface KickPaginatedResponse<T> extends KickResponse<T> {
  pagination: { next_cursor: string };
}

export type KickScope =
  | 'user:read'
  | 'channel:read'
  | 'channel:write'
  | 'channel:rewards:read'
  | 'channel:rewards:write'
  | 'chat:write'
  | 'streamkey:read'
  | 'events:subscribe'
  | 'moderation:ban'
  | 'moderation:chat_message:manage'
  | 'kicks:read'
  | 'ads:read'
  | 'ads:write';

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

export interface ChatMessage {
  content: string;
  type: 'user' | 'bot';
  broadcaster_user_id?: number;
  reply_to_message_id?: string;
}

export interface SentChatMessage {
  is_sent: boolean;
  message_id: string;
}

export interface Ban {
  broadcaster_user_id: number;
  user_id: number;
  duration?: number;
  reason?: string;
}

export interface ChannelReward {
  id: string;
  title: string;
  description: string;
  cost: number;
  background_color: string;
  is_enabled: boolean;
  is_paused: boolean;
  is_user_input_required: boolean;
  should_redemptions_skip_request_queue: boolean;
}

export interface ChannelRewardInput {
  title: string;
  cost: number;
  description?: string;
  background_color?: string;
  is_enabled?: boolean;
  is_user_input_required?: boolean;
  should_redemptions_skip_request_queue?: boolean;
}

export type ChannelRewardUpdate = Partial<ChannelRewardInput> & { is_paused?: boolean };

export type RedemptionStatus = 'pending' | 'accepted' | 'rejected';

export interface RewardRedemptions {
  reward: { id: string; title: string; description?: string; cost?: number; can_manage?: boolean; is_deleted?: boolean };
  redemptions: Array<{
    id: string;
    redeemed_at: string;
    redeemer: { user_id: number };
    status: RedemptionStatus;
    user_input: string;
  }>;
}

export interface RedemptionFailure {
  id: string;
  reason: 'UNKNOWN' | 'NOT_PENDING' | 'NOT_FOUND' | 'NOT_OWNED';
}

export interface KicksLeaderboardEntry {
  gifted_amount: number;
  rank: number;
  user_id: number;
  username: string;
}

export interface KicksLeaderboard {
  lifetime: KicksLeaderboardEntry[];
  month: KicksLeaderboardEntry[];
  week: KicksLeaderboardEntry[];
}

export interface AdBreak {
  id: string;
  remaining_ad_breaks: number;
}

export interface AdBreakStatus {
  ad_breaks: Array<{ id: string; break_duration_seconds: number; created_at: string; source: string; status: string }>;
  ads_blocked: boolean;
  auto_ads_active: boolean;
  limits: { max: number; period_seconds: number };
  opted_in: boolean;
  remaining_ad_breaks: number;
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
